"""Non-blocking offline text-to-speech service for the desktop app."""

import logging
import queue
import threading

import pyttsx3

from asl_desktop.config import TTS_JOIN_TIMEOUT, TTS_RATE, TTS_VOLUME

_logger = logging.getLogger("ASL.TTS")


class TTSEngine:
    """Run ``pyttsx3`` work on a dedicated daemon thread.

    Example:
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
        # Set when the speech driver cannot start, so speak() stops retrying.
        self._unavailable = False

    def start(self) -> None:
        """Start the speech worker if it is not already running."""
        if self._running or self._unavailable:
            return
        self._running = True
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()

    def _worker(self) -> None:
        """Create the speech engine and process queued text."""
        try:
            engine = pyttsx3.init()
        except Exception as e:
            # A missing driver raises ImportError, not only RuntimeError or OSError.
            _logger.warning("Speech engine failed to start; speech is off: %s", e)
            self._unavailable = True
            self._running = False
            return

        engine.setProperty("rate", self._rate)
        engine.setProperty("volume", self._volume)

        while self._running:
            try:
                text = self._queue.get(timeout=0.5)
                if text is None:  # Sentinel inserted by ``stop``.
                    break
                engine.say(text)
                engine.runAndWait()
            except queue.Empty:
                continue
            except Exception as e:
                _logger.error("Speech failed: %s", e)

        try:
            engine.stop()
        except Exception:
            pass

    def speak(self, text: str) -> None:
        """Queue non-empty text for speech, starting the worker as needed."""
        if not self._running:
            self.start()
        if self._running and text:
            self._queue.put(text)

    def stop(self) -> None:
        """Stop the worker and wait briefly for it to exit."""
        self._running = False
        self._queue.put(None)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=TTS_JOIN_TIMEOUT)
        self._thread = None

    @property
    def is_running(self) -> bool:
        return self._running
