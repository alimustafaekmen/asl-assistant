"""Desktop camera view for letter and legacy 25-word recognition."""

import logging
import os
import time

import customtkinter as ctk
import cv2
from PIL import Image

from asl_desktop.camera.camera_widget import CameraWidget
from asl_desktop.config import (
    ACCENT_ERROR,
    ACCENT_PRIMARY,
    ACCENT_SUCCESS,
    ASSET_SIGNS_DIR,
    BG_BASE,
    BG_CARD,
    BG_ELEVATED,
    BG_HOVER,
    BORDER,
    COLOR_ERROR,
    COLOR_PRIMARY,
    COLOR_PRIMARY_HOVER,
    COLOR_SUCCESS,
    COLOR_TEXT_MUTED,
    COLOR_TEXT_PRIMARY,
    COLOR_TEXT_TERTIARY,
    COLOR_WARNING,
    CONFIDENCE_THRESHOLD,
    DWELL_THRESHOLD,
    FONT_FAMILY,
    LETTER_CONFIDENCE_THRESHOLD,
    PREDICTION_FONT_SIZE,
    PREDICTION_FONT_SIZE_WORD,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    TEXT_TERTIARY,
    WORD_IDLE_RESET_FRAMES,
)
from asl_desktop.detection.hand_detector import HandDetector
from asl_desktop.detection.holistic_detector import HolisticDetector
from asl_desktop.models.letter_classifier import LetterClassifier
from asl_desktop.models.sequence_classifier import SequenceClassifier
from asl_desktop.services.tts_engine import TTSEngine
from asl_desktop.utils.motion_tracker import MotionTracker
from asl_desktop.utils.smoother import PredictionSmoother


class TranslationView(ctk.CTkFrame):
    """Show live predictions and build a transcript from them.

    A letter is appended once the smoothed prediction holds for the dwell
    interval, and a word as soon as the model is confident. Unlike the web
    app, nothing asks the user first.
    """

    def __init__(self, master, on_back=None, **kwargs):
        super().__init__(master, **kwargs)
        self._on_back = on_back
        self._logger = logging.getLogger("ASL")

        # Recognition and output services.
        self._detector = HandDetector()
        self._holistic_detector = HolisticDetector()
        self._classifier = LetterClassifier()
        self._smoother = PredictionSmoother(confidence_threshold=LETTER_CONFIDENCE_THRESHOLD)
        self._tts = TTSEngine()
        self._jz_classifier = SequenceClassifier(model_type="jz")
        self._word_classifier = SequenceClassifier(model_type="word")
        self._motion_tracker = MotionTracker()

        # Temporal state for stable letter results and word-mode cooldowns.
        self._dwell_counter = 0
        self._dwell_threshold = DWELL_THRESHOLD  # About 0.7 seconds at 30 FPS.
        self._word_idle_frames = 0
        self._cooldown_frames = 0

        # Personalized letter-calibration state.
        self._is_calibrating = False
        self._calib_target = ""
        self._calib_frames = 0

        # Load each optional desktop artifact independently.
        self._letter_loaded = self._classifier.load()
        self._jz_loaded = self._jz_classifier.load()
        self._word_loaded = self._word_classifier.load()

        if not self._letter_loaded:
            self._logger.warning(
                "Letter model could not be loaded: python scripts/model_training/train_static_letter_model.py"
            )

        # Modes: static letters with optional J/Z, or the legacy word model.
        self._mode = "letter"

        # Current transcript and prediction state.
        self._current_text = ""
        self._current_prediction = ""
        self._current_confidence = 0.0

        # Lightweight display-rate tracking.
        self._fps_time = time.time()
        self._fps_count = 0
        self._fps_display = 0

        self._build_ui()

        # ``stop`` removes these bindings before the view is destroyed.
        self._master_ref = master
        master.bind("<space>", lambda e: self._add_space())
        master.bind("<BackSpace>", lambda e: self._delete_last())

    def _build_ui(self) -> None:
        """Build the camera and control-panel columns."""
        F = ctk.CTkFont

        # Header.
        top = ctk.CTkFrame(self, height=52, corner_radius=0, fg_color=BG_BASE)
        top.pack(fill="x")
        top.pack_propagate(False)

        if self._on_back:
            ctk.CTkButton(
                top,
                text="← Geri",
                width=80,
                height=30,
                corner_radius=8,
                font=F(family=FONT_FAMILY, size=14, weight="bold"),
                fg_color="transparent",
                hover_color=BG_ELEVATED,
                text_color=TEXT_SECONDARY,
                command=self._on_back,
            ).pack(side="left", padx=(16, 8), pady=10)

        ctk.CTkLabel(
            top,
            text="Çeviri Modu",
            font=F(family=FONT_FAMILY, size=20, weight="bold"),
            text_color=TEXT_PRIMARY,
        ).pack(side="left", padx=(0, 20), pady=10)

        # Mode switcher.
        seg = ctk.CTkFrame(top, fg_color=BG_CARD, corner_radius=8)
        seg.pack(side="left", pady=10)
        self._letter_mode_btn = ctk.CTkButton(
            seg,
            text="Harf",
            width=80,
            height=28,
            corner_radius=6,
            font=F(family=FONT_FAMILY, size=13, weight="bold"),
            fg_color=COLOR_PRIMARY,
            hover_color=BG_HOVER,
            text_color="white",
            command=lambda: self._set_mode("letter"),
        )
        self._letter_mode_btn.pack(side="left", padx=2, pady=2)
        self._word_mode_btn = ctk.CTkButton(
            seg,
            text="Kelime",
            width=80,
            height=28,
            corner_radius=6,
            font=F(family=FONT_FAMILY, size=13, weight="bold"),
            fg_color="transparent",
            hover_color=BG_HOVER,
            text_color=TEXT_TERTIARY,
            command=lambda: self._set_mode("word"),
            state="normal" if self._word_loaded else "disabled",
        )
        self._word_mode_btn.pack(side="left", padx=(0, 2), pady=2)

        self._fps_label = ctk.CTkLabel(
            top, text="", font=F(family=FONT_FAMILY, size=12), text_color=TEXT_MUTED
        )
        self._fps_label.pack(side="right", padx=16, pady=10)

        # Two-column content area.
        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=8, pady=(4, 8))
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        # Left column: camera preview.
        cam_frame = ctk.CTkFrame(
            body, corner_radius=12, fg_color=BG_CARD, border_width=1, border_color=BORDER
        )
        cam_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 6))

        self._camera = CameraWidget(cam_frame, width=640, height=480, callback=self._process_frame)
        self._camera.pack(expand=True, fill="both", padx=3, pady=3)

        # Right column: predictions, reference image, and transcript controls.
        right = ctk.CTkFrame(body, fg_color="transparent")
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        right.rowconfigure(0, weight=0)  # prediction (compact)
        right.rowconfigure(1, weight=1)  # reference image: takes the free space
        right.rowconfigure(2, weight=0)  # feedback
        right.rowconfigure(3, weight=0)  # transcript and buttons
        right.rowconfigure(4, weight=0)  # status

        # Row 0: current prediction and confidence.
        pred = ctk.CTkFrame(
            right, fg_color=BG_CARD, corner_radius=10, border_width=1, border_color=BORDER
        )
        pred.grid(row=0, column=0, sticky="ew", pady=(0, 4))
        pred.columnconfigure(0, weight=0)  # large letter
        pred.columnconfigure(1, weight=1)  # confidence details

        self._prediction_label = ctk.CTkLabel(
            pred,
            text="?",
            font=F(family=FONT_FAMILY, size=PREDICTION_FONT_SIZE, weight="bold"),
            text_color=TEXT_PRIMARY,
            width=90,
        )
        self._prediction_label.grid(row=0, column=0, rowspan=2, padx=(10, 8), pady=4)

        # Keep confidence details beside the predicted label.
        info_frame = ctk.CTkFrame(pred, fg_color="transparent")
        info_frame.grid(row=0, column=1, sticky="ew", padx=(0, 10), pady=(4, 0))

        self._confidence_label = ctk.CTkLabel(
            info_frame,
            text="Güven: --",
            font=F(family=FONT_FAMILY, size=15, weight="bold"),
            text_color=TEXT_TERTIARY,
            anchor="w",
        )
        self._confidence_label.pack(fill="x")

        self._top3_label = ctk.CTkLabel(
            info_frame,
            text="",
            font=F(family=FONT_FAMILY, size=12),
            text_color=TEXT_MUTED,
            anchor="w",
        )
        self._top3_label.pack(fill="x")

        self._word_conf_bar = ctk.CTkProgressBar(
            pred, height=5, corner_radius=3, fg_color=BG_ELEVATED, progress_color=COLOR_PRIMARY
        )
        self._word_conf_bar.grid(row=1, column=1, sticky="ew", padx=(0, 10), pady=(0, 4))
        self._word_conf_bar.set(0)

        self._buffer_progress_label = ctk.CTkLabel(
            pred, text="", font=F(family=FONT_FAMILY, size=11), text_color=TEXT_SECONDARY
        )
        self._buffer_progress_label.grid(
            row=2, column=0, columnspan=2, sticky="ew", padx=10, pady=(0, 2)
        )

        # Row 1: reference image expands into the remaining space.
        self._guide_frame = ctk.CTkFrame(
            right, corner_radius=12, fg_color=BG_CARD, border_width=1, border_color=BORDER
        )
        self._guide_frame.grid(row=1, column=0, sticky="nsew", pady=(0, 4))

        ctk.CTkLabel(
            self._guide_frame,
            text="ALFABE REHBERİ",
            font=F(family=FONT_FAMILY, size=11, weight="bold"),
            text_color=TEXT_TERTIARY,
        ).pack(pady=(3, 0))
        self._guide_img_label = ctk.CTkLabel(self._guide_frame, text="")
        self._guide_img_label.pack(fill="both", expand=True, padx=4, pady=(2, 3))
        self._load_guide_image(
            os.path.join(ASSET_SIGNS_DIR, "letters.png"),
            "_guide_ctk_img",
            self._guide_img_label,
            480,
            max_h=450,
        )

        self._word_ref_frame = ctk.CTkFrame(
            right, corner_radius=12, fg_color=BG_CARD, border_width=1, border_color=BORDER
        )
        # Word mode swaps this in for the alphabet guide; it starts hidden.
        ctk.CTkLabel(
            self._word_ref_frame,
            text="KELİME REHBERİ",
            font=F(family=FONT_FAMILY, size=11, weight="bold"),
            text_color=TEXT_TERTIARY,
        ).pack(pady=(3, 0))
        self._word_img_label = ctk.CTkLabel(self._word_ref_frame, text="")
        self._word_img_label.pack(fill="both", expand=True, padx=4, pady=(2, 2))
        self._load_guide_image(
            os.path.join(ASSET_SIGNS_DIR, "word-25.png"),
            "_word_ref_ctk_img",
            self._word_img_label,
            480,
            max_h=450,
        )
        ctk.CTkLabel(
            self._word_ref_frame,
            text="25 ASL kelimesi: işareti yapın, model tanısın",
            font=F(family=FONT_FAMILY, size=11),
            text_color=TEXT_TERTIARY,
            wraplength=460,
        ).pack(pady=(0, 3))

        # Row 2: short recognition feedback.
        fb_frame = ctk.CTkFrame(right, fg_color="transparent")
        fb_frame.grid(row=2, column=0, sticky="ew", pady=(0, 2))

        self._dwell_progress = ctk.CTkProgressBar(
            fb_frame, height=4, corner_radius=2, fg_color=BG_ELEVATED, progress_color=COLOR_PRIMARY
        )
        self._dwell_progress.pack(fill="x", pady=(0, 1))
        self._dwell_progress.set(0)

        self._feedback_label = ctk.CTkLabel(
            fb_frame,
            text="Ellerinizi gösterin.",
            font=F(family=FONT_FAMILY, size=14, weight="bold"),
            text_color=TEXT_TERTIARY,
            wraplength=460,
        )
        self._feedback_label.pack()

        # Row 3: transcript and editing controls.
        ctrl_frame = ctk.CTkFrame(
            right, fg_color=BG_CARD, corner_radius=10, border_width=1, border_color=BORDER
        )
        ctrl_frame.grid(row=3, column=0, sticky="ew", pady=(0, 2))

        self._text_display = ctk.CTkTextbox(
            ctrl_frame,
            height=44,
            corner_radius=0,
            font=F(family=FONT_FAMILY, size=24, weight="bold"),
            state="disabled",
            wrap="word",
            border_width=0,
            fg_color="transparent",
            text_color=TEXT_PRIMARY,
        )
        self._text_display.pack(fill="x", padx=8, pady=(4, 2))

        btn_row = ctk.CTkFrame(ctrl_frame, fg_color="transparent")
        btn_row.pack(fill="x", padx=6, pady=(0, 4))
        btn_row.columnconfigure((0, 1, 2, 3), weight=1)

        bf = F(family=FONT_FAMILY, size=13, weight="bold")
        ctk.CTkButton(
            btn_row,
            text="Boşluk",
            height=30,
            corner_radius=6,
            font=bf,
            fg_color=BG_ELEVATED,
            hover_color=BG_HOVER,
            text_color=TEXT_PRIMARY,
            command=self._add_space,
        ).grid(row=0, column=0, padx=(0, 2), sticky="ew")
        ctk.CTkButton(
            btn_row,
            text="Sil",
            height=30,
            corner_radius=6,
            font=bf,
            fg_color=BG_ELEVATED,
            hover_color=BG_HOVER,
            text_color=TEXT_PRIMARY,
            command=self._delete_last,
        ).grid(row=0, column=1, padx=2, sticky="ew")
        ctk.CTkButton(
            btn_row,
            text="Temizle",
            height=30,
            corner_radius=6,
            font=bf,
            fg_color=BG_ELEVATED,
            hover_color=BG_HOVER,
            text_color=TEXT_PRIMARY,
            command=self._clear_text,
        ).grid(row=0, column=2, padx=2, sticky="ew")
        ctk.CTkButton(
            btn_row,
            text="🔊 Seslendir",
            height=30,
            corner_radius=6,
            font=bf,
            fg_color=COLOR_PRIMARY,
            hover_color=COLOR_PRIMARY_HOVER,
            text_color="white",
            command=self._speak_text,
        ).grid(row=0, column=3, padx=(2, 0), sticky="ew")

        # Row 4: model and camera status.
        st_row = ctk.CTkFrame(right, fg_color="transparent")
        st_row.grid(row=4, column=0, sticky="ew")

        for st, loaded in [
            ("Harf", self._letter_loaded),
            ("J/Z", self._jz_loaded),
            ("Kelime", self._word_loaded),
        ]:
            color = ACCENT_SUCCESS if loaded else ACCENT_ERROR
            dot = "●" if loaded else "○"
            ctk.CTkLabel(
                st_row, text=f"{dot} {st}", font=F(family=FONT_FAMILY, size=12), text_color=color
            ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            st_row,
            text="Kalibre Et",
            width=80,
            height=24,
            corner_radius=6,
            font=F(family=FONT_FAMILY, size=11, weight="bold"),
            fg_color="transparent",
            border_width=1,
            border_color=ACCENT_PRIMARY,
            text_color=ACCENT_PRIMARY,
            hover_color=BG_ELEVATED,
            command=self._start_calibration,
            state="normal" if self._letter_loaded else "disabled",
        ).pack(side="right")

    def _load_guide_image(
        self, path: str, attr: str, label: ctk.CTkLabel, max_w: int, max_h: int = 400
    ) -> None:
        """Load and scale the reference image while preserving its aspect ratio."""
        if os.path.exists(path):
            try:
                pil_img = Image.open(path)
                orig_w, orig_h = pil_img.size
                ratio = orig_h / orig_w

                if ratio < 0.7:
                    # Wide word reference image.
                    w = min(max(max_w, 480), orig_w)
                    h = int(w * ratio)
                    if h < 220:
                        h = 220
                        w = int(h / ratio)
                else:
                    # Portrait alphabet reference image.
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

    def _set_mode(self, mode: str) -> None:
        """Switch between desktop letter and word recognition."""
        if mode == self._mode:
            return
        self._mode = mode

        is_letter = mode == "letter"
        self._letter_mode_btn.configure(
            fg_color=COLOR_PRIMARY if is_letter else "transparent",
            text_color="white" if is_letter else COLOR_TEXT_TERTIARY,
        )
        self._word_mode_btn.configure(
            fg_color="transparent" if is_letter else COLOR_PRIMARY,
            text_color=COLOR_TEXT_TERTIARY if is_letter else "white",
        )

        # Update the mode-specific reference image.
        if is_letter:
            self._word_ref_frame.grid_forget()
            self._guide_frame.grid(row=1, column=0, sticky="nsew", pady=(0, 4))
        else:
            self._guide_frame.grid_forget()
            self._word_ref_frame.grid(row=1, column=0, sticky="nsew", pady=(0, 4))

        self._feedback_label.configure(
            text="Ellerinizi gösterin." if is_letter else "Kelime modu aktif."
        )

        # Never carry temporal state across model contracts.
        self._current_prediction = ""
        self._current_confidence = 0.0
        self._word_idle_frames = 0
        self._smoother.reset()
        self._motion_tracker.reset()  # Letter frames are 63D, word frames 321D.
        if self._jz_loaded:
            self._jz_classifier.reset_buffer()
        if self._word_loaded:
            self._word_classifier.reset_buffer()
        # Word labels need a smaller font than single letters.
        pred_size = PREDICTION_FONT_SIZE if is_letter else PREDICTION_FONT_SIZE_WORD
        self._prediction_label.configure(
            text="?",
            text_color=COLOR_TEXT_PRIMARY,
            font=ctk.CTkFont(family=FONT_FAMILY, size=pred_size, weight="bold"),
        )
        self._confidence_label.configure(text="Güven: --")
        self._top3_label.configure(text="")
        self._buffer_progress_label.configure(text="")

    def _process_frame(self, frame, preview):
        """Detect on the captured ``frame``; draw and return the mirrored ``preview``."""
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
                keypoints = self._detector.detect(frame)
                preview = self._detector.draw_landmarks(preview)
                hands_detected = True if keypoints is not None else False
            else:
                keypoints, hands_detected = self._holistic_detector.detect(frame)
                preview = self._holistic_detector.draw_landmarks(preview)
        except Exception as e:
            self._logger.warning("Frame processing failed: %s", e, exc_info=True)
            return preview

        is_moving = self._motion_tracker.update(keypoints)

        if keypoints is not None:
            if self._mode == "letter":
                preview = self._process_letter_mode(keypoints, preview, is_moving)
            else:
                preview = self._process_word_mode(keypoints, preview, is_moving, hands_detected)
        else:
            # Clear temporal state as soon as the hand leaves the frame.
            self._dwell_counter = 0
            self._dwell_progress.set(0)
            self._prediction_label.configure(text="--", text_color=COLOR_PRIMARY)
            self._confidence_label.configure(text="Güven: --")
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

        return preview

    def _process_letter_mode(self, keypoints, frame, is_moving):
        """Run static-letter inference and optional dynamic J/Z recognition."""

        # Calibration records features instead of producing predictions.
        if getattr(self, "_is_calibrating", False):
            if not is_moving:
                self._classifier.calibrate(self._calib_target, keypoints, persist=False)
                self._calib_frames += 1
                self._dwell_progress.set(self._calib_frames / 30.0)

                if self._calib_frames >= 30:  # One second at 30 FPS.
                    self._is_calibrating = False
                    self._classifier.save_calibration()
                    self._feedback_label.configure(
                        text=f"'{self._calib_target}' kalibre edildi ✓ Tahmin başlıyor.",
                        text_color=COLOR_SUCCESS,
                    )
                    self._dwell_progress.set(0)
                    self._cooldown_frames = 30
            else:
                self._feedback_label.configure(
                    text="Uyarı: Elinizi hareket ettirmeyin, sabit tutun!", text_color=COLOR_ERROR
                )

            # Show calibration progress without exposing intermediate labels.
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

        # Feed the optional J/Z sequence model when it is available.
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

        # Static model: 24 letters, excluding J and Z.
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

            # Predict only after the pose stabilizes.
            label, confidence, top3 = self._classifier.predict(keypoints)
            smoothed = self._smoother.update(label, confidence)

            self._current_prediction = label
            self._current_confidence = confidence

            display = smoothed if smoothed else label
            # Map confidence bands to the existing status colors.
            conf_color = (
                COLOR_SUCCESS
                if confidence >= 0.75
                else COLOR_WARNING
                if confidence >= 0.5
                else COLOR_PRIMARY
            )

            if smoothed:
                self._prediction_label.configure(text=display, text_color=conf_color)

                # Accumulate stable frames for automatic dwell acceptance.
                self._dwell_counter += 1
                progress = min(1.0, self._dwell_counter / self._dwell_threshold)
                self._dwell_progress.set(progress)
                dwell_color = (
                    COLOR_SUCCESS
                    if progress >= 1.0
                    else (COLOR_WARNING if progress >= 0.5 else COLOR_PRIMARY)
                )
                self._dwell_progress.configure(progress_color=dwell_color)
                self._feedback_label.configure(
                    text=f"'{smoothed}' kilitleniyor...", text_color=COLOR_WARNING
                )

                if self._dwell_counter >= self._dwell_threshold:
                    self._auto_type_letter(smoothed)
            else:
                # Decay gradually so one noisy frame does not reset progress.
                self._prediction_label.configure(text=f"({label})", text_color=COLOR_TEXT_MUTED)
                self._dwell_counter = max(0, self._dwell_counter - 2)
                self._dwell_progress.set(self._dwell_counter / self._dwell_threshold)
                self._dwell_progress.configure(progress_color=COLOR_PRIMARY)
                self._feedback_label.configure(
                    text="Harfi sabitlediğinizde otomatik yazılacaktır.",
                    text_color=COLOR_TEXT_TERTIARY,
                )

            self._confidence_label.configure(text=f"Güven: {confidence:.0%}", text_color=conf_color)
            self._top3_label.configure(
                text=" / ".join([f"{label} {score:.0%}" for label, score in top3])
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
        """Run the legacy 30-frame desktop word model with idle detection."""
        if not self._word_loaded:
            return frame

        if self._cooldown_frames > 0:
            self._cooldown_frames -= 1
            self._prediction_label.configure(text="Eklendi ✓", text_color=COLOR_SUCCESS)
            self._confidence_label.configure(text="Hazırlanıyor...")
            # Do not collect frames during cooldown; they belong to the last sign.
            return frame

        # Never buffer face/pose-only frames; forward filling can create false words.
        if not hands_detected:
            self._word_idle_frames += 1
            self._logger.debug(
                "WORD idle(no-hands): speed=%.3f idle=%d",
                self._motion_tracker.speed,
                self._word_idle_frames,
            )
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

        # A visible but stationary hand is also idle for dynamic word recognition.
        if not is_moving:
            self._word_idle_frames += 1
            self._logger.debug(
                "WORD idle(no-motion): speed=%.3f idle=%d",
                self._motion_tracker.speed,
                self._word_idle_frames,
            )
            self._prediction_label.configure(text="Bekleniyor...", text_color=COLOR_TEXT_MUTED)
            self._confidence_label.configure(text="Elinizi hareket ettirin...")
            self._top3_label.configure(text="")
            if self._word_idle_frames >= WORD_IDLE_RESET_FRAMES:
                self._word_classifier.reset_buffer()
                self._word_idle_frames = 0
                self._buffer_progress_label.configure(text="Kelime: ░░░░░░░░░░ 0%")
            return frame

        # Active signing resets the idle counter.
        self._word_idle_frames = 0

        word_result = self._word_classifier.add_frame(keypoints)
        progress = self._word_classifier.buffer_progress
        self._logger.debug(
            "WORD frame(hands=True): buffer=%d/30 stride=%d",
            len(self._word_classifier._frame_buffer),
            self._word_classifier._frames_since_predict,
        )

        _p = min(1.0, progress)
        self._buffer_progress_label.configure(
            text=f"Kelime: {'█' * int(_p * 10)}{'░' * (10 - int(_p * 10))} {int(_p * 100)}%"
        )

        # Mirror progress on the camera frame.
        h, w = frame.shape[:2]
        bar_w = int(w * progress)
        color = (0, int(200 * progress), int(255 * (1 - progress)))
        cv2.rectangle(frame, (0, h - 6), (bar_w, h), color, -1)

        # A result is returned only when the sequence window is ready.
        if word_result is not None:
            word_label, word_conf = word_result
            self._logger.info("WORD predict: label=%s conf=%.3f", word_label, word_conf)
            self._word_conf_bar.set(min(1.0, word_conf))
            if word_conf >= CONFIDENCE_THRESHOLD:
                self._current_prediction = word_label
                self._current_confidence = word_conf
                self._prediction_label.configure(text=word_label, text_color=COLOR_SUCCESS)
                self._confidence_label.configure(text=f"Güven: {word_conf:.0%}")
                self._top3_label.configure(text="")

                # A completed word sequence does not need an additional dwell.
                if self._cooldown_frames == 0:
                    self._auto_type_word(word_label)
            else:
                self._current_prediction = ""
                self._current_confidence = 0.0
                self._prediction_label.configure(
                    text=f"({word_label})", text_color=COLOR_TEXT_MUTED
                )
                self._confidence_label.configure(text=f"Güven: {word_conf:.0%} (düşük)")
                self._top3_label.configure(text="")

        return frame

    def _auto_type_letter(self, letter: str) -> None:
        """Append a letter after its dwell interval completes."""
        self._current_text += letter
        self._update_text_display()
        self._feedback_label.configure(
            text=f"'{letter}' EKLENDİ ✓",
            text_color=COLOR_SUCCESS,
        )
        self._dwell_counter = 0
        self._cooldown_frames = 15  # About 0.5 seconds at 30 FPS.

    def _auto_type_word(self, word: str) -> None:
        """Append one accepted word with transcript spacing."""
        if self._current_text and not self._current_text.endswith(" "):
            self._current_text += " "
        self._current_text += word + " "
        self._update_text_display()
        self._feedback_label.configure(
            text=f"'{word}' EKLENDİ ✓",
            text_color=COLOR_SUCCESS,
        )
        self._cooldown_frames = 30  # Use a longer pause after a complete word.
        self._word_classifier.reset_buffer()

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

    def _start_calibration(self) -> None:
        dialog = ctk.CTkInputDialog(
            text="Hangi harfi yanlış okuyor?\nDoğrusunu düzeltmek için harfi girin (Örn: A)",
            title="Hızlı Kalibrasyon",
        )
        target = dialog.get_input()
        if target and len(target) == 1 and target.isalpha():
            self._calib_target = target.upper()

            # Count down before collecting the user's template.
            self._feedback_label.configure(
                text=f"Elinizi '{self._calib_target}' şeklinde tutun... 3", text_color=COLOR_WARNING
            )
            self.after(
                1000,
                lambda: self._feedback_label.configure(
                    text="Elinizi tutun... 2", text_color=COLOR_WARNING
                ),
            )
            self.after(
                2000,
                lambda: self._feedback_label.configure(
                    text="Elinizi tutun... 1", text_color=COLOR_WARNING
                ),
            )
            self.after(3000, self._enable_calibration_recording)
        elif target is not None:
            self._feedback_label.configure(
                text="Geçersiz harf, kalibrasyon iptal edildi.", text_color=COLOR_ERROR
            )
            self.after(
                2500,
                lambda: self._feedback_label.configure(
                    text="Harfi sabitlediğinizde otomatik yazılacaktır.", text_color="gray"
                ),
            )

    def _enable_calibration_recording(self) -> None:
        self._is_calibrating = True
        self._calib_frames = 0
        self._dwell_progress.set(0)
        self._feedback_label.configure(
            text="Kaydediliyor, lütfen hareket etmeyin...", text_color=COLOR_PRIMARY
        )

    def start(self) -> None:
        if hasattr(self, "_camera") and self._camera:
            self._camera.start()

    def stop(self) -> None:
        # Remove view-scoped bindings before another view installs its own.
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
