#!/usr/bin/env python3
"""Download MS-ASL clips for an exploratory 50-word data experiment.

This helper was not used to train the published 50-word web model, which uses
Google ASL Signs data. It remains useful for reproducing the documented MS-ASL
exploration.

Examples:
    python scripts/data_preparation/download_msasl_videos.py
    python scripts/data_preparation/download_msasl_videos.py --workers 4 --retry-failed
    python scripts/data_preparation/download_msasl_videos.py --dry-run
    python scripts/data_preparation/download_msasl_videos.py --max-per-word 5  # test

Outputs:
    data/raw/MS-ASL/videos/{class_id}_{word}/{split}_{idx}.mp4
    data/raw/MS-ASL/download_state.json   (state for resuming)
    data/raw/MS-ASL/download.log          (detailed log)
"""

import argparse
import json
import logging
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MSASL_DIR = PROJECT_ROOT / "data" / "raw" / "MS-ASL"
DEFAULT_VIDEO_DIR = MSASL_DIR / "videos"
DEFAULT_STATE_FILE = MSASL_DIR / "download_state.json"
DEFAULT_LOG_FILE = MSASL_DIR / "download.log"

# Target vocabulary mapped to MS-ASL class identifiers.
WORD_TO_MSASL_CLASS = {
    "hello": 0,
    "eat": 3,
    "food": 3,
    "no": 4,
    "happy": 5,
    "like": 6,
    "finish": 12,
    "friend": 17,
    "mom": 19,
    "yes": 20,
    "good": 24,
    "again": 26,
    "sad": 27,
    "need": 29,
    "dad": 31,
    "brother": 34,
    "book": 38,
    "please": 47,
    "water": 48,
    "help": 50,
    "hungry": 54,
    "different": 55,
    "drink": 56,
    "sick": 63,
    "name": 67,
    "day": 72,
    "thankyou": 75,
    "go": 87,
    "big": 88,
    "work": 90,
    "know": 97,
    "dog": 108,
    "have": 111,
    "home": 118,
    "all": 134,
    "hot": 135,
    "can": 142,
    "more": 164,
    "cold": 177,
    "bye": 216,
    "new": 271,
    "give": 288,
    "talk": 355,
    "sleep": 361,
    "before": 387,
    "wait": 400,
    "child": 525,
    "look": 613,
    "open": 702,
    "come": 801,
}

# Reverse mapping; multiple target words can share one MS-ASL class.
CLASS_TO_WORDS: dict[int, list[str]] = {}
for word, cid in WORD_TO_MSASL_CLASS.items():
    CLASS_TO_WORDS.setdefault(cid, []).append(word)

# Unique source classes after shared mappings are collapsed.
TARGET_CLASS_IDS = set(WORD_TO_MSASL_CLASS.values())

# Errors that should not be retried on a resumed download.
PERMANENT_SKIP_REASONS = {
    "unavailable",
    "private",
    "age_restricted",
    "deleted",
    "account_terminated",
    "copyright",
    "removed",
}


def setup_logging(log_file: Path) -> logging.Logger:
    """Create an INFO console logger and a DEBUG file logger."""
    logger = logging.getLogger("msasl_download")
    logger.setLevel(logging.DEBUG)

    # Persist detailed diagnostics for resumable bulk downloads.
    log_file.parent.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    )
    logger.addHandler(fh)

    # Keep interactive output concise.
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(ch)

    return logger


def load_msasl_entries() -> list[dict]:
    """Load entries for the target MS-ASL class identifiers.

    Returns:
        Normalized metadata dictionaries for downloadable clips.
    """
    classes_path = MSASL_DIR / "MSASL_classes.json"
    with open(classes_path) as f:
        class_names = json.load(f)

    entries = []

    for split_name in ("train", "val", "test"):
        json_path = MSASL_DIR / f"MSASL_{split_name}.json"
        with open(json_path) as f:
            split_data = json.load(f)

        for idx, item in enumerate(split_data):
            label = item["label"]
            if label not in TARGET_CLASS_IDS:
                continue

            # Normalize incomplete URLs found in the source metadata.
            url = item["url"]
            if url.startswith("www."):
                url = "https://" + url
            elif not url.startswith("http"):
                url = "https://" + url

            words = CLASS_TO_WORDS[label]

            entries.append(
                {
                    "entry_id": f"{split_name}_{idx}",
                    "words": words,
                    "ms_class": class_names[label],
                    "class_id": label,
                    "split": split_name,
                    "entry_idx": idx,
                    "url": url,
                    "start_time": item.get("start_time", 0.0),
                    "end_time": item.get("end_time", 0.0),
                    "signer_id": item.get("signer_id", -1),
                    "box": item.get("box"),
                    "width": item.get("width", 0),
                    "height": item.get("height", 0),
                    "fps": item.get("fps", 30.0),
                }
            )

    return entries


def load_state(state_file: Path) -> dict:
    """Load resumable download state."""
    if state_file.exists():
        with open(state_file) as f:
            return json.load(f)
    return {"version": 1, "completed": {}, "failed": {}}


def save_state(state: dict, state_file: Path) -> None:
    """Atomically persist resumable download state."""
    tmp = state_file.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    tmp.replace(state_file)


def check_ytdlp() -> bool:
    """Return whether the ``yt-dlp`` executable is available."""
    return shutil.which("yt-dlp") is not None


def build_download_command(entry: dict, output_path: Path) -> list[str]:
    """Build the ``yt-dlp`` argv for one annotated clip.

    Keeping argv construction free of filesystem and process side effects makes
    the public CLI contract cheap to test without downloading a video.
    """
    return [
        "yt-dlp",
        "-f",
        "bestvideo[height<=480]+bestaudio/best[height<=480]/bestvideo[height<=360]+bestaudio/best[height<=360]/best",
        "--download-sections",
        f"*{entry['start_time']}-{entry['end_time']}",
        "--force-keyframes-at-cuts",
        "--merge-output-format",
        "mp4",
        "-o",
        str(output_path),
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--socket-timeout",
        "30",
        "--retries",
        "2",
        "--no-check-certificates",
        entry["url"],
    ]


def download_clip(
    entry: dict,
    output_dir: Path,
    logger: logging.Logger,
    max_retries: int = 2,
) -> dict:
    """Download one time-bounded video clip.

    Returns:
        A status dictionary with the local path and failure reason.
    """
    cid = entry["class_id"]
    ms_class = entry["ms_class"]
    entry_id = entry["entry_id"]

    # Group clips by their source class identifier and sanitized name.
    safe_name = ms_class.replace(" ", "_").replace("/", "_")
    clip_dir = output_dir / f"{cid}_{safe_name}"
    clip_dir.mkdir(parents=True, exist_ok=True)

    output_path = clip_dir / f"{entry_id}.mp4"

    # Reuse an existing non-empty clip when resuming.
    if output_path.exists() and output_path.stat().st_size > 1000:
        return {"status": "success", "path": str(output_path), "reason": "already_exists"}

    # Ask yt-dlp to fetch only the annotated sign interval.
    cmd = build_download_command(entry, output_path)

    for attempt in range(max_retries + 1):
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )

            if result.returncode == 0 and output_path.exists():
                size_kb = output_path.stat().st_size / 1024
                if size_kb < 1:
                    output_path.unlink(missing_ok=True)
                    return {"status": "error", "path": "", "reason": "empty_file"}
                logger.debug(f"  OK {entry_id}: {size_kb:.0f} KB")
                return {"status": "success", "path": str(output_path), "reason": "downloaded"}

            stderr = result.stderr.lower()

            # Classify permanent source failures so resume can skip them.
            if any(
                kw in stderr
                for kw in [
                    "video unavailable",
                    "private video",
                    "has been removed",
                    "account associated",
                    "terminated",
                    "copyright",
                    "this video is not available",
                    "not available in your country",
                ]
            ):
                return {"status": "unavailable", "path": "", "reason": "video_unavailable"}

            if "sign in to confirm" in stderr or "age" in stderr:
                return {"status": "age_restricted", "path": "", "reason": "age_restricted"}

            # Retry transient downloader failures with a short backoff.
            if attempt < max_retries:
                wait = (attempt + 1) * 5
                logger.debug(f"  {entry_id}: Retry {attempt + 1}/{max_retries} ({wait}s)")
                time.sleep(wait)
                continue

            return {"status": "error", "path": "", "reason": f"exit_code_{result.returncode}"}

        except subprocess.TimeoutExpired:
            if attempt < max_retries:
                logger.debug(f"  {entry_id}: Timeout, retry {attempt + 1}")
                time.sleep(5)
                continue
            return {"status": "error", "path": "", "reason": "timeout"}

        except Exception as e:
            return {"status": "error", "path": "", "reason": str(e)[:100]}

    return {"status": "error", "path": "", "reason": "max_retries_exceeded"}


def download_all(
    entries: list[dict],
    output_dir: Path,
    state_file: Path,
    logger: logging.Logger,
    max_workers: int = 3,
    retry_failed: bool = False,
    dry_run: bool = False,
    max_per_word: int = 0,
) -> dict:
    """Download all eligible entries with a bounded thread pool.

    Returns:
        Aggregate status counts.
    """
    state = load_state(state_file)
    stats = {
        "success": 0,
        "unavailable": 0,
        "age_restricted": 0,
        "error": 0,
        "skipped": 0,
        "total": len(entries),
    }

    # Remove completed or permanently failed entries from the work queue.
    to_download = []
    for entry in entries:
        eid = entry["entry_id"]

        # Successful downloads never need to be repeated.
        if eid in state["completed"]:
            if state["completed"][eid].get("status") == "success":
                stats["skipped"] += 1
                continue

        # Retry permanent failures only when explicitly requested.
        if eid in state["failed"]:
            reason = state["failed"][eid].get("reason", "")
            if reason in PERMANENT_SKIP_REASONS and not retry_failed:
                stats["skipped"] += 1
                continue

        to_download.append(entry)

    # Apply the optional per-source-class development limit.
    if max_per_word > 0:
        word_counts: dict[int, int] = {}
        limited = []
        for entry in to_download:
            cid = entry["class_id"]
            count = word_counts.get(cid, 0)
            if count < max_per_word:
                limited.append(entry)
                word_counts[cid] = count + 1
        to_download = limited

    logger.info(
        f"İndirilecek: {len(to_download)} video "
        f"(atlanıyor: {stats['skipped']}, toplam: {stats['total']})"
    )

    if dry_run:
        # Show the class distribution without touching external state.
        class_counts: dict[str, int] = {}
        for e in to_download:
            key = f"{e['class_id']}_{e['ms_class']}"
            class_counts[key] = class_counts.get(key, 0) + 1
        logger.info("\n[DRY RUN] İndirilecek video dağılımı:")
        for key in sorted(class_counts.keys()):
            logger.info(f"  {key}: {class_counts[key]}")
        return stats

    if not to_download:
        logger.info("İndirilecek yeni video yok.")
        return stats

    # Download clips concurrently while updating one shared state file.
    completed_count = 0
    total_count = len(to_download)

    def _process(entry: dict) -> tuple[str, dict]:
        # Stagger workers slightly to reduce request bursts.
        time.sleep(0.5)
        result = download_clip(entry, output_dir, logger)
        return entry["entry_id"], result

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_process, e): e for e in to_download}

        for future in as_completed(futures):
            entry = futures[future]
            try:
                eid, result = future.result()
            except Exception as exc:
                eid = entry["entry_id"]
                result = {"status": "error", "path": "", "reason": str(exc)[:100]}

            status = result["status"]

            if status == "success":
                stats["success"] += 1
                state["completed"][eid] = {
                    "status": "success",
                    "path": result["path"],
                    "class_id": entry["class_id"],
                    "signer_id": entry["signer_id"],
                }
            elif status == "unavailable":
                stats["unavailable"] += 1
                state["failed"][eid] = {"status": status, "reason": "unavailable"}
            elif status == "age_restricted":
                stats["age_restricted"] += 1
                state["failed"][eid] = {"status": status, "reason": "age_restricted"}
            else:
                stats["error"] += 1
                state["failed"][eid] = {
                    "status": "error",
                    "reason": result.get("reason", "unknown"),
                }

            completed_count += 1

            # Persist progress periodically so an interruption is recoverable.
            if completed_count % 10 == 0 or completed_count == total_count:
                save_state(state, state_file)
                pct = completed_count / total_count * 100
                logger.info(
                    f"[{completed_count}/{total_count}] {pct:.0f}%: "
                    f"success={stats['success']} unavailable={stats['unavailable']} "
                    f"age_restricted={stats['age_restricted']} error={stats['error']}"
                )

    # Save the final state even when the last batch was smaller than ten.
    save_state(state, state_file)
    return stats


def print_summary(
    entries: list[dict],
    state: dict,
    logger: logging.Logger,
) -> None:
    """Print download coverage by source class and signer."""
    # Aggregate source-class totals and successful clips.
    class_total: dict[int, int] = {}
    class_success: dict[int, int] = {}

    for entry in entries:
        cid = entry["class_id"]
        class_total[cid] = class_total.get(cid, 0) + 1

        eid = entry["entry_id"]
        if eid in state.get("completed", {}):
            if state["completed"][eid].get("status") == "success":
                class_success[cid] = class_success.get(cid, 0) + 1

    logger.info("\n" + "=" * 60)
    logger.info("KELIME BAZINDA İNDİRME ÖZETİ")
    logger.info("=" * 60)
    logger.info(f"{'Kelime':<15} {'MS-ASL Class':<15} {'Başarılı':>8} {'Toplam':>8} {'Oran':>8}")
    logger.info("-" * 60)

    total_s = 0
    total_t = 0
    low_words = []

    for cid in sorted(class_total.keys()):
        words = CLASS_TO_WORDS[cid]
        word_str = "/".join(words)
        s = class_success.get(cid, 0)
        t = class_total[cid]
        pct = s / t * 100 if t > 0 else 0
        flag = " LOW" if s < 5 else ""
        logger.info(f"  {word_str:<15} (class {cid:<4}) {s:>5} / {t:<5} ({pct:5.1f}%){flag}")
        total_s += s
        total_t += t
        if s < 5:
            low_words.append(word_str)

    logger.info("-" * 60)
    pct = total_s / total_t * 100 if total_t > 0 else 0
    logger.info(f"  {'TOPLAM':<15} {'':15} {total_s:>5} / {total_t:<5} ({pct:5.1f}%)")

    if low_words:
        logger.info(f"\nUYARI: Düşük örnekli kelimeler: {', '.join(low_words)}")

    # Report signer diversity for the exploratory dataset.
    signers = set()
    for info in state.get("completed", {}).values():
        if info.get("status") == "success":
            sid = info.get("signer_id", -1)
            if sid >= 0:
                signers.add(sid)
    logger.info(f"\nBenzersiz signer: {len(signers)}")
    logger.info("Google ASL Signs: 21 signer")
    logger.info(f"MS-ASL eklendikten sonra: 21 + {len(signers)} = {21 + len(signers)}+ signer")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="MS-ASL veri setinden 50 kelime videosu indir",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_VIDEO_DIR,
        help=f"Video çıktı dizini (varsayılan: {DEFAULT_VIDEO_DIR})",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=3,
        help="Paralel indirme thread sayısı (varsayılan: 3)",
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="Daha önce başarısız olanları tekrar dene",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="İndirmeden ne indirileceğini göster",
    )
    parser.add_argument(
        "--max-per-word",
        type=int,
        default=0,
        help="Kelime başına max indirme (test için, 0=sınırsız)",
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        default=DEFAULT_STATE_FILE,
        help="State dosyası yolu",
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        default=DEFAULT_LOG_FILE,
        help="Log dosyası yolu",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logger = setup_logging(args.log_file)

    logger.info("=" * 60)
    logger.info("MS-ASL Video İndirme Başlıyor")
    logger.info("=" * 60)

    # Fail before loading metadata if the external downloader is unavailable.
    if not check_ytdlp():
        logger.error("HATA: yt-dlp kurulu değil! pip install yt-dlp")
        sys.exit(1)

    logger.info("MS-ASL JSON'ları yükleniyor...")
    entries = load_msasl_entries()
    logger.info(f"  Hedef class sayısı: {len(TARGET_CLASS_IDS)}")
    logger.info(f"  Toplam entry: {len(entries)}")

    # Report source signer coverage before downloading.
    signers = {e["signer_id"] for e in entries}
    logger.info(f"  Benzersiz signer: {len(signers)}")

    start_time = time.time()
    download_all(
        entries=entries,
        output_dir=args.output_dir,
        state_file=args.state_file,
        logger=logger,
        max_workers=args.workers,
        retry_failed=args.retry_failed,
        dry_run=args.dry_run,
        max_per_word=args.max_per_word,
    )
    elapsed = time.time() - start_time

    if not args.dry_run:
        logger.info(f"\nİndirme tamamlandı: {elapsed:.0f} saniye ({elapsed / 60:.1f} dakika)")

        # Summarize the state written by the download loop.
        state = load_state(args.state_file)
        print_summary(entries, state, logger)


if __name__ == "__main__":
    main()
