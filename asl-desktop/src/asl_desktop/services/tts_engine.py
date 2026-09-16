"""
Ses Motoru (Text-to-Speech)
============================
- pyttsx3 ile offline sesli okuma
- Ayri daemon thread (kamera donmasini onler)
- Queue tabanli asenkron konusma
"""
import logging
import threading
import queue

import pyttsx3

from config.settings import TTS_RATE, TTS_VOLUME, TTS_JOIN_TIMEOUT

_logger = logging.getLogger("ASL.TTS")


class TTSEngine:
    """
    Thread-safe pyttsx3 wrapper.

    pyttsx3 macOS'ta ana thread'de calismazsa sorun cikarir.
    Bu sinif pyttsx3'u kendi daemon thread'inde calistirir.

    Kullanim:
        tts = TTSEngine()
        tts.start()
        tts.speak("Hello World")
        tts.stop()
    """

    def __init__(self, rate: int = TTS_RATE, volume: float = TTS_VOLUME):
        self._rate = rate
        self._volume = volume
        self._queue: queue.Queue = queue.Queue()
        self._thread: threading.Thread | None = None
        self._running = False

    def start(self) -> None:
        """TTS daemon thread'ini baslatir."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()

    def _worker(self) -> None:
        """Daemon thread: pyttsx3 motorunu olusturur ve queue'dan okur."""
        try:
            engine = pyttsx3.init()
        except (RuntimeError, OSError) as e:
            _logger.error("TTS motoru baslatilamadi: %s", e)
            self._running = False
            return

        engine.setProperty("rate", self._rate)
        engine.setProperty("volume", self._volume)

        while self._running:
            try:
                text = self._queue.get(timeout=0.5)
                if text is None:  # Durdurma sinyali
                    break
                engine.say(text)
                engine.runAndWait()
            except queue.Empty:
                continue
            except Exception as e:
                _logger.error("TTS konusma hatasi: %s", e)

        try:
            engine.stop()
        except Exception:
            pass

    def speak(self, text: str) -> None:
        """Konusma kuyruguna metin ekler (non-blocking). Otomatik baslatir."""
        if not self._running:
            self.start()
        if self._running and text:
            self._queue.put(text)

    def stop(self) -> None:
        """TTS motorunu durdurur."""
        self._running = False
        self._queue.put(None)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=TTS_JOIN_TIMEOUT)
        self._thread = None

    @property
    def is_running(self) -> bool:
        return self._running
