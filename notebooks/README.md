# notebooks/

Final kelime modelinin eğitim ve sonuç notebook'ları. **Bu klasör production
modelinin kaynağıdır — dikkatsiz dokunma.**

## Bu klasör ne işe yarar?

`asl-web/` tarayıcı uygulamasının kullandığı 50 kelimelik SignTransformer
modeli buradan üretildi. `notebooks/results/` klasöründeki ONNX modeli ve
JSON dosyaları, web runtime'a **birebir kopyalandı** ve hash chain ile
provenance'ı izlenir.

## Ne zaman buraya bakılır?

- Kelime modelinin nasıl eğitildiğini anlamak için
- Yeniden eğitim gerektiğinde (Kaggle T4 GPU önerilir)
- Final 50 kelime export'unu doğrulamak için
- Deney sonuçlarını incelemek için (15 sistematik ablasyon notebook içinde)

## İçindekiler

| Dosya / Klasör | Ne içerir? |
|---|---|
| `train_word_model_final.ipynb` | Final SignTransformer eğitim notebook'u (Kaggle T4 GPU, 100 epoch, early stop ep63) |
| `kelime-modeli-results.ipynb` | Sonuç görselleştirme |
| `results/` | Final ONNX + label map + temperature + test sample (provenance kaynağı) |

`results/` klasörünün içeriği ve bunların `asl-web/` ile nasıl eşleştiği:

| `notebooks/results/` | → kopyalanan yer |
|---|---|
| `word_model.onnx` | `asl-web/models/word_model.onnx` |
| `word_to_idx.json` | `asl-web/data/word_labels.json` |
| `temperature.json` | `asl-web/data/temperature.json` |
| `per_word_stats.json` | `asl-web/data/per_word_stats.json` |
| `confusion_pairs.json` | `asl-web/data/confusion_pairs.json` |
| `curriculum.json` | `asl-web/data/curriculum.json` |
| `test_sample.json` | `asl-web/data/test_sample.json` |
| `final_model.pt` | (PyTorch checkpoint, runtime kullanmaz; provenance) |
| `manifest.json` | Export manifest |
| `classification_report.txt` | Per-class precision/recall/f1 |
| `all_experiment_results.json` | 15 sistematik deneyin sonucu |
| `Grafikler/` | 10 PNG (deney + confusion matrix + F1) |

## Eski deneyler nerede?

Eski numbered deney notebook'ları (V2/V3/V4 vb.) `legacy/old_notebooks/`
altındadır. Bu klasör yalnızca **final** içindir.

## Yeniden eğitim adımları

1. `train_word_model_final.ipynb`'u Kaggle T4 GPU'da çalıştır
2. Çıktılar `notebooks/results/` altında oluşur
3. Web kopyalarını manuel olarak güncelle (yukarıdaki tablo)
4. Hash chain doğrula:
   ```bash
   python3 scripts/validation/check_runtime_assets.py
   python3 scripts/validation/verify_project_assets.py
   ```
5. Tarayıcıda offline test: `give @ %7.6` çıkmalı

## Neye dokunurken dikkatli olunmalı?

- `results/` içindeki **herhangi** bir dosya değişirse, `asl-web/` ile
  hash chain drift eder. Mutlaka validation çalıştır.
- Notebook'u re-run ederken seed'leri korumak best-effort; tam reproducibility
  garantisi yoktur.
- `notebooks/` üst seviyesinde başka bir notebook varsa, bu final
  pipeline'a dahil olduğu varsayılmasın — sadece `train_word_model_final.ipynb`
  production kaynağıdır.

## İlgili dokümanlar

- [`docs/current/model-contract.md`](../docs/current/model-contract.md) — kelime modeli ONNX I/O sözleşmesi
- [`docs/current/data-contract.md`](../docs/current/data-contract.md) — provenance hash chain detayı
- [`models/README.md`](../models/README.md) — harf modeli kaynağı (ayrı klasör)
- [`legacy/old_notebooks/README.md`](../legacy/old_notebooks/README.md) — eski deney arşivi
