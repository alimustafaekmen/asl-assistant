# scripts/validation

Proje saglik kontrolleri ve web dogrulama yardimcilari.

- `verify_project_assets.py`: dataset, model ve gerekli cikti dosyalarini raporlar.
- `generate_word_onnx_test_sample.py`: final kelime ONNX modeli icin Python/Browser parity sample'i uretir.

`generate_word_onnx_test_sample.py` eksik paketleri otomatik kurmaz; onnxruntime yoksa durup acik kurulum komutu verir. Bu, demo makinesinde beklenmeyen network/pip yan etkilerini engeller.
