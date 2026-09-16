import json
import time
import logging
import cv2
import os
import numpy as np
import customtkinter as ctk

from PIL import Image

from asl_desktop.camera.camera_widget import CameraWidget
from asl_desktop.detection.hand_detector import HandDetector
from asl_desktop.models.letter_classifier import LetterClassifier
from asl_desktop.detection.holistic_detector import HolisticDetector
from asl_desktop.models.sequence_classifier import SequenceClassifier
from config.settings import (
    DEFAULT_WORDS,
    COACH_SUCCESS_THRESHOLD,
    WORD_COACH_SUCCESS_THRESHOLD,
    COACH_SUCCESS_FRAMES,
    FEEDBACK_DELAY,
    SEQUENCE_LENGTH,
    COLOR_PRIMARY, COLOR_PRIMARY_HOVER,
    COLOR_SUCCESS, COLOR_WARNING, COLOR_ERROR,
    COLOR_PURPLE, COLOR_PURPLE_HOVER, COLOR_PURPLE_TEXT,
    COLOR_BG_BASE, COLOR_BG_CARD, COLOR_BG_ELEVATED, COLOR_BG_HOVER,
    COLOR_BORDER,
    COLOR_TEXT_PRIMARY, COLOR_TEXT_SECONDARY, COLOR_TEXT_TERTIARY, COLOR_TEXT_MUTED,
    BG_BASE, BG_CARD, BG_ELEVATED, BG_HOVER,
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_MUTED,
    ACCENT_SUCCESS, ACCENT_WARNING, ACCENT_ERROR, ACCENT_PRIMARY, ACCENT_PURPLE, BORDER,
    FONT_FAMILY,
    ASSET_SIGNS_DIR,
    REFERENCE_DIR,
)

_logger = logging.getLogger("ASL.Coach")


class LearningCoachView(ctk.CTkFrame):
    """Öğrenme Koçu Modu — Kullanıcı harf/kelime seçer, kamerayla pratik yapar."""

    def __init__(self, master, on_back=None, **kwargs):
        super().__init__(master, **kwargs)
        self._on_back = on_back

        # Backend
        self._holistic_detector = HolisticDetector()
        self._word_classifier = SequenceClassifier(model_type="word")
        self._hand_detector = HandDetector()
        self._letter_classifier = LetterClassifier()

        self._word_loaded = self._word_classifier.load()
        self._words = DEFAULT_WORDS if self._word_loaded else []

        self._letter_loaded = self._letter_classifier.load()
        self._letters = list(self._letter_classifier.label_map.keys()) if self._letter_loaded else []

        self._mode = "word"
        self._selected_word = ""
        self._current_confidence = 0.0
        self._completed: set[str] = set()

        self._is_successful = False
        self._success_frames = 0
        self._needed_success_frames = COACH_SUCCESS_FRAMES  # harf: 60 (~2s), kelime: 3 (seyrek tahmin)
        self._last_feedback_time = 0.0

        # Kelime modu: state machine
        self._word_state = "idle"  # "idle" | "countdown" | "recording" | "result"
        self._word_countdown_end = 0.0
        self._word_record_buffer: list[np.ndarray] = []
        self._word_result_end = 0.0
        self._word_attempt_count = 0

        # Harf ipuçları
        self._letter_hints: dict[str, str] = {}
        _hints_path = os.path.join(REFERENCE_DIR, "letter_feedback.json")
        if os.path.exists(_hints_path):
            try:
                with open(_hints_path, encoding="utf-8") as f:
                    self._letter_hints = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError) as e:
                _logger.warning("Harf ipuclari yuklenemedi: %s", e)

        # Video linkleri
        self._video_links: dict[str, str] = {}
        self._alphabet_video_url = ""
        _video_path = os.path.join(REFERENCE_DIR, "asl_video_links.json")
        if os.path.exists(_video_path):
            try:
                with open(_video_path, encoding="utf-8") as f:
                    vdata = json.load(f)
                self._video_links = vdata.get("words", {})
                self._alphabet_video_url = vdata.get("alphabet_video", "")
            except (FileNotFoundError, json.JSONDecodeError) as e:
                _logger.warning("Video linkleri yuklenemedi: %s", e)

        # GC koruması
        self._ref_ctk_img = None
        self._ref_ctk_img_word = None

        self._build_ui()

    # ═══════════════════════════════════════════════════════
    #  UI BUILD
    # ═══════════════════════════════════════════════════════

    def _build_ui(self) -> None:
        """Sol=Kamera, Sağ=Sabit grid kontrol paneli."""
        F = ctk.CTkFont

        # ── Üst Çubuk ──
        top = ctk.CTkFrame(self, height=48, corner_radius=0, fg_color=BG_BASE)
        top.pack(fill="x")
        top.pack_propagate(False)

        if self._on_back:
            ctk.CTkButton(
                top, text="← Geri", width=80, height=28, corner_radius=8,
                font=F(family=FONT_FAMILY, size=14, weight="bold"),
                fg_color="transparent", hover_color=BG_ELEVATED,
                text_color=TEXT_SECONDARY, command=self._on_back,
            ).pack(side="left", padx=(16, 8), pady=10)

        ctk.CTkLabel(top, text="Öğrenme Koçu",
                      font=F(family=FONT_FAMILY, size=20, weight="bold"),
                      text_color=TEXT_PRIMARY).pack(side="left", padx=(0, 16), pady=10)

        # Mod seçici
        seg = ctk.CTkFrame(top, fg_color=BG_CARD, corner_radius=8)
        seg.pack(side="left", pady=10)
        self._letter_mode_btn = ctk.CTkButton(
            seg, text="Harf", width=72, height=26, corner_radius=6,
            font=F(family=FONT_FAMILY, size=13, weight="bold"),
            fg_color="transparent", hover_color=BG_HOVER,
            text_color=TEXT_TERTIARY,
            command=lambda: self._set_mode("letter"))
        self._letter_mode_btn.pack(side="left", padx=2, pady=2)
        self._word_mode_btn = ctk.CTkButton(
            seg, text="Kelime", width=72, height=26, corner_radius=6,
            font=F(family=FONT_FAMILY, size=13, weight="bold"),
            fg_color=COLOR_PURPLE, hover_color=COLOR_PURPLE_HOVER, text_color="white",
            command=lambda: self._set_mode("word"))
        self._word_mode_btn.pack(side="left", padx=(0, 2), pady=2)

        self._progress_label = ctk.CTkLabel(
            top, text="0/0", font=F(family=FONT_FAMILY, size=14, weight="bold"),
            text_color=TEXT_TERTIARY)
        self._progress_label.pack(side="right", padx=16, pady=10)

        # ── 2-Sütunlu Ana İçerik ──
        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=10, pady=(4, 8))
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        # ═══ SOL: KAMERA ═══
        cam_frame = ctk.CTkFrame(body, corner_radius=12, fg_color=BG_CARD,
                                  border_width=1, border_color=BORDER)
        cam_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 6))

        self._camera = CameraWidget(
            cam_frame, width=640, height=480, callback=self._process_frame)
        self._camera.pack(expand=True, fill="both", padx=3, pady=3)

        # ═══ SAĞ: KONTROL PANELİ (sabit grid) ═══
        right = ctk.CTkFrame(body, fg_color="transparent")
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        right.rowconfigure(0, weight=0)  # hedef kartı (kompakt)
        right.rowconfigure(1, weight=0)  # feedback label
        right.rowconfigure(2, weight=0)  # hint label
        right.rowconfigure(3, weight=0)  # liste (tek satır, horizontal scroll)
        right.rowconfigure(4, weight=1)  # referans görseli (BÜYÜK — tüm boşluğu alır)
        right.rowconfigure(5, weight=0)  # sonraki butonu

        # ── Row 0: Hedef Kartı (kompakt — harf + ipucu yan yana) ──
        target_card = ctk.CTkFrame(right, fg_color=BG_CARD, corner_radius=10,
                                     border_width=1, border_color=BORDER)
        target_card.grid(row=0, column=0, sticky="ew", pady=(0, 4))

        t_inner = ctk.CTkFrame(target_card, fg_color="transparent")
        t_inner.pack(fill="x", padx=8, pady=4)
        t_inner.columnconfigure(1, weight=1)

        self._ref_big_label = ctk.CTkLabel(
            t_inner, text="?",
            font=F(family=FONT_FAMILY, size=44, weight="bold"),
            text_color=ACCENT_PRIMARY)
        self._ref_big_label.grid(row=0, column=0, padx=(0, 8))

        self._target_label = ctk.CTkLabel(
            t_inner, text="Listeden bir hedef seçin",
            font=F(family=FONT_FAMILY, size=14), text_color=TEXT_TERTIARY,
            wraplength=280, anchor="w", justify="left")
        self._target_label.grid(row=0, column=1, sticky="w")

        t_inner.columnconfigure(2, weight=0)
        self._video_btn = ctk.CTkButton(
            t_inner, text="📹 Nasıl Yapılır?",
            width=120, height=30, corner_radius=8,
            font=F(family=FONT_FAMILY, size=13, weight="bold"),
            fg_color=COLOR_PRIMARY, hover_color=COLOR_PRIMARY_HOVER,
            text_color="white",
            command=self._open_video_link,
        )
        self._video_btn.grid(row=0, column=2, padx=(4, 0))

        self._confidence_progress = ctk.CTkProgressBar(
            target_card, height=6, corner_radius=3,
            fg_color=BG_ELEVATED, progress_color=COLOR_PRIMARY)
        self._confidence_progress.pack(fill="x", padx=8, pady=(0, 4))
        self._confidence_progress.set(0)

        # ── Row 1: Feedback ──
        self._feedback_label = ctk.CTkLabel(
            right, text="Seçim bekleniyor...",
            font=F(family=FONT_FAMILY, size=14, weight="bold"),
            text_color=TEXT_TERTIARY, wraplength=500)
        self._feedback_label.grid(row=1, column=0, sticky="ew", pady=(0, 0))

        self._hint_label = ctk.CTkLabel(
            right, text="",
            font=F(family=FONT_FAMILY, size=12),
            text_color=TEXT_SECONDARY, wraplength=480)
        self._hint_label.grid(row=2, column=0, sticky="ew", pady=(0, 2))

        # ── "Hazırım" butonu (kelime modu — başta gizli) ──
        self._hazirim_btn = ctk.CTkButton(
            right, text="▶  Hazırım — Kayda Başla",
            height=38, corner_radius=10,
            font=F(family=FONT_FAMILY, size=15, weight="bold"),
            fg_color=COLOR_PURPLE, hover_color=COLOR_PURPLE_HOVER,
            text_color="white",
            command=self._on_hazirim_clicked)
        self._hazirim_btn.grid(row=2, column=0, sticky="ew", pady=(2, 4))
        self._hazirim_btn.grid_remove()  # kelime seçilince görünür

        # ── Row 3: Eğitim Listesi (horizontal scroll, TEK SATIR) ──
        list_bar = ctk.CTkFrame(right, corner_radius=8, fg_color=BG_CARD,
                                  border_width=1, border_color=BORDER)
        list_bar.grid(row=3, column=0, sticky="ew", pady=(0, 4))

        self._scroll_frame = ctk.CTkScrollableFrame(
            list_bar, orientation="horizontal", height=38,
            fg_color="transparent", corner_radius=0)
        self._scroll_frame.pack(fill="x", padx=2, pady=2)

        self._word_buttons = {}
        self._populate_list()

        # ── Row 4: Referans Görseli (BÜYÜK — weight=1 ile esner) ──
        self._ref_image_frame = ctk.CTkFrame(right, fg_color=BG_CARD, corner_radius=12,
                                              border_width=1, border_color=BORDER)
        self._ref_image_frame.grid(row=4, column=0, sticky="nsew", pady=(0, 4))

        self._ref_image_title = ctk.CTkLabel(
            self._ref_image_frame, text="REFERANS REHBERİ",
            font=F(family=FONT_FAMILY, size=11, weight="bold"),
            text_color=TEXT_TERTIARY)
        self._ref_image_title.pack(pady=(4, 0))

        self._ref_image_label = ctk.CTkLabel(self._ref_image_frame, text="")
        self._ref_image_label.pack(fill="both", expand=True, padx=4, pady=(2, 4))

        self._load_ref_image_for_mode()

        # ── Row 5: Sonraki Butonu (başta gizli) ──
        self._next_btn = ctk.CTkButton(
            right, text="Sonraki →", height=32, corner_radius=8,
            font=F(family=FONT_FAMILY, size=14, weight="bold"),
            fg_color=COLOR_SUCCESS, hover_color="#1e8449",
            command=self._select_next)
        self._next_btn.grid(row=5, column=0, sticky="ew")
        self._next_btn.grid_remove()

    # ═══════════════════════════════════════════════════════
    #  REFERANS GÖRSEL
    # ═══════════════════════════════════════════════════════

    def _load_ref_image_for_mode(self) -> None:
        """Moda göre doğru referans PNG'yi yükler."""
        if self._mode == "letter":
            path = os.path.join(ASSET_SIGNS_DIR, "letters.png")
            self._ref_image_title.configure(text="ALFABE REHBERİ")
        else:
            path = os.path.join(ASSET_SIGNS_DIR, "kelime.png")
            self._ref_image_title.configure(text="KELİME REHBERİ")

        if os.path.exists(path):
            try:
                pil_img = Image.open(path)
                orig_w, orig_h = pil_img.size
                ratio = orig_h / orig_w

                if ratio < 0.7:
                    # Geniş görsel (kelime.png) — genişliği artır
                    w = min(600, orig_w)
                    h = int(w * ratio)
                    if h < 260:
                        h = 260
                        w = int(h / ratio)
                else:
                    # Dikey görsel (letters.png)
                    w = 420
                    h = int(w * ratio)
                    if h > 460:
                        h = 460
                        w = int(h / ratio)
                    if h < 200:
                        h = 200
                        w = int(h / ratio)

                img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=(w, h))
                if self._mode == "letter":
                    self._ref_ctk_img = img
                else:
                    self._ref_ctk_img_word = img
                self._ref_image_label.configure(image=img, text="")
            except Exception as e:
                _logger.warning("Referans görsel yüklenemedi: %s", e)
                self._ref_image_label.configure(text="Görsel açılamadı", image=None)
        else:
            self._ref_image_label.configure(text=f"{path} bulunamadı", image=None)

    # ═══════════════════════════════════════════════════════
    #  MOD DEĞİŞİMİ
    # ═══════════════════════════════════════════════════════

    def _set_mode(self, mode: str) -> None:
        if mode == self._mode:
            return
        self._mode = mode

        is_letter = (mode == "letter")
        self._letter_mode_btn.configure(
            fg_color=COLOR_PRIMARY if is_letter else "transparent",
            text_color="white" if is_letter else COLOR_TEXT_TERTIARY)
        self._word_mode_btn.configure(
            fg_color="transparent" if is_letter else COLOR_PURPLE,
            hover_color=BG_HOVER if is_letter else COLOR_PURPLE_HOVER,
            text_color=COLOR_TEXT_TERTIARY if is_letter else "white")

        self._selected_word = ""
        self._is_successful = False
        self._success_frames = 0
        self._needed_success_frames = 3 if mode == "word" else COACH_SUCCESS_FRAMES
        self._completed.clear()
        self._confidence_progress.set(0)
        self._confidence_progress.configure(progress_color=COLOR_PRIMARY)
        total = len(self._letters) if is_letter else len(self._words)
        self._progress_label.configure(text=f"0/{total}")
        self._ref_big_label.configure(text="?", text_color=ACCENT_PRIMARY)
        self._target_label.configure(text="Listeden bir hedef seçin")
        self._feedback_label.configure(text="Seçim bekleniyor...", text_color=TEXT_TERTIARY)
        self._hint_label.configure(text="")
        self._next_btn.grid_remove()
        self._hazirim_btn.grid_remove()
        self._word_state = "idle"
        self._word_record_buffer.clear()

        self._load_ref_image_for_mode()
        self._populate_list()

    # ═══════════════════════════════════════════════════════
    #  LİSTE OLUŞTURMA (horizontal tek satır)
    # ═══════════════════════════════════════════════════════

    def _populate_list(self) -> None:
        """Horizontal scrollable tek satır harf/kelime seçici."""
        for widget in self._scroll_frame.winfo_children():
            widget.destroy()
        self._word_buttons.clear()

        items = self._words if self._mode == "word" else self._letters

        for i, w in enumerate(items):
            display = w.upper() if len(w) == 1 else w.capitalize()

            if w in self._completed:
                bg, fg = COLOR_SUCCESS, COLOR_BG_BASE
                text = f"✓ {display}"
            else:
                bg, fg = BG_ELEVATED, TEXT_SECONDARY
                text = display

            btn = ctk.CTkButton(
                self._scroll_frame, text=text,
                width=65 if self._mode == "letter" else 85,
                height=30, corner_radius=6,
                font=ctk.CTkFont(family=FONT_FAMILY, size=13, weight="bold"),
                fg_color=bg, hover_color=COLOR_PRIMARY,
                text_color=fg,
                command=lambda word=w: self._select_word(word),
            )
            btn.grid(row=0, column=i, padx=2, pady=1)
            self._word_buttons[w] = btn

    # ═══════════════════════════════════════════════════════
    #  HEDEF SEÇİMİ
    # ═══════════════════════════════════════════════════════

    def _select_word(self, word: str) -> None:
        self._selected_word = word
        self._is_successful = False
        self._success_frames = 0
        self._last_feedback_time = 0.0
        self._confidence_progress.set(0)
        self._confidence_progress.configure(progress_color=COLOR_PRIMARY)
        self._next_btn.grid_remove()

        for w, btn in self._word_buttons.items():
            d = w.upper() if len(w) == 1 else w.capitalize()
            if w == word:
                btn.configure(fg_color=COLOR_PRIMARY, text_color="white",
                               text=f"→ {d}")
            elif w in self._completed:
                btn.configure(fg_color=COLOR_SUCCESS, text_color=COLOR_BG_BASE,
                               text=f"✓ {d}")
            else:
                btn.configure(fg_color=BG_ELEVATED, text_color=TEXT_SECONDARY,
                               text=d)

        display = word.upper() if self._mode == "letter" else word.capitalize()
        self._ref_big_label.configure(text=display, text_color=ACCENT_PRIMARY)

        if self._mode == "letter":
            hint = self._letter_hints.get(word.upper(), "")
            self._target_label.configure(text=hint if hint else f"'{display}' harfini yapın")
        else:
            self._target_label.configure(text=f"'{display}' kelimesini işaret edin")

        self._hint_label.configure(text="")
        self._word_attempt_count = 0
        # Kelime modunda tahminler seyrek gelir — 3 başarı yeterli
        self._needed_success_frames = 3 if self._mode == "word" else COACH_SUCCESS_FRAMES

        if self._mode == "word":
            # State machine: idle → "Hazırım" butonu göster
            self._word_state = "idle"
            self._word_record_buffer.clear()
            self._word_classifier.reset_buffer()
            self._hazirim_btn.configure(text="▶  Hazırım — Kayda Başla")
            self._hazirim_btn.grid(row=2, column=0, sticky="ew", pady=(2, 4))
            self._feedback_label.configure(
                text="Hazır olduğunuzda butona basın",
                text_color=ACCENT_PRIMARY)
            self._hint_label.configure(
                text=f"'{display}' işaretini referans görsele bakarak öğrenin")
        else:
            self._hazirim_btn.grid_remove()
            self._feedback_label.configure(text="Yapmanızı bekliyorum...", text_color=ACCENT_WARNING)

    # ═══════════════════════════════════════════════════════
    #  FRAME İŞLEME
    # ═══════════════════════════════════════════════════════

    def _process_frame(self, frame):
        if not self._selected_word:
            return frame

        if self._mode == "word":
            if not self._word_loaded:
                return frame

            # Holistic detect + landmark çiz (tüm durumlarda)
            try:
                keypoints, hands_detected = self._holistic_detector.detect(frame)
                frame = self._holistic_detector.draw_landmarks(frame)
            except Exception as e:
                _logger.warning("Koç Frame işleme (word): %s", e)
                return frame

            now = time.time()
            # ── STATE: IDLE — Kullanıcı "Hazırım" butonuna basmasını bekle ──
            if self._word_state == "idle":
                pass  # Kamera canlı, ama frame toplanmıyor

            # ── STATE: COUNTDOWN — 3-2-1 geri sayım ──
            elif self._word_state == "countdown":
                remaining = int(self._word_countdown_end - now) + 1
                if now >= self._word_countdown_end:
                    # Geri sayım bitti → kayda başla
                    self._word_state = "recording"
                    self._word_record_buffer.clear()
                    self._confidence_progress.set(0)
                    self._feedback_label.configure(
                        text="KAYIT BAŞLADI — Şimdi işareti yapın!",
                        text_color=ACCENT_SUCCESS)
                    self._hint_label.configure(text="")
                else:
                    self._confidence_progress.set(0)
                    self._confidence_progress.configure(progress_color=COLOR_PRIMARY)
                    self._feedback_label.configure(
                        text=f"Hazırlanın...  {remaining}",
                        text_color=ACCENT_PRIMARY)
                    self._hint_label.configure(
                        text=f"'{self._selected_word.capitalize()}' için hazırlanın")

            # ── STATE: RECORDING — 30 frame topla ──
            elif self._word_state == "recording":
                if not hands_detected:
                    self._feedback_label.configure(
                        text="Elinizi gösterin — kayıt devam ediyor",
                        text_color=ACCENT_ERROR)
                elif keypoints is not None:
                    self._word_record_buffer.append(keypoints.copy())

                collected = len(self._word_record_buffer)
                progress = collected / SEQUENCE_LENGTH
                self._confidence_progress.set(min(progress, 1.0))
                self._confidence_progress.configure(progress_color=COLOR_SUCCESS)

                if collected < SEQUENCE_LENGTH:
                    filled = int(progress * 15)
                    bar = "▓" * filled + "░" * (15 - filled)
                    self._feedback_label.configure(
                        text=f"Kaydediliyor  {bar}  {collected}/{SEQUENCE_LENGTH}",
                        text_color=ACCENT_SUCCESS)
                    self._hint_label.configure(text="")
                    # Kırmızı çerçeve çiz
                    h, w = frame.shape[:2]
                    cv2.rectangle(frame, (4, 4), (w - 4, h - 4), (0, 0, 255), 3)
                else:
                    # 30 frame toplandı → tek seferlik tahmin
                    result = self._word_classifier.predict_sequence(
                        self._word_record_buffer)
                    top3 = self._word_classifier.last_top3
                    predicted_word, conf = result
                    self._word_attempt_count += 1
                    self._word_state = "result"
                    self._word_result_end = now + 3.0
                    self._update_score(predicted_word, float(conf), top3)

            # ── STATE: RESULT — Sonucu göster, ardından idle'a dön ──
            elif self._word_state == "result":
                if now >= self._word_result_end:
                    if not self._is_successful:
                        self._word_state = "idle"
                        self._word_record_buffer.clear()
                        self._hazirim_btn.configure(text="▶  Tekrar Dene")
                        self._hazirim_btn.grid(row=2, column=0, sticky="ew", pady=(2, 4))
        else:
            if not self._letter_loaded:
                return frame
            try:
                keypoints, frame = self._hand_detector.detect_and_draw(frame)
                hands_detected = keypoints is not None
            except Exception as e:
                _logger.warning("Koç Frame işleme (letter): %s", e)
                return frame

            if not hands_detected or keypoints is None:
                self._confidence_progress.set(0)
                self._feedback_label.configure(text="Eller görünmüyor", text_color=ACCENT_ERROR)
                self._hint_label.configure(text=self._letter_hints.get(self._selected_word.upper(), ""))
                return frame

            pred_lbl, conf, top3 = self._letter_classifier.predict(keypoints)
            self._update_score(pred_lbl, float(conf), top3)

        return frame

    # ═══════════════════════════════════════════════════════
    #  SKOR GÜNCELLEME
    # ═══════════════════════════════════════════════════════

    def _update_score(self, predicted: str, conf: float, top3: list) -> None:
        # Hedef harfin gerçek olasılığını çek (top-1 değilse top3'ten bul)
        if predicted == self._selected_word:
            target_prob = conf
        elif top3 and self._mode == "letter":
            target_prob = 0.0
            for lbl, prob in top3:
                if lbl == self._selected_word:
                    target_prob = float(prob)
                    break
        else:
            target_prob = 0.0
        self._confidence_progress.set(min(target_prob, 1.0))

        if self._is_successful:
            return

        # ── 1) BAŞARI SAYACI — her frame'de çalışır, delay yok ──
        threshold = WORD_COACH_SUCCESS_THRESHOLD if self._mode == "word" else COACH_SUCCESS_THRESHOLD
        if target_prob >= threshold:
            self._success_frames += 1
        else:
            self._success_frames = max(0, self._success_frames - 1)

        # ── 2) TAMAMLAMA — hemen tetiklenir ──
        if self._success_frames >= self._needed_success_frames:
            self._is_successful = True
            self._completed.add(self._selected_word)
            total = len(self._words) if self._mode == "word" else len(self._letters)
            self._progress_label.configure(text=f"Tamamlanan: {len(self._completed)}/{total}")
            self._confidence_progress.set(1.0)
            self._confidence_progress.configure(progress_color=COLOR_SUCCESS)
            self._feedback_label.configure(
                text=f"MÜKEMMEL! %{int(target_prob * 100)} ile tamamladınız! ✓",
                text_color=ACCENT_SUCCESS)
            self._hint_label.configure(text="")
            self._next_btn.grid(row=5, column=0, sticky="ew")
            d = (self._selected_word.upper() if len(self._selected_word) == 1
                 else self._selected_word.capitalize())
            if self._selected_word in self._word_buttons:
                self._word_buttons[self._selected_word].configure(
                    fg_color=COLOR_SUCCESS, text_color=COLOR_BG_BASE,
                    text=f"✓ {d}")
            return

        # ── 3) METİN FEEDBACK — delay ile throttle (sadece metin) ──
        now = time.time()
        if self._mode == "letter" and now - self._last_feedback_time < FEEDBACK_DELAY:
            return
        self._last_feedback_time = now

        if target_prob >= threshold:
            progress_ratio = min(self._success_frames / self._needed_success_frames, 1.0)
            if self._mode == "word":
                remaining = self._needed_success_frames - self._success_frames
                self._confidence_progress.configure(progress_color=COLOR_SUCCESS)
                self._feedback_label.configure(
                    text=f"Harika! %{int(target_prob * 100)} — {remaining} kez daha yapın" if remaining > 0
                    else f"Harika! %{int(target_prob * 100)}",
                    text_color=ACCENT_SUCCESS)
                self._hint_label.configure(text="Aynı hareketi tekrarlayın!")
            else:
                filled = int(progress_ratio * 10)
                bar = "✓" * filled + "░" * (10 - filled)
                self._confidence_progress.configure(progress_color=COLOR_WARNING)
                self._feedback_label.configure(
                    text=f"İyi Gidiyor... %{int(target_prob * 100)}  {bar}",
                    text_color=ACCENT_WARNING)
                self._hint_label.configure(text="Böyle tutun!")
        else:
            self._confidence_progress.configure(progress_color=COLOR_PRIMARY)

            if predicted and predicted != "?" and self._mode == "letter":
                hint = self._letter_hints.get(self._selected_word.upper(), "")
                top3_text = ""
                if top3:
                    top3_text = " | ".join([f"{lbl} %{int(c*100)}" for lbl, c in top3[:3]])
                target_pct = int(target_prob * 100)
                self._feedback_label.configure(
                    text=f"'{predicted}' algılandı (%{int(conf*100)}) — hedef '{self._selected_word.upper()}' %{target_pct}",
                    text_color=ACCENT_ERROR)
                display_hint = f"Model: {top3_text}\n{hint}" if top3_text and hint else (top3_text or hint)
                self._hint_label.configure(text=display_hint)
            elif predicted and predicted != "?" and self._mode == "word":
                if predicted != self._selected_word:
                    conf_pct = int(conf * 100)
                    self._confidence_progress.set(0)
                    self._confidence_progress.configure(progress_color=COLOR_ERROR)
                    self._feedback_label.configure(
                        text=f"✗ '{predicted.capitalize()}' algılandı (%{conf_pct})",
                        text_color=ACCENT_ERROR)
                    top3_text = "  |  ".join(
                        [f"{lbl} %{int(p*100)}" for lbl, p in top3[:3]]
                    ) if top3 else ""
                    hint = f"Model gördükleri: {top3_text}\n" if top3_text else ""
                    self._hint_label.configure(
                        text=f"{hint}Hedef: '{self._selected_word.capitalize()}' — Referansa bakarak tekrarlayın.")
                else:
                    conf_pct = int(conf * 100)
                    needed_pct = int(WORD_COACH_SUCCESS_THRESHOLD * 100)
                    self._confidence_progress.set(min(conf, 1.0))
                    self._confidence_progress.configure(progress_color=COLOR_WARNING)
                    self._feedback_label.configure(
                        text=f"✓ Doğru kelime! Güven %{conf_pct} — hedefe yaklaşıyorsunuz (%{needed_pct} gerekli)",
                        text_color=ACCENT_WARNING)
                    self._hint_label.configure(
                        text="Az kaldı! Hareketi daha belirgin ve yavaş tekrarlayın.")
            else:
                if self._mode == "word":
                    # Gating tarafından reddedildi (hareket yetersiz veya belirsiz)
                    self._confidence_progress.set(0)
                    self._confidence_progress.configure(progress_color=COLOR_WARNING)
                    self._feedback_label.configure(
                        text="Hareket algılanamadı — daha belirgin işaret yapın",
                        text_color=ACCENT_WARNING)
                    self._hint_label.configure(
                        text="Ellerinizi daha geniş ve yavaş hareket ettirin.\n"
                             "Sabit durmayın — kelime işaretleri hareket gerektirir.")
                else:
                    self._feedback_label.configure(
                        text=f"Denemeye devam... (%{int(target_prob * 100)})",
                        text_color=ACCENT_PRIMARY)
                    self._hint_label.configure(text="")

    # ═══════════════════════════════════════════════════════
    #  NAVİGASYON + YAŞAM DÖNGÜSÜ
    # ═══════════════════════════════════════════════════════

    def _on_hazirim_clicked(self) -> None:
        """Kullanıcı 'Hazırım' butonuna bastı — geri sayımı başlat."""
        if self._word_state != "idle" or not self._selected_word:
            return
        self._word_state = "countdown"
        self._word_countdown_end = time.time() + 3.0
        self._word_record_buffer.clear()
        self._hazirim_btn.grid_remove()
        self._confidence_progress.set(0)
        self._confidence_progress.configure(progress_color=COLOR_PRIMARY)
        self._feedback_label.configure(text="Hazırlanın...  3", text_color=ACCENT_PRIMARY)
        self._hint_label.configure(
            text=f"'{self._selected_word.capitalize()}' için hazırlanın — 3 saniye")

    def _open_video_link(self) -> None:
        """Seçili hedef için YouTube rehber videosunu açar."""
        import webbrowser
        if self._mode == "letter":
            url = self._alphabet_video_url
        else:
            url = self._video_links.get(self._selected_word, self._alphabet_video_url)
        if url:
            webbrowser.open(url)

    def _select_next(self) -> None:
        items = self._words if self._mode == "word" else self._letters
        if not items or not self._selected_word:
            return
        try:
            idx = items.index(self._selected_word)
            next_word = items[(idx + 1) % len(items)]
        except ValueError:
            next_word = items[0]
        self._select_word(next_word)

    def start(self) -> None:
        if hasattr(self, "_camera") and self._camera:
            self._camera.start()

    def stop(self) -> None:
        if hasattr(self, "_camera") and self._camera:
            self._camera.stop()
        if hasattr(self, "_holistic_detector") and self._holistic_detector:
            self._holistic_detector.close()
        if hasattr(self, "_hand_detector") and self._hand_detector:
            self._hand_detector.close()
