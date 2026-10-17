#!/usr/bin/env python3
"""Run fast integrity checks for the deployable ``asl-web`` application.

The command verifies required files and minimum sizes, JSON schemas, Model Test
fixtures, source-to-deploy hashes, gzipped deploy copies, the curated Kaggle
export manifest, and ONNX input/output contracts by default. It intentionally
skips local dataset inspection; use ``verify_project_assets.py`` for the broader
repository audit.

With ``--deploy`` (``make deploy-check``) it also lists every file under
``asl-web/`` in the working tree, which is what a drag-and-drop upload takes,
and fails on anything the site does not ship: the local Model Test fixture
folder, files Git ignores, hidden files, and paths outside the allowlist in
``contracts.py``. Run it before every upload.

Examples:
  python scripts/validation/check_runtime_assets.py
  python scripts/validation/check_runtime_assets.py --verbose
  python scripts/validation/check_runtime_assets.py --no-onnx
  python scripts/validation/check_runtime_assets.py --deploy
  python scripts/validation/check_runtime_assets.py --root path/to/checkout

Exit status:
  0  every check ran and every contract held
  1  a contract failed (this outranks 2: a fault that was found is reported)
  2  bad usage, or ONNX Runtime cannot be imported and --no-onnx was not given,
     so the models were not verified

See ``docs/models-and-data.md`` for model provenance and ONNX contracts.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zlib
from collections.abc import Iterable
from pathlib import Path, PurePosixPath
from typing import Literal, NamedTuple

if __package__ in (None, ""):  # Allow running this file directly.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.validation.contracts import (  # noqa: E402
    ALL_ARTIFACTS,
    DEPLOY_ALLOWED_ENDINGS,
    DEPLOY_FILES_ANYWHERE,
    DEPLOY_FORBIDDEN_DIRS,
    DEPLOY_ROOT_FILES,
    NOTEBOOKS_RESULTS,
    PROJECT_ROOT,
    WEB_DATA_DIR,
    WEB_DIR,
    WEB_MODELS_DIR,
    WORD_MODEL_DIR,
    gzip_pairs,
    provenance_pairs,
    rebased,
    relative,
)


def _sha256(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_kb(path: str) -> float:
    return os.path.getsize(path) / 1024.0


def _ok(msg: str) -> None:
    print(f"  \033[32m✓\033[0m {msg}")


def _fail(msg: str) -> None:
    print(f"  \033[31m✗\033[0m {msg}")


def _warn(msg: str) -> None:
    print(f"  \033[33m⚠\033[0m {msg}")


class ToolMissing(Exception):
    """A step could not run because a required tool cannot be imported.

    That is neither a pass nor a contract failure, so it is raised to main(),
    which reports it as exit 2 rather than letting the step count as passed.
    """


def check_file_existence_and_size(root: Path) -> bool:
    """Check required runtime artifacts exist and are not truncated.

    The floors here are coarse and apply to binaries and curated data only:
    they catch a partial copy or a Git LFS pointer committed in place of the
    file. Source files are checked by their content in check_web_sources(),
    because a size floor on source only forbids it getting smaller.
    """
    print("\n[1/6] Required files and minimum sizes")
    ok = True
    for artifact in ALL_ARTIFACTS:
        abs_path = rebased(artifact.deploy_path, root)
        rel_path = relative(abs_path, root)
        min_kb = artifact.min_size_kb
        if not os.path.exists(abs_path):
            _fail(f"{rel_path}: NOT FOUND")
            ok = False
            continue
        actual_kb = _file_kb(abs_path)
        if actual_kb < min_kb:
            _fail(f"{rel_path}: TOO SMALL ({actual_kb:.1f} KB < {min_kb} KB)")
            ok = False
        else:
            _ok(f"{rel_path}: {actual_kb:.1f} KB")
    return ok and check_web_sources(root)


def _loaded_local_scripts(html: str) -> set[str]:
    """Local script paths index.html loads, relative to asl-web/."""
    return {
        src.split("?", 1)[0].removeprefix("./")
        for src in re.findall(r'<script\b[^>]*\bsrc="([^"]+)"', html)
        if not src.startswith("http")
    }


class WebSourceCheck(NamedTuple):
    """What inspecting the browser sources found.

    `issues` is empty when the sources are consistent; the counts are for the
    success line, so the caller does not have to walk the directory again.
    """

    issues: list[str]
    modules: int
    stylesheets: int


def find_web_source_issues(web_dir: Path) -> WebSourceCheck:
    """Inspect the browser sources by what they contain, not by how large they are.

    A shipped module that index.html never loads is dead weight, and a loaded
    module that is not shipped is a blank page. Both are real deploy faults and
    neither shows up in a byte count, while a byte count fails the first time
    anything is minified or a module is genuinely simplified.

    This prints nothing and reads nothing outside `web_dir`, so the faults it
    reports can be produced in a test.
    """
    index_html = web_dir / "index.html"
    if not index_html.is_file() or index_html.stat().st_size == 0:
        return WebSourceCheck([f"{relative(index_html)}: empty or not found"], 0, 0)
    html = index_html.read_text(encoding="utf-8")

    issues: list[str] = []

    # Every local <link> must resolve, not only stylesheets: a renamed icon
    # would otherwise 404 with nothing to report it.
    links = [
        href
        for href in re.findall(r'<link\b[^>]*\bhref="([^"]+)"', html)
        if not href.startswith("http")
    ]
    stylesheets = [href for href in links if href.split("?", 1)[0].endswith(".css")]
    for href in links:
        target = web_dir / href.split("?", 1)[0].removeprefix("./")
        if not target.is_file() or target.stat().st_size == 0:
            issues.append(f"{relative(target)}: referenced by index.html but empty or missing")

    on_disk = {
        str(path.relative_to(web_dir)).replace(os.sep, "/")
        for path in (web_dir / "js").rglob("*.js")
    }
    if not on_disk:
        issues.append("asl-web/js: no JavaScript module found")
        return WebSourceCheck(issues, 0, len(stylesheets))

    for name in sorted(name for name in on_disk if (web_dir / name).stat().st_size == 0):
        issues.append(f"asl-web/{name}: EMPTY")

    loaded = {src for src in _loaded_local_scripts(html) if src.startswith("js/")}
    for name in sorted(loaded - on_disk):
        issues.append(f"asl-web/{name}: index.html loads it but the file is missing")
    for name in sorted(on_disk - loaded):
        issues.append(f"asl-web/{name}: the file exists but index.html does not load it")

    return WebSourceCheck(issues, len(on_disk), len(stylesheets))


def check_web_sources(root: Path) -> bool:
    """Report the browser source inspection to the user."""
    result = find_web_source_issues(rebased(WEB_DIR, root))
    for issue in result.issues:
        _fail(issue)
    if not result.issues:
        _ok(f"asl-web/js: {result.modules} modules, all loaded by index.html")
        _ok(f"asl-web/css: {result.stylesheets} stylesheet references resolved")
    return not result.issues


def check_json_schemas(root: Path) -> bool:
    """Validate parseability and core schemas for deploy JSON files."""
    print("\n[2/6] JSON schemas")
    ok = True
    web_data_dir = rebased(WEB_DATA_DIR, root)

    schemas = {
        "word_labels.json": {"expect_count": 50, "type": "labels"},
        "letter_labels.json": {"expect_count": 24, "type": "labels"},
        "temperature.json": {"type": "temperature"},
        "test_sample.json": {"type": "test_sample"},
        "per_word_stats.json": {"type": "stats"},
        "confusion_pairs.json": {"type": "pairs"},
    }

    for filename, schema in schemas.items():
        path = os.path.join(web_data_dir, filename)
        if not os.path.exists(path):
            _fail(f"{filename}: missing")
            ok = False
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except json.JSONDecodeError as exc:
            _fail(f"{filename}: parse error {exc}")
            ok = False
            continue

        kind = schema.get("type")
        if kind == "labels":
            expect = schema["expect_count"]
            indices = sorted(int(v) for v in data.values())
            if len(data) != expect or indices != list(range(expect)):
                _fail(
                    f"{filename}: expected {expect} dense entries; len={len(data)}, indices={indices[:5]}..."
                )
                ok = False
            else:
                _ok(f"{filename}: {expect} dense classes (0..{expect - 1})")
        elif kind == "temperature":
            t = data.get("T") or data.get("temperature")
            if not isinstance(t, (int, float)) or not 0 < t < 5:
                _fail(f"temperature.json: implausible T value ({t})")
                ok = False
            else:
                _ok(f"temperature.json: T={t}")
        elif kind == "test_sample":
            features = data.get("features", [])
            mask = data.get("mask", [])
            expected_word = data.get("expected_word")
            if len(features) != 45 * 168:
                _fail(f"test_sample.json: features length must be 7560, got {len(features)}")
                ok = False
            elif len(mask) != 45:
                _fail(f"test_sample.json: mask length must be 45, got {len(mask)}")
                ok = False
            elif not expected_word:
                _fail("test_sample.json: expected_word missing")
                ok = False
            else:
                real_frames = sum(1 for v in mask if v)
                _ok(
                    f"test_sample.json: features={len(features)}, mask={len(mask)} (real={real_frames}/45), expected={expected_word}"
                )
        elif kind == "stats":
            if not isinstance(data, dict) or len(data) < 1:
                _fail("per_word_stats.json: empty or of the wrong type")
                ok = False
            else:
                sample_key = next(iter(data))
                fields = data[sample_key]
                missing = [k for k in ("f1", "difficulty") if k not in fields]
                if missing:
                    _fail(f"per_word_stats.json: entry '{sample_key}' lacks fields: {missing}")
                    ok = False
                else:
                    _ok(
                        f"per_word_stats.json: stats for {len(data)} words (example '{sample_key}': f1={fields['f1']}, difficulty={fields['difficulty']})"
                    )
        elif kind == "pairs":
            if not isinstance(data, list) or len(data) < 1:
                _fail("confusion_pairs.json: empty or of the wrong type")
                ok = False
            else:
                sample = data[0]
                if not all(k in sample for k in ("word_a", "word_b")):
                    _fail(
                        f"confusion_pairs.json: the first entry lacks 'word_a'/'word_b': {sample}"
                    )
                    ok = False
                else:
                    _ok(
                        f"confusion_pairs.json: {len(data)} pairs (example: {sample['word_a']} ↔ {sample['word_b']})"
                    )

    return ok


def check_model_test_fixtures(root: Path) -> bool:
    """Validate the deployable fixture registry and every referenced sample."""
    print("\n[3/6] Model Test fixtures")
    web_dir = rebased(WEB_DIR, root)
    web_data_dir = rebased(WEB_DATA_DIR, root)
    manifest_path = os.path.join(web_data_dir, "model-test-samples", "manifest.json")
    if not os.path.exists(manifest_path):
        _fail("model-test-samples/manifest.json: missing")
        return False

    try:
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"Model Test manifest parse error: {exc}")
        return False

    ok = True
    if manifest.get("schema_version") != "asl-model-test-manifest-v1":
        _fail("Model Test manifest schema_version invalid")
        ok = False

    # Word fixtures exported from the Google competition data stay in the
    # ignored local/ folder with their own manifest, because the competition
    # rules forbid redistributing the data. They are checked when present.
    local_path = os.path.join(web_data_dir, "model-test-samples", "local", "manifest.json")
    if os.path.exists(local_path):
        try:
            with open(local_path, encoding="utf-8") as handle:
                local_words = json.load(handle).get("words")
        except (OSError, json.JSONDecodeError, AttributeError) as exc:
            _fail(f"Model Test local manifest unreadable: {exc}")
            return False
        if not isinstance(local_words, list) or not isinstance(manifest.get("words"), list):
            _fail("Model Test local manifest lacks a 'words' list")
            return False
        manifest = {**manifest, "words": manifest["words"] + local_words}
        _warn(
            "model-test-samples/local/ is present: uploading asl-web/ as it is would publish "
            "fixtures derived from competition data; move this folder out before a deploy "
            "(make deploy-check fails while it is there)"
        )

    registered: set[str] = set()
    registered_ids: set[str] = set()
    expected_tasks = {"letters": "letter", "words": "word"}

    for section, expected_task in expected_tasks.items():
        entries = manifest.get(section)
        if not isinstance(entries, list):
            _fail(f"Model Test manifest lacks a '{section}' list")
            ok = False
            continue

        for entry in entries:
            sample_id = entry.get("id") if isinstance(entry, dict) else None
            raw_path = entry.get("path") if isinstance(entry, dict) else None
            if not isinstance(sample_id, str) or not isinstance(raw_path, str):
                _fail(f"Model Test {section}: invalid id/path")
                ok = False
                continue
            if sample_id in registered_ids or raw_path in registered:
                _fail(f"Model Test duplicate entry: {sample_id} / {raw_path}")
                ok = False
                continue

            registered_ids.add(sample_id)
            registered.add(raw_path)
            rel_path = raw_path.removeprefix("./")
            if not rel_path.startswith("data/model-test-samples/") or ".." in rel_path.split("/"):
                _fail(f"Model Test unsafe or invalid path: {raw_path}")
                ok = False
                continue

            sample_path = os.path.join(web_dir, rel_path)
            try:
                with open(sample_path, encoding="utf-8") as handle:
                    sample = json.load(handle)
            except (OSError, json.JSONDecodeError) as exc:
                _fail(f"Model Test sample unreadable: {raw_path} ({exc})")
                ok = False
                continue

            features = sample.get("features")
            expected_len = 93 if expected_task == "letter" else 45 * 168
            if sample.get("schema_version") != "asl-sample-v1":
                _fail(f"{raw_path}: schema_version invalid")
                ok = False
            if sample.get("task") != expected_task:
                _fail(f"{raw_path}: task={sample.get('task')}, expected={expected_task}")
                ok = False
            if not isinstance(features, list) or len(features) != expected_len:
                _fail(f"{raw_path}: features length must be {expected_len}")
                ok = False
            if expected_task == "word":
                mask = sample.get("mask")
                if (
                    not isinstance(mask, list)
                    or len(mask) != 45
                    or not all(isinstance(v, bool) for v in mask)
                ):
                    _fail(f"{raw_path}: mask must be 45 booleans")
                    ok = False

    fixture_root = os.path.join(web_data_dir, "model-test-samples")
    actual = {
        "./" + os.path.relpath(os.path.join(folder, filename), web_dir).replace(os.sep, "/")
        for folder, _, files in os.walk(fixture_root)
        for filename in files
        if filename.endswith(".json") and filename != "manifest.json"
    }
    if actual != registered:
        _fail(
            "Model Test manifest/file drift: "
            f"unregistered={sorted(actual - registered)}, missing={sorted(registered - actual)}"
        )
        ok = False

    if ok:
        _ok(f"Model Test: {len(registered)} fixtures, manifest and schemas agree")
    return ok


def find_gzip_drift(pairs: Iterable[tuple[str, Path, Path]]) -> list[str]:
    """Gzipped copies that do not decompress to exactly their deploy file.

    The browser loads the copy and falls back to the raw file, so a copy left
    behind after a model is exported again would ship two different models,
    one per code path, and nothing at runtime would notice. This prints nothing,
    so the faults it reports can be produced in a test.
    """
    issues: list[str] = []
    for name, compressed, raw in pairs:
        if not compressed.is_file():
            issues.append(f"{name}: not found ({relative(compressed)})")
            continue
        if not raw.is_file():
            issues.append(f"{name}: its uncompressed file {relative(raw)} is missing")
            continue
        try:
            with gzip.open(compressed, "rb") as handle:
                data = handle.read()
        except (OSError, EOFError, zlib.error) as exc:
            issues.append(f"{name}: cannot be read as gzip ({exc})")
            continue
        if data != raw.read_bytes():
            issues.append(
                f"{name}: differs from {relative(raw)}"
                f" → gzip -9 -n -c {relative(raw)} > {relative(compressed)}"
            )
    return issues


class ProvenanceCheck(NamedTuple):
    """One deploy file, its source, and how they compare."""

    name: str
    deploy: Path
    source: Path
    deploy_hash: str | None
    source_hash: str | None
    status: Literal["match", "drift", "missing_deploy", "missing_source"]


def compare_provenance(pairs: Iterable[tuple[str, Path, Path]]) -> list[ProvenanceCheck]:
    """Hash every deploy file and its source and say whether they are the same bytes.

    Both validators report provenance, each in its own words; this is the one
    place that decides the outcome. Every source is tracked by Git, so a clone
    has them all: a missing one was lost, and without it nothing shows the
    deploy file is the exported one. This prints nothing.
    """
    checks: list[ProvenanceCheck] = []
    for name, deploy, source in pairs:
        deploy_hash = _sha256(str(deploy))
        source_hash = _sha256(str(source))
        if deploy_hash is None:
            status = "missing_deploy"
        elif source_hash is None:
            status = "missing_source"
        elif deploy_hash == source_hash:
            status = "match"
        else:
            status = "drift"
        checks.append(ProvenanceCheck(name, deploy, source, deploy_hash, source_hash, status))
    return checks


def check_provenance(root: Path) -> bool:
    """Verify that deploy artifacts match their documented source copies."""
    print("\n[4/6] Provenance hash chain (asl-web ↔ source)")
    ok = True
    for check in compare_provenance(provenance_pairs(root)):
        label = check.name
        if check.status == "missing_deploy":
            _fail(f"{label}: web file missing")
        elif check.status == "missing_source":
            _fail(f"{label}: source file missing ({relative(check.source, root)})")
        elif check.status == "match":
            _ok(f"{label}: {check.deploy_hash[:16]}... (web == source)")
            continue
        else:
            _fail(f"{label}: DRIFT")
            print(f"      web   : {check.deploy_hash}")
            print(f"      source: {check.source_hash}")
            print(f"      → cp {check.source} {check.deploy}")
        ok = False

    gzip_issues = find_gzip_drift(gzip_pairs(root))
    for issue in gzip_issues:
        _fail(issue)
    if gzip_issues:
        ok = False
    else:
        for name, _, raw in gzip_pairs(root):
            _ok(f"{name}: decompresses to exactly {relative(raw, root)}")
    return ok


def check_export_manifest(root: Path) -> bool:
    """Validate the original Kaggle bundle manifest against curated paths."""
    print("\n[5/6] Word export manifest")
    notebooks_results = rebased(NOTEBOOKS_RESULTS, root)
    word_model_dir = rebased(WORD_MODEL_DIR, root)
    manifest_path = os.path.join(notebooks_results, "manifest.json")
    try:
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"word_50_results/manifest.json unreadable: {exc}")
        return False

    entries = manifest.get("files")
    if not isinstance(entries, list):
        _fail("Word export manifest lacks a 'files' list")
        return False

    ok = True
    if manifest.get("num_files") != len(entries) + 1:
        _fail("Word export num_files is not the entry count plus the manifest itself")
        ok = False

    renamed = {
        "word_model.onnx": os.path.join(word_model_dir, "word_model.onnx"),
        "final_model.pt": os.path.join(word_model_dir, "word_model.pt"),
        "word_to_idx.json": os.path.join(word_model_dir, "word_labels.json"),
        "temperature.json": os.path.join(word_model_dir, "temperature.json"),
    }

    for entry in entries:
        filename = entry.get("filename") if isinstance(entry, dict) else None
        if not isinstance(filename, str):
            _fail("Word export manifest has an invalid filename")
            ok = False
            continue
        path = renamed.get(filename, os.path.join(notebooks_results, filename))
        if not os.path.isfile(path) and filename.endswith(".png"):
            path = os.path.join(notebooks_results, "figures", filename)
        if not os.path.isfile(path):
            _fail(f"Word export target missing: {filename}")
            ok = False
            continue
        if os.path.getsize(path) != entry.get("size_bytes"):
            _fail(f"Word export size mismatch: {filename}")
            ok = False
            continue
        if _sha256(path) != entry.get("sha256"):
            _fail(f"Word export hash mismatch: {filename}")
            ok = False

    if ok:
        _ok(f"Word export: size and SHA-256 match for {len(entries)} files")
    return ok


def _print_model_io(label: str, session) -> None:
    """List a model's inputs and outputs with their shapes and element types."""
    for kind, tensors in (("input", session.get_inputs()), ("output", session.get_outputs())):
        for tensor in tensors:
            print(f"      {label} {kind}: {tensor.name} {tensor.type} {tensor.shape}")


def check_onnx_contracts(root: Path, verbose: bool = False) -> bool:
    """Validate the ONNX input/output contracts with ONNX Runtime.

    Raises ToolMissing when ONNX Runtime cannot be imported: the models were
    not looked at, which must not read as their contracts having held.
    """
    print("\n[6/6] ONNX I/O contract")
    web_models_dir = rebased(WEB_MODELS_DIR, root)
    web_data_dir = rebased(WEB_DATA_DIR, root)
    try:
        import onnxruntime as ort  # type: ignore
    except ImportError as exc:
        raise ToolMissing(f"onnxruntime cannot be imported ({exc})") from exc

    ok = True

    # Word model: 45 x 168 float input plus a boolean validity mask. The browser
    # sends the mask as booleans, so a float mask is as much a break as a
    # wrong length.
    word_path = os.path.join(web_models_dir, "word_model.onnx")
    if not os.path.exists(word_path):
        _fail("word_model.onnx missing")
        return False
    sess = ort.InferenceSession(word_path)
    if verbose:
        _print_model_io("word_model", sess)
    in_names = [i.name for i in sess.get_inputs()]
    out_names = [o.name for o in sess.get_outputs()]
    in_shapes = [i.shape for i in sess.get_inputs()]
    out_shapes = [o.shape for o in sess.get_outputs()]
    in_types = [i.type for i in sess.get_inputs()]
    out_types = [o.type for o in sess.get_outputs()]

    word_ok = (
        len(in_names) == 2
        and in_shapes[0][1:] == [45, 168]
        and in_types[0] == "tensor(float)"
        and in_shapes[1][1:] == [45]
        and in_types[1] == "tensor(bool)"
        and len(out_names) == 1
        and out_shapes[0][1:] == [50]
        and out_types[0] == "tensor(float)"
    )
    if word_ok:
        _ok(f"word_model: input={in_names}, output={out_names}, shapes OK")
    else:
        _fail(
            f"word_model SHAPE MISMATCH: inputs={list(zip(in_names, in_shapes, in_types))}, outputs={list(zip(out_names, out_shapes, out_types))}"
        )
        print(
            "      Expected: input tensor(float)[N,45,168] + mask tensor(bool)[N,45]"
            " → output tensor(float)[N,50]"
        )
        ok = False

    # Letter model: one 93D engineered feature vector.
    letter_path = os.path.join(web_models_dir, "letter_model.onnx")
    if not os.path.exists(letter_path):
        _fail("letter_model.onnx missing")
        return False
    sess2 = ort.InferenceSession(letter_path)
    if verbose:
        _print_model_io("letter_model", sess2)
    in_names2 = [i.name for i in sess2.get_inputs()]
    outputs2 = sess2.get_outputs()
    out_names2 = [o.name for o in outputs2]
    out_shapes2 = [o.shape for o in outputs2]
    out_types2 = [o.type for o in outputs2]
    in_shapes2 = [i.shape for i in sess2.get_inputs()]

    letter_ok = (
        len(in_names2) == 1
        and in_shapes2[0][1:] == [93]
        and out_names2 == ["label", "probabilities"]
        and out_types2 == ["tensor(int64)", "tensor(float)"]
        and out_shapes2[1][1:] == [24]
    )
    if letter_ok:
        _ok(
            f"letter_model: input={in_names2}, output={out_names2}, probabilities=tensor(float)[N,24]"
        )
    else:
        _fail(
            f"letter_model SHAPE MISMATCH: inputs={list(zip(in_names2, in_shapes2))}, outputs={list(zip(out_names2, out_shapes2, out_types2))}"
        )
        print(
            "      Expected: input(N,93) → label tensor(int64)[N] + probabilities tensor(float)[N,24]"
        )
        ok = False

    # A model that breaks its interface has already failed, and feeding it the
    # fixture would only crash or add a second failure that hides the first.
    if word_ok:
        ok = check_word_smoke_inference(sess, in_names, out_names, web_data_dir) and ok
    else:
        _warn("offline test skipped: the word_model interface breaks its contract")

    return ok


def check_word_smoke_inference(session, in_names, out_names, web_data_dir: Path) -> bool:
    """Run the word model on the smoke fixture and compare the recorded result.

    This is the only step that shows the deployed model still predicts what it
    did at export time. A fixture that is missing or cannot be fed to the model
    is therefore a failure, not a reason to skip.
    """
    import numpy as np  # onnxruntime depends on it, so it is importable here.

    sample_path = web_data_dir / "test_sample.json"
    labels_path = web_data_dir / "word_labels.json"
    try:
        with open(sample_path, encoding="utf-8") as handle:
            sample = json.load(handle)
        with open(labels_path, encoding="utf-8") as handle:
            i2w = {int(v): k for k, v in json.load(handle).items()}
        features = np.array(sample["features"], dtype=np.float32).reshape(1, 45, 168)
        mask = np.array([sample["mask"]], dtype=bool)
        if mask.shape != (1, 45):
            raise ValueError(f"mask length must be 45, got {mask.shape[-1]}")
        T = float(sample.get("temperature", 1.0))
        if not T > 0:
            raise ValueError(f"temperature must be positive, got {T}")
    except (OSError, json.JSONDecodeError, AttributeError, KeyError, TypeError, ValueError) as exc:
        _fail(f"offline test could not run: {exc}")
        return False

    logits = session.run(out_names, {in_names[0]: features, in_names[1]: mask})[0][0]
    calib = logits / T
    ex = np.exp(calib - calib.max())
    probs = ex / ex.sum()
    top1 = int(np.argmax(probs))

    predicted = i2w.get(top1)
    expected = sample.get("expected_word")
    conf_diff = abs(probs[top1] - sample.get("expected_confidence", 0))

    if predicted == expected and conf_diff < 1e-3:
        _ok(
            f"offline test: {predicted} @ {probs[top1]:.4f} (Δconf={conf_diff:.2e}), ground truth {expected}"
        )
        return True
    _fail(
        f"offline test FAIL: predicted={predicted} ({probs[top1]:.4f}), expected={expected} (Δconf={conf_diff:.2e})"
    )
    return False


class DeployInventory(NamedTuple):
    """What listing the folder about to be uploaded found."""

    issues: list[str]
    files: int


def _shipped_kind(rel: PurePosixPath) -> bool:
    """Whether the allowlist in contracts.py admits a file at this path."""
    name = rel.name
    if name in DEPLOY_FILES_ANYWHERE:
        return True
    if len(rel.parts) == 1:
        return name in DEPLOY_ROOT_FILES
    for depth in range(len(rel.parts) - 1, 0, -1):
        endings = DEPLOY_ALLOWED_ENDINGS.get("/".join(rel.parts[:depth]))
        if endings is not None:
            return any(
                name.endswith(ending) if ending.startswith(".") else name == ending
                for ending in endings
            )
    return False


def find_deploy_inventory_issues(web_dir: Path, ignored: Iterable[Path] = ()) -> DeployInventory:
    """Every file under `web_dir` that an upload of it must not carry.

    `ignored` holds the files Git ignores there, when Git can say; the
    allowlist applies either way, so a checkout without Git is still checked.
    Each offending path is reported once, with the first reason that applies.
    This prints nothing and reads nothing outside `web_dir`.
    """
    label = web_dir.name
    forbidden = {web_dir / path.relative_to(WEB_DIR) for path in DEPLOY_FORBIDDEN_DIRS}
    found: dict[str, str] = {}
    files = 0

    for directory in sorted(forbidden):
        if directory.is_dir():
            rel = directory.relative_to(web_dir).as_posix()
            found[f"{rel}/"] = (
                f"{label}/{rel}/: local only, never published (fixtures derived from "
                "competition data); move the folder out of asl-web/ before the upload"
            )

    for folder, dirs, names in os.walk(web_dir):
        folder_path = Path(folder)
        dirs[:] = sorted(d for d in dirs if folder_path / d not in forbidden)
        for name in sorted(names):
            files += 1
            rel = PurePosixPath((folder_path / name).relative_to(web_dir).as_posix())
            if name == ".DS_Store":
                reason = "macOS Finder metadata; make clean removes it"
            elif any(part.startswith(".") for part in rel.parts):
                reason = "hidden file; the site does not publish it"
            elif not _shipped_kind(rel):
                reason = "not in the publish allowlist (contracts.DEPLOY_ALLOWED_ENDINGS)"
            else:
                continue
            found.setdefault(str(rel), f"{label}/{rel}: {reason}")

    for path in sorted(ignored):
        if any(directory in path.parents for directory in forbidden):
            continue
        rel = path.relative_to(web_dir).as_posix()
        found.setdefault(rel, f"{label}/{rel}: Git ignores this file; it must not be uploaded")

    return DeployInventory([found[key] for key in sorted(found)], files)


def git_ignored_files(root: Path) -> list[Path] | None:
    """Files Git ignores under asl-web/, or None when `root` is not a Git checkout."""
    git = shutil.which("git")
    if git is None:
        return None
    top = subprocess.run(
        [git, "-C", str(root), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if top.returncode != 0 or Path(top.stdout.strip()).resolve() != root.resolve():
        return None
    web = relative(WEB_DIR)
    listed = subprocess.run(
        [git, "-C", str(root), "ls-files", "-z", "--others", "--ignored", "--exclude-standard"]
        + ["--", web],
        capture_output=True,
        check=True,
        timeout=60,
    ).stdout.decode("utf-8")
    return [root / name for name in listed.split("\0") if name]


def check_deploy_inventory(root: Path) -> bool:
    """Report what an upload of asl-web/ from this working tree would carry."""
    print("\n[deploy] Inventory of the folder to upload (asl-web/)")
    web_dir = rebased(WEB_DIR, root)
    ignored = git_ignored_files(root)
    if ignored is None:
        _warn("not a Git working tree: only the allowlist was applied")
    result = find_deploy_inventory_issues(web_dir, ignored or ())
    for issue in result.issues:
        _fail(issue)
    if not result.issues:
        _ok(f"asl-web/: {result.files} files, all of a published kind")
    return not result.issues


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the explicit runtime-validation switches."""
    parser = argparse.ArgumentParser(description="Runtime asset check of asl-web/")
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="also print the ONNX inputs and outputs"
    )
    parser.add_argument(
        "--no-onnx", action="store_true", help="skip the ONNX check (files, JSON and hashes only)"
    )
    parser.add_argument(
        "--deploy",
        action="store_true",
        help="before an upload: check every file under asl-web/ against the allowlist",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=PROJECT_ROOT,
        help="root of the checkout to check (default: this repository)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = args.root.resolve()

    print("=" * 60)
    print("  asl-web/ Runtime Asset Smoke Test")
    print("=" * 60)

    file_ok = check_file_existence_and_size(root)
    json_ok = check_json_schemas(root)
    fixtures_ok = check_model_test_fixtures(root)
    hash_ok = check_provenance(root)
    export_ok = check_export_manifest(root)
    onnx_ok = True
    unverified: str | None = None
    if not args.no_onnx:
        try:
            onnx_ok = check_onnx_contracts(root, args.verbose)
        except ToolMissing as exc:
            unverified = str(exc)
            _warn(f"{unverified}: ONNX contract NOT VERIFIED")
    inventory_ok = check_deploy_inventory(root) if args.deploy else True

    print("\n" + "=" * 60)
    overall = (
        file_ok and json_ok and fixtures_ok and hash_ok and export_ok and onnx_ok and inventory_ok
    )
    if not overall:
        print("  RESULT: \033[31m✗ FIX REQUIRED\033[0m")
    elif unverified:
        print("  RESULT: \033[33m⚠ NOT VERIFIED\033[0m (the ONNX step could not run)")
    else:
        print("  RESULT: \033[32m✓ SAFE TO DEPLOY\033[0m")
    print("=" * 60 + "\n")

    if not overall:
        print("Next steps:")
        if not file_ok:
            print("  - Missing or truncated files: copy them again from their source")
        if not json_ok:
            print("  - JSON schema error: see docs/models-and-data.md")
        if not fixtures_ok:
            print("  - Export the Model Test manifest and fixtures again")
        if not hash_ok:
            print("  - Hash drift: a notebook or script may have run again; copy from the source")
        if not export_ok:
            print("  - Bring the curated files back in line with the word export manifest")
        if not onnx_ok:
            print("  - ONNX shape mismatch: the model was exported again but the web copy is old")
        if not inventory_ok:
            print("  - Deploy inventory: move the listed files out of asl-web/, then upload")
        print()
        return 1

    if unverified:
        print("Next step:")
        print(
            "  - pip install -r requirements-dev.txt; to leave ONNX out on purpose, pass --no-onnx"
        )
        print()
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
