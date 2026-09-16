# data/

Lokal ham ve işlenmiş veri klasörü. **Bu klasör tarayıcı uygulamasının
parçası değildir** — sadece eğitim ve veri hazırlık scriptleri tarafından
kullanılır.

## Bu klasör ne işe yarar?

- Ham datasetleri tutar (ASL Alphabet, ASL_SemCom, MS-ASL, …)
- Bu datasetlerden çıkarılmış işlenmiş landmark CSV/NPZ dosyalarını tutar
- Sözlük/referans dosyaları gibi yardımcı statik kaynakları tutar

Boyutu büyüktür (~3 GB civarı) ve `.gitignore` ile versiyon kontrolünden
çıkarılır. Repo'yu klonlayan biri bu klasörü boş görebilir; üretim için
gerekli değildir.

## Ne zaman buraya bakılır?

- Harf modelini yeniden eğitirken (`scripts/model_training/train_static_letter_model.py`)
- Yeni bir ham dataset eklenirken
- Landmark çıkarma scriptleri çalıştırılırken (`scripts/data_preparation/`)

## İçindeki klasörler

| Alt klasör | İçerik |
|---|---|
| `raw/` | Orijinal datasetler (ASL Alphabet, ASL_SemCom, MS-ASL, MediaPipe_Processed_Asl, American Sign Language Dataset) |
| `processed/` | Landmark CSV ve NPZ dosyaları (extract scriptlerinin çıktısı) |
| `reference/` | Sözlük/referans yardımcı dosyalar |

## Web runtime için DEĞİL

`asl-web/` (tarayıcı uygulaması) bu klasörü kullanmaz. Tarayıcı sadece kendi
`asl-web/data/` klasöründeki JSON sözleşme dosyalarını okur (etiketler,
temperature, curriculum, vb.). Ham datasetlere tarayıcının ihtiyacı yoktur.

## Neye dokunurken dikkatli olunmalı?

- `processed/` çıktılarını silmeden önce extract scriptlerinin tekrar
  çalışabileceğini doğrula. Bazı `processed/` dosyaları saatlerce süren
  landmark çıkarmanın ürünü.
- `raw/` içindeki orijinal datasetlere dokunma — bunlar yeniden indirilebilir
  ama trafik/zaman maliyetlidir.
- Yeni bir dataset eklenirse `scripts/data_preparation/` altında ona uygun
  extract script'i de güncellenmelidir.

## İlgili dokümanlar

- [`scripts/data_preparation/README.md`](../scripts/data_preparation/README.md) — landmark çıkarma komutları
- [`docs/current/data-contract.md`](../docs/current/data-contract.md) — `asl-web/data/` JSON sözleşmesi (ayrı klasör)
- [`docs/current/project-structure.md`](../docs/current/project-structure.md) — repo katman rehberi
