#!/usr/bin/env python3
"""Run fast integrity checks for the deployable ``asl-web`` application.

The command verifies required files and minimum sizes, JSON schemas, Model Test
fixtures, source-to-deploy hashes, gzipped deploy copies, the curated Kaggle
export manifest, and ONNX input/output contracts by default. It intentionally
skips local dataset inspection; use ``verify_project_assets.py`` for the broader
repository audit.

Examples:
  python scripts/validation/check_runtime_assets.py
  python scripts/validation/check_runtime_assets.py --verbose
  python scripts/validation/check_runtime_assets.py --no-onnx

Exit status is zero when every required check passes and one otherwise. See
``docs/models-and-data.md`` for model provenance and ONNX contracts.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import zlib
from collections.abc import Iterable
from pathlib import Path
from typing import NamedTuple

if __package__ in (None, ""):  # Allow running this file directly.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.validation.contracts import (  # noqa: E402
    ALL_ARTIFACTS,
    NOTEBOOKS_RESULTS,
    PROJECT_ROOT,
    WEB_DATA_DIR,
    WEB_DIR,
    WEB_MODELS_DIR,
    WORD_MODEL_DIR,
    gzip_pairs,
    provenance_pairs,
    relative,
)

# Coarse floors that catch a truncated copy or a committed Git LFS pointer.
# Source files are not in here: see check_web_sources().
MIN_SIZES_KB = {relative(artifact.deploy_path): artifact.min_size_kb for artifact in ALL_ARTIFACTS}

# Source-to-deploy hash pairs detect unreviewed runtime drift.
PROVENANCE_PAIRS = provenance_pairs()


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


def check_file_existence_and_size() -> bool:
    """Check required runtime artifacts exist and are not truncated.

    The floors here are coarse and apply to binaries and curated data only:
    they catch a partial copy or a Git LFS pointer committed in place of the
    file. Source files are checked by their content in check_web_sources(),
    because a size floor on source only forbids it getting smaller.
    """
    print("\n[1/6] Dosya mevcudiyet + minimum boyut kontrolu")
    ok = True
    for rel_path, min_kb in MIN_SIZES_KB.items():
        abs_path = os.path.join(PROJECT_ROOT, rel_path)
        if not os.path.exists(abs_path):
            _fail(f"{rel_path}: BULUNAMADI")
            ok = False
            continue
        actual_kb = _file_kb(abs_path)
        if actual_kb < min_kb:
            _fail(f"{rel_path}: COK KUCUK ({actual_kb:.1f} KB < {min_kb} KB)")
            ok = False
        else:
            _ok(f"{rel_path}: {actual_kb:.1f} KB")
    return ok and check_web_sources()


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
        return WebSourceCheck([f"{relative(index_html)}: bos veya bulunamadi"], 0, 0)
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
            issues.append(f"{relative(target)}: index.html referansi bos veya eksik")

    on_disk = {
        str(path.relative_to(web_dir)).replace(os.sep, "/")
        for path in (web_dir / "js").rglob("*.js")
    }
    if not on_disk:
        issues.append("asl-web/js: JavaScript modulu bulunamadi")
        return WebSourceCheck(issues, 0, len(stylesheets))

    for name in sorted(name for name in on_disk if (web_dir / name).stat().st_size == 0):
        issues.append(f"asl-web/{name}: BOS")

    loaded = {src for src in _loaded_local_scripts(html) if src.startswith("js/")}
    for name in sorted(loaded - on_disk):
        issues.append(f"asl-web/{name}: index.html yukluyor ama dosya yok")
    for name in sorted(on_disk - loaded):
        issues.append(f"asl-web/{name}: dosya var ama index.html yuklemiyor")

    return WebSourceCheck(issues, len(on_disk), len(stylesheets))


def check_web_sources() -> bool:
    """Report the browser source inspection to the user."""
    result = find_web_source_issues(WEB_DIR)
    for issue in result.issues:
        _fail(issue)
    if not result.issues:
        _ok(f"asl-web/js: {result.modules} modul, tamami index.html tarafindan yukleniyor")
        _ok(f"asl-web/css: {result.stylesheets} stylesheet referansi cozuldu")
    return not result.issues


def check_json_schemas() -> bool:
    """Validate parseability and core schemas for deploy JSON files."""
    print("\n[2/6] JSON sema kontrolu")
    ok = True

    schemas = {
        "word_labels.json": {"expect_count": 50, "type": "labels"},
        "letter_labels.json": {"expect_count": 24, "type": "labels"},
        "temperature.json": {"type": "temperature"},
        "test_sample.json": {"type": "test_sample"},
        "per_word_stats.json": {"type": "stats"},
        "confusion_pairs.json": {"type": "pairs"},
    }

    for filename, schema in schemas.items():
        path = os.path.join(WEB_DATA_DIR, filename)
        if not os.path.exists(path):
            _fail(f"{filename}: yok")
            ok = False
            continue
        try:
            data = json.load(open(path, encoding="utf-8"))
        except json.JSONDecodeError as exc:
            _fail(f"{filename}: parse hatasi {exc}")
            ok = False
            continue

        kind = schema.get("type")
        if kind == "labels":
            expect = schema["expect_count"]
            indices = sorted(int(v) for v in data.values())
            if len(data) != expect or indices != list(range(expect)):
                _fail(
                    f"{filename}: dense {expect} eleman bekleniyor; len={len(data)}, indices={indices[:5]}..."
                )
                ok = False
            else:
                _ok(f"{filename}: dense {expect} sinif (0..{expect - 1})")
        elif kind == "temperature":
            t = data.get("T") or data.get("temperature")
            if not isinstance(t, (int, float)) or not 0 < t < 5:
                _fail(f"temperature.json: T degeri makul degil ({t})")
                ok = False
            else:
                _ok(f"temperature.json: T={t}")
        elif kind == "test_sample":
            features = data.get("features", [])
            mask = data.get("mask", [])
            expected_word = data.get("expected_word")
            if len(features) != 45 * 168:
                _fail(f"test_sample.json: features uzunlugu 7560 olmali, {len(features)}")
                ok = False
            elif len(mask) != 45:
                _fail(f"test_sample.json: mask uzunlugu 45 olmali, {len(mask)}")
                ok = False
            elif not expected_word:
                _fail("test_sample.json: expected_word eksik")
                ok = False
            else:
                real_frames = sum(1 for v in mask if v)
                _ok(
                    f"test_sample.json: features={len(features)}, mask={len(mask)} (gercek={real_frames}/45), expected={expected_word}"
                )
        elif kind == "stats":
            if not isinstance(data, dict) or len(data) < 1:
                _fail("per_word_stats.json: bos veya yanlis tip")
                ok = False
            else:
                sample_key = next(iter(data))
                fields = data[sample_key]
                missing = [k for k in ("f1", "difficulty") if k not in fields]
                if missing:
                    _fail(f"per_word_stats.json: '{sample_key}' kayitinda eksik alan: {missing}")
                    ok = False
                else:
                    _ok(
                        f"per_word_stats.json: {len(data)} kelime stat (ornek '{sample_key}': f1={fields['f1']}, difficulty={fields['difficulty']})"
                    )
        elif kind == "pairs":
            if not isinstance(data, list) or len(data) < 1:
                _fail("confusion_pairs.json: bos veya yanlis tip")
                ok = False
            else:
                sample = data[0]
                if not all(k in sample for k in ("word_a", "word_b")):
                    _fail(f"confusion_pairs.json: ilk eleman 'word_a'/'word_b' icermiyor: {sample}")
                    ok = False
                else:
                    _ok(
                        f"confusion_pairs.json: {len(data)} cift (ornek: {sample['word_a']} ↔ {sample['word_b']})"
                    )

    return ok


def check_model_test_fixtures() -> bool:
    """Validate the deployable fixture registry and every referenced sample."""
    print("\n[3/6] Model Test fixture paketi")
    manifest_path = os.path.join(WEB_DATA_DIR, "model-test-samples", "manifest.json")
    if not os.path.exists(manifest_path):
        _fail("model-test-samples/manifest.json: yok")
        return False

    try:
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"Model Test manifest parse hatasi: {exc}")
        return False

    ok = True
    if manifest.get("schema_version") != "asl-model-test-manifest-v1":
        _fail("Model Test manifest schema_version gecersiz")
        ok = False

    registered: set[str] = set()
    registered_ids: set[str] = set()
    expected_tasks = {"letters": "letter", "words": "word"}

    for section, expected_task in expected_tasks.items():
        entries = manifest.get(section)
        if not isinstance(entries, list):
            _fail(f"Model Test manifest '{section}' listesi eksik")
            ok = False
            continue

        for entry in entries:
            sample_id = entry.get("id") if isinstance(entry, dict) else None
            raw_path = entry.get("path") if isinstance(entry, dict) else None
            if not isinstance(sample_id, str) or not isinstance(raw_path, str):
                _fail(f"Model Test {section}: id/path gecersiz")
                ok = False
                continue
            if sample_id in registered_ids or raw_path in registered:
                _fail(f"Model Test duplicate kayit: {sample_id} / {raw_path}")
                ok = False
                continue

            registered_ids.add(sample_id)
            registered.add(raw_path)
            rel_path = raw_path.removeprefix("./")
            if not rel_path.startswith("data/model-test-samples/") or ".." in rel_path.split("/"):
                _fail(f"Model Test guvensiz/gecersiz path: {raw_path}")
                ok = False
                continue

            sample_path = os.path.join(WEB_DIR, rel_path)
            try:
                with open(sample_path, encoding="utf-8") as handle:
                    sample = json.load(handle)
            except (OSError, json.JSONDecodeError) as exc:
                _fail(f"Model Test sample okunamadi: {raw_path} ({exc})")
                ok = False
                continue

            features = sample.get("features")
            expected_len = 93 if expected_task == "letter" else 45 * 168
            if sample.get("schema_version") != "asl-sample-v1":
                _fail(f"{raw_path}: schema_version gecersiz")
                ok = False
            if sample.get("task") != expected_task:
                _fail(f"{raw_path}: task={sample.get('task')}, beklenen={expected_task}")
                ok = False
            if not isinstance(features, list) or len(features) != expected_len:
                _fail(f"{raw_path}: features uzunlugu {expected_len} olmali")
                ok = False
            if expected_task == "word":
                mask = sample.get("mask")
                if (
                    not isinstance(mask, list)
                    or len(mask) != 45
                    or not all(isinstance(v, bool) for v in mask)
                ):
                    _fail(f"{raw_path}: 45 boolean mask bekleniyor")
                    ok = False

    fixture_root = os.path.join(WEB_DATA_DIR, "model-test-samples")
    actual = {
        "./" + os.path.relpath(os.path.join(root, filename), WEB_DIR).replace(os.sep, "/")
        for root, _, files in os.walk(fixture_root)
        for filename in files
        if filename.endswith(".json") and filename != "manifest.json"
    }
    if actual != registered:
        _fail(
            "Model Test manifest/file drift: "
            f"kayitsiz={sorted(actual - registered)}, eksik={sorted(registered - actual)}"
        )
        ok = False

    if ok:
        _ok(f"Model Test: {len(registered)} fixture, manifest ve semalar uyumlu")
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
            issues.append(f"{name}: bulunamadi ({relative(compressed)})")
            continue
        if not raw.is_file():
            issues.append(f"{name}: acilmis hali {relative(raw)} yok")
            continue
        try:
            with gzip.open(compressed, "rb") as handle:
                data = handle.read()
        except (OSError, EOFError, zlib.error) as exc:
            issues.append(f"{name}: gzip olarak acilamadi ({exc})")
            continue
        if data != raw.read_bytes():
            issues.append(
                f"{name}: {relative(raw)} ile ayni degil"
                f" → gzip -9 -n -c {relative(raw)} > {relative(compressed)}"
            )
    return issues


def check_provenance() -> bool:
    """Verify that deploy artifacts match their documented source copies."""
    print("\n[4/6] Provenance hash chain (asl-web ↔ kaynak)")
    ok = True
    for label, web_path, source_path in PROVENANCE_PAIRS:
        web_hash = _sha256(web_path)
        src_hash = _sha256(source_path)
        if web_hash is None:
            _fail(f"{label}: web dosyasi yok")
            ok = False
            continue
        if src_hash is None:
            _warn(
                f"{label}: kaynak dosya yok ({source_path}) — gelistirme ortami eksik, web run OK"
            )
            continue
        if web_hash == src_hash:
            _ok(f"{label}: {web_hash[:16]}... (web == kaynak)")
        else:
            _fail(f"{label}: DRIFT")
            print(f"      web   : {web_hash}")
            print(f"      kaynak: {src_hash}")
            print(f"      → cp {source_path} {web_path}")
            ok = False

    gzip_issues = find_gzip_drift(gzip_pairs())
    for issue in gzip_issues:
        _fail(issue)
    if gzip_issues:
        ok = False
    else:
        for name, _, raw in gzip_pairs():
            _ok(f"{name}: acildiginda {relative(raw)} ile birebir ayni")
    return ok


def check_export_manifest() -> bool:
    """Validate the original Kaggle bundle manifest against curated paths."""
    print("\n[5/6] Word export manifesti")
    manifest_path = os.path.join(NOTEBOOKS_RESULTS, "manifest.json")
    try:
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"word_50_results/manifest.json okunamadi: {exc}")
        return False

    entries = manifest.get("files")
    if not isinstance(entries, list):
        _fail("Word export manifest 'files' listesi eksik")
        return False

    ok = True
    if manifest.get("num_files") != len(entries) + 1:
        _fail("Word export num_files, manifest haric entry sayisiyla uyusmuyor")
        ok = False

    renamed = {
        "word_model.onnx": os.path.join(WORD_MODEL_DIR, "word_model.onnx"),
        "final_model.pt": os.path.join(WORD_MODEL_DIR, "word_model.pt"),
        "word_to_idx.json": os.path.join(WORD_MODEL_DIR, "word_labels.json"),
        "temperature.json": os.path.join(WORD_MODEL_DIR, "temperature.json"),
    }

    for entry in entries:
        filename = entry.get("filename") if isinstance(entry, dict) else None
        if not isinstance(filename, str):
            _fail("Word export manifest filename gecersiz")
            ok = False
            continue
        path = renamed.get(filename, os.path.join(NOTEBOOKS_RESULTS, filename))
        if not os.path.isfile(path) and filename.endswith(".png"):
            path = os.path.join(NOTEBOOKS_RESULTS, "figures", filename)
        if not os.path.isfile(path):
            _fail(f"Word export hedefi yok: {filename}")
            ok = False
            continue
        if os.path.getsize(path) != entry.get("size_bytes"):
            _fail(f"Word export boyut uyusmazligi: {filename}")
            ok = False
            continue
        if _sha256(path) != entry.get("sha256"):
            _fail(f"Word export hash uyusmazligi: {filename}")
            ok = False

    if ok:
        _ok(f"Word export: {len(entries)} dosyanin boyut ve SHA-256 degeri uyumlu")
    return ok


def check_onnx_contracts(verbose: bool = False) -> bool:
    """Validate ONNX input/output contracts when ONNX Runtime is available."""
    print("\n[6/6] ONNX I/O sozlesmesi")
    try:
        import onnxruntime as ort  # type: ignore
    except ImportError:
        _warn("onnxruntime kurulu degil — atlandi (pip install -r requirements-dev.txt)")
        return True

    ok = True

    # Word model: 45 x 168 float input plus a boolean validity mask.
    word_path = os.path.join(WEB_MODELS_DIR, "word_model.onnx")
    if not os.path.exists(word_path):
        _fail("word_model.onnx yok")
        return False
    sess = ort.InferenceSession(word_path)
    in_names = [i.name for i in sess.get_inputs()]
    out_names = [o.name for o in sess.get_outputs()]
    in_shapes = [i.shape for i in sess.get_inputs()]
    out_shapes = [o.shape for o in sess.get_outputs()]

    word_ok = (
        len(in_names) == 2
        and in_shapes[0][1:] == [45, 168]
        and in_shapes[1][1:] == [45]
        and len(out_names) == 1
        and out_shapes[0][1:] == [50]
    )
    if word_ok:
        _ok(f"word_model: input={in_names}, output={out_names}, shapes OK")
    else:
        _fail(
            f"word_model SHAPE MISMATCH: inputs={list(zip(in_names, in_shapes))}, outputs={list(zip(out_names, out_shapes))}"
        )
        print("      Beklenen: input(1,45,168) + mask(1,45) → output(1,50)")
        ok = False

    # Letter model: one 93D engineered feature vector.
    letter_path = os.path.join(WEB_MODELS_DIR, "letter_model.onnx")
    if not os.path.exists(letter_path):
        _fail("letter_model.onnx yok")
        return False
    sess2 = ort.InferenceSession(letter_path)
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
            "      Beklenen: input(N,93) → label tensor(int64)[N] + probabilities tensor(float)[N,24]"
        )
        ok = False

    # Optionally verify deterministic inference against the smoke fixture.
    sample_path = os.path.join(WEB_DATA_DIR, "test_sample.json")
    if os.path.exists(sample_path):
        try:
            import numpy as np  # type: ignore

            sample = json.load(open(sample_path, encoding="utf-8"))
            features = np.array(sample["features"], dtype=np.float32).reshape(1, 45, 168)
            mask = np.array([sample["mask"]], dtype=bool)
            T = sample.get("temperature", 1.0)

            logits = sess.run(out_names, {in_names[0]: features, in_names[1]: mask})[0][0]
            calib = logits / T
            ex = np.exp(calib - calib.max())
            probs = ex / ex.sum()
            top1 = int(np.argmax(probs))

            with open(os.path.join(WEB_DATA_DIR, "word_labels.json"), encoding="utf-8") as f:
                i2w = {int(v): k for k, v in json.load(f).items()}

            predicted = i2w.get(top1)
            expected = sample.get("expected_word")
            conf_diff = abs(probs[top1] - sample.get("expected_confidence", 0))

            if predicted == expected and conf_diff < 1e-3:
                _ok(
                    f"offline test: {predicted} @ {probs[top1]:.4f} (Δconf={conf_diff:.2e}) — ground truth {expected}"
                )
            else:
                _fail(
                    f"offline test FAIL: predicted={predicted} ({probs[top1]:.4f}), expected={expected} (Δconf={conf_diff:.2e})"
                )
                ok = False
        except (ImportError, KeyError, ValueError) as exc:
            _warn(f"offline test atlandi: {exc}")

    return ok


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the explicit runtime-validation switches."""
    parser = argparse.ArgumentParser(description="asl-web/ runtime sağlik kontrolu")
    parser.add_argument("--verbose", "-v", action="store_true", help="Daha detayli cikti")
    parser.add_argument(
        "--no-onnx", action="store_true", help="ONNX kontrolunu atla (sadece dosya/json/hash)"
    )
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()

    print("=" * 60)
    print("  asl-web/ Runtime Asset Smoke Test")
    print("=" * 60)

    file_ok = check_file_existence_and_size()
    json_ok = check_json_schemas()
    fixtures_ok = check_model_test_fixtures()
    hash_ok = check_provenance()
    export_ok = check_export_manifest()
    onnx_ok = True if args.no_onnx else check_onnx_contracts(args.verbose)

    print("\n" + "=" * 60)
    overall = file_ok and json_ok and fixtures_ok and hash_ok and export_ok and onnx_ok
    if overall:
        print("  SONUC: \033[32m✓ DEPLOY GUVENLI\033[0m")
    else:
        print("  SONUC: \033[31m✗ DUZELTME GEREKLI\033[0m")
    print("=" * 60 + "\n")

    if not overall:
        print("Sonraki adimlar:")
        if not file_ok:
            print("  - Eksik/kucuk dosyalar: source dosyadan yeniden kopyala")
        if not json_ok:
            print("  - JSON sema hatasi: docs/models-and-data.md kontrol et")
        if not fixtures_ok:
            print("  - Model Test manifest/fixture paketini yeniden export et")
        if not hash_ok:
            print(
                "  - Hash drift: notebook/script yeniden calistirilmis olabilir, source'tan kopyala"
            )
        if not export_ok:
            print("  - Word export manifesti ile curated dosyalari yeniden eslestir")
        if not onnx_ok:
            print("  - ONNX shape mismatch: model yeniden export edilmis ama web kopyasi eski")
        print()

    return 0 if overall else 1


if __name__ == "__main__":
    sys.exit(main())
