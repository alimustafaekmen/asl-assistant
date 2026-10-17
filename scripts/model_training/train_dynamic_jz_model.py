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
import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, TensorDataset

# Both local packages are put on the path, so the trainer runs without an
# editable install: the model comes from asl-desktop, the landmark step from
# asl-features.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for source_dir in (
    os.path.join(PROJECT_ROOT, "asl-features", "src"),
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
from asl_desktop.detection.hand_detector import HandDetector
from asl_features.config import (
    HAND_LANDMARK_DIM,
)

# Local recording directory; raw sequences remain outside Git.
DYNAMIC_DIR = str(DYNAMIC_DATA_DIR)


# Camera instructions shown by the interactive collector.
SIGN_INSTRUCTIONS = {
    "J": [
        "HOW TO SIGN J:",
        "1. Raise the little finger (I handshape)",
        "2. Draw a J-shaped curve in the air",
        "3. The movement ends downward",
        "",
        "Tip: move calmly and clearly",
    ],
    "Z": [
        "HOW TO SIGN Z:",
        "1. Extend the index finger",
        "2. Draw a Z in the air:",
        "   left -> diagonal down to the right -> left",
        "3. The movement ends toward the left",
        "",
        "Tip: think of it as a zigzag",
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
    r = int(color_start[0] + (color_end[0] - color_start[0]) * progress)
    g = int(color_start[1] + (color_end[1] - color_start[1]) * progress)
    b = int(color_start[2] + (color_end[2] - color_start[2]) * progress)
    cv2.rectangle(frame, (0, h - y_offset), (bar_width, h), (b, g, r), -1)


def capture_frame(
    detector: HandDetector, frame: np.ndarray
) -> tuple[np.ndarray | None, np.ndarray]:
    """Detect on one camera frame as captured and return ``(keypoints, preview)``.

    The keypoints are the ones the desktop app feeds its J/Z model: the same
    HandDetector, on the unmirrored frame, so the recorded hand shape is the
    one the model is shown live. Only the preview is mirrored, with the
    landmarks drawn where the hand appears in it.
    """
    keypoints = detector.detect(frame)
    preview = cv2.flip(frame, 1)
    if keypoints is not None:
        detector.draw_landmarks(preview)
    return keypoints, preview


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
    print("  J/Z data collection: guided version")
    print("=" * 60)
    print(f"\n  Letters:       {signs}")
    print(f"  Takes/letter:  {sequences_per_sign}")
    print(f"  Frames/take:   {frames_per_sequence}")
    print(f"  Countdown:     {COUNTDOWN_SECONDS}s")
    print(f"  Min hand ratio: {MIN_HAND_DETECTION_RATIO:.0%}")
    print(f"  Output folder: {DYNAMIC_DIR}")

    detector = HandDetector()

    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)

    if not cap.isOpened():
        print("ERROR: Could not open the camera.")
        return

    print("\n  Controls:")
    print("    SPACE  - start the countdown")
    print("    R      - delete the last take and repeat it")
    print("    S      - skip to the next letter")
    print("    Q/ESC  - quit")
    print("\n  Press SPACE when you are ready...")

    total_saved = 0
    total_rejected = 0
    win_name = "J/Z data collection"

    for sign in signs:
        sign_dir = os.path.join(DYNAMIC_DIR, sign.upper())
        os.makedirs(sign_dir, exist_ok=True)

        # Resume after previously accepted recordings.
        existing = len([f for f in os.listdir(sign_dir) if f.endswith(".npy")])
        target = sequences_per_sign + existing
        seq_idx = existing

        instructions = SIGN_INSTRUCTIONS.get(sign, [f"Sign {sign}"])

        print(f"\n  Letter {sign} ({seq_idx}/{target})")

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

            keypoints, frame = capture_frame(detector, frame)
            h, w = frame.shape[:2]
            hand_visible = keypoints is not None

            cv2.rectangle(frame, (0, 0), (w, 90), (30, 30, 30), -1)
            cv2.putText(
                frame,
                f"Letter '{sign}'   Take: {seq_idx}/{target}",
                (15, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

            if hand_visible:
                cv2.putText(
                    frame,
                    "Hand: DETECTED",
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
                    "No hand found. Show your hand.",
                    (15, 60),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 0, 255),
                    2,
                    cv2.LINE_AA,
                )

            # Idle: wait for the user to start a recording.
            if state == "idle":
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
                cv2.putText(
                    frame,
                    "Press SPACE to start",
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
                        "GET READY!",
                        (w // 2 - 130, h // 2 + 80),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1.0,
                        (0, 255, 255),
                        2,
                        cv2.LINE_AA,
                    )

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
                    state = "recording"
                    frame_buffer = []
                    detected_frames = 0
                    last_quality_msg = ""

            # Recording: collect a fixed-length sequence.
            elif state == "recording":
                if hand_visible:
                    frame_buffer.append(keypoints)
                    detected_frames += 1

                progress = len(frame_buffer) / frames_per_sequence

                cv2.putText(
                    frame,
                    "RECORDING",
                    (w // 2 - 80, h // 2 - 20),
                    cv2.FONT_HERSHEY_DUPLEX,
                    2.0,
                    (0, 0, 255),
                    3,
                    cv2.LINE_AA,
                )

                cv2.putText(
                    frame,
                    f"{len(frame_buffer)}/{frames_per_sequence} frames",
                    (w // 2 - 90, h // 2 + 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )

                # A blinking red dot marks the recording.
                if int(time.time() * 3) % 2 == 0:
                    cv2.circle(frame, (w - 40, 45), 12, (0, 0, 255), -1)

                _draw_progress_bar(frame, progress)

                if len(frame_buffer) >= frames_per_sequence:
                    state = "checking"

            # Checking: accept or reject the completed sequence.
            elif state == "checking":
                detection_ratio = (
                    detected_frames / frames_per_sequence if frames_per_sequence > 0 else 0
                )

                if detection_ratio >= MIN_HAND_DETECTION_RATIO:
                    seq_array = np.array(frame_buffer[:frames_per_sequence], dtype=np.float32)
                    save_path = os.path.join(sign_dir, f"seq_{seq_idx}.npy")
                    np.save(save_path, seq_array)
                    seq_idx += 1
                    total_saved += 1
                    last_quality_msg = (
                        f"Take {seq_idx}/{target} ACCEPTED (hand: {detection_ratio:.0%})"
                    )
                    print(
                        f"    Take {seq_idx}/{target} accepted (hand detection: {detection_ratio:.0%})"
                    )
                    state = "pause"
                    pause_start = time.time()
                else:
                    # Reject low-visibility recordings without incrementing count.
                    total_rejected += 1
                    last_quality_msg = f"Rejected: hand seen in {detection_ratio:.0%} of frames (min {MIN_HAND_DETECTION_RATIO:.0%}). Try again."
                    print(
                        f"    Rejected (hand detection: {detection_ratio:.0%} < {MIN_HAND_DETECTION_RATIO:.0%})"
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
                        "ACCEPTED!",
                        (w // 2 - 120, h // 2),
                        cv2.FONT_HERSHEY_DUPLEX,
                        2.0,
                        (0, 220, 0),
                        3,
                        cv2.LINE_AA,
                    )
                    cv2.putText(
                        frame,
                        f"Next take: {remaining:.1f}s",
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

            cv2.putText(
                frame,
                "SPACE:Start  R:Redo  S:Skip  Q:Quit",
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
                    last_quality_msg = "Show your hand to the camera first."

            elif key == ord("r"):
                # Delete the latest accepted recording and repeat it.
                if seq_idx > existing:
                    last_path = os.path.join(sign_dir, f"seq_{seq_idx - 1}.npy")
                    if os.path.exists(last_path):
                        os.remove(last_path)
                        seq_idx -= 1
                        total_saved -= 1
                        last_quality_msg = f"Last take deleted. Redo: {seq_idx}/{target}"
                        print(f"    Take {seq_idx + 1} deleted, redoing it")
                state = "idle"
                frame_buffer = []

            elif key == ord("s"):
                print(f"    Skipped {sign}")
                break

            elif key in (ord("q"), 27):
                cap.release()
                cv2.destroyAllWindows()
                detector.close()
                print(f"\n  Quit. Saved: {total_saved}, rejected: {total_rejected}")
                return

        cv2.destroyAllWindows()

    cap.release()
    cv2.destroyAllWindows()
    detector.close()

    print("\n  " + "=" * 39)
    print("  Data collection finished.")
    print(f"  Saved:       {total_saved}")
    print(f"  Rejected:    {total_rejected}")
    print(f"  Output folder: {DYNAMIC_DIR}")
    print("  " + "=" * 39)
    print("\n  Next step: python scripts/model_training/train_dynamic_jz_model.py train")


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
            print(f"  WARNING: {sign_dir} not found")
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
                print(f"  WARNING: Unexpected shape: {f} -> {seq.shape}")

        print(f"  [{sign}] {sum(1 for label in y_list if label == idx)} sequences loaded")

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
    print("  J/Z LSTM model training")
    print("=" * 60)

    X, y, label_map = load_jz_data()

    if len(X) < 10:
        print(f"\nERROR: Not enough data ({len(X)} sequences).")
        print(
            "  Collect data first: python scripts/model_training/train_dynamic_jz_model.py collect"
        )
        return

    print(f"\n  Total: {len(X)} sequences")
    print(f"  Device: {DEVICE}")

    # Preserve class ratios across train, validation, and test splits.
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.3, random_state=42, stratify=y
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.5, random_state=42, stratify=y_temp
    )

    print(f"  Train: {len(y_train)}, Val: {len(y_val)}, Test: {len(y_test)}")

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
    print(f"  Model parameters: {params:,}")

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
    print("  J/Z model finished.")
    print(f"  Test accuracy: {test_acc:.1%}")
    print(f"  Model: {JZ_MODEL_PATH}")
    print(f"{'=' * 60}")
    print("\n  Note: the final 50-word model is produced by notebooks/word_50_training.ipynb.")


def build_parser() -> argparse.ArgumentParser:
    """The command line, separate from main() so other scripts can check commands against it."""
    parser = argparse.ArgumentParser(
        description="Dynamic letters J and Z: data collection and LSTM training",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "action",
        choices=["collect", "train", "all"],
        help="collect: record data, train: train the model, all: do both",
    )
    parser.add_argument(
        "--sequences", type=int, default=30, help="Sequences to record per letter (default: 30)"
    )
    parser.add_argument(
        "--epochs", type=int, default=TRAIN_EPOCHS, help="Number of training epochs"
    )
    parser.add_argument("--lr", type=float, default=TRAIN_LR)
    return parser


def main():
    args = build_parser().parse_args()

    if args.action in ("collect", "all"):
        collect_dynamic_data(sequences_per_sign=args.sequences)

    if args.action in ("train", "all"):
        train_jz_model(epochs=args.epochs, lr=args.lr)


if __name__ == "__main__":
    main()
