# scripts/data_preparation

Veri hazirlama ve landmark cikarma araclari.

- `extract_static_letter_landmarks.py`: statik harf gorsellerinden 21 el landmark'i cikartir ve CSV yazar.
- `merge_static_letter_datasets.py`: statik harf CSV'lerini birlestirir, dengeler ve train/test CSV uretir.
- `download_msasl_videos.py`: MS-ASL hedef kelime videolarini indirir.
- `extract_msasl_landmarks.py`: MS-ASL videolarindan holistic landmark parquet uretir.
- `run_static_letter_extraction.sh`: statik harf cikarma + merge pipeline'i.

Bu klasor ham/islenmis veriye dokunur; model dosyasi yazmaz.
