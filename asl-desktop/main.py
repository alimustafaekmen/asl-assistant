"""
AI Destekli Isaret Dili Asistani — LEGACY DESKTOP ENTRYPOINT
================================================================

⚠ DIKKAT: Bu dosya eski masaustu (CustomTkinter) prototipinin giris noktasidir.
ASIL URUN artik tarayicidir: `asl-web/`. Juri demosu, GitHub Pages dagitimi ve
gercek zamanli ASL tanima `asl-web/` uzerinde calisir.

Bu masaustu uygulamasi referans/legacy katman olarak korunur. Yeni gelistirme
yapacaksaniz `asl-web/` altinda calisin. Web runtime hakkinda dokumantasyon:
- README.md (kapsamli proje tanitimi)
- asl-web/README.md (deploy + demo + hata senaryolari)
- docs/current/runtime-pipeline.md (pipeline detayi)

Web runtime'i baslatmak icin:
    cd asl-web && python3 -m http.server 8080
    # tarayici: http://localhost:8080

Bu masaustu prototipini calistirmak icin:
    # 1) Editable install ZORUNLU (asl_desktop + asl_ml package'lari import yolu)
    pip install -r requirements-dev.txt
    pip install -e ./asl-ml
    pip install -e ./asl-desktop
    # 2) Sonra:
    python3 asl-desktop/main.py
    # Doğrudan `python3 asl-desktop/main.py` editable install yapmadan
    # ModuleNotFoundError verir (`from asl_desktop.app.asl_app import ASLApp`).

Yazar: Ali Mustafa Ekmen
Yapay Zeka Uygulamalari Gelistirme Dersi - Mart 2026
"""
import sys
import os
import time
import logging

# MediaPipe ve TF C++ bazli loglari sustur (daha temiz terminal)
os.environ["GLOG_minloglevel"] = "2"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

# Proje kokunu Python path'e ekle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def setup_logging():
    """Loglama yapilandirmasi."""
    logging.basicConfig(
        level=logging.WARNING,  # Tum loglar sessiz (MediaPipe, TF vb.)
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # Sadece ASL uygulamasi DEBUG seviyesinde — word mode tani icin
    logging.getLogger("ASL").setLevel(logging.DEBUG)


def warmup_camera():
    """
    macOS kamera izni icin on-isinim.

    macOS'ta ilk kamera erisiminde izin dialogu acar.
    Eger bu dialog Tkinter mainloop icinde gelirse GIL cokuyor.
    Bu fonksiyon UI acilmadan ONCE kamerayi bir kez acar/kapar,
    boylece izin sorgusu burada gerceklesir.
    """
    import cv2
    from config.settings import CAMERA_INDEX

    logger = logging.getLogger("ASL")
    logger.info("Kamera izni kontrol ediliyor...")

    cap = cv2.VideoCapture(CAMERA_INDEX)

    if not cap.isOpened():
        # Fallback to backend 'CAP_AVFOUNDATION' and 'CAP_ANY' which might trigger permissions differently
        cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_AVFOUNDATION)
        if not cap.isOpened():
            cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_ANY)
    
    # macOS izin dialogunun kapanmasini bekle
    time.sleep(1.0)

    if cap.isOpened():
        ret, _ = cap.read()
        cap.release()
        if ret:
            logger.info("Kamera erisilebilir ✓")
            return True
        else:
            logger.warning("Kamera acildi ama frame alinamadi — izin var, sonra duzelebilir.")
            return True  # Kamera acildi, frame sorunu gecici olabilir
    else:
        logger.error(
            "Kamera acilamadi! macOS Sistem Ayarlari → Gizlilik → Kamera'dan "
            "Terminal/IDE'ye izin verin ve tekrar deneyin."
        )
        return False


def main():
    """Uygulamayi baslatir."""
    setup_logging()
    logger = logging.getLogger("ASL")

    logger.info("ASL Sign Language Assistant baslatiliyor...")

    # PyTorch cihaz bilgisi
    try:
        from config.settings import DEVICE
        logger.info(f"PyTorch cihaz: {DEVICE}")
    except Exception as e:
        logger.warning(f"PyTorch cihaz tespiti basarisiz: {e}")

    # Kamera on-isinim (macOS GIL cokusu onleme)
    if not warmup_camera():
        logger.error("Kamera erisilemedi. Uygulama kapatiliyor.")
        print("\n  ❌ Kamera erisilemedi!")
        print("  macOS: Sistem Ayarlari → Gizlilik ve Guvenlik → Kamera")
        print("  Terminal uygulamaniza (veya IDE) kamera izni verin.\n")
        sys.exit(1)

    # Uygulamayi baslat
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
