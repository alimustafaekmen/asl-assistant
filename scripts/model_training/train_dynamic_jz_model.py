#!/usr/bin/env python3
"""
============================================================
  J ve Z Harfleri — Veri Toplama + LSTM Eğitimi
============================================================

J ve Z harfleri dinamik hareketlerdir (statik poz değil).
Bu script iki aşamayı birleştirir:
  1. Kameradan J/Z hareketlerini kaydet
  2. Kaydedilen verilerle LSTM modeli eğit

Kullanım:
  conda activate isaret_dili

  # Adım 1: Veri topla (kamera gerekli)
  python scripts/model_training/train_dynamic_jz_model.py collect

  # Adım 2: Model eğit
  python scripts/model_training/train_dynamic_jz_model.py train

  # İkisini ard arda yap
  python scripts/model_training/train_dynamic_jz_model.py all

Seçenekler:
  python scripts/model_training/train_dynamic_jz_model.py collect --sequences 40
  python scripts/model_training/train_dynamic_jz_model.py train --epochs 80

Çıktılar:
  data/raw/dynamic/J/     — J harfi .npy dosyaları
  data/raw/dynamic/Z/     — Z harfi .npy dosyaları
  models/letter/dynamic_jz/jz_model.pt      — Eğitilmiş LSTM modeli
  models/letter/dynamic_jz/jz_label_map.json
============================================================
"""

import os
import sys
import json
import time
import argparse
import numpy as np
import cv2
import mediapipe as mp
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.model_selection import train_test_split

# ── Proje kökünü path'e ekle ──
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

from config.settings import (
    NUM_LANDMARKS, NUM_FEATURES, SEQUENCE_LENGTH,
    CAMERA_INDEX, CAMERA_WIDTH, CAMERA_HEIGHT,
    NUM_HANDS, MIN_DETECTION_CONFIDENCE, MIN_TRACKING_CONFIDENCE,
    LSTM_HIDDEN_SIZE, LSTM_NUM_LAYERS, LSTM_DROPOUT,
    JZ_MODEL_PATH, JZ_LABEL_MAP_PATH,
    DEVICE, TRAIN_EPOCHS, TRAIN_BATCH_SIZE, TRAIN_LR,
    EARLY_STOPPING_PATIENCE, DYNAMIC_DATA_DIR,
)
from asl_ml.utils import normalize_landmarks

# ── J/Z verilerinin kaydedilecegi yer ──
DYNAMIC_DIR = DYNAMIC_DATA_DIR


# ═══════════════════════════════════════════════════════
#  ADIM 1: Veri Toplama (Kameradan) — Rehberli Surum
# ═══════════════════════════════════════════════════════

# J ve Z harf aciklamalari (ekranda gosterilecek)
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

# Kalite esikleri
MIN_HAND_DETECTION_RATIO = 0.75   # en az %75 frame'de el gorulmeli
COUNTDOWN_SECONDS = 3              # kayit oncesi geri sayim
PAUSE_AFTER_RECORD = 1.5           # kayitlar arasi mola (saniye)


def _draw_text_block(frame, lines, x, y, scale=0.6, color=(255, 255, 255), thickness=1, line_gap=28):
    """Birden fazla satir metni frame uzerine yazar."""
    for i, line in enumerate(lines):
        cv2.putText(frame, line, (x, y + i * line_gap),
                    cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def _draw_progress_bar(frame, progress, y_offset=6, color_start=(255, 180, 0), color_end=(0, 220, 0)):
    """Frame'in altina renkli progress bar cizer."""
    h, w = frame.shape[:2]
    bar_width = int(w * progress)
    # Renk gradyan: baslangic → bitis
    r = int(color_start[0] + (color_end[0] - color_start[0]) * progress)
    g = int(color_start[1] + (color_end[1] - color_start[1]) * progress)
    b = int(color_start[2] + (color_end[2] - color_start[2]) * progress)
    cv2.rectangle(frame, (0, h - y_offset), (bar_width, h), (b, g, r), -1)


def collect_dynamic_data(
    signs: list[str] = None,
    sequences_per_sign: int = 30,
    frames_per_sequence: int = SEQUENCE_LENGTH,
):
    """
    Rehberli J/Z veri toplama — ekran uzerinde yonlendirmeli.

    Ozellikler:
      - Hareket nasil yapilir talimatları ekranda gosterilir
      - Her kayit oncesi 3-2-1 geri sayim
      - Kalite kontrolu: el %75'ten az gorunduyse kayit reddedilir
      - Kayitlar arasi otomatik 1.5s mola
      - R tusu ile son kaydi tekrarlama
      - Gorsel progress bar ve durum gostergesi

    Args:
        signs:                Kaydedilecek harfler (varsayilan: ["J", "Z"])
        sequences_per_sign:   Her harf icin kac defa kayit yapilacak
        frames_per_sequence:  Her kaydin karesayisi (30 ≈ 1 saniye)
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

    # MediaPipe hazirla
    hands = mp.solutions.hands.Hands(
        static_image_mode=False,
        max_num_hands=NUM_HANDS,
        min_detection_confidence=MIN_DETECTION_CONFIDENCE,
        min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
    )
    mp_draw = mp.solutions.drawing_utils

    # Kamerayi ac
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

        # Mevcut kayitlari say
        existing = len([f for f in os.listdir(sign_dir) if f.endswith(".npy")])
        target = sequences_per_sign + existing
        seq_idx = existing

        instructions = SIGN_INSTRUCTIONS.get(sign, [f"{sign} hareketi yapin"])

        print(f"\n  ─── {sign} harfi ({seq_idx}/{target}) ───")

        # Durumlar: "idle", "countdown", "recording", "checking", "pause"
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

            # El varsa ciz
            if hand_visible:
                for hand_lm in results.multi_hand_landmarks:
                    mp_draw.draw_landmarks(frame, hand_lm, mp.solutions.hands.HAND_CONNECTIONS)

            # ── Ust bilgi cubugu (siyah bant) ──
            cv2.rectangle(frame, (0, 0), (w, 90), (30, 30, 30), -1)
            cv2.putText(frame, f"'{sign}' harfi   Kayit: {seq_idx}/{target}",
                        (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)

            # El durumu gostergesi
            if hand_visible:
                cv2.putText(frame, "El: ALGILANDI", (15, 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 220, 0), 2, cv2.LINE_AA)
            else:
                cv2.putText(frame, "El: BULUNAMADI — Elinizi gosterin!", (15, 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2, cv2.LINE_AA)

            # ── IDLE: Bekleme durumu ──
            if state == "idle":
                # Sag tarafta talimatlar
                _draw_text_block(frame, instructions, w - 400, 130,
                                 scale=0.55, color=(0, 255, 255), thickness=1, line_gap=26)
                # Ortada buyuk yazi
                cv2.putText(frame, "SPACE ile baslat", (w // 2 - 170, h // 2),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.0, (100, 255, 100), 2, cv2.LINE_AA)

                if last_quality_msg:
                    cv2.putText(frame, last_quality_msg, (15, h - 30),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2, cv2.LINE_AA)

            # ── COUNTDOWN: Geri sayim ──
            elif state == "countdown":
                elapsed = time.time() - countdown_start
                remaining = COUNTDOWN_SECONDS - elapsed

                if remaining > 0:
                    # Buyuk geri sayim rakami
                    num = int(remaining) + 1
                    cv2.putText(frame, str(num), (w // 2 - 40, h // 2 + 30),
                                cv2.FONT_HERSHEY_DUPLEX, 4.0, (0, 255, 255), 4, cv2.LINE_AA)
                    cv2.putText(frame, "HAZIRLANIN!", (w // 2 - 130, h // 2 + 80),
                                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2, cv2.LINE_AA)

                    # Talimatlar (altta kucuk)
                    _draw_text_block(frame, instructions[:3], 15, h - 100,
                                     scale=0.5, color=(200, 200, 200), thickness=1, line_gap=22)
                else:
                    # Geri sayim bitti → kayda basla
                    state = "recording"
                    frame_buffer = []
                    detected_frames = 0
                    last_quality_msg = ""

            # ── RECORDING: Kayit ──
            elif state == "recording":
                if hand_visible:
                    lms = []
                    for lm in results.multi_hand_landmarks[0].landmark:
                        lms.extend([lm.x, lm.y, lm.z])
                    kp = normalize_landmarks(np.array(lms, dtype=np.float32))
                    frame_buffer.append(kp)
                    detected_frames += 1

                total_frames = detected_frames + (frames_per_sequence - len(frame_buffer) if len(frame_buffer) < frames_per_sequence else 0)
                progress = len(frame_buffer) / frames_per_sequence

                # Buyuk KAYIT yazisi
                cv2.putText(frame, "KAYIT", (w // 2 - 80, h // 2 - 20),
                            cv2.FONT_HERSHEY_DUPLEX, 2.0, (0, 0, 255), 3, cv2.LINE_AA)

                # Frame sayaci
                cv2.putText(frame, f"{len(frame_buffer)}/{frames_per_sequence} frame",
                            (w // 2 - 90, h // 2 + 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)

                # Yanip sonen kirmizi kayit noktasi
                if int(time.time() * 3) % 2 == 0:
                    cv2.circle(frame, (w - 40, 45), 12, (0, 0, 255), -1)

                # Progress bar
                _draw_progress_bar(frame, progress)

                # Kayit tamamlandi → kalite kontrol
                if len(frame_buffer) >= frames_per_sequence:
                    state = "checking"

            # ── CHECKING: Kalite kontrol ──
            elif state == "checking":
                detection_ratio = detected_frames / frames_per_sequence if frames_per_sequence > 0 else 0

                if detection_ratio >= MIN_HAND_DETECTION_RATIO:
                    # Kaliteli kayit — kaydet
                    seq_array = np.array(frame_buffer[:frames_per_sequence], dtype=np.float32)
                    save_path = os.path.join(sign_dir, f"seq_{seq_idx}.npy")
                    np.save(save_path, seq_array)
                    seq_idx += 1
                    total_saved += 1
                    last_quality_msg = f"Kayit {seq_idx}/{target} BASARILI (el: {detection_ratio:.0%})"
                    print(f"    ✓ Kayit {seq_idx}/{target} (el algilama: {detection_ratio:.0%})")
                    state = "pause"
                    pause_start = time.time()
                else:
                    # Dusuk kalite — reddet
                    total_rejected += 1
                    last_quality_msg = f"REDDEDILDI — el {detection_ratio:.0%} algilandi (min {MIN_HAND_DETECTION_RATIO:.0%}). Tekrar deneyin!"
                    print(f"    ✗ Reddedildi (el algilama: {detection_ratio:.0%} < {MIN_HAND_DETECTION_RATIO:.0%})")
                    state = "idle"

                frame_buffer = []
                detected_frames = 0

            # ── PAUSE: Kayitlar arasi mola ──
            elif state == "pause":
                elapsed = time.time() - pause_start
                remaining = PAUSE_AFTER_RECORD - elapsed

                if remaining > 0:
                    cv2.putText(frame, "BASARILI!", (w // 2 - 120, h // 2),
                                cv2.FONT_HERSHEY_DUPLEX, 2.0, (0, 220, 0), 3, cv2.LINE_AA)
                    cv2.putText(frame, f"Sonraki kayit: {remaining:.1f}s",
                                (w // 2 - 130, h // 2 + 50),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2, cv2.LINE_AA)
                else:
                    state = "countdown"
                    countdown_start = time.time()

            # ── Ekrani goster ──
            # Kontrol tuslari (alt sol)
            cv2.putText(frame, "SPACE:Baslat  R:Tekrarla  S:Atla  Q:Cik",
                        (15, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (150, 150, 150), 1, cv2.LINE_AA)

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
                # Son kaydi sil ve tekrarla
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

    print(f"\n  ═══════════════════════════════════════")
    print(f"  ✅ Veri toplama tamamlandi!")
    print(f"  Kaydedilen:  {total_saved}")
    print(f"  Reddedilen:  {total_rejected}")
    print(f"  Kayit dizini: {DYNAMIC_DIR}")
    print(f"  ═══════════════════════════════════════")
    print(f"\n  Sonraki adim: python scripts/model_training/train_dynamic_jz_model.py train")


# ═══════════════════════════════════════════════════════
#  ADIM 2: LSTM Modeli (asl_desktop.models.sequence_classifier ile ayni mimari)
# ═══════════════════════════════════════════════════════

from asl_desktop.models.sequence_classifier import SignLanguageLSTM


def load_jz_data():
    """
    data/raw/dynamic/J/ ve Z/ klasörlerinden .npy dosyalarını yükler.
    
    Returns:
        X: (N, 30, 63) numpy dizisi
        y: (N,) etiketler
        label_map: {"J": 0, "Z": 1}
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
            
            # Boyut kontrolü: (30, 63) olmalı
            if seq.shape == (SEQUENCE_LENGTH, NUM_FEATURES):
                X_list.append(seq)
                y_list.append(idx)
            elif seq.shape[1] == NUM_FEATURES:
                # Farklı uzunluk → kırp veya doldur
                if len(seq) >= SEQUENCE_LENGTH:
                    X_list.append(seq[:SEQUENCE_LENGTH])
                else:
                    padded = np.zeros((SEQUENCE_LENGTH, NUM_FEATURES), dtype=np.float32)
                    padded[:len(seq)] = seq
                    X_list.append(padded)
                y_list.append(idx)
            else:
                print(f"  ⚠ Beklenmeyen boyut: {f} → {seq.shape}")
        
        print(f"  [{sign}] {sum(1 for l in y_list if l == idx)} sekans yüklendi")
    
    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int64)
    
    return X, y, label_map


def train_jz_model(
    epochs: int = TRAIN_EPOCHS,
    batch_size: int = TRAIN_BATCH_SIZE,
    lr: float = TRAIN_LR,
    patience: int = EARLY_STOPPING_PATIENCE,
):
    """J/Z LSTM modeli eğitir."""
    
    print("\n" + "="*60)
    print("  🧠 J/Z LSTM Modeli Eğitimi")
    print("="*60)
    
    # Veri yükle
    X, y, label_map = load_jz_data()
    
    if len(X) < 10:
        print(f"\n❌ HATA: Yeterli veri yok! ({len(X)} sekans)")
        print("  Önce veri toplayın: python scripts/model_training/train_dynamic_jz_model.py collect")
        return
    
    print(f"\n  Toplam: {len(X)} sekans")
    print(f"  Cihaz: {DEVICE}")
    
    # Train/Val/Test bölme
    X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.3, random_state=42, stratify=y)
    X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.5, random_state=42, stratify=y_temp)
    
    print(f"  Train: {len(y_train)}, Val: {len(y_val)}, Test: {len(y_test)}")
    
    # DataLoader
    train_dl = DataLoader(
        TensorDataset(torch.tensor(X_train), torch.tensor(y_train)),
        batch_size=batch_size, shuffle=True,
    )
    val_dl = DataLoader(
        TensorDataset(torch.tensor(X_val), torch.tensor(y_val)),
        batch_size=batch_size, shuffle=False,
    )
    
    # Model
    num_classes = len(label_map)
    model = SignLanguageLSTM(
        input_size=NUM_FEATURES,
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
    
    # ── Eğitim döngüsü ──
    best_val_loss = float("inf")
    best_state = None
    no_improve = 0
    
    print(f"\n  {'Epoch':>6} {'T.Loss':>8} {'T.Acc':>7} {'V.Loss':>8} {'V.Acc':>7}")
    print("  " + "-"*42)
    
    for epoch in range(1, epochs + 1):
        # Train
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
        
        # Val
        model.eval()
        v_loss, v_ok, v_n = 0, 0, 0
        with torch.no_grad():
            for xb, yb in val_dl:
                xb, yb = xb.to(DEVICE), yb.to(DEVICE)
                out = model(xb)
                v_loss += criterion(out, yb).item() * len(yb)
                v_ok += (out.argmax(1) == yb).sum().item()
                v_n += len(yb)
        
        tl, ta = t_loss/t_n, t_ok/t_n
        vl, va = v_loss/v_n, v_ok/v_n
        scheduler.step(vl)
        
        print(f"  {epoch:>6} {tl:>8.4f} {ta:>6.1%} {vl:>8.4f} {va:>6.1%}")
        
        if vl < best_val_loss:
            best_val_loss = vl
            best_state = {
                k: v.detach().cpu().clone()
                for k, v in model.state_dict().items()
            }
            no_improve = 0
        else:
            no_improve += 1
            if no_improve >= patience:
                print(f"\n  Early stopping (epoch {epoch})")
                break
    
    # En iyi modeli yükle
    if best_state:
        model.load_state_dict(best_state)
    
    # Test
    model.eval()
    test_dl = DataLoader(
        TensorDataset(torch.tensor(X_test), torch.tensor(y_test)),
        batch_size=batch_size, shuffle=False,
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
    
    # ── Kaydet ──
    os.makedirs(os.path.dirname(JZ_MODEL_PATH), exist_ok=True)
    torch.save(model.state_dict(), JZ_MODEL_PATH)
    with open(JZ_LABEL_MAP_PATH, "w") as f:
        json.dump(label_map, f, indent=2)
    
    print(f"\n{'='*60}")
    print(f"  ✅ J/Z Modeli Tamamlandı!")
    print(f"  Test doğruluk: {test_acc:.1%}")
    print(f"  Model: {JZ_MODEL_PATH}")
    print(f"{'='*60}")
    print(f"\n  Not: Final 50 kelime modeli notebooks/train_word_model_final.ipynb kaydından üretilir.")


# ═══════════════════════════════════════════════════════
#  Ana akış
# ═══════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="J/Z Dinamik Harf — Veri Toplama + LSTM Eğitimi",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("action", choices=["collect", "train", "all"],
                        help="collect: veri topla, train: model eğit, all: ikisini de yap")
    parser.add_argument("--sequences", type=int, default=30,
                        help="Harf başına sekans sayısı (varsayılan: 30)")
    parser.add_argument("--epochs", type=int, default=TRAIN_EPOCHS,
                        help="Eğitim epoch sayısı")
    parser.add_argument("--lr", type=float, default=TRAIN_LR)
    args = parser.parse_args()
    
    if args.action in ("collect", "all"):
        collect_dynamic_data(sequences_per_sign=args.sequences)
    
    if args.action in ("train", "all"):
        train_jz_model(epochs=args.epochs, lr=args.lr)


if __name__ == "__main__":
    main()
