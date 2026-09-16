# Harf Modeli Ciktilari

Bu klasor notebook ciktilari icin degil, statik harf modeli egitim scripti icindir.

Kaynak:

- `scripts/model_training/train_static_letter_model.py`

Aktif eski Python/masaustu harf modeli:

```text
letter_model.pkl          LightGBM, 24 sinif, 93D feature
letter_label_map.json     Harf -> index eslemesi
letter_model_meta.json    Model metadata
```

ONNX duplicate/export kayitlari:

```text
onnx_exports/
  letter_model_static_24_web_duplicate.onnx   # eski ZipMap export
  letter_model_static_24_web_no_zipmap.onnx   # aktif web export
```

Web runtime'in kullandigi aktif ONNX kopyasi `asl-web/models/letter_model.onnx` altindadir.
Aktif kaynak `letter_model_static_24_web_no_zipmap.onnx` dosyasidir; bu export
`probabilities` cikisini `tensor(float)[N,24]` olarak verir ve tarayicida gercek
top-3 harf olasiliklarinin okunmasini saglar.
