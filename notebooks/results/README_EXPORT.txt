ASL Word Model Export Package
=============================

Bu zip dosyasi train_word_model_final.ipynb Kaggle run'i sonunda otomatik uretilir.
Tum dosyalar ayni run'a aittir; zip whitelist ile olusturuldugu icin eski/yanlis PNG dosyalari eklenmez.

Final model
-----------
- Model: SignTransformer
- Sekans stratejisi: padmask45
- Feature: 1E_compact (168D)
- Sekans uzunlugu: 45
- Mask input: True
- Test accuracy: 0.7192
- Test macro F1: 0.7140
- Best val F1: 0.8029
- Temperature T: 0.9854
- ONNX boyutu: 1.77 MB
- ONNX export: var

Metriklerin kisa yorumu
-----------------------
- Test macro F1: 50 kelimeyi esit agirlikta degerlendirir; ana karar metrigidir.
- Test accuracy: Genel dogruluk oranidir; kelime bazli zorluklari tek basina gostermez.
- Best val F1: Egitim sirasinda en iyi model agirliginin secildigi noktayi gosterir.
- Temperature T: Model guven skorlarini daha gercekci yapmak icin kullanilir.
- ECE: Guven skoru ile gercek dogruluk arasindaki farki olcer; dusmesi olumlu kabul edilir.

Web entegrasyonu
----------------
1. word_model.onnx varsa ONNX Runtime Web ile yukle; yoksa ONNX export adimini internet olan ortamda tekrar calistir.
2. MediaPipe landmark ciktisindan her frame icin secilen feature builder mantigini uygula: 1E_compact (168D).
3. Kelime modu icin secilen sekans uzunlugunda frame hazirla; padmask45 kazanirsa mask input'u da verilir.
4. ONNX model ham skorlar, yani logits uretir.
5. Logits cikisini temperature.json icindeki T ile kalibre et: logits / T.
6. Softmax ile kelime olasiliklarini hesapla.
7. word_to_idx.json ile cikti indekslerini kelimeye cevir.
8. per_word_stats.json, curriculum.json ve confusion_pairs.json web tarafinda UI/coach geri bildirimi icin kullanilir.

Dosya gruplari
--------------
- Model: word_model.onnx, final_model.pt
- Web JSON: temperature.json, word_to_idx.json, per_word_stats.json, curriculum.json, confusion_pairs.json
- Rapor JSON/metin: all_experiment_results.json, classification_report.txt, manifest.json
- Grafikler: 01_kelime_dagilimi.png, 02_sekans_uzunluk.png, 03_feature_ablasyonu.png, 03_sekans_karsilastirma.png, 04_model_karsilastirma.png, 05_full_training_egrileri.png, 06_kelime_bazli_f1.png, 07_confusion_matrix.png, 08_tum_deneyler_ozet.png, 09_confusion_top_pairs.png

Grafiklerin anlami
------------------
01_kelime_dagilimi.png: Secilen 50 kelimenin ornek sayilarini gosterir. Veri dengesi buradan okunur.
02_sekans_uzunluk.png: Videolarin frame uzunlugunu gosterir. Sekans stratejisi kararina dayanak olur.
03_feature_ablasyonu.png: 6 feature setinin validation ve test F1 sonuclarini gosterir.
03_sekans_karsilastirma.png: fixed30, padmask45 ve motion stratejilerini karsilastirir.
04_model_karsilastirma.png: Model F1, parametre, egitim egrisi ve inference hizi bilgilerini birlikte gosterir.
05_full_training_egrileri.png: Final egitimde loss ve validation metriklerinin gidisatini gosterir.
06_kelime_bazli_f1.png: Hangi kelimelerin kolay veya zor oldugunu gosterir.
07_confusion_matrix.png: Hangi kelimenin hangi kelimeyle karistigini gosterir.
08_tum_deneyler_ozet.png: Deney zincirinin genel etkisini tek grafikte ozetler.
09_confusion_top_pairs.png: En cok karisan kelime ciftlerini okunabilir liste olarak gosterir.
