"""
LandmarkSmoother (EMA) birim testleri.
EMA yumusatma, ilk frame davranisi ve reset test edilir.
"""
import numpy as np
from asl_desktop.utils.landmark_smoother import LandmarkSmoother


def test_first_frame_passthrough():
    """Ilk frame oldugu gibi donmeli (onceki yok)."""
    s = LandmarkSmoother(alpha=0.6)
    data = np.ones(63, dtype=np.float32)
    result = s.smooth(data)
    np.testing.assert_array_equal(result, data)


def test_ema_smoothing():
    """EMA sonrasi deger, ham ve onceki arasinda olmali."""
    s = LandmarkSmoother(alpha=0.6)
    s.smooth(np.zeros(63))           # prev = 0
    result = s.smooth(np.ones(63))   # alpha*1 + (1-alpha)*0 = 0.6
    assert np.allclose(result, 0.6, atol=1e-6)


def test_alpha_one_no_smoothing():
    """alpha=1: yumusatma yok, ham deger donmeli."""
    s = LandmarkSmoother(alpha=1.0)
    s.smooth(np.zeros(63))
    result = s.smooth(np.ones(63))
    np.testing.assert_array_equal(result, np.ones(63))


def test_reset():
    """Reset sonrasi sonraki frame ilk frame gibi davranmali."""
    s = LandmarkSmoother(alpha=0.6)
    s.smooth(np.zeros(63))
    s.smooth(np.ones(63))
    s.reset()
    data = np.full(63, 5.0)
    result = s.smooth(data)
    np.testing.assert_array_equal(result, data)  # ilk frame = passthrough


def test_shape_preserved():
    """Cikti boyutu girdi ile ayni olmali."""
    s = LandmarkSmoother()
    data = np.random.randn(63).astype(np.float32)
    result = s.smooth(data)
    assert result.shape == data.shape


if __name__ == "__main__":
    test_first_frame_passthrough()
    test_ema_smoothing()
    test_alpha_one_no_smoothing()
    test_reset()
    test_shape_preserved()
    print("✅ test_landmark_smoother: 5/5 gecti")
