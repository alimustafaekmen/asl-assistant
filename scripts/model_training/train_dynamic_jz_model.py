#!/usr/bin/env python3
"""Collect data and train an optional desktop LSTM for dynamic J/Z gestures.

J and Z are not part of the published 24-class static-letter model and no
trained J/Z artifact is distributed. This experimental command can record
camera sequences and train a compatible desktop checkpoint when users provide
their own data.

Examples (activate any compatible Python environment first):

  # Collect camera sequences.
  python scripts/model_training/train_dynamic_jz_model.py collect

  # Train the sequence model.
  python scripts/model_training/train_dynamic_jz_model.py train

  # Run both steps.
  python scripts/model_training/train_dynamic_jz_model.py all

Options:
  python scripts/model_training/train_dynamic_jz_model.py collect --sequences 40
  python scripts/model_training/train_dynamic_jz_model.py train --epochs 80

Outputs:
  data/raw/dynamic/J/
  data/raw/dynamic/Z/
  models/letter/dynamic_jz/jz_model.pt
  models/letter/dynamic_jz/jz_label_map.json
"""

import argparse
import json
import os
import sys
import time

import cv2
import mediapipe as mp
import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, TensorDataset

# Resolve both local packages; this experimental trainer targets the desktop
# sequence runtime while reusing the shared ML landmark contract.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for source_dir in (
    os.path.join(PROJECT_ROOT, "asl-ml", "src"),
    os.path.join(PROJECT_ROOT, "asl-desktop", "src"),
):
    if source_dir not in sys.path:
        sys.path.insert(0, source_dir)

from asl_desktop.config import (
    CAMERA_HEIGHT,
    CAMERA_INDEX,
    CAMERA_WIDTH,
    DEVICE,
    DYNAMIC_DATA_DIR,
    EARLY_STOPPING_PATIENCE,
    JZ_LABEL_MAP_PATH,
    JZ_MODEL_PATH,
    LSTM_DROPOUT,
    LSTM_HIDDEN_SIZE,
    LSTM_NUM_LAYERS,
    SEQUENCE_LENGTH,
    TRAIN_BATCH_SIZE,
    TRAIN_EPOCHS,
    TRAIN_LR,
)
from asl_ml.config import (
    HAND_LANDMARK_DIM,
    MIN_DETECTION_CONFIDENCE,
    MIN_TRACKING_CONFIDENCE,
    NUM_HANDS,
)
from asl_ml.utils import normalize_landmarks

# Local recording directory; raw sequences remain outside Git.
DYNAMIC_DIR = str(DYNAMIC_DATA_DIR)


# Turkish camera instructions shown by the interactive collector.
SIGN_INSTRUCTIONS = {
    "J": [
        "J HARFI NASIL YAPILIR:",
        "1. Serceyi yukari kaldirin (I pozisyonu)",
        "2. Havada J seklinde bir kavis cizin",
        "3. Hareket asagi dogru biter",
        "",
        "Ipucu: Sakin ve net hareket yapin",
    ],
    "Z": [
        "Z HARFI NASIL YAPILIR:",
        "1. Isaret parmagini uzatin",
        "2. Havada Z seklinde cizin:",
        "   sola → saga asagi capraz → sola",
        "3. Hareket sola dogru biter",
        "",
        "Ipucu: Zigzag yapar gibi dusunun",
    ],
}

# Recording quality thresholds.
MIN_HAND_DETECTION_RATIO = 0.75
COUNTDOWN_SECONDS = 3
PAUSE_AFTER_RECORD = 1.5  # Seconds between recordings.


def _draw_text_block(
    frame, lines, x, y, scale=0.6, color=(255, 255, 255), thickness=1, line_gap=28
):
    """Draw a block of equally spaced text lines on a frame."""
    for i, line in enumerate(lines):
        cv2.putText(
            frame,
            line,
            (x, y + i * line_gap),
            cv2.FONT_HERSHEY_SIMPLEX,
            scale,
            color,
            thickness,
            cv2.LINE_AA,
        )


def _draw_progress_bar(
    frame, progress, y_offset=6, color_start=(255, 180, 0), color_end=(0, 220, 0)
):
    """Draw a color-interpolated progress bar at the bottom of a frame."""
    h, w = frame.shape[:2]
    bar_width = int(w * progress)
    # Interpolate from the start color to the end color.
    r = int(color_start[0] + (color_end[0] - color_start[0]) * progress)
    g = int(color_start[1] + (color_end[1] - color_start[1]) * progress)
    b = int(color_start[2] + (color_end[2] - color_start[2]) * progress)
    cv2.rectangle(frame, (0, h - y_offset), (bar_width, h), (b, g, r), -1)


def collect_dynamic_data(
    signs: list[str] = None,
    sequences_per_sign: int = 30,
    frames_per_sequence: int = SEQUENCE_LENGTH,
):
    """Collect guided J/Z sequences from the configured camera.

    The interactive window shows sign instructions, a countdown, recording
    progress, and a hand-visibility quality check. Users can discard and repeat
    the latest sequence.

    Args:
        signs: Dynamic letters to record; defaults to J and Z.
        sequences_per_sign: Number of accepted recordings per letter.
        frames_per_sequence: Frames per recording.
    """
    signs = signs or ["J", "Z"]

    print("\n" + "=" * 60)
    print("  📹 J/Z Veri Toplama — Rehberli Surum")
    print("=" * 60)
    print(f"\n  Harfler:       {signs}")
    print(f"  Kayit/harf:    {sequences_per_sign}")
    print(f"  Frame/kayit:   {frames_per_sequence}")
    print(f"  Geri sayim:    {COUNTDOWN_SECONDS}s")
    print(f"  Min el orani:  {MIN_HAND_DETECTION_RATIO:.0%}")
    print(f"  Kayit dizini:  {DYNAMIC_DIR}")

    # Reuse one MediaPipe tracker throughout the capture session.
    hands = mp.solutions.hands.Hands(
        static_image_mode=False,
        max_num_hands=NUM_HANDS,
        min_detection_confidence=MIN_DETECTION_CONFIDENCE,
        min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
    )
    mp_draw = mp.solutions.drawing_utils

    # Open the configured camera at the desktop preview resolution.
    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)

    if not cap.isOpened():
        print("❌ Kamera acilamadi!")
        return

    print("\n  Kontroller:")
    print("    SPACE  → Geri sayimi baslat")
    print("    R      → Son kaydi sil ve tekrarla")
    print("    S      → Sonraki harfe gec")
    print("    Q/ESC  → Cik")
    print("\n  Hazir oldugunuzda SPACE'e basin...")

    total_saved = 0
    total_rejected = 0
    win_name = "J/Z Veri Toplama"

    for sign in signs:
        sign_dir = os.path.join(DYNAMIC_DIR, sign.upper())
        os.makedirs(sign_dir, exist_ok=True)

        # Resume after previously accepted recordings.
        existing = len([f for f in os.listdir(sign_dir) if f.endswith(".npy")])
        target = sequences_per_sign + existing
        seq_idx = existing

        instructions = SIGN_INSTRUCTIONS.get(sign, [f"{sign} hareketi yapin"])

        print(f"\n  ─── {sign} harfi ({seq_idx}/{target}) ───")

        # Capture states: idle, countdown, recording, checking, and pause.
        state = "idle"
        frame_buffer = []
        detected_frames = 0
        countdown_start = 0.0
        pause_start = 0.0
        last_quality_msg = ""

        while seq_idx < target:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(rgb)

            hand_visible = results.multi_hand_landmarks is not None

            # Draw the current hand when available.
            if hand_visible:
                for hand_lm in results.multi_hand_landmarks:
                    mp_draw.draw_landmarks(frame, hand_lm, mp.solutions.hands.HAND_CONNECTIONS)

            # Persistent status band.
            cv2.rectangle(frame, (0, 0), (w, 90), (30, 30, 30), -1)
            cv2.putText(
                frame,
                f"'{sign}' harfi   Kayit: {seq_idx}/{target}",
                (15, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

            # Hand-visibility indicator.
            if hand_visible:
                cv2.putText(
                    frame,
                    "El: ALGILANDI",
                    (15, 60),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 220, 0),
                    2,
                    cv2.LINE_AA,
                )
            else:
                cv2.putText(
                    frame,
                    "El: BULUNAMADI — Elinizi gosterin!",
                    (15, 60),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 0, 255),
                    2,
                    cv2.LINE_AA,
                )

            # Idle: wait for the user to start a recording.
            if state == "idle":
                # Show sign instructions beside the camera view.
                _draw_text_block(
                    frame,
                    instructions,
                    w - 400,
                    130,
                    scale=0.55,
                    color=(0, 255, 255),
                    thickness=1,
                    line_gap=26,
                )
                # Emphasize the start action in the center.
                cv2.putText(
                    frame,
                    "SPACE ile baslat",
                    (w // 2 - 170, h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    1.0,
                    (100, 255, 100),
                    2,
                    cv2.LINE_AA,
                )

                if last_quality_msg:
                    cv2.putText(
                        frame,
                        last_quality_msg,
                        (15, h - 30),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (0, 200, 255),
                        2,
                        cv2.LINE_AA,
                    )

            # Countdown: prepare the signer.
            elif state == "countdown":
                elapsed = time.time() - countdown_start
                remaining = COUNTDOWN_SECONDS - elapsed

                if remaining > 0:
                    # Draw the remaining count prominently.
                    num = int(remaining) + 1
                    cv2.putText(
                        frame,
                        str(num),
                        (w // 2 - 40, h // 2 + 30),
                        cv2.FONT_HERSHEY_DUPLEX,
                        4.0,
                        (0, 255, 255),
                        4,
                        cv2.LINE_AA,
                    )
                    cv2.putText(
                        frame,
                        "HAZIRLANIN!",
                        (w // 2 - 130, h // 2 + 80),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1.0,
                        (0, 255, 255),
                        2,
                        cv2.LINE_AA,
                    )

                    # Keep the gesture reminder visible below.
                    _draw_text_block(
                        frame,
                        instructions[:3],
                        15,
                        h - 100,
                        scale=0.5,
                        color=(200, 200, 200),
                        thickness=1,
                        line_gap=22,
                    )
                else:
                    # Start with an empty sequence after the countdown.
                    state = "recording"
                    frame_buffer = []
                    detected_frames = 0
                    last_quality_msg = ""

            # Recording: collect a fixed-length sequence.
            elif state == "recording":
                if hand_visible:
                    lms = []
                    for lm in results.multi_hand_landmarks[0].landmark:
                        lms.extend([lm.x, lm.y, lm.z])
                    kp = normalize_landmarks(np.array(lms, dtype=np.float32))
                    frame_buffer.append(kp)
                    detected_frames += 1

                progress = len(frame_buffer) / frames_per_sequence

                # Make recording state visually explicit.
                cv2.putText(
                    frame,
                    "KAYIT",
                    (w // 2 - 80, h // 2 - 20),
                    cv2.FONT_HERSHEY_DUPLEX,
                    2.0,
                    (0, 0, 255),
                    3,
                    cv2.LINE_AA,
                )

                # Display captured-frame progress.
                cv2.putText(
                    frame,
                    f"{len(frame_buffer)}/{frames_per_sequence} frame",
                    (w // 2 - 90, h // 2 + 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )

                # Blink a red recording indicator.
                if int(time.time() * 3) % 2 == 0:
                    cv2.circle(frame, (w - 40, 45), 12, (0, 0, 255), -1)

                # Mirror progress at the bottom edge.
                _draw_progress_bar(frame, progress)

                # Validate hand coverage after the sequence completes.
                if len(frame_buffer) >= frames_per_sequence:
                    state = "checking"

            # Checking: accept or reject the completed sequence.
            elif state == "checking":
                detection_ratio = (
                    detected_frames / frames_per_sequence if frames_per_sequence > 0 else 0
                )

                if detection_ratio >= MIN_HAND_DETECTION_RATIO:
                    # Persist recordings that pass the visibility gate.
                    seq_array = np.array(frame_buffer[:frames_per_sequence], dtype=np.float32)
                    save_path = os.path.join(sign_dir, f"seq_{seq_idx}.npy")
                    np.save(save_path, seq_array)
                    seq_idx += 1
                    total_saved += 1
                    last_quality_msg = (
                        f"Kayit {seq_idx}/{target} BASARILI (el: {detection_ratio:.0%})"
                    )
                    print(f"    ✓ Kayit {seq_idx}/{target} (el algilama: {detection_ratio:.0%})")
                    state = "pause"
                    pause_start = time.time()
                else:
                    # Reject low-visibility recordings without incrementing count.
                    total_rejected += 1
                    last_quality_msg = f"REDDEDILDI — el {detection_ratio:.0%} algilandi (min {MIN_HAND_DETECTION_RATIO:.0%}). Tekrar deneyin!"
                    print(
                        f"    ✗ Reddedildi (el algilama: {detection_ratio:.0%} < {MIN_HAND_DETECTION_RATIO:.0%})"
                    )
                    state = "idle"

                frame_buffer = []
                detected_frames = 0

            # Pause briefly before the next capture.
            elif state == "pause":
                elapsed = time.time() - pause_start
                remaining = PAUSE_AFTER_RECORD - elapsed

                if remaining > 0:
                    cv2.putText(
                        frame,
                        "BASARILI!",
                        (w // 2 - 120, h // 2),
                        cv2.FONT_HERSHEY_DUPLEX,
                        2.0,
                        (0, 220, 0),
                        3,
                        cv2.LINE_AA,
                    )
                    cv2.putText(
                        frame,
                        f"Sonraki kayit: {remaining:.1f}s",
                        (w // 2 - 130, h // 2 + 50),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.8,
                        (200, 200, 200),
                        2,
                        cv2.LINE_AA,
                    )
                else:
                    state = "countdown"
                    countdown_start = time.time()

            # Draw keyboard controls before presenting the frame.
            cv2.putText(
                frame,
                "SPACE:Baslat  R:Tekrarla  S:Atla  Q:Cik",
                (15, h - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (150, 150, 150),
                1,
                cv2.LINE_AA,
            )

            cv2.imshow(win_name, frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord(" ") and state == "idle":
                if hand_visible:
                    state = "countdown"
                    countdown_start = time.time()
                    last_quality_msg = ""
                else:
                    last_quality_msg = "Once elinizi kameraya gosterin!"

            elif key == ord("r"):
                # Delete the latest accepted recording and repeat it.
                if seq_idx > existing:
                    last_path = os.path.join(sign_dir, f"seq_{seq_idx - 1}.npy")
                    if os.path.exists(last_path):
                        os.remove(last_path)
                        seq_idx -= 1
                        total_saved -= 1
                        last_quality_msg = f"Son kayit silindi. Tekrar: {seq_idx}/{target}"
                        print(f"    ↺ Kayit {seq_idx + 1} silindi, tekrar")
                state = "idle"
                frame_buffer = []

            elif key == ord("s"):
                print(f"    → {sign} atlandi")
                break

            elif key in (ord("q"), 27):
                cap.release()
                cv2.destroyAllWindows()
                hands.close()
                print(f"\n  Cikildi. Kaydedilen: {total_saved}, Reddedilen: {total_rejected}")
                return

        cv2.destroyAllWindows()

    cap.release()
    cv2.destroyAllWindows()
    hands.close()

    print("\n  ═══════════════════════════════════════")
    print("  ✅ Veri toplama tamamlandi!")
    print(f"  Kaydedilen:  {total_saved}")
    print(f"  Reddedilen:  {total_rejected}")
    print(f"  Kayit dizini: {DYNAMIC_DIR}")
    print("  ═══════════════════════════════════════")
    print("\n  Sonraki adim: python scripts/model_training/train_dynamic_jz_model.py train")


from asl_desktop.models.sequence_classifier import SignLanguageLSTM


def load_jz_data():
    """Load locally recorded J/Z NumPy sequences.

    Returns:
        Sequence array, numeric labels, and the J/Z label map.
    """
    label_map = {"J": 0, "Z": 1}
    X_list = []
    y_list = []

    for sign, idx in label_map.items():
        sign_dir = os.path.join(DYNAMIC_DIR, sign)
        if not os.path.isdir(sign_dir):
            print(f"  ⚠ {sign_dir} bulunamadı")
            continue

        npy_files = sorted([f for f in os.listdir(sign_dir) if f.endswith(".npy")])

        for f in npy_files:
            seq = np.load(os.path.join(sign_dir, f))

            # The desktop sequence contract expects ``(30, 63)``.
            if seq.shape == (SEQUENCE_LENGTH, HAND_LANDMARK_DIM):
                X_list.append(seq)
                y_list.append(idx)
            elif seq.shape[1] == HAND_LANDMARK_DIM:
                # Crop or zero-pad compatible recordings to the target length.
                if len(seq) >= SEQUENCE_LENGTH:
                    X_list.append(seq[:SEQUENCE_LENGTH])
                else:
                    padded = np.zeros((SEQUENCE_LENGTH, HAND_LANDMARK_DIM), dtype=np.float32)
                    padded[: len(seq)] = seq
                    X_list.append(padded)
                y_list.append(idx)
            else:
                print(f"  ⚠ Beklenmeyen boyut: {f} → {seq.shape}")

        print(f"  [{sign}] {sum(1 for label in y_list if label == idx)} sekans yüklendi")

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int64)

    return X, y, label_map


def train_jz_model(
    epochs: int = TRAIN_EPOCHS,
    batch_size: int = TRAIN_BATCH_SIZE,
    lr: float = TRAIN_LR,
    patience: int = EARLY_STOPPING_PATIENCE,
):
    """Train and evaluate the optional J/Z desktop LSTM."""

    print("\n" + "=" * 60)
    print("  🧠 J/Z LSTM Modeli Eğitimi")
    print("=" * 60)

    # Load user-recorded local data.
    X, y, label_map = load_jz_data()

    if len(X) < 10:
        print(f"\n❌ HATA: Yeterli veri yok! ({len(X)} sekans)")
        print(
            "  Önce veri toplayın: python scripts/model_training/train_dynamic_jz_model.py collect"
        )
        return

    print(f"\n  Toplam: {len(X)} sekans")
    print(f"  Cihaz: {DEVICE}")

    # Preserve class ratios across train, validation, and test splits.
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.3, random_state=42, stratify=y
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.5, random_state=42, stratify=y_temp
    )

    print(f"  Train: {len(y_train)}, Val: {len(y_val)}, Test: {len(y_test)}")

    # Build deterministic tensor loaders.
    train_dl = DataLoader(
        TensorDataset(torch.tensor(X_train), torch.tensor(y_train)),
        batch_size=batch_size,
        shuffle=True,
    )
    val_dl = DataLoader(
        TensorDataset(torch.tensor(X_val), torch.tensor(y_val)),
        batch_size=batch_size,
        shuffle=False,
    )

    # Keep this architecture identical to desktop inference.
    num_classes = len(label_map)
    model = SignLanguageLSTM(
        input_size=HAND_LANDMARK_DIM,
        hidden_size=LSTM_HIDDEN_SIZE,
        num_layers=LSTM_NUM_LAYERS,
        num_classes=num_classes,
        dropout=LSTM_DROPOUT,
    ).to(DEVICE)

    params = sum(p.numel() for p in model.parameters())
    print(f"  Model parametreleri: {params:,}")

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5, factor=0.5)

    # Optimize with validation-based early stopping.
    best_val_loss = float("inf")
    best_state = None
    no_improve = 0

    print(f"\n  {'Epoch':>6} {'T.Loss':>8} {'T.Acc':>7} {'V.Loss':>8} {'V.Acc':>7}")
    print("  " + "-" * 42)

    for epoch in range(1, epochs + 1):
        # Training pass.
        model.train()
        t_loss, t_ok, t_n = 0, 0, 0
        for xb, yb in train_dl:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            optimizer.zero_grad()
            out = model(xb)
            loss = criterion(out, yb)
            loss.backward()
            optimizer.step()
            t_loss += loss.item() * len(yb)
            t_ok += (out.argmax(1) == yb).sum().item()
            t_n += len(yb)

        # Validation pass.
        model.eval()
        v_loss, v_ok, v_n = 0, 0, 0
        with torch.no_grad():
            for xb, yb in val_dl:
                xb, yb = xb.to(DEVICE), yb.to(DEVICE)
                out = model(xb)
                v_loss += criterion(out, yb).item() * len(yb)
                v_ok += (out.argmax(1) == yb).sum().item()
                v_n += len(yb)

        tl, ta = t_loss / t_n, t_ok / t_n
        vl, va = v_loss / v_n, v_ok / v_n
        scheduler.step(vl)

        print(f"  {epoch:>6} {tl:>8.4f} {ta:>6.1%} {vl:>8.4f} {va:>6.1%}")

        if vl < best_val_loss:
            best_val_loss = vl
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1
            if no_improve >= patience:
                print(f"\n  Early stopping (epoch {epoch})")
                break

    # Restore the best validation checkpoint before testing.
    if best_state:
        model.load_state_dict(best_state)

    # Report held-out accuracy.
    model.eval()
    test_dl = DataLoader(
        TensorDataset(torch.tensor(X_test), torch.tensor(y_test)),
        batch_size=batch_size,
        shuffle=False,
    )
    correct = 0
    total = 0
    with torch.no_grad():
        for xb, yb in test_dl:
            xb = xb.to(DEVICE)
            out = model(xb)
            correct += (out.argmax(1).cpu() == yb).sum().item()
            total += len(yb)

    test_acc = correct / total if total > 0 else 0

    # Persist the checkpoint and label map for the desktop app.
    os.makedirs(os.path.dirname(JZ_MODEL_PATH), exist_ok=True)
    torch.save(model.state_dict(), JZ_MODEL_PATH)
    with open(JZ_LABEL_MAP_PATH, "w") as f:
        json.dump(label_map, f, indent=2)

    print(f"\n{'=' * 60}")
    print("  ✅ J/Z Modeli Tamamlandı!")
    print(f"  Test doğruluk: {test_acc:.1%}")
    print(f"  Model: {JZ_MODEL_PATH}")
    print(f"{'=' * 60}")
    print("\n  Not: Final 50 kelime modeli notebooks/word_50_training.ipynb kaydından üretilir.")


def main():
    parser = argparse.ArgumentParser(
        description="J/Z Dinamik Harf — Veri Toplama + LSTM Eğitimi",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "action",
        choices=["collect", "train", "all"],
        help="collect: veri topla, train: model eğit, all: ikisini de yap",
    )
    parser.add_argument(
        "--sequences", type=int, default=30, help="Harf başına sekans sayısı (varsayılan: 30)"
    )
    parser.add_argument("--epochs", type=int, default=TRAIN_EPOCHS, help="Eğitim epoch sayısı")
    parser.add_argument("--lr", type=float, default=TRAIN_LR)
    args = parser.parse_args()

    if args.action in ("collect", "all"):
        collect_dynamic_data(sequences_per_sign=args.sequences)

    if args.action in ("train", "all"):
        train_jz_model(epochs=args.epochs, lr=args.lr)


if __name__ == "__main__":
    main()
