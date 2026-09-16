"""Fast regression checks for the browser UI wiring.

These tests intentionally stay static and cheap. They catch the kind of
presentation-breaking drift that unit tests often miss: a renamed DOM id,
script order changes in classic JS, weak default jury fixtures, or a word
recording UX guard accidentally being removed.
"""
from __future__ import annotations

import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = PROJECT_ROOT / "asl-web"
INDEX_HTML = WEB_DIR / "index.html"
APP_JS = WEB_DIR / "js" / "core" / "app.js"
CAMERA_JS = WEB_DIR / "js" / "media" / "camera.js"
FEATURES_JS = WEB_DIR / "js" / "ml" / "features.js"
LANDMARKS_JS = WEB_DIR / "js" / "ml" / "landmarks.js"
JURY_MANIFEST = WEB_DIR / "data" / "jury-samples" / "manifest.json"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _load_json(path: Path):
    return json.loads(_read(path))


def test_app_get_element_by_id_bindings_exist_in_index_html() -> None:
    """Every required `els.*` binding in app.js should have a matching DOM id."""

    html = _read(INDEX_HTML)
    app = _read(APP_JS)
    dom_ids = set(re.findall(r'id="([^"]+)"', html))
    bound_ids = set(re.findall(r'getElementById\("([^"]+)"\)', app))

    missing = sorted(bound_ids - dom_ids)
    assert missing == []


def test_classic_script_order_protects_global_runtime_contract() -> None:
    """The web app uses classic scripts, so load order is a runtime contract."""

    html = _read(INDEX_HTML)
    scripts = re.findall(r'<script[^>]+src="([^"]+)"', html)
    normalized = [src.split("?", 1)[0] for src in scripts]

    expected_order = [
        "js/ml/landmarks.js",
        "js/ml/features.js",
        "js/services/benchmark.js",
        "js/ml/gating.js",
        "js/ml/letter-model.js",
        "js/ml/word-model.js",
        "js/media/camera.js",
        "js/core/app.js",
    ]

    positions = {src: normalized.index(src) for src in expected_order}
    assert [positions[src] for src in expected_order] == sorted(positions.values())


def test_word_recording_ux_keeps_manual_acceptance_contract() -> None:
    """Word predictions should be shown for user review, not auto-appended."""

    html = _read(INDEX_HTML)
    app = _read(APP_JS)
    camera = _read(CAMERA_JS)

    for required_id in ["wordResultGuide", "wordResultDecision", "wordResultAction"]:
        assert f'id="{required_id}"' in html
        assert f'getElementById("{required_id}")' in app

    assert "function assessWordResult()" in app
    assert 'state.wordState !== "RESULT"' in app
    assert "CONFIG.WORD_ACCEPT_THRESHOLD" in app
    assert "acceptPrediction(false)" not in camera
    assert 'state.mode === "word" && result.confidence >= CONFIG.CONFIDENT_THRESHOLD' not in camera


def test_reference_gallery_uses_split_word_assets() -> None:
    """Word reference should use the readable 5-page assets, not only the old poster."""

    html = _read(INDEX_HTML)
    app = _read(APP_JS)

    assert 'id="referenceThumbs"' in html
    assert 'getElementById("referenceThumbs")' in app
    assert "REFERENCE_ASSETS" in app

    for index in range(1, 6):
        asset = WEB_DIR / "assets" / "signs" / f"word-{index}.png"
        assert asset.exists()
        assert f"./assets/signs/word-{index}.png" in app

    assert "./assets/signs/letters.png" in app
    assert "./assets/signs/kelime.png" in app


def test_guided_ux_keeps_primary_reference_and_test_actions_visible() -> None:
    """The presentation UI should keep references close and hide technical test details."""

    html = _read(INDEX_HTML)
    css = _read(WEB_DIR / "css" / "style.css")

    side_panel_pos = html.index('<aside class="side-panel"')
    reference_pos = html.index('class="reference-strip app-reference"')
    coach_pos = html.index('class="card coach-card')
    advanced_pos = html.index('class="jury-advanced"')
    task_switch_pos = html.index('class="jury-task-switch"')

    assert side_panel_pos < reference_pos < coach_pos
    assert advanced_pos < task_switch_pos
    assert '<p class="model-test-simple-copy">' in html
    assert '<details class="card word-demo-card mode-only word-only">' in html
    assert ".model-test-brief {\n  display:none;" in css


def test_word_live_pipeline_uses_notebook_parity_paths() -> None:
    """Protect the two fixed live-word parity hazards from silent regression."""

    camera = _read(CAMERA_JS)
    features = _read(FEATURES_JS)
    landmarks = _read(LANDMARKS_JS)

    assert "normalizedFrameBuffer" in camera
    assert "buildCompactSequenceFeatures(normalizedFrameBuffer)" in camera
    assert "function buildCompactSequenceFeatures(seq321dFrames)" in features
    assert "function computeDominantHandSequence(seq321dFrames)" in features
    assert "return normalizeShouldersFallbackMinMax(frame321d)" in landmarks
    assert "return frame321d;" not in landmarks


def test_jury_word_default_has_a_stable_high_confidence_fixture() -> None:
    """The default word sample in the jury panel should not start on a weak case."""

    html = _read(INDEX_HTML)
    app = _read(APP_JS)
    manifest = _load_json(JURY_MANIFEST)
    words = {item["id"]: item for item in manifest["words"]}

    assert 'id="loadDemoLetter"' in html
    assert 'id="loadDemoWord"' in html
    assert "function loadPreferredJurySample(task)" in app
    assert "function loadAndRunPreferredJurySample(task)" in app
    assert 'loadAndRunPreferredJurySample("letter")' in app
    assert 'loadAndRunPreferredJurySample("word")' in app
    assert '"word-bird-01"' in app
    default = words["word-bird-01"]
    assert default["expected_label"] == "bird"
    assert float(default["confidence"]) >= 0.9
    assert (WEB_DIR / default["path"].removeprefix("./")).exists()


def test_qr_demo_deep_links_can_open_runtime_modes() -> None:
    """QR links should be able to open the live app directly in a target mode."""

    html = _read(INDEX_HTML)
    app = _read(APP_JS)

    assert 'data-mode="qr"' in html
    assert 'id="qrScreen"' in html
    assert 'id="qrCanvas"' in html
    assert "kjua@0.9.0" in html
    assert "function modeFromHash(hash)" in app
    assert 'window.addEventListener("hashchange"' in app
    assert 'setMode(modeFromHash(window.location.hash), { syncHash: false })' in app
    assert "function renderQrDemo()" in app
    assert "window.kjua" in app
    assert "CONFIG.DEMO_PUBLIC_URL" in app
    for mode in ["letter", "coach", "word", "project", "test", "qr"]:
        assert f'"{mode}"' in app


def test_jury_manifest_and_sample_files_are_bidirectional() -> None:
    """Every exported jury fixture should be registered, and every registry path should exist."""

    manifest = _load_json(JURY_MANIFEST)
    registered = set()
    for section in ["letters", "words"]:
        for item in manifest[section]:
            rel = item["path"].removeprefix("./")
            registered.add(rel)
            assert (WEB_DIR / rel).exists()

    fixture_files = {
        path.relative_to(WEB_DIR).as_posix()
        for path in (WEB_DIR / "data" / "jury-samples").rglob("*.json")
        if path.name != "manifest.json"
    }

    assert fixture_files == registered
