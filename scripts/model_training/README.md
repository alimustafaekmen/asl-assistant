# scripts/model_training

Legacy Python model egitim komutlari.

- `train_static_letter_model.py`: 24 statik harf icin LightGBM/RF/XGBoost/MLP/Conv1D karsilastirmasi ve model kaydi.
- `train_dynamic_jz_model.py`: J/Z dinamik harfleri icin kamera verisi toplama ve LSTM egitimi.

Cikti kurali:

- Harf modeli `models/letter/` altina yazilir.
- J/Z modeli `models/letter/dynamic_jz/` altina yazilir.
- 50 kelime final web modeli bu klasorden degil, `notebooks/train_word_model_final.ipynb` sonuc paketinden gelir.
