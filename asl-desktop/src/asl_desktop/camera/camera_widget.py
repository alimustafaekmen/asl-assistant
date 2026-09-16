"""
Kamera Widget
==============
OpenCV frame alimi → PIL → CTkImage dongusu.
CustomTkinter icinde calisan yeniden kullanilabilir widget.
"""
import logging

import cv2
import numpy as np
from PIL import Image
import customtkinter as ctk

from config.settings import (
    CAMERA_INDEX, CAMERA_WIDTH, CAMERA_HEIGHT, TARGET_FPS,
    CAMERA_WARN_THRESHOLD, CAMERA_STOP_THRESHOLD,
)

_logger = logging.getLogger("ASL.Camera")


class CameraWidget(ctk.CTkFrame):
    """
    OpenCV kamera gostericisi.

    Her frame icin opsiyonel bir callback fonksiyonu cagrilir.
    Boylece frame uzerinde overlay, tahmin yazisi vb. yapilabilir.

    Kullanim:
        def process_frame(frame):
            # frame uzerinde islemler
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

        # Ardisik basarisiz frame sayaci
        self._fail_count = 0

        # Goruntu alani
        self.image_label = ctk.CTkLabel(self, text="")
        self.image_label.pack(expand=True, fill="both")
        self._show_placeholder()

    def _show_placeholder(self) -> None:
        """Kamera acilmadan once placeholder gosterir."""
        self.image_label.configure(
            text="📷 Kamera bekleniyor...",
            font=ctk.CTkFont(size=16),
        )

    def start(self) -> bool:
        """Kamerayi acar ve frame dongusunu baslatir."""
        if self._running:
            return True

        self._cap = cv2.VideoCapture(CAMERA_INDEX)
        
        # macOS izinleri icin AVFOUNDATION fallback
        if not self._cap.isOpened():
            self._cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_AVFOUNDATION)
            if not self._cap.isOpened():
                 self._cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_ANY)

        if not self._cap.isOpened():
            _logger.error("Kamera acilamadi — izin kontrol edilmeli")
            self.image_label.configure(text="❌ Kamera açılamadı!\n\nmacOS Sistem Ayarları → Gizlilik ve Güvenlik → Kamera\nTerminal / IDE izni verin.")
            return False

        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)

        self._running = True
        self._update_frame()
        return True

    def stop(self) -> None:
        """Kamerayi durdurur ve serbest birakir."""
        self._running = False
        if self._after_id:
            self.after_cancel(self._after_id)
            self._after_id = None
        if self._cap and self._cap.isOpened():
            self._cap.release()
            self._cap = None
        self._show_placeholder()

    def _update_frame(self) -> None:
        """Periyodik frame yakalama ve gosterme."""
        if not self._running or not self._cap:
            return

        ret, frame = self._cap.read()
        if ret:
            self._fail_count = 0  # Basarili frame — sayaci sifirla
            frame = cv2.flip(frame, 1)  # Ayna goruntusu

            # Callback ile frame isleme
            if self.callback:
                frame = self.callback(frame)

            # BGR → RGB → PIL → CTkImage
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(rgb)
            img = img.resize(
                (self.display_width, self.display_height),
                Image.LANCZOS,
            )
            ctk_img = ctk.CTkImage(
                light_image=img, dark_image=img,
                size=(self.display_width, self.display_height),
            )
            self.image_label.configure(image=ctk_img, text="")
            self._current_ctk_image = ctk_img
        else:
            # Basarisiz frame — sayaci artir
            self._fail_count += 1
            if self._fail_count >= CAMERA_STOP_THRESHOLD:
                # 5 saniye boyunca frame alinamadi — kamerayi durdur
                self.image_label.configure(
                    text="❌ Kamera bağlantısı koptu!\n\n"
                         "Kameranızı kontrol edip uygulamayı yeniden başlatın.",
                    font=ctk.CTkFont(size=16),
                )
                self.stop()
                return
            elif self._fail_count >= CAMERA_WARN_THRESHOLD:
                # 1 saniye boyunca frame alinamadi — uyari goster
                self.image_label.configure(
                    text="⚠️ Kamera yanıt vermiyor...\n"
                         "Bağlantı kontrol ediliyor.",
                    font=ctk.CTkFont(size=15),
                )

        # Sonraki frame (~30 FPS)
        delay = max(1, int(1000 / TARGET_FPS))
        self._after_id = self.after(delay, self._update_frame)

    @property
    def is_running(self) -> bool:
        return self._running

    def destroy(self) -> None:
        self.stop()
        super().destroy()
