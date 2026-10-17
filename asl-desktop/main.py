"""Entry point for the optional CustomTkinter desktop prototype.

The browser application in ``asl-web/`` is the primary product. This desktop
application is retained as a runnable reference for the earlier 24-letter and
25-word workflows. See ``asl-desktop/README.md`` for setup instructions.

The local ``src`` directory is added below so this entry point can resolve the
``asl_desktop`` package when launched directly. The shared ``asl_features``
package must still be installed (normally with ``pip install -e ./asl-features``).
"""

import logging
import os
import sys
import time

# Reduce noisy C++ logs emitted by MediaPipe and TensorFlow dependencies.
os.environ["GLOG_minloglevel"] = "2"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

# Lets `python asl-desktop/main.py` find the desktop package without an
# editable install. asl-features is a declared dependency and is not added here.
DESKTOP_DIR = os.path.dirname(os.path.abspath(__file__))
DESKTOP_SRC = os.path.join(DESKTOP_DIR, "src")

if DESKTOP_SRC not in sys.path:
    sys.path.insert(0, DESKTOP_SRC)


def setup_logging():
    """Configure dependency and application logging."""
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # Preserve detailed diagnostics for the application itself.
    logging.getLogger("ASL").setLevel(logging.DEBUG)


def warmup_camera():
    """Request macOS camera access before the Tk event loop starts.

    Opening the camera for the first time can display a system permission
    dialog. Performing that request before ``mainloop`` avoids a known native
    crash in this desktop prototype.
    """
    import cv2
    from asl_desktop.config import CAMERA_INDEX

    logger = logging.getLogger("ASL")
    logger.info("Kamera izni kontrol ediliyor...")

    cap = cv2.VideoCapture(CAMERA_INDEX)

    if not cap.isOpened():
        # Try explicit macOS and automatic backends if the default backend fails.
        cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_AVFOUNDATION)
        if not cap.isOpened():
            cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_ANY)

    # Allow the system permission dialog time to settle.
    time.sleep(1.0)

    if cap.isOpened():
        ret, _ = cap.read()
        cap.release()
        if ret:
            logger.info("Kamera erisilebilir.")
            return True
        else:
            logger.warning("Kamera acildi ama frame alinamadi; izin var, birazdan duzelebilir.")
            return True  # The device opened; a missing first frame may be transient.
    else:
        logger.error(
            "Kamera acilamadi! macOS Sistem Ayarlari → Gizlilik → Kamera'dan "
            "Terminal/IDE'ye izin verin ve tekrar deneyin."
        )
        return False


def main():
    """Start the desktop application."""
    setup_logging()
    logger = logging.getLogger("ASL")

    logger.info("ASL Sign Language Assistant baslatiliyor...")

    # Report the selected PyTorch device when the optional dependency is usable.
    try:
        from asl_desktop.config import DEVICE

        logger.info(f"PyTorch cihaz: {DEVICE}")
    except Exception as e:
        logger.warning(f"PyTorch cihaz tespiti basarisiz: {e}")

    if not warmup_camera():
        logger.error("Kamera erisilemedi. Uygulama kapatiliyor.")
        print("\n  HATA: Kamera erisilemedi!")
        print("  macOS: Sistem Ayarlari → Gizlilik ve Guvenlik → Kamera")
        print("  Terminal uygulamaniza (veya IDE) kamera izni verin.\n")
        sys.exit(1)

    # The UI is imported only once the camera has opened; see warmup_camera.
    try:
        from asl_desktop.app.asl_app import ASLApp

        app = ASLApp()
        logger.info("Uygulama hazir. Arayuz aciliyor...")
        app.mainloop()
    except KeyboardInterrupt:
        logger.info("Kullanici tarafindan sonlandirildi.")
    except Exception as e:
        logger.error(f"Uygulama hatasi: {e}", exc_info=True)
        sys.exit(1)

    logger.info("Uygulama kapatildi.")


if __name__ == "__main__":
    main()
