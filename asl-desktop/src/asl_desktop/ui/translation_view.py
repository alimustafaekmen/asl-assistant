"""
Ceviri Modu — Harf ve Kelime Tanima
=====================================
Canli kamera goruntusu uzerinden ASL harf ve kelime tanima,
metin olusturma ve sesli okuma.

Modlar:
  - Harf (letter): Statik el pozisyonu → harf tahmini (A-Y) + J/Z dinamik
  - Kelime (word): 30 frame sliding window → GRU kelime tahmini
"""
import time
import logging
import os

import cv2
import customtkinter as ctk
from PIL import Image

from config.settings import (
    CONFIDENCE_THRESHOLD,
    WORD_IDLE_RESET_FRAMES,
    DWELL_THRESHOLD,
    COLOR_PRIMARY, COLOR_PRIMARY_HOVER,
    COLOR_SUCCESS, COLOR_WARNING, COLOR_ERROR,
    COLOR_BG_BASE, COLOR_BG_CARD, COLOR_BG_ELEVATED, COLOR_BG_HOVER,
    COLOR_BORDER,
    COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY, COLOR_TEXT_TERTIARY, COLOR_TEXT_MUTED,
    BG_BASE, BG_CARD, BG_ELEVATED, BG_HOVER,
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_MUTED,
    ACCENT_SUCCESS, ACCENT_ERROR, ACCENT_PRIMARY, BORDER,
    FONT_FAMILY, PREDICTION_FONT_SIZE, PREDICTION_FONT_SIZE_WORD,
    LETTER_CONFIDENCE_THRESHOLD,
    ASSET_SIGNS_DIR,
)

from asl_desktop.camera.camera_widget import CameraWidget
from asl_desktop.detection.hand_detector import HandDetector
from asl_desktop.detection.holistic_detector import HolisticDetector
from asl_desktop.models.letter_classifier import LetterClassifier
from asl_desktop.models.sequence_classifier import SequenceClassifier
from asl_desktop.utils.smoother import PredictionSmoother
from asl_desktop.services.tts_engine import TTSEngine
from asl_desktop.utils.motion_tracker import MotionTracker


class TranslationView(ctk.CTkFrame):
    """
    Ceviri modu: kamera → harf tanima → MANUEL ONAY → metin → ses.

    Model surekli tahmin yapar ve ekranda gosterir.
    Kullanici dogru harfi gordugunde "✓ Ekle" butonuna basar
    veya Enter tusuna basar. Yanlis tahminler metne eklenmez.
    """

    def __init__(self, master, on_back=None, **kwargs):
        super().__init__(master, **kwargs)
        self._on_back = on_back
        self._logger = logging.getLogger("ASL")

        # Backend
        self._detector = HandDetector()
        self._holistic_detector = HolisticDetector()
        self._classifier = LetterClassifier()
        self._smoother = PredictionSmoother(confidence_threshold=LETTER_CONFIDENCE_THRESHOLD)
        self._tts = TTSEngine()
        self._jz_classifier = SequenceClassifier(model_type="jz")
        self._word_classifier = SequenceClassifier(model_type="word")
        self._motion_tracker = MotionTracker()

        # Dwell-time ayarlari
        self._dwell_counter = 0
        self._dwell_threshold = DWELL_THRESHOLD  # config/settings.py'den (~0.6s)
        self._word_idle_frames = 0               # kelime modu idle frame sayaci
        self._cooldown_frames = 0

        # Kalibrasyon durumu
        self._is_calibrating = False
        self._calib_target = ""
        self._calib_frames = 0

        # Model yukleme
        self._letter_loaded = self._classifier.load()
        self._jz_loaded = self._jz_classifier.load()
        self._word_loaded = self._word_classifier.load()

        if not self._letter_loaded:
            self._logger.warning(
                "Harf modeli yuklenemedi: python scripts/model_training/train_static_letter_model.py"
            )

        # Mod: "letter" (harf + J/Z) veya "word" (kelime)
        self._mode = "letter"

        # Durum
        self._current_text = ""
        self._current_prediction = ""
        self._current_confidence = 0.0

        # FPS
        self._fps_time = time.time()
        self._fps_count = 0
        self._fps_display = 0

        self._build_ui()

        # Klavye kisayollari (stop() icinde unbind edilecek)
        self._master_ref = master
        master.bind("<space>", lambda e: self._add_space())
        master.bind("<BackSpace>", lambda e: self._delete_last())

    def _build_ui(self) -> None:
        """2-sutunlu layout: Sol=Kamera, Sag=Kontrol paneli."""
        F = ctk.CTkFont  # kisaltma

        # ── Ust Cubuk ──
        top = ctk.CTkFrame(self, height=52, corner_radius=0, fg_color=BG_BASE)
        top.pack(fill="x")
        top.pack_propagate(False)

        if self._on_back:
            ctk.CTkButton(
                top, text="← Geri", width=80, height=30, corner_radius=8,
                font=F(family=FONT_FAMILY, size=14, weight="bold"),
                fg_color="transparent", hover_color=BG_ELEVATED,
                text_color=TEXT_SECONDARY, command=self._on_back,
            ).pack(side="left", padx=(16, 8), pady=10)

        ctk.CTkLabel(top, text="Çeviri Modu",
                      font=F(family=FONT_FAMILY, size=20, weight="bold"),
                      text_color=TEXT_PRIMARY).pack(side="left", padx=(0, 20), pady=10)

        # Mod secici
        seg = ctk.CTkFrame(top, fg_color=BG_CARD, corner_radius=8)
        seg.pack(side="left", pady=10)
        self._letter_mode_btn = ctk.CTkButton(
            seg, text="Harf", width=80, height=28, corner_radius=6,
            font=F(family=FONT_FAMILY, size=13, weight="bold"),
            fg_color=COLOR_PRIMARY, hover_color=BG_HOVER, text_color="white",
            command=lambda: self._set_mode("letter"))
        self._letter_mode_btn.pack(side="left", padx=2, pady=2)
        self._word_mode_btn = ctk.CTkButton(
            seg, text="Kelime", width=80, height=28, corner_radius=6,
            font=F(family=FONT_FAMILY, size=13, weight="bold"),
            fg_color="transparent", hover_color=BG_HOVER, text_color=TEXT_TERTIARY,
            command=lambda: self._set_mode("word"),
            state="normal" if self._word_loaded else "disabled")
        self._word_mode_btn.pack(side="left", padx=(0, 2), pady=2)

        self._fps_label = ctk.CTkLabel(
            top, text="", font=F(family=FONT_FAMILY, size=12), text_color=TEXT_MUTED)
        self._fps_label.pack(side="right", padx=16, pady=10)

        # ── 2-Sutunlu Ana Icerik ──
        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=8, pady=(4, 8))
        body.columnconfigure(0, weight=1)   # kamera
        body.columnconfigure(1, weight=1)   # kontrol paneli
        body.rowconfigure(0, weight=1)

        # ═══ SOL: KAMERA ═══
        cam_frame = ctk.CTkFrame(body, corner_radius=12, fg_color=BG_CARD,
                                  border_width=1, border_color=BORDER)
        cam_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 6))

        self._camera = CameraWidget(
            cam_frame, width=640, height=480, callback=self._process_frame)
        self._camera.pack(expand=True, fill="both", padx=3, pady=3)

        # ═══ SAG: KONTROL PANELI ═══
        right = ctk.CTkFrame(body, fg_color="transparent")
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        right.rowconfigure(0, weight=0)  # tahmin (kompakt)
        right.rowconfigure(1, weight=1)  # rehber gorseli (BUYUK — tum alan)
        right.rowconfigure(2, weight=0)  # feedback
        right.rowconfigure(3, weight=0)  # metin + butonlar
        right.rowconfigure(4, weight=0)  # status

        # ── Row 0: Tahmin Karti (kompakt — harf + guven yan yana) ──
        pred = ctk.CTkFrame(right, fg_color=BG_CARD, corner_radius=10,
                             border_width=1, border_color=BORDER)
        pred.grid(row=0, column=0, sticky="ew", pady=(0, 4))
        pred.columnconfigure(0, weight=0)  # buyuk harf
        pred.columnconfigure(1, weight=1)  # guven detaylari

        self._prediction_label = ctk.CTkLabel(
            pred, text="?",
            font=F(family=FONT_FAMILY, size=PREDICTION_FONT_SIZE, weight="bold"),
            text_color=TEXT_PRIMARY, width=90)
        self._prediction_label.grid(row=0, column=0, rowspan=2, padx=(10, 8), pady=4)

        # Guven bilgileri sag tarafta
        info_frame = ctk.CTkFrame(pred, fg_color="transparent")
        info_frame.grid(row=0, column=1, sticky="ew", padx=(0, 10), pady=(4, 0))

        self._confidence_label = ctk.CTkLabel(
            info_frame, text="Güven: —",
            font=F(family=FONT_FAMILY, size=15, weight="bold"),
            text_color=TEXT_TERTIARY, anchor="w")
        self._confidence_label.pack(fill="x")

        self._top3_label = ctk.CTkLabel(
            info_frame, text="",
            font=F(family=FONT_FAMILY, size=12), text_color=TEXT_MUTED, anchor="w")
        self._top3_label.pack(fill="x")

        self._word_conf_bar = ctk.CTkProgressBar(
            pred, height=5, corner_radius=3,
            fg_color=BG_ELEVATED, progress_color=COLOR_PRIMARY)
        self._word_conf_bar.grid(row=1, column=1, sticky="ew", padx=(0, 10), pady=(0, 4))
        self._word_conf_bar.set(0)

        self._buffer_progress_label = ctk.CTkLabel(
            pred, text="",
            font=F(family=FONT_FAMILY, size=11), text_color=TEXT_SECONDARY)
        self._buffer_progress_label.grid(row=2, column=0, columnspan=2, sticky="ew", padx=10, pady=(0, 2))

        # ── Row 1: Rehber Gorseli (weight=1 — TUM BOSLUGU ALIR) ──
        self._guide_frame = ctk.CTkFrame(right, corner_radius=12, fg_color=BG_CARD,
                                          border_width=1, border_color=BORDER)
        self._guide_frame.grid(row=1, column=0, sticky="nsew", pady=(0, 4))

        ctk.CTkLabel(self._guide_frame, text="ALFABE REHBERİ",
                      font=F(family=FONT_FAMILY, size=11, weight="bold"),
                      text_color=TEXT_TERTIARY).pack(pady=(3, 0))
        self._guide_img_label = ctk.CTkLabel(self._guide_frame, text="")
        self._guide_img_label.pack(fill="both", expand=True, padx=4, pady=(2, 3))
        self._load_guide_image(os.path.join(ASSET_SIGNS_DIR, "letters.png"), "_guide_ctk_img", self._guide_img_label, 480, max_h=450)

        self._word_ref_frame = ctk.CTkFrame(right, corner_radius=12, fg_color=BG_CARD,
                                             border_width=1, border_color=BORDER)
        # baslangicta gizli
        ctk.CTkLabel(self._word_ref_frame, text="KELİME REHBERİ",
                      font=F(family=FONT_FAMILY, size=11, weight="bold"),
                      text_color=TEXT_TERTIARY).pack(pady=(3, 0))
        self._word_img_label = ctk.CTkLabel(self._word_ref_frame, text="")
        self._word_img_label.pack(fill="both", expand=True, padx=4, pady=(2, 2))
        self._load_guide_image(os.path.join(ASSET_SIGNS_DIR, "kelime.png"), "_word_ref_ctk_img", self._word_img_label, 480, max_h=450)
        ctk.CTkLabel(self._word_ref_frame,
                      text="25 ASL kelimesi — işaret yapın, model tanısın",
                      font=F(family=FONT_FAMILY, size=11),
                      text_color=TEXT_TERTIARY, wraplength=460).pack(pady=(0, 3))

        # ── Row 2: Feedback ──
        fb_frame = ctk.CTkFrame(right, fg_color="transparent")
        fb_frame.grid(row=2, column=0, sticky="ew", pady=(0, 2))

        self._dwell_progress = ctk.CTkProgressBar(
            fb_frame, height=4, corner_radius=2,
            fg_color=BG_ELEVATED, progress_color=COLOR_PRIMARY)
        self._dwell_progress.pack(fill="x", pady=(0, 1))
        self._dwell_progress.set(0)

        self._feedback_label = ctk.CTkLabel(
            fb_frame, text="Ellerinizi gösterin.",
            font=F(family=FONT_FAMILY, size=14, weight="bold"),
            text_color=TEXT_TERTIARY, wraplength=460)
        self._feedback_label.pack()

        # ── Row 3: Metin + Butonlar (birlesik kompakt) ──
        ctrl_frame = ctk.CTkFrame(right, fg_color=BG_CARD, corner_radius=10,
                                    border_width=1, border_color=BORDER)
        ctrl_frame.grid(row=3, column=0, sticky="ew", pady=(0, 2))

        self._text_display = ctk.CTkTextbox(
            ctrl_frame, height=44, corner_radius=0,
            font=F(family=FONT_FAMILY, size=24, weight="bold"),
            state="disabled", wrap="word",
            border_width=0, fg_color="transparent", text_color=TEXT_PRIMARY)
        self._text_display.pack(fill="x", padx=8, pady=(4, 2))

        btn_row = ctk.CTkFrame(ctrl_frame, fg_color="transparent")
        btn_row.pack(fill="x", padx=6, pady=(0, 4))
        btn_row.columnconfigure((0, 1, 2, 3), weight=1)

        bf = F(family=FONT_FAMILY, size=13, weight="bold")
        ctk.CTkButton(btn_row, text="Boşluk", height=30, corner_radius=6, font=bf,
                       fg_color=BG_ELEVATED, hover_color=BG_HOVER,
                       text_color=TEXT_PRIMARY, command=self._add_space
                       ).grid(row=0, column=0, padx=(0, 2), sticky="ew")
        ctk.CTkButton(btn_row, text="Sil", height=30, corner_radius=6, font=bf,
                       fg_color=BG_ELEVATED, hover_color=BG_HOVER,
                       text_color=TEXT_PRIMARY, command=self._delete_last
                       ).grid(row=0, column=1, padx=2, sticky="ew")
        ctk.CTkButton(btn_row, text="Temizle", height=30, corner_radius=6, font=bf,
                       fg_color=BG_ELEVATED, hover_color=BG_HOVER,
                       text_color=TEXT_PRIMARY, command=self._clear_text
                       ).grid(row=0, column=2, padx=2, sticky="ew")
        ctk.CTkButton(btn_row, text="🔊 Seslendir", height=30, corner_radius=6, font=bf,
                       fg_color=COLOR_PRIMARY, hover_color=COLOR_PRIMARY_HOVER,
                       text_color="white", command=self._speak_text
                       ).grid(row=0, column=3, padx=(2, 0), sticky="ew")

        # ── Row 4: Status Satiri ──
        st_row = ctk.CTkFrame(right, fg_color="transparent")
        st_row.grid(row=4, column=0, sticky="ew")

        for st, loaded in [("Harf", self._letter_loaded), ("J/Z", self._jz_loaded), ("Kelime", self._word_loaded)]:
            color = ACCENT_SUCCESS if loaded else ACCENT_ERROR
            dot = "●" if loaded else "○"
            ctk.CTkLabel(st_row, text=f"{dot} {st}",
                          font=F(family=FONT_FAMILY, size=12), text_color=color
                          ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(st_row, text="Kalibre Et", width=80, height=24, corner_radius=6,
                       font=F(family=FONT_FAMILY, size=11, weight="bold"),
                       fg_color="transparent", border_width=1, border_color=ACCENT_PRIMARY,
                       text_color=ACCENT_PRIMARY, hover_color=BG_ELEVATED,
                       command=self._start_calibration,
                       state="normal" if self._letter_loaded else "disabled"
                       ).pack(side="right")

    def _load_guide_image(self, path: str, attr: str, label: ctk.CTkLabel, max_w: int,
                          max_h: int = 400) -> None:
        """Rehber gorselini yukle. Gorsel oranina gore akilli boyutlandirma."""
        if os.path.exists(path):
            try:
                pil_img = Image.open(path)
                orig_w, orig_h = pil_img.size
                ratio = orig_h / orig_w

                if ratio < 0.7:
                    # Genis gorsel (kelime.png)
                    w = min(max(max_w, 480), orig_w)
                    h = int(w * ratio)
                    if h < 220:
                        h = 220
                        w = int(h / ratio)
                else:
                    # Dikey gorsel (letters.png)
                    w = max_w
                    h = int(w * ratio)
                    if h > max_h:
                        h = max_h
                        w = int(h / ratio)
                    if h < 180:
                        h = 180
                        w = int(h / ratio)

                img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=(w, h))
                setattr(self, attr, img)
                label.configure(image=img)
            except Exception:
                label.configure(text="Görsel açılamadı")
        else:
            label.configure(text=f"{path} bulunamadı")

    # ── Mod secimi ──

    def _set_mode(self, mode: str) -> None:
        """Harf/Kelime modunu degistirir."""
        if mode == self._mode:
            return
        self._mode = mode

        is_letter = (mode == "letter")
        self._letter_mode_btn.configure(
            fg_color=COLOR_PRIMARY if is_letter else "transparent",
            text_color="white" if is_letter else COLOR_TEXT_TERTIARY)
        self._word_mode_btn.configure(
            fg_color="transparent" if is_letter else COLOR_PRIMARY,
            text_color=COLOR_TEXT_TERTIARY if is_letter else "white")

        # Rehber paneli degistir
        if is_letter:
            self._word_ref_frame.grid_forget()
            self._guide_frame.grid(row=1, column=0, sticky="nsew", pady=(0, 4))
        else:
            self._guide_frame.grid_forget()
            self._word_ref_frame.grid(row=1, column=0, sticky="nsew", pady=(0, 4))

        self._feedback_label.configure(
            text="Ellerinizi gösterin." if is_letter else "Kelime modu aktif.")

        # Buffer ve tahminleri sifirla
        self._current_prediction = ""
        self._current_confidence = 0.0
        self._word_idle_frames = 0
        self._smoother.reset()
        self._motion_tracker.reset()  # Shape uyumsuzlugunu onle (63D↔321D)
        if self._jz_loaded:
            self._jz_classifier.reset_buffer()
        if self._word_loaded:
            self._word_classifier.reset_buffer()
        # Tahmin etiketi font boyutunu moda gore ayarla
        pred_size = PREDICTION_FONT_SIZE if is_letter else PREDICTION_FONT_SIZE_WORD
        self._prediction_label.configure(
            text="?", text_color=COLOR_TEXT_PRIMARY,
            font=ctk.CTkFont(family=FONT_FAMILY, size=pred_size, weight="bold"))
        self._confidence_label.configure(text="Güven: —")
        self._top3_label.configure(text="")
        self._buffer_progress_label.configure(text="")

    # ── Frame isleme (sadece tahmin, ekleme YOK) ──

    def _process_frame(self, frame):
        self._fps_count += 1
        now = time.time()
        if now - self._fps_time >= 1.0:
            self._fps_display = self._fps_count
            self._fps_count = 0
            self._fps_time = now
            try:
                self._fps_label.configure(text=f"FPS: {self._fps_display}")
            except Exception:
                pass

        try:
            if self._mode == "letter":
                keypoints, frame = self._detector.detect_and_draw(frame)
                hands_detected = True if keypoints is not None else False
            else:
                keypoints, hands_detected = self._holistic_detector.detect(frame)
                frame = self._holistic_detector.draw_landmarks(frame)
        except Exception as e:
            self._logger.warning(
                "Frame isleme hatasi (detect_and_draw): %s", e, exc_info=True
            )
            return frame

        is_moving = self._motion_tracker.update(keypoints)

        if keypoints is not None:
            if self._mode == "letter":
                frame = self._process_letter_mode(keypoints, frame, is_moving)
            else:
                frame = self._process_word_mode(keypoints, frame, is_moving, hands_detected)
        else:
            # El bulunamadi → tum tahminleri sifirla
            self._dwell_counter = 0
            self._dwell_progress.set(0)
            self._prediction_label.configure(text="—", text_color=COLOR_PRIMARY)
            self._confidence_label.configure(text="Güven: —")
            self._top3_label.configure(text="")
            self._current_prediction = ""
            self._current_confidence = 0.0
            self._smoother.update(None, 0.0)
            if self._mode == "letter" and self._jz_loaded:
                self._jz_classifier.reset_buffer()
                self._buffer_progress_label.configure(text="J/Z: ░░░░░░░░░░ 0%")
            elif self._mode == "word" and self._word_loaded:
                self._word_classifier.reset_buffer()
                self._buffer_progress_label.configure(text="Kelime: ░░░░░░░░░░ 0%")

        return frame

    def _process_letter_mode(self, keypoints, frame, is_moving):
        """Harf modu: statik harf tahmini (A-Y) + J/Z dinamik tanima."""

        # Kalibrasyon modu aktifse tahmini durdur, frame topla
        if getattr(self, "_is_calibrating", False):
            if not is_moving:
                self._classifier.calibrate(self._calib_target, keypoints)
                self._calib_frames += 1
                self._dwell_progress.set(self._calib_frames / 30.0)

                if self._calib_frames >= 30: # 1 saniyelik veri
                    self._is_calibrating = False
                    self._feedback_label.configure(text=f"'{self._calib_target}' kalibre edildi ✓ Tahmin başlıyor.", text_color=COLOR_SUCCESS)
                    self._dwell_progress.set(0)
                    self._cooldown_frames = 30
            else:
                self._feedback_label.configure(text="Uyarı: Elinizi hareket ettirmeyin, sabit tutun!", text_color=COLOR_ERROR)

            # UI guncelleme
            self._prediction_label.configure(text="🎯", text_color=COLOR_PRIMARY)
            self._confidence_label.configure(text=f"Kalibre ediliyor: {self._calib_target}")
            self._top3_label.configure(text="")
            return frame

        jz_suppressing = False

        if self._cooldown_frames > 0:
            self._cooldown_frames -= 1
            self._prediction_label.configure(text="Eklendi ✓", text_color=COLOR_SUCCESS)
            self._confidence_label.configure(text="Hazırlanıyor...")
            self._dwell_progress.set(0)
            return frame

        # J/Z dinamik tanima
        if self._jz_loaded:
            jz_result = self._jz_classifier.add_frame(keypoints)
            progress = self._jz_classifier.buffer_progress
            _p = min(1.0, progress)
            self._buffer_progress_label.configure(
                text=f"J/Z: {'█' * int(_p * 10)}{'░' * (10 - int(_p * 10))} {int(_p * 100)}%"
            )
            if progress > 0.5:
                jz_suppressing = True
            if jz_result is not None:
                jz_label, jz_conf = jz_result
                if jz_conf >= CONFIDENCE_THRESHOLD:
                    self._current_prediction = jz_label
                    self._current_confidence = jz_conf
                    self._prediction_label.configure(text=jz_label)
                    self._confidence_label.configure(text=f"Güven: {jz_conf:.0%}")
            h, w = frame.shape[:2]
            bar_w = int(w * progress)
            color = (0, int(180 * progress), int(255 * (1 - progress)))
            cv2.rectangle(frame, (0, h - 6), (bar_w, h), color, -1)

        # Statik harf tahmini (A-Y, J/Z haric)
        if self._letter_loaded and not jz_suppressing:
            if is_moving:
                self._dwell_counter = 0
                self._dwell_progress.set(0)
                self._current_prediction = ""
                self._current_confidence = 0.0
                self._smoother.update(None, 0.0)
                self._prediction_label.configure(text="〰", text_color=COLOR_TEXT_MUTED)
                self._confidence_label.configure(text="Hareket ediliyor...")
                self._top3_label.configure(text="")
                return frame

            # Sabit durumda tahmin yap
            label, confidence, top3 = self._classifier.predict(keypoints)
            smoothed = self._smoother.update(label, confidence)

            self._current_prediction = label
            self._current_confidence = confidence

            display = smoothed if smoothed else label
            # Guven skoru rengi: yuksek=yesil, orta=sari, dusuk=mavi
            conf_color = (COLOR_SUCCESS if confidence >= 0.75
                          else COLOR_WARNING if confidence >= 0.5
                          else COLOR_PRIMARY)

            if smoothed:
                self._prediction_label.configure(
                    text=display, text_color=conf_color)

                # Dwell-time ilerlet
                self._dwell_counter += 1
                progress = min(1.0, self._dwell_counter / self._dwell_threshold)
                self._dwell_progress.set(progress)
                # Bar rengi dwell ilerledikce yesile kayar
                dwell_color = COLOR_SUCCESS if progress >= 1.0 else (COLOR_WARNING if progress >= 0.5 else COLOR_PRIMARY)
                self._dwell_progress.configure(progress_color=dwell_color)
                self._feedback_label.configure(text=f"'{smoothed}' kilitleniyor...", text_color=COLOR_WARNING)

                if self._dwell_counter >= self._dwell_threshold:
                    self._auto_type_letter(smoothed)
            else:
                # Guven yetersizse sayac yavasca duser (anlik hatalari tolere etmek icin)
                self._prediction_label.configure(
                    text=f"({label})", text_color=COLOR_TEXT_MUTED)
                self._dwell_counter = max(0, self._dwell_counter - 2)
                self._dwell_progress.set(self._dwell_counter / self._dwell_threshold)
                self._dwell_progress.configure(progress_color=COLOR_PRIMARY)
                self._feedback_label.configure(text="Harfi sabitlediğinizde otomatik yazılacaktır.", text_color=COLOR_TEXT_TERTIARY)

            self._confidence_label.configure(text=f"Güven: {confidence:.0%}", text_color=conf_color)
            self._top3_label.configure(
                text=" / ".join([f"{l} {s:.0%}" for l, s in top3])
            )

        elif self._letter_loaded and jz_suppressing:
            self._dwell_counter = 0
            self._dwell_progress.set(0)
            self._current_prediction = ""
            self._current_confidence = 0.0
            self._smoother.update(None, 0.0)
            self._prediction_label.configure(text="…", text_color=COLOR_TEXT_MUTED)
            self._confidence_label.configure(text="J/Z aktif...")
            self._top3_label.configure(text="")

        return frame

    def _process_word_mode(self, keypoints, frame, is_moving, hands_detected):
        """Kelime modu: 30 frame buffer → GRU/LSTM kelime tahmini + Idle Detection."""
        if not self._word_loaded:
            return frame

        if self._cooldown_frames > 0:
            self._cooldown_frames -= 1
            self._prediction_label.configure(text="Eklendi ✓", text_color=COLOR_SUCCESS)
            self._confidence_label.configure(text="Hazırlanıyor...")
            # Buffer'a ekleme yapmiyoruz ki cooldown sirasinda eski/ilgili frame'leri toplamasin
            return frame

        # Idle Detection: El algilanmadiysa ASLA buffer'a frame ekleme
        # (forward-fill yuz/vucut verisi modeli yaniltiyor — "dad" bug'i)
        if not hands_detected:
            self._word_idle_frames += 1
            self._logger.debug("WORD idle(no-hands): speed=%.3f idle=%d",
                               self._motion_tracker.speed, self._word_idle_frames)
            self._current_prediction = ""
            self._current_confidence = 0.0
            self._prediction_label.configure(text="Bekleniyor...", text_color=COLOR_TEXT_MUTED)
            self._confidence_label.configure(text="Eller görünmüyor")
            self._top3_label.configure(text="")
            if self._word_idle_frames >= WORD_IDLE_RESET_FRAMES:
                self._word_classifier.reset_buffer()
                self._word_idle_frames = 0
                self._buffer_progress_label.configure(text="Kelime: ░░░░░░░░░░ 0%")
            return frame

        # El var ama hareket yoksa da idle say (sabit durumda kelime tahmin etme)
        if not is_moving:
            self._word_idle_frames += 1
            self._logger.debug("WORD idle(no-motion): speed=%.3f idle=%d",
                               self._motion_tracker.speed, self._word_idle_frames)
            self._prediction_label.configure(text="Bekleniyor...", text_color=COLOR_TEXT_MUTED)
            self._confidence_label.configure(text="Elinizi hareket ettirin...")
            self._top3_label.configure(text="")
            if self._word_idle_frames >= WORD_IDLE_RESET_FRAMES:
                self._word_classifier.reset_buffer()
                self._word_idle_frames = 0
                self._buffer_progress_label.configure(text="Kelime: ░░░░░░░░░░ 0%")
            return frame

        # Aktif imzalama: idle sayacini sifirla
        self._word_idle_frames = 0

        # Buffer'a frame ekle
        word_result = self._word_classifier.add_frame(keypoints)
        progress = self._word_classifier.buffer_progress
        self._logger.debug("WORD frame(hands=True): buffer=%d/30 stride=%d",
                           len(self._word_classifier._frame_buffer),
                           self._word_classifier._frames_since_predict)

        # Progress bar guncelle
        _p = min(1.0, progress)
        self._buffer_progress_label.configure(
            text=f"Kelime: {'█' * int(_p * 10)}{'░' * (10 - int(_p * 10))} {int(_p * 100)}%"
        )

        # Frame uzerine progress bar ciz
        h, w = frame.shape[:2]
        bar_w = int(w * progress)
        color = (0, int(200 * progress), int(255 * (1 - progress)))
        cv2.rectangle(frame, (0, h - 6), (bar_w, h), color, -1)

        # Tahmin sonucu geldi mi?
        if word_result is not None:
            word_label, word_conf = word_result
            self._logger.info("WORD predict: label=%s conf=%.3f", word_label, word_conf)
            self._word_conf_bar.set(min(1.0, word_conf))
            if word_conf >= CONFIDENCE_THRESHOLD:
                self._current_prediction = word_label
                self._current_confidence = word_conf
                self._prediction_label.configure(
                    text=word_label, text_color=COLOR_SUCCESS)
                self._confidence_label.configure(text=f"Güven: {word_conf:.0%}")
                self._top3_label.configure(text="")

                # Kelime bulundugunda dogrudan yaz (Dwell gerekli degil)
                if self._cooldown_frames == 0:
                    self._auto_type_word(word_label)
            else:
                self._current_prediction = ""
                self._current_confidence = 0.0
                self._prediction_label.configure(
                    text=f"({word_label})", text_color=COLOR_TEXT_MUTED)
                self._confidence_label.configure(text=f"Güven: {word_conf:.0%} (düşük)")
                self._top3_label.configure(text="")

        return frame

    # ── Otomatik Ekleme ──

    def _auto_type_letter(self, letter: str) -> None:
        """Dwell-time doldugunda harfi yazar."""
        self._current_text += letter
        self._update_text_display()
        self._feedback_label.configure(
            text=f"'{letter}' EKLENDİ ✓", text_color=COLOR_SUCCESS,
        )
        self._dwell_counter = 0
        self._cooldown_frames = 15  # 0.5 saniye bekleme

    def _auto_type_word(self, word: str) -> None:
        """Kelime modeli sonucunda kelimeyi yazar, kelime arasi bosluk ekler."""
        if self._current_text and not self._current_text.endswith(" "):
            self._current_text += " "
        self._current_text += word + " "
        self._update_text_display()
        self._feedback_label.configure(
            text=f"'{word}' EKLENDİ ✓", text_color=COLOR_SUCCESS,
        )
        self._cooldown_frames = 30  # Word sonrasi daha uzun bekleme
        self._word_classifier.reset_buffer()

    # ── Metin islemleri ──

    def _update_text_display(self) -> None:
        self._text_display.configure(state="normal")
        self._text_display.delete("1.0", "end")
        self._text_display.insert("1.0", self._current_text)
        self._text_display.configure(state="disabled")

    def _delete_last(self) -> None:
        if self._current_text:
            self._current_text = self._current_text[:-1]
            self._update_text_display()

    def _add_space(self) -> None:
        self._current_text += " "
        self._update_text_display()

    def _speak_text(self) -> None:
        if self._current_text.strip():
            if not self._tts.is_running:
                self._tts.start()
            self._tts.speak(self._current_text.strip())

    def _clear_text(self) -> None:
        self._current_text = ""
        self._current_prediction = ""
        self._smoother.reset()
        if self._jz_loaded:
            self._jz_classifier.reset_buffer()
        if self._word_loaded:
            self._word_classifier.reset_buffer()
        self._update_text_display()
        self._feedback_label.configure(text="")
        self._buffer_progress_label.configure(text="")

    # ── Kalibrasyon ──

    def _start_calibration(self) -> None:
        dialog = ctk.CTkInputDialog(
            text="Hangi harfi yanlış okuyor?\nDoğrusunu düzeltmek için harfi girin (Örn: A)",
            title="Hızlı Kalibrasyon"
        )
        target = dialog.get_input()
        if target and len(target) == 1 and target.isalpha():
            self._calib_target = target.upper()

            # Geri sayim
            self._feedback_label.configure(
                text=f"Elinizi '{self._calib_target}' şeklinde tutun... 3", text_color=COLOR_WARNING
            )
            self.after(1000, lambda: self._feedback_label.configure(text="Elinizi tutun... 2", text_color=COLOR_WARNING))
            self.after(2000, lambda: self._feedback_label.configure(text="Elinizi tutun... 1", text_color=COLOR_WARNING))
            self.after(3000, self._enable_calibration_recording)
        elif target is not None:
            self._feedback_label.configure(text="Geçersiz harf, kalibrasyon iptal edildi.", text_color=COLOR_ERROR)
            self.after(2500, lambda: self._feedback_label.configure(text="Harfi sabitlediğinizde otomatik yazılacaktır.", text_color="gray"))

    def _enable_calibration_recording(self) -> None:
        self._is_calibrating = True
        self._calib_frames = 0
        self._dwell_progress.set(0)
        self._feedback_label.configure(text="Kaydediliyor, lütfen hareket etmeyin...", text_color=COLOR_PRIMARY)

    # ── Yasam dongusu ──

    def start(self) -> None:
        if hasattr(self, "_camera") and self._camera:
            self._camera.start()

    def stop(self) -> None:
        # Klavye binding'lerini temizle (birikmesini onle)
        try:
            if hasattr(self, "_master_ref") and self._master_ref.winfo_exists():
                self._master_ref.unbind("<space>")
                self._master_ref.unbind("<BackSpace>")
        except Exception:
            pass
        if hasattr(self, "_camera") and self._camera:
            self._camera.stop()
        if hasattr(self, "_tts") and self._tts and self._tts.is_running:
            self._tts.stop()
        try:
            self._detector.close()
        except Exception:
            pass
        if hasattr(self, "_holistic_detector") and self._holistic_detector:
            try:
                self._holistic_detector.close()
            except Exception:
                pass

    def destroy(self) -> None:
        self.stop()
        super().destroy()
