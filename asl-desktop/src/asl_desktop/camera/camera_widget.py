"""Reusable OpenCV-to-CustomTkinter camera widget."""

import logging

import customtkinter as ctk
import cv2
from PIL import Image

from asl_desktop.config import (
    CAMERA_HEIGHT,
    CAMERA_INDEX,
    CAMERA_STOP_THRESHOLD,
    CAMERA_WARN_THRESHOLD,
    CAMERA_WIDTH,
    TARGET_FPS,
)

_logger = logging.getLogger("ASL.Camera")


class CameraWidget(ctk.CTkFrame):
    """Display camera frames and optionally process each frame.

    The callback receives a BGR frame and must return the frame to display. It
    can add landmarks, prediction text, or other overlays.

    Example:
        def process_frame(frame):
            # Add overlays or run inference here.
            return frame

        camera = CameraWidget(parent, callback=process_frame)
        camera.start()
    """

    def __init__(self, master, width=640, height=480, callback=None, **kwargs):
        super().__init__(master, **kwargs)
        self.display_width = width
        self.display_height = height
        self.callback = callback

        self._cap = None
        self._running = False
        self._after_id = None

        # Consecutive read failures drive warning and stop thresholds.
        self._fail_count = 0

        # A single label hosts both status text and the current image.
        self.image_label = ctk.CTkLabel(self, text="")
        self.image_label.pack(expand=True, fill="both")
        self._show_placeholder()

    def _show_placeholder(self) -> None:
        """Show the idle state before the camera starts."""
        self.image_label.configure(
            text="📷 Kamera bekleniyor...",
            font=ctk.CTkFont(size=16),
        )

    def start(self) -> bool:
        """Open the configured camera and start the frame loop."""
        if self._running:
            return True

        self._cap = cv2.VideoCapture(CAMERA_INDEX)

        # Try explicit macOS and automatic backends if the default backend fails.
        if not self._cap.isOpened():
            self._cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_AVFOUNDATION)
            if not self._cap.isOpened():
                self._cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_ANY)

        if not self._cap.isOpened():
            _logger.error("Kamera acilamadi; izni kontrol edin")
            self.image_label.configure(
                text="❌ Kamera açılamadı!\n\nmacOS Sistem Ayarları → Gizlilik ve Güvenlik → Kamera\nTerminal / IDE izni verin."
            )
            return False

        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)

        self._running = True
        self._update_frame()
        return True

    def stop(self) -> None:
        """Stop scheduled updates and release the camera."""
        self._running = False
        if self._after_id:
            self.after_cancel(self._after_id)
            self._after_id = None
        if self._cap and self._cap.isOpened():
            self._cap.release()
            self._cap = None
        self._show_placeholder()

    def _update_frame(self) -> None:
        """Capture, process, and display one frame, then schedule the next."""
        if not self._running or not self._cap:
            return

        ret, frame = self._cap.read()
        if ret:
            self._fail_count = 0
            frame = cv2.flip(frame, 1)  # Mirror the preview for natural interaction.

            # Run the owning view's inference and overlay callback.
            if self.callback:
                frame = self.callback(frame)

            # Convert OpenCV BGR data into a CustomTkinter-compatible image.
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(rgb)
            img = img.resize(
                (self.display_width, self.display_height),
                Image.LANCZOS,
            )
            ctk_img = ctk.CTkImage(
                light_image=img,
                dark_image=img,
                size=(self.display_width, self.display_height),
            )
            self.image_label.configure(image=ctk_img, text="")
            self._current_ctk_image = ctk_img
        else:
            # Keep transient read failures separate from a disconnected camera.
            self._fail_count += 1
            if self._fail_count >= CAMERA_STOP_THRESHOLD:
                # Stop after the configured sustained-failure threshold.
                self.image_label.configure(
                    text="❌ Kamera bağlantısı koptu!\n\n"
                    "Kameranızı kontrol edip uygulamayı yeniden başlatın.",
                    font=ctk.CTkFont(size=16),
                )
                self.stop()
                return
            elif self._fail_count >= CAMERA_WARN_THRESHOLD:
                # Warn after the shorter configured failure threshold.
                self.image_label.configure(
                    text="⚠️ Kamera yanıt vermiyor...\nBağlantı kontrol ediliyor.",
                    font=ctk.CTkFont(size=15),
                )

        # Schedule the next update at the configured target rate.
        delay = max(1, int(1000 / TARGET_FPS))
        self._after_id = self.after(delay, self._update_frame)

    @property
    def is_running(self) -> bool:
        return self._running

    def destroy(self) -> None:
        self.stop()
        super().destroy()
