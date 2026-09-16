"""
ASL Sign Language Assistant - Proje Konfigurasyonu / Project configuration.

Tum Python-tarafi sabitleri ve yollari burada merkezi tanimlanir. ONEMLI:
Bu dosya YALNIZCA Python tarafi icindir (asl-desktop legacy + scripts + tests).
Aktif web urunu (asl-web/) bunu OKUMAZ; kendi JS CONFIG'ini ve
asl-web/data/*.json kontratlarini kullanir.

Central place for all Python-side constants and paths. NOTE: the active web
app (asl-web/) does NOT read this file — it ships its own JS CONFIG and JSON
contracts. Keep that Python/web separation in mind.
"""
import os

try:
    import torch
except ImportError:  # Hafif kontrol/test ortamlarinda PyTorch kurulu olmayabilir.
    torch = None

# ==================== YOLLAR ====================
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
RAW_DATA_DIR = os.path.join(DATA_DIR, "raw")
PROCESSED_DATA_DIR = os.path.join(DATA_DIR, "processed")
DYNAMIC_DATA_DIR = os.path.join(RAW_DATA_DIR, "dynamic")
MODELS_DIR = os.path.join(PROJECT_ROOT, "models")
LETTER_MODELS_DIR = os.path.join(MODELS_DIR, "letter")
JZ_MODELS_DIR = os.path.join(LETTER_MODELS_DIR, "dynamic_jz")
LEGACY_NOTEBOOKS_DIR = os.path.join(PROJECT_ROOT, "legacy", "old_notebooks")
WORD_V4_OUTPUT_DIR = os.path.join(LEGACY_NOTEBOOKS_DIR, "04_word_25_holistic_v4", "outputs")
REFERENCE_DIR = os.path.join(DATA_DIR, "reference")  # Ogrenme kocu icin
# Isaret rehber gorselleri (letters.png, kelime.png) — desktop UI buradan yukler.
# Not: Eskiden legacy/shared-assets/signs kopyasi kullaniliyordu; ayni dosyalar
# asl-web/assets/signs altinda byte-ayni oldugu icin tek kopyaya indirildi.
# Sign reference images; deduplicated to the single asl-web copy (was a
# byte-identical duplicate under legacy/shared-assets, ~11.7MB saved).
ASSET_SIGNS_DIR = os.path.join(PROJECT_ROOT, "asl-web", "assets", "signs")

# ==================== CIHAZ (PyTorch) ====================
def get_torch_device():
    """M4 Pro'da MPS, Kaggle'da CUDA, yoksa CPU kullanir."""
    if torch is None:
        return "cpu"
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")

DEVICE = get_torch_device()
TORCH_AVAILABLE = torch is not None

# ==================== MEDIAPIPE ====================
NUM_HANDS = 1
MIN_DETECTION_CONFIDENCE = 0.5
MIN_TRACKING_CONFIDENCE = 0.4
NUM_LANDMARKS = 21
NUM_FEATURES = NUM_LANDMARKS * 3  # 63 ozellik (x, y, z)
NUM_RAW_FEATURES = NUM_FEATURES   # ham landmark boyutu (63)
FEATURE_ENGINEERING_ENABLED = True # feature engineering varsayilan acik

# ==================== KAMERA ====================
CAMERA_INDEX = 0
CAMERA_WIDTH = 1280
CAMERA_HEIGHT = 720
TARGET_FPS = 30

# ==================== VERI TOPLAMA ====================
SAMPLES_PER_LETTER = 200        # her harf icin hedef ornek sayisi
COUNTDOWN_SECONDS = 3           # kayit oncesi geri sayim
COLLECTION_DELAY_MS = 50        # ornekler arasi bekleme (ms)
STATIC_LETTERS = list("ABCDEFGHIKLMNOPQRSTUVWXY")  # J ve Z haric
DYNAMIC_LETTERS = ["J", "Z"]
ALL_LETTERS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

# ==================== MODEL DOSYA YOLLARI ====================
# NOT: Bu yollar SADECE Python tarafi (asl-desktop legacy + scripts/tests) icindir.
# Aktif web urunu (asl-web/) bu config'i okumaz; kendi `asl-web/models/*.onnx` +
# `asl-web/data/*.json` runtime kontratlarini kullanir.
LETTER_MODEL_PATH = os.path.join(LETTER_MODELS_DIR, "letter_model.pkl")
LETTER_LABEL_MAP_PATH = os.path.join(LETTER_MODELS_DIR, "letter_label_map.json")
JZ_MODEL_PATH = os.path.join(JZ_MODELS_DIR, "jz_model.pt")
JZ_LABEL_MAP_PATH = os.path.join(JZ_MODELS_DIR, "jz_label_map.json")
# WORD_MODEL_PATH: LEGACY desktop 25-class BiGRU + Attention `.pt` modeli.
# Production web word model `asl-web/models/word_model.onnx` (50-class
# SignTransformer, 168D x 45 + mask) — TAMAMEN AYRI bir model. Bunu
# karistirma; asl-desktop/sequence_classifier yalniz bu legacy `.pt`'yi kullanir.
WORD_MODEL_PATH = os.path.join(WORD_V4_OUTPUT_DIR, "word_25_v4_holistic321_bigru_attention.pt")
WORD_LABEL_MAP_PATH = os.path.join(WORD_V4_OUTPUT_DIR, "word_25_v4_label_map.json")

# ==================== TAHMIN ====================
PREDICTION_SMOOTHING_WINDOW = 5  # majority voting icin frame sayisi (eskisi: 3)
CONFIDENCE_THRESHOLD = 0.78       # Kelime modu esigi (V4 Focal Loss modeliyle uyumlu)
LETTER_CONFIDENCE_THRESHOLD = 0.55  # Harf modu smoother esigi (daha toleranslı, dwell ile telafi edilir)
NEUTRAL_THRESHOLD = 0.2  # notr pozisyon esigi

# ==================== GUVENILIRLIK ====================
LANDMARK_QUALITY_THRESHOLD = 0.75   # MediaPipe handedness score esigi
WORD_STRIDE = 10                     # Sliding window adimi (eskisi: 15)
WORD_IDLE_RESET_FRAMES = 15          # Bu kadar idle frame sonrasi buffer temizle
DWELL_THRESHOLD = 20                 # Harf dwell-time frame sayisi (~0.6s)

# ==================== GATING ====================
MOTION_VARIANCE_THRESHOLD = 0.003   # Kelime modunda statik pozisyon reddi
ENTROPY_THRESHOLD = 0.85            # Normalize entropy esigi (ustunde guven dusur)
ENTROPY_PENALTY = 0.5               # Entropy esigi asildiginda guven carpani
VELOCITY_THRESHOLD = 0.05           # Hareket hizi esigi (normalize birim)

# ==================== KNN ====================
KNN_THRESHOLD = 0.94                # Cosine similarity esigi (kesin eslesme)
KNN_MAX_TEMPLATES = 50              # Harf basina maksimum template sayisi

# ==================== KAMERA HATA ====================
CAMERA_WARN_THRESHOLD = 30          # Uyari oncesi ardisik basarisiz frame
CAMERA_STOP_THRESHOLD = 150         # Kamerayi durdurma oncesi ardisik basarisiz frame

# ==================== TTS ====================
TTS_RATE = 150                      # Konusma hizi (kelime/dk)
TTS_VOLUME = 0.9                    # Ses seviyesi (0.0-1.0)
TTS_JOIN_TIMEOUT = 2.0              # Thread join timeout (saniye)

# ==================== HOLISTIC (Kelime Modu) ====================
HOLISTIC_MODEL_COMPLEXITY = 1  # 0=hafif, 1=orta (M4 Pro icin 1 yeterli)

# ==================== LSTM / DINAMIK TANIMA ====================
SEQUENCE_LENGTH = 30    # frame dizisi uzunlugu
JZ_CLASSES = 2          # J ve Z
WORD_CLASSES = 25       # hedef kelime sayisi (word_25_v4_label_map.json ile eslesmeli)
LSTM_HIDDEN_SIZE = 128  # LSTM/GRU gizli katman boyutu
LSTM_NUM_LAYERS = 2     # LSTM/GRU katman sayisi
LSTM_DROPOUT = 0.3      # dropout orani

# ==================== EGITIM ====================
TRAIN_BATCH_SIZE = 32
TRAIN_EPOCHS = 50
TRAIN_LR = 0.001
TRAIN_VAL_RATIO = 0.15
TRAIN_TEST_RATIO = 0.15
EARLY_STOPPING_PATIENCE = 10

# ==================== ON ISLEME ====================
AUGMENTATION_NOISE_STD = 0.02    # gaussian gurultu standart sapma
AUGMENTATION_ROTATION_RANGE = 45  # derece cinsinden maks rotasyon
AUGMENTATION_MULTIPLIER = 5      # her ornek icin augmented kopya sayisi
AUGMENTATION_SCALE_RANGE = 0.2   # olcek perturbasyonu (±%20)

# ==================== OGRENME KOCU ====================
SIMILARITY_THRESHOLD = 0.85   # cosine similarity esigi
FEEDBACK_DELAY = 1.5          # saniye cinsinden geri bildirim araligi
COACH_SUCCESS_THRESHOLD = 0.65       # harf modu başarı eşiği
WORD_COACH_SUCCESS_THRESHOLD = 0.50  # kelime modu — live ortamda daha toleranslı
COACH_SUCCESS_FRAMES = 60       # ~2s @ 30fps (her frame sayiliyor)

# ==================== ARAYUZ ====================
WINDOW_WIDTH = 1360
WINDOW_HEIGHT = 900
THEME = "dark-blue"

# ── Renk Paleti (Dark Mode) ──
COLOR_PRIMARY = "#4d8eff"
COLOR_PRIMARY_HOVER = "#3a7eff"
COLOR_PRIMARY_TEXT = "#adc6ff"   # Açık arka plan üzerinde primary metin rengi
COLOR_SUCCESS = "#4ae176"
COLOR_WARNING = "#ff9f0a"
COLOR_ERROR = "#ffb4ab"
COLOR_PURPLE = "#571bc1"         # Koç modu buton/container arka planı
COLOR_PURPLE_HOVER = "#6b33d4"
COLOR_PURPLE_TEXT = "#d0bcff"    # Koç modu açık metin rengi

COLOR_BG_LOWEST = "#0e0e11"      # En koyu zemin (overlay arka planları)
COLOR_BG_BASE = "#131316"
COLOR_BG_CARD = "#1f1f22"
COLOR_BG_ELEVATED = "#2a2a2d"
COLOR_BG_HOVER = "#353438"
COLOR_BORDER = "#2c2c2c"

COLOR_TEXT_PRIMARY = "#e4e1e6"
COLOR_TEXT_SECONDARY = "#c2c6d6"
COLOR_TEXT_TERTIARY = "#8c909f"
COLOR_TEXT_MUTED = "#5c5f6e"

# ── Font ──
FONT_FAMILY = "Inter"
PREDICTION_FONT_SIZE = 72        # Harf modu tahmin etiketi (jüride okunur)
PREDICTION_FONT_SIZE_WORD = 48   # Kelime modu tahmin etiketi

# ── Adaptive renk çiftleri (aydınlık_mod, karanlık_mod) ──
# CustomTkinter tuple formatı: (light, dark) — tema geçişinde otomatik değişir.
BG_BASE     = ("#f8f9fc", COLOR_BG_BASE)       # Temiz açık zemin
BG_CARD     = ("#ffffff", COLOR_BG_CARD)       # Beyaz kart
BG_ELEVATED = ("#ecedf2", COLOR_BG_ELEVATED)   # Buton/input zemin
BG_HOVER    = ("#dcdde5", COLOR_BG_HOVER)      # Hover efekti
BG_LOWEST   = ("#f0f1f6", COLOR_BG_LOWEST)     # Sayfa arka planı

TEXT_PRIMARY   = ("#1a1a2e", COLOR_TEXT_PRIMARY)    # Koyu lacivert
TEXT_SECONDARY = ("#2d2d44", COLOR_TEXT_SECONDARY)  # Okunur ikincil
TEXT_TERTIARY  = ("#5a5a7a", COLOR_TEXT_TERTIARY)   # Açıklama metinleri
TEXT_MUTED     = ("#8e8ea0", COLOR_TEXT_MUTED)      # Deaktif metinler

# ── Adaptive accent renkler (aydınlık_mod, karanlık_mod) ──
# Accent renkler light mode'da daha koyu/doygun olmalı (beyaz üzeri kontrast).
ACCENT_SUCCESS = ("#1a8f3c", COLOR_SUCCESS)    # Koyu yeşil / parlak yeşil
ACCENT_WARNING = ("#c47a00", COLOR_WARNING)    # Koyu turuncu / parlak turuncu
ACCENT_ERROR   = ("#c62828", COLOR_ERROR)      # Koyu kırmızı / açık pembe
ACCENT_PRIMARY = ("#1a5cd6", COLOR_PRIMARY)    # Koyu mavi / parlak mavi
ACCENT_PURPLE  = ("#7c3aed", COLOR_PURPLE)     # Mor (her iki temada okunur)
BORDER = ("#d0d1d9", COLOR_BORDER)             # Kart sınırı

# Kelime modeli kelime listesi — word_25_v4_label_map.json ile BIREBIR eslesmeli
# Google ASL Signs dataset'inden elle secilmis 25 gunluk hayat kelimesi.
#
# KAPSAM NOTU: Bu liste LEGACY desktop 25-class word modeli (`WORD_MODEL_PATH`,
# BiGRU+Attention) ve eski "ogrenme kocu" UI'i icindir. Production web 50-class
# word modeli (`asl-web/models/word_model.onnx`) bu config'i OKUMAZ; kendi
# `asl-web/data/word_labels.json` dosyasini kullanir (50 alfabetik kelime,
# bu 25'in superset'i).
DEFAULT_WORDS = [
    "bye", "child", "dad", "drink", "finish",
    "food", "give", "go", "happy", "hello",
    "home", "hungry", "look", "mom", "no",
    "open", "please", "sad", "sick", "sleep",
    "talk", "thankyou", "wait", "water", "yes",
]
