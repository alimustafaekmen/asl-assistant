"""Fast regression checks for the browser UI wiring.

These tests intentionally stay static and cheap. They catch browser-breaking
drift that unit tests often miss: a renamed DOM id, script order changes in
classic JS, a script that is never loaded, a global that two scripts declare,
weak default model-test fixtures, or a word recording UX guard accidentally
being removed.

Behaviour contracts are checked against every file under `asl-web/js`, because
the browser loads those scripts into one shared global scope. Which file owns a
given function is a layout decision, not a runtime contract.
"""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = PROJECT_ROOT / "asl-web"
INDEX_HTML = WEB_DIR / "index.html"
WEB_JS_DIR = WEB_DIR / "js"
FEATURES_JS = WEB_JS_DIR / "ml" / "features.js"
LANDMARKS_JS = WEB_JS_DIR / "ml" / "landmarks.js"
GATING_JS = WEB_JS_DIR / "ml" / "gating.js"
MODEL_TEST_MANIFEST = WEB_DIR / "data" / "model-test-samples" / "manifest.json"
LOCAL_MODEL_TEST_MANIFEST = WEB_DIR / "data" / "model-test-samples" / "local" / "manifest.json"
WEB_JS_README = WEB_JS_DIR / "README.md"
WEB_README = WEB_DIR / "README.md"

# Functions the browser app must keep, wherever they end up living. The browser
# loads classic scripts into one shared global scope, so "defined once across
# all of js/" is the real contract; the owning file is free to change.
REQUIRED_WEB_FUNCTIONS = (
    # Bootstrap and routing
    "init",
    "bindEvents",
    "modeFromHash",
    "setMode",
    "toggleCamera",
    "stopCamera",
    "renderLoop",
    "drawOverlay",
    # Prediction presentation
    "updatePrediction",
    "renderTop3",
    "assessWordResult",
    "formatTopPredictions",
    "getConfidenceLevel",
    "setMessage",
    "showFeedback",
    "clearFeedback",
    # Transcript
    "appendCurrentLetter",
    "appendWordResultToTranscript",
    "appendTranscriptToken",
    "renderTranscript",
    "saveTranscript",
    "restoreTranscript",
    # Word recording flow
    "startWordRecording",
    "retryWordRecording",
    "canCaptureWordInCurrentMode",
    "updateWordState",
    "updateWordRecordingHud",
    "syncRecordButton",
    "syncActionBar",
    # Coach
    "buildCoachOptions",
    "updateCoachPanel",
    "checkCoachTarget",
    "nextCoachTarget",
    "updateCoachFromPrediction",
    "renderWordGuidancePanel",
    "queryUi",
    "queryAllUi",
    "isEditableTarget",
    "readConfusionPair",
    # Reference and QR
    "loadReferenceVideoLinks",
    "updateReferenceForMode",
    "buildReferenceVideoUrl",
    "toggleReference",
    "bindReferenceLightbox",
    "getDemoBaseUrl",
    "buildQrDemoUrl",
    "renderQrDemo",
    "copyQrDemoUrl",
    # Model Test
    "loadModelTestManifest",
    "loadPreferredModelTestSample",
    "loadAndRunPreferredModelTestSample",
    "normalizeModelTestSample",
    "flattenNumericArray",
    "normalizeMask",
    "runModelTestSample",
    "runOfflineCheck",
    # Camera, overlay, and live inference
    "startMediaPipe",
    "stopMediaPipe",
    "drawLandmarks",
    "_getVideoCoverRect",
    "realInference",
    "resetWordRecordingStats",
    "_finishWordRecordingReal",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _load_json(path: Path):
    return json.loads(_read(path))


def _web_js_sources() -> dict[str, str]:
    """Every browser script, keyed by its path relative to asl-web/."""
    return {
        path.relative_to(WEB_DIR).as_posix(): _read(path)
        for path in sorted(WEB_JS_DIR.rglob("*.js"))
    }


def _web_js_corpus() -> str:
    """All browser scripts concatenated.

    The app runs as classic scripts in one global scope, so behaviour contracts
    hold across the whole directory rather than inside a single file. Using the
    corpus keeps these tests meaningful while modules are split apart.
    """
    return "\n".join(_web_js_sources().values())


def _web_function_body(name: str) -> str:
    """Return the source of a top-level browser function, braces included.

    Browser scripts keep top-level declarations at column 0, so the body ends at
    the first line that is exactly a closing brace.
    """
    header = re.compile(rf"^(?:async\s+)?function\s+{re.escape(name)}\s*\(", flags=re.MULTILINE)
    for source in _web_js_sources().values():
        match = header.search(source)
        if match is None:
            continue
        end = re.compile(r"^\}$", flags=re.MULTILINE).search(source, match.end())
        assert end is not None, f"unterminated function body: {name}"
        return source[match.start() : end.end()]
    raise AssertionError(f"browser function not found: {name}")


def _jsdoc_union(name: str) -> set[str]:
    """Return the string members of a JSDoc string-union typedef."""
    pattern = re.compile(rf"@typedef\s*\{{(?P<body>[^}}]*)\}}\s*{re.escape(name)}\b")
    for source in _web_js_sources().values():
        match = pattern.search(source)
        if match is not None:
            return set(re.findall(r'"([^"]+)"', match.group("body")))
    raise AssertionError(f"JSDoc union not found: {name}")


def _literal_arguments(function_name: str, position: int) -> set[str]:
    """Return the literal lower-case strings passed at `position` of a call."""
    opener = re.compile(rf"\b{re.escape(function_name)}\(")
    found: set[str] = set()
    for source in _web_js_sources().values():
        for match in opener.finditer(source):
            index, depth = match.end(), 1
            while index < len(source) and depth:
                if source[index] == "(":
                    depth += 1
                elif source[index] == ")":
                    depth -= 1
                index += 1
            call = source[match.end() : index - 1]
            parts = call.rsplit(",", 1)
            if len(parts) <= position:
                continue
            found.update(re.findall(r'"([a-z_]+)"', parts[position]))
    return found


def _definition_sites(name: str) -> list[str]:
    """Files that declare `name` at the top level of a browser script."""
    pattern = re.compile(
        rf"^(?:async\s+)?function\s+{re.escape(name)}\s*\(|^(?:const|let|var)\s+{re.escape(name)}\b",
        flags=re.MULTILINE,
    )
    return [rel_path for rel_path, source in _web_js_sources().items() if pattern.search(source)]


class HtmlSnapshot(HTMLParser):
    """Small structural view of HTML; ignores formatting and attribute order."""

    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()
        self.id_list: list[str] = []
        self.scripts: list[str] = []
        self.nodes: list[tuple[str, dict[str, str]]] = []

        self.feed(source)

    def handle_starttag(self, tag: str, attrs):
        attributes = {key: value or "" for key, value in attrs}
        self.nodes.append((tag, attributes))
        if element_id := attributes.get("id"):
            self.ids.add(element_id)
            self.id_list.append(element_id)
        if tag == "script" and (src := attributes.get("src")):
            self.scripts.append(src)

    def first_with_class(self, class_name: str) -> int:
        for index, (_, attrs) in enumerate(self.nodes):
            if class_name in attrs.get("class", "").split():
                return index
        raise AssertionError(f"HTML class not found: {class_name}")

    def tag_for_id(self, element_id: str) -> str | None:
        for tag, attrs in self.nodes:
            if attrs.get("id") == element_id:
                return tag
        return None

    def has(self, tag: str, *, class_name: str | None = None) -> bool:
        return any(
            node_tag == tag and (class_name is None or class_name in attrs.get("class", "").split())
            for node_tag, attrs in self.nodes
        )

    def attribute_values(self, attribute: str) -> set[str]:
        return {attrs[attribute] for _, attrs in self.nodes if attribute in attrs}

    def id_references(self, attribute: str) -> set[str]:
        """Ids named by an attribute that points at other elements by id."""
        targets: set[str] = set()
        for _, attrs in self.nodes:
            if value := attrs.get(attribute):
                targets.update(value.split())
        return targets

    def inline_handlers(self) -> list[str]:
        return sorted(
            f"<{tag} {name}>"
            for tag, attrs in self.nodes
            for name in attrs
            if name.startswith("on")
        )


# How a browser script can bind a DOM id. requireElement() and optionalElement()
# wrap getElementById(), so an id reaching the app through them is just as real
# as a direct call and must exist in index.html all the same.
DOM_ID_BINDERS = ("getElementById", "requireElement", "optionalElement")

# The element constructor each registry entry may ask for, and the HTML tags
# that actually satisfy it. Only the subtypes the registry uses are listed;
# a bare requireElement(id) accepts any tag and is not checked here.
ELEMENT_TYPE_TAGS = {
    "HTMLVideoElement": {"video"},
    "HTMLCanvasElement": {"canvas"},
    "HTMLSelectElement": {"select"},
    "HTMLImageElement": {"img"},
    "HTMLAnchorElement": {"a"},
    "HTMLButtonElement": {"button"},
    "HTMLInputElement": {"input"},
}


# Which JSDoc union governs each behaviour attribute in the markup. A value in
# the HTML that the union does not list is a route or target the app cannot
# reach, which is exactly the drift a redesign introduces.
DATASET_DOMAINS = {
    "data-mode": "AppMode",
    "data-go-mode": "AppMode",
    "data-qr-target": "QrTarget",
    "data-coach-flow": "CoachFlow",
    "data-model-test-task": "ModelTask",
    "data-quality": "WordQualityPill",
    "data-step": "ModelTestProcessStep",
}

# Stable element hooks, as data-ui values.
#
# A hook exists only so the scripts can find the element. Styling never uses it,
# so renaming a CSS class cannot detach behaviour, and removing a hook is a
# visible edit rather than a silent one.
#
# Singletons are what queryUi() resolves and must appear exactly once. Groups are
# what queryAllUi() collects; their count is a design decision, so only their
# presence is fixed here.
UI_HOOKS_SINGLE = ("app-shell", "workspace")
UI_HOOKS_GROUP = ("workspace-pane", "mode-tab", "word-step")

# Hooks the scripts put on elements they build themselves. These are absent from
# index.html by definition, so they are checked against the assignment instead.
UI_HOOKS_RUNTIME = ("reference-thumb",)

# Presentation class names the browser scripts still use to *find* elements.
#
# These are the fragile couplings: renaming one of these classes in the CSS
# silently detaches behaviour, because nothing in the markup says the class is
# load-bearing. The list is frozen so it can only shrink. Each entry moves to a
# data-ui or data-action hook and leaves this list; nothing new may join it.
BEHAVIOUR_CLASS_ALLOW_LIST = frozenset()

# Element lookups in the browser scripts, including the project's own helpers.
_SELECTOR_CALL = re.compile(
    r"(?:queryElements|queryElement|querySelectorAll|querySelector|closest|matches)"
    r"\(\s*(?P<quote>[\"'`])(?P<selector>(?:\\.|(?!(?P=quote)).)*)(?P=quote)"
)


def _js_selectors() -> set[str]:
    """Every literal element selector the browser scripts look elements up by."""
    found: set[str] = set()
    for rel_path, source in _web_js_sources().items():
        for match in _SELECTOR_CALL.finditer(source):
            selector = match.group("selector")
            # runtime.js holds the helpers themselves; its own parameter
            # forwarding is not a selector.
            if selector:
                found.add(selector)
    return found


def _js_ui_hooks() -> set[str]:
    """Hook names the browser scripts resolve through the registry helpers."""
    return {
        match.group(1)
        for source in _web_js_sources().values()
        for match in re.finditer(r"query(?:All)?Ui\(\s*[\"']([\w-]+)[\"']", source)
    }


def _js_selector_classes() -> set[str]:
    """Class names the browser scripts use to find elements."""
    return {
        name for selector in _js_selectors() for name in re.findall(r"\.([A-Za-z][\w-]*)", selector)
    }


def _js_bound_dom_ids(source: str) -> set[str]:
    binders = "|".join(DOM_ID_BINDERS)
    return set(re.findall(rf"(?:{binders})\(\s*['\"]([^'\"]+)['\"]", source))


def _js_typed_dom_bindings(source: str) -> set[tuple[str, str]]:
    """Return every (id, element constructor) the registry asks for by name."""
    return set(
        re.findall(
            r"(?:require|optional)Element\(\s*['\"]([^'\"]+)['\"]\s*,\s*(HTML\w+)",
            source,
        )
    )


def _js_string_array(source: str, constant_name: str) -> list[str]:
    match = re.search(
        rf"const\s+{re.escape(constant_name)}\s*=\s*\[(?P<body>.*?)\]\s*;",
        source,
        flags=re.DOTALL,
    )
    assert match is not None, f"JavaScript array not found: {constant_name}"
    return re.findall(r"['\"]([^'\"]+)['\"]", match.group("body"))


def test_dom_id_bindings_exist_in_index_html() -> None:
    """Every DOM id a browser script binds must exist in index.html.

    requireElement() throws on a missing id, so a typo here is a startup crash
    rather than a silently dead handler. Both paths are scanned because which
    helper an entry uses is a fail-fast decision, not a naming contract.
    """

    html = HtmlSnapshot(_read(INDEX_HTML))
    bound_ids = _js_bound_dom_ids(_web_js_corpus())

    assert bound_ids, "no DOM bindings found; the scan is probably broken"
    missing = sorted(bound_ids - html.ids)
    assert missing == []


def test_registry_element_types_match_their_html_tags() -> None:
    """A required subtype that the markup does not satisfy is a startup crash.

    The Node harness stubs every element constructor with one class, so it
    cannot tell HTMLVideoElement from HTMLButtonElement. This check runs against
    the real markup instead, and is the only place the pairing is verified.
    """

    html = HtmlSnapshot(_read(INDEX_HTML))
    bindings = _js_typed_dom_bindings(_web_js_corpus())

    assert bindings, "no typed DOM bindings found; the scan is probably broken"

    unknown = sorted({type_name for _, type_name in bindings} - set(ELEMENT_TYPE_TAGS))
    assert unknown == [], f"element types with no known tag: {unknown}"

    mismatched = []
    for element_id, type_name in sorted(bindings):
        tag = html.tag_for_id(element_id)
        if tag not in ELEMENT_TYPE_TAGS[type_name]:
            mismatched.append(f"#{element_id} is <{tag}>, not {type_name}")
    assert mismatched == []


def test_stable_ui_hooks_exist_with_the_expected_multiplicity() -> None:
    """A hook the scripts resolve must be in the markup, and be as unique.

    Counts are only pinned where the code depends on them: a singleton hook
    resolved with queryUi() is ambiguous if it appears twice, while a group hook
    may grow or shrink with the design.
    """

    html = HtmlSnapshot(_read(INDEX_HTML))
    hooks = [attrs["data-ui"] for _, attrs in html.nodes if "data-ui" in attrs]

    for name in UI_HOOKS_SINGLE:
        assert hooks.count(name) == 1, f"expected exactly one data-ui={name}"
    for name in UI_HOOKS_GROUP:
        assert hooks.count(name) >= 1, f"no data-ui={name} in the markup"

    catalogued = set(UI_HOOKS_SINGLE) | set(UI_HOOKS_GROUP)
    uncatalogued = sorted(set(hooks) - catalogued)
    assert uncatalogued == [], f"hooks nothing resolves; catalogue or remove: {uncatalogued}"

    # A hook the scripts ask for but the markup never carries resolves to
    # nothing, which is the silent breakage the hooks exist to prevent.
    resolved = _js_ui_hooks()
    assert resolved, "no hook lookups found; the scan is probably broken"
    corpus = _web_js_corpus()
    assigned = {name for name in UI_HOOKS_RUNTIME if f'dataset.ui = "{name}"' in corpus}
    assert assigned == set(UI_HOOKS_RUNTIME), (
        f"runtime hook never assigned: {sorted(set(UI_HOOKS_RUNTIME) - assigned)}"
    )
    unbacked = sorted(resolved - set(hooks) - assigned)
    assert unbacked == [], f"scripts resolve hooks nothing carries: {unbacked}"


def test_element_ids_are_unique() -> None:
    """A duplicate id makes getElementById() pick a winner silently.

    Copying a block while restyling a screen is the usual way this happens, and
    the loser keeps its markup while losing all of its behaviour.
    """

    html = HtmlSnapshot(_read(INDEX_HTML))
    duplicated = sorted({i for i in html.id_list if html.id_list.count(i) > 1})

    assert html.id_list, "no ids found; the scan is probably broken"
    assert duplicated == []


def test_behaviour_attribute_values_stay_inside_their_unions() -> None:
    """A route or target the markup offers but the app cannot reach is dead."""

    html = HtmlSnapshot(_read(INDEX_HTML))

    unreachable = {}
    for attribute, union_name in DATASET_DOMAINS.items():
        used = {value for value in html.attribute_values(attribute) if value}
        assert used, f"no {attribute} values found; the scan is probably broken"
        if extra := sorted(used - _jsdoc_union(union_name)):
            unreachable[attribute] = extra

    assert unreachable == {}


def test_aria_and_label_references_resolve() -> None:
    """A label or description pointing at nothing is silent for a screen reader.

    These attributes carry ids across the markup, so moving an element during a
    redesign breaks them without breaking anything visible.
    """

    html = HtmlSnapshot(_read(INDEX_HTML))

    dangling = {}
    for attribute in ("for", "aria-labelledby", "aria-describedby", "aria-controls"):
        if missing := sorted(html.id_references(attribute) - html.ids):
            dangling[attribute] = missing

    assert dangling == {}


def test_markup_has_no_inline_event_handlers() -> None:
    """Behaviour belongs in the scripts, where the tests can reach it."""

    html = HtmlSnapshot(_read(INDEX_HTML))

    assert html.inline_handlers() == []


def test_scripts_do_not_bind_through_presentation_classes() -> None:
    """A class that both styles and binds is a trap.

    Renaming it in the CSS detaches behaviour with nothing to show for it. The
    allow-list held the couplings that existed before the hooks were introduced
    and is now empty; it stays as the mechanism, so a new coupling fails here
    rather than being discovered in a browser.
    """

    assert _js_selectors(), "no selectors found; the scan is probably broken"

    used = _js_selector_classes()
    new_couplings = sorted(used - BEHAVIOUR_CLASS_ALLOW_LIST)
    assert new_couplings == [], (
        f"presentation class used as a lookup; add a data-ui or data-action hook: {new_couplings}"
    )

    stale = sorted(BEHAVIOUR_CLASS_ALLOW_LIST - used)
    assert stale == [], f"allow-list entries no longer used; remove them: {stale}"


def test_external_scripts_carry_subresource_integrity() -> None:
    """A CDN script runs with the page's camera access, so its bytes are pinned.

    Integrity on a cross-origin script needs a CORS request, hence crossorigin;
    without it the browser refuses to run the script at all.
    """

    external = [
        attrs
        for tag, attrs in HtmlSnapshot(_read(INDEX_HTML)).nodes
        if tag == "script" and re.match(r"(?:https?:)?//", attrs.get("src", ""))
    ]

    assert external, "no external script found in index.html"
    for attrs in external:
        assert re.fullmatch(
            r"sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}", attrs.get("integrity", "")
        ), attrs["src"]
        assert attrs.get("crossorigin") == "anonymous", attrs["src"]


def test_every_browser_script_is_loaded_exactly_once() -> None:
    """A script that exists but is never loaded is dead weight and a trap."""

    html = HtmlSnapshot(_read(INDEX_HTML))
    loaded = [src.split("?", 1)[0].removeprefix("./") for src in html.scripts]
    local = [src for src in loaded if src.startswith("js/")]

    assert sorted(local) == sorted(_web_js_sources())
    assert len(local) == len(set(local))


def test_required_browser_functions_are_defined_exactly_once() -> None:
    """Classic scripts share one scope, so a duplicate definition wins silently."""

    sites = {name: _definition_sites(name) for name in REQUIRED_WEB_FUNCTIONS}

    missing = sorted(name for name, files in sites.items() if not files)
    duplicated = sorted(name for name, files in sites.items() if len(files) > 1)

    assert missing == []
    assert duplicated == []


def test_no_browser_script_declares_a_global_twice() -> None:
    """Re-declaring a top-level const/let in a second script is a load error."""

    declaration = re.compile(
        r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)"
        r"|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)",
        flags=re.MULTILINE,
    )

    owners: dict[str, list[str]] = {}
    for rel_path, source in _web_js_sources().items():
        for match in declaration.finditer(source):
            name = match.group(1) or match.group(2)
            owners.setdefault(name, []).append(rel_path)

    duplicated = {name: files for name, files in owners.items() if len(files) > 1}
    assert duplicated == {}


def test_classic_script_order_protects_global_runtime_contract() -> None:
    """The web app uses classic scripts, so load order is a runtime contract."""

    html = HtmlSnapshot(_read(INDEX_HTML))
    normalized = [src.split("?", 1)[0].removeprefix("./") for src in html.scripts]

    expected_order = [
        "js/core/theme-boot.js",
        "js/core/config.js",
        "js/core/runtime.js",
        "js/ml/landmarks.js",
        "js/ml/features.js",
        "js/services/benchmark.js",
        "js/ml/gating.js",
        "js/ml/hold.js",
        "js/ml/letter-model.js",
        "js/ml/word-model.js",
        "js/media/overlay.js",
        "js/media/camera.js",
        "js/ml/live-inference.js",
        "js/ui/prediction.js",
        "js/ui/plate-side.js",
        "js/ui/toast.js",
        "js/ui/transcript.js",
        "js/ui/word-flow.js",
        "js/ui/coach.js",
        "js/ui/reference.js",
        "js/ui/qr.js",
        "js/ui/model-test.js",
        "js/core/app.js",
    ]

    assert [src for src in normalized if src.startswith("js/")] == expected_order


def _documented_script_order(markdown: str) -> list[str]:
    """Read the fenced ```text block that lists the browser scripts."""
    for block in re.finditer(r"```text\n(?P<body>.*?)```", markdown, flags=re.DOTALL):
        lines = [line.strip() for line in block.group("body").splitlines() if line.strip()]
        if lines and all(line.endswith(".js") for line in lines):
            return [line.removeprefix("js/") for line in lines]
    raise AssertionError("no fenced script-order block found")


def test_documented_script_order_matches_index_html() -> None:
    """Load order is a runtime contract, so the docs may not drift from it."""

    html = HtmlSnapshot(_read(INDEX_HTML))
    actual = [
        src.split("?", 1)[0].removeprefix("./").removeprefix("js/")
        for src in html.scripts
        if src.split("?", 1)[0].removeprefix("./").startswith("js/")
    ]

    assert _documented_script_order(_read(WEB_JS_README)) == actual
    assert _documented_script_order(_read(WEB_README)) == actual


def test_every_browser_module_is_documented() -> None:
    """A module nobody documented is a module nobody can find."""

    module_map = _read(WEB_JS_README)
    undocumented = [
        rel_path
        for rel_path in _web_js_sources()
        if f"`{rel_path.removeprefix('js/')}`" not in module_map
    ]

    assert undocumented == []


def test_word_recording_ux_keeps_manual_acceptance_contract() -> None:
    """Word predictions should be shown for user review, not auto-appended."""

    html = HtmlSnapshot(_read(INDEX_HTML))
    corpus = _web_js_corpus()

    for required_id in ["wordResultGuide", "wordResultDecision", "wordResultAction"]:
        assert required_id in html.ids
        assert required_id in _js_bound_dom_ids(corpus)

    assert _definition_sites("assessWordResult")
    assert 'state.wordState !== "RESULT"' in corpus
    assert "CONFIG.WORD_ACCEPT_THRESHOLD" in corpus
    assert "acceptPrediction(false)" not in corpus
    assert 'state.mode === "word" && result.confidence >= CONFIG.CONFIDENT_THRESHOLD' not in corpus


def test_word_recording_buffers_are_cleared_at_every_reset_point() -> None:
    """A sign left in the motion buffers would leak into the next recording.

    All five reset points must clear the same three buffers: starting a
    recording, retrying, changing mode, stopping the camera, and finishing
    inference.
    """

    reset_points = [
        "startWordRecording",
        "retryWordRecording",
        "setMode",
        "stopCamera",
        "_finishWordRecordingReal",
    ]
    buffers = ["frameBuffer = []", "normalizedFrameBuffer = []", "previousFrame = null"]

    missing = [
        f"{name}: {buffer}"
        for name in reset_points
        for buffer in buffers
        if buffer not in _web_function_body(name)
    ]
    assert missing == []


def test_word_recording_requires_hand_pose_and_face_models() -> None:
    """Letter mode needs only hands; word mode must not start without all three."""

    body = _web_function_body("syncRecordButton")

    assert "poseLandmarker" in body
    assert "faceLandmarker" in body
    assert "mpRunning" in body


def test_feedback_kinds_stay_in_step_with_their_css() -> None:
    """A feedback style nobody wrote renders as an unstyled bar."""

    css = _read(WEB_DIR / "css" / "style.css")
    declared = _jsdoc_union("FeedbackKind")
    used = _literal_arguments("showFeedback", position=1)

    assert used, "no showFeedback call sites found; the scan is probably broken"
    assert used <= declared, f"undeclared feedback kinds: {sorted(used - declared)}"
    for kind in declared:
        assert f".feedback-bar--{kind}" in css, f"feedback kind has no CSS: {kind}"


def test_confidence_levels_stay_in_step_with_their_css() -> None:
    """The status message and the word result guide share one level scale."""

    css = _read(WEB_DIR / "css" / "style.css")
    declared = _jsdoc_union("ConfidenceLevel")
    used = _literal_arguments("setMessage", position=1)

    assert used, "no setMessage call sites found; the scan is probably broken"
    assert used <= declared, f"undeclared message levels: {sorted(used - declared)}"
    for level in declared:
        assert f'.word-result-guide[data-level="{level}"]' in css, (
            f"confidence level has no CSS: {level}"
        )


def test_benchmark_stages_have_matching_sample_windows() -> None:
    """A stage with no bucket is measured and then silently thrown away."""

    declared = _jsdoc_union("BenchmarkStage")
    recorded = _literal_arguments("recordBenchmark", position=0)
    buckets = set(
        re.findall(
            r"^  ([a-z_]+): \[\],$",
            _read(WEB_JS_DIR / "services" / "benchmark.js"),
            flags=re.MULTILINE,
        )
    )

    assert recorded, "no recordBenchmark call sites found; the scan is probably broken"
    assert buckets == declared, (
        f"BenchmarkStage and benchmarkData disagree: {sorted(buckets ^ declared)}"
    )
    assert recorded <= declared, f"stage recorded into no bucket: {sorted(recorded - declared)}"
    assert declared <= recorded, f"bucket nothing records into: {sorted(declared - recorded)}"


def test_reference_gallery_uses_split_word_assets() -> None:
    """Word reference should use the five readable page assets."""

    html = HtmlSnapshot(_read(INDEX_HTML))
    corpus = _web_js_corpus()

    assert "referenceThumbs" in html.ids
    assert "referenceThumbs" in _js_bound_dom_ids(corpus)
    assert _definition_sites("REFERENCE_ASSETS")

    for index in range(1, 6):
        assert f"./assets/signs/word-50-{index}.png" in corpus

    assert "./assets/signs/letters.png" in corpus


def test_guided_ux_keeps_primary_reference_and_test_actions_visible() -> None:
    """Keep primary actions visible while advanced test controls remain collapsed."""

    html = HtmlSnapshot(_read(INDEX_HTML))
    css = _read(WEB_DIR / "css" / "style.css")

    side_panel_pos = html.first_with_class("side-panel")
    reference_pos = html.first_with_class("app-reference")
    advanced_pos = html.first_with_class("model-test-advanced")
    task_switch_pos = html.first_with_class("model-test-task-switch")

    assert side_panel_pos < reference_pos
    assert advanced_pos < task_switch_pos
    assert html.has("p", class_name="model-test-simple-copy")
    assert html.has("details", class_name="word-demo-card")
    assert re.search(r"\.model-test-brief\s*\{[^}]*display\s*:\s*none\s*;", css, re.DOTALL)


def test_word_live_pipeline_uses_notebook_parity_paths() -> None:
    """Protect the two fixed live-word parity hazards from silent regression."""

    corpus = _web_js_corpus()
    features = _read(FEATURES_JS)
    landmarks = _read(LANDMARKS_JS)

    assert _definition_sites("normalizedFrameBuffer")
    assert "buildCompactSequenceFeatures(normalizedFrameBuffer)" in corpus
    assert "function buildCompactSequenceFeatures(seq321dFrames)" in features
    assert "function computeDominantHandSequence(seq321dFrames)" in features
    assert "return normalizeShouldersFallbackMinMax(frame321d)" in landmarks
    assert "return frame321d;" not in landmarks


def test_word_inference_discards_results_the_user_moved_on_from() -> None:
    """A slow model call must not overwrite the screen after a mode change."""

    body = _web_function_body("_finishWordRecordingReal")

    assert 'state.mode !== "word"' in body
    assert "!state.cameraOn" in body
    # The padded input keeps a fixed 45-frame window; true marks a real frame.
    assert "new Array(45).fill(false)" in body
    assert "mask[i] = true" in body


def test_camera_module_no_longer_runs_model_inference() -> None:
    """camera.js owns the MediaPipe lifecycle; inference lives on its own."""

    sources = _web_js_sources()
    camera = sources["js/media/camera.js"]

    assert "predictLetter" not in camera
    assert "predictWord" not in camera
    assert "computeLetterFeatures" not in camera
    assert "buildCompactFeatures" not in camera
    assert _definition_sites("realInference") == ["js/ml/live-inference.js"]
    assert _definition_sites("startMediaPipe") == ["js/media/camera.js"]


def test_mediapipe_models_are_pinned_to_a_version() -> None:
    """The tasks bundle is pinned, so the models it runs must be pinned as well.

    A `/latest/` model can change under a pinned bundle without any edit here.
    """

    urls = {
        url
        for source in _web_js_sources().values()
        for url in re.findall(r"https://[^\s\"'`]+", source)
    }
    model_urls = {url for url in urls if url.endswith(".task")}

    # Proves the scan sees the model URLs, so an empty result below means pinned.
    assert len(model_urls) == 3, sorted(model_urls)
    assert not sorted(url for url in urls if "/latest/" in url)


def test_model_test_word_default_has_a_stable_high_confidence_fixture() -> None:
    """The default word sample in the Model Test panel should not start on a weak case."""

    html = HtmlSnapshot(_read(INDEX_HTML))
    corpus = _web_js_corpus()
    manifest = _load_json(MODEL_TEST_MANIFEST)
    words = {item["id"]: item for item in manifest["words"]}

    assert {"loadDemoLetter", "loadDemoWord"} <= html.ids
    assert re.search(r"function\s+loadPreferredModelTestSample\s*\(\s*task\s*\)", corpus)
    assert re.search(r"function\s+loadAndRunPreferredModelTestSample\s*\(\s*task\s*\)", corpus)
    assert 'loadAndRunPreferredModelTestSample("letter")' in corpus
    assert 'loadAndRunPreferredModelTestSample("word")' in corpus
    preferred_ids = _js_string_array(corpus, "PREFERRED_MODEL_TEST_WORD_IDS")
    # The preferred samples are competition-derived and stay local by its rules,
    # so a clone falls back to the published smoke fixture instead.
    if not LOCAL_MODEL_TEST_MANIFEST.exists():
        pytest.skip("local competition-derived word fixtures are not present")
    words.update({item["id"]: item for item in _load_json(LOCAL_MODEL_TEST_MANIFEST)["words"]})
    default_id = next((sample_id for sample_id in preferred_ids if sample_id in words), None)
    assert default_id is not None
    default = words[default_id]
    assert default["expected_label"] in _load_json(WEB_DIR / "data" / "word_labels.json")
    assert float(default["confidence"]) >= 0.9


def test_qr_demo_deep_links_can_open_runtime_modes() -> None:
    """QR links should be able to open the live app directly in a target mode."""

    html = HtmlSnapshot(_read(INDEX_HTML))
    corpus = _web_js_corpus()

    assert "qr" in html.attribute_values("data-mode")
    assert {"qrScreen", "qrCanvas"} <= html.ids
    assert any("kjua" in src.lower() for src in html.scripts)
    assert re.search(r"function\s+modeFromHash\s*\(\s*hash\s*\)", corpus)
    assert 'window.addEventListener("hashchange"' in corpus
    assert "setMode(modeFromHash(window.location.hash), { syncHash: false })" in corpus
    assert re.search(r"function\s+renderQrDemo\s*\(", corpus)
    assert "window.kjua" in corpus
    assert "CONFIG.DEMO_PUBLIC_URL" in corpus
    assert {"letter", "coach", "word", "project", "test", "qr"} <= html.attribute_values(
        "data-mode"
    )


# The live site. A page without a shareable origin of its own (localhost,
# file://) links here, and the markup shows it before the scripts run.
PUBLISHED_DEMO_URL = "https://asl-assistant.netlify.app/"


def test_qr_demo_fallback_links_point_at_the_published_site() -> None:
    """The site was renamed once and the old name 404s; all three copies move together."""

    source = _read(INDEX_HTML)
    html = HtmlSnapshot(source)
    config = _read(WEB_JS_DIR / "core" / "config.js")
    open_demo = next(attrs for _, attrs in html.nodes if attrs.get("id") == "qrOpenDemo")
    shown_url = re.search(r'id="qrDemoUrl"[^>]*>([^<]*)<', source)

    assert f'DEMO_PUBLIC_URL: "{PUBLISHED_DEMO_URL}"' in config
    assert open_demo["href"] == f"{PUBLISHED_DEMO_URL}#letter"
    assert shown_url is not None
    assert shown_url.group(1).strip() == f"{PUBLISHED_DEMO_URL}#letter"


def test_web_runtime_has_no_confirmed_dead_branches() -> None:
    """Keep removed compatibility and unused-state paths from drifting back."""

    corpus = _web_js_corpus()
    gating = _read(GATING_JS)

    assert "acceptPrediction" not in corpus
    assert "modelsReady" not in corpus
    assert "window.QRCode" not in corpus
    assert "window.kjua" in corpus
    assert "curriculumData" not in gating
    assert "./data/curriculum.json" not in gating
