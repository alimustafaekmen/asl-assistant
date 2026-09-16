"""
HolisticDetector çıktı doğrulama testleri.

detect() sözleşmesi:
  - Tüm landmark sıfırsa → (None, False)   [boş frame / MediaPipe bulamadı]
  - Landmark varsa       → (ndarray(321,), bool)
  - NaN hiçbir zaman olmamalı (forward-fill sıfır döndürür, NaN değil)
  - hands_detected sadece gerçek el görüldüğünde True

Boş (siyah) frame'de MediaPipe genellikle hiçbir landmark üretmez →
detect() (None, False) döner. Bu testte bunu kabul edip doğruluyoruz.
"""
import numpy as np
import pytest

pytest.importorskip("cv2")
pytest.importorskip("mediapipe")

from asl_desktop.detection.holistic_detector import HolisticDetector

EXPECTED_SHAPE = (321,)  # 107 landmark × 3


def _make_detector() -> HolisticDetector:
    """Create HolisticDetector, or skip when MediaPipe cannot open a GL context."""
    try:
        return HolisticDetector()
    except RuntimeError as exc:
        pytest.skip(f"MediaPipe HolisticDetector bu ortamda baslatilamadi: {exc}")


def _blank_frame(h: int = 480, w: int = 640) -> np.ndarray:
    """Siyah (boş) kamera frame'i — MediaPipe'ın üretimde görebileceği en kötü durum."""
    return np.zeros((h, w, 3), dtype=np.uint8)


@pytest.fixture(scope="module")
def detector():
    """Modül genelinde tek HolisticDetector (MediaPipe init maliyetli)."""
    return _make_detector()


def test_detect_returns_tuple(detector):
    """detect() her zaman 2-tuple döndürmeli: (ndarray|None, bool)."""
    result = detector.detect(_blank_frame())
    assert isinstance(result, tuple) and len(result) == 2, "detect() 2-tuple dondurmeli"
    keypoints, hands_detected = result
    assert isinstance(hands_detected, bool), "hands_detected bool olmali"
    assert keypoints is None or isinstance(keypoints, np.ndarray), (
        "keypoints None veya ndarray olmali"
    )


def test_output_shape_when_not_none(detector):
    """Keypoints None değilse shape (321,) olmalı."""
    keypoints, _ = detector.detect(_blank_frame())
    if keypoints is not None:
        assert keypoints.shape == EXPECTED_SHAPE, (
            f"Beklenen {EXPECTED_SHAPE}, alınan {keypoints.shape}"
        )


def test_output_no_nan_when_not_none(detector):
    """Keypoints None değilse NaN içermemeli (forward-fill sıfır döndürür)."""
    keypoints, _ = detector.detect(_blank_frame())
    if keypoints is not None:
        assert not np.any(np.isnan(keypoints.astype(np.float32))), "Çıktıda NaN var!"


def test_hands_detected_false_on_blank(detector):
    """Boş frame'de el olmadığı için hands_detected=False olmalı."""
    _, hands_detected = detector.detect(_blank_frame())
    assert hands_detected is False, "Boş frame'de el tespit edilmemeli"


def test_output_shape_multiple_frames(detector):
    """Ardışık 5 frame'de — None değilse — shape ve NaN garantisi bozulmamalı."""
    for i in range(5):
        keypoints, _ = detector.detect(_blank_frame())
        if keypoints is not None:
            assert keypoints.shape == EXPECTED_SHAPE, f"Frame {i}: shape bozuldu"
            assert not np.any(np.isnan(keypoints.astype(np.float32))), f"Frame {i}: NaN var"


def test_forward_fill_no_nan_after_absence():
    """
    El görünmeyince forward-fill devreye girmeli, NaN oluşmamalı.
    Cache başlangıçta sıfır → boş frame'lerde de NaN üretmemeli.
    """
    fresh = _make_detector()  # temiz cache
    for _ in range(3):
        keypoints, _ = fresh.detect(_blank_frame())
        if keypoints is not None:
            assert not np.any(np.isnan(keypoints.astype(np.float32))), (
                "Forward-fill sonrası NaN var!"
            )
            assert keypoints.shape == EXPECTED_SHAPE


if __name__ == "__main__":
    det = HolisticDetector()
    test_detect_returns_tuple(det)
    test_output_shape_when_not_none(det)
    test_output_no_nan_when_not_none(det)
    test_hands_detected_false_on_blank(det)
    test_output_shape_multiple_frames(det)
    test_forward_fill_no_nan_after_absence()
    print("✅ test_holistic_output: 6/6 geçti")
