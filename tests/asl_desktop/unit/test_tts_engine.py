"""The speech worker must degrade to silence when no speech driver works."""

from __future__ import annotations

import logging
import threading
from types import SimpleNamespace

import asl_desktop.services.tts_engine as tts_module
import pytest
from asl_desktop.services.tts_engine import TTSEngine


class FakeSpeechEngine:
    def __init__(self):
        self.said: list[str] = []
        self.spoken = threading.Event()

    def setProperty(self, name, value):  # noqa: N802 - mirrors pyttsx3
        pass

    def say(self, text):
        self.said.append(text)

    def runAndWait(self):  # noqa: N802 - mirrors pyttsx3
        self.spoken.set()

    def stop(self):
        pass


def _install_fake_pyttsx3(monkeypatch, init):
    monkeypatch.setattr(tts_module, "pyttsx3", SimpleNamespace(init=init))


@pytest.mark.parametrize("error", [ImportError("no driver"), RuntimeError("busy"), OSError("io")])
def test_failed_init_leaves_speech_unavailable(monkeypatch, caplog, error):
    calls = []

    def failing_init():
        calls.append(1)
        raise error

    _install_fake_pyttsx3(monkeypatch, failing_init)
    engine = TTSEngine()

    with caplog.at_level(logging.WARNING, logger="ASL.TTS"):
        engine.start()
        engine._thread.join(timeout=2)
        assert not engine._thread.is_alive()
        engine.speak("hello")
        engine.speak("again")

    assert engine.is_running is False
    assert len(calls) == 1
    assert len([r for r in caplog.records if r.levelno >= logging.WARNING]) == 1


def test_speak_reaches_the_engine_when_init_works(monkeypatch):
    fake = FakeSpeechEngine()
    _install_fake_pyttsx3(monkeypatch, lambda: fake)
    engine = TTSEngine()

    engine.speak("hello")
    assert fake.spoken.wait(timeout=2)
    engine.stop()

    assert fake.said == ["hello"]
