# ASL Assistant

[Canlı demo](https://asl-assistant.netlify.app/) · [Başlangıç rehberi](docs/getting-started.tr.md) · [Dokümantasyon](docs/README.md) · [Teknik rapor](TECHNICAL_REPORT.tr.md) · [English](README.md)

ASL Assistant, tarayıcıda çalışan bir işaret dili asistanıdır. Amerikan İşaret
Dili (ASL) harflerini kameradan canlı olarak tanır ve metne dönüştürür; 50
izole ASL kelimesi için de deneysel bir modu vardır. El, yüz ve gövde
landmark'ları MediaPipe ile bulunur ve ONNX modelleriyle sınıflandırılır. Bunun
tamamı sayfanın içinde olur: uygulama sunucusu yoktur ve kamera görüntüsü
cihazdan çıkmaz. Arayüz Türkçedir.

> Canlı demo bu depodan daha eski bir sürümü çalıştırıyor; aşağıdaki arayüz
> henüz yayında değil.

![Dizüstü bilgisayarda harf ekranı, açık tema. Koyu kamera alanı ziyaretçiden bir ASL harfi göstermesini istiyor ve Kamerayı aç ile Kamerasız dene düğmelerini sunuyor; yan kartlarda en olası sonuçlar, harf referansı ve klavye kısayolları var; altta metin şeridi ile Sil, Boşluk ve Ekle düğmeleri duruyor.](docs/assets/screenshots/letter-laptop.png)

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/assets/screenshots/letter-phone.png" width="240" alt="Telefonda harf ekranı, açık tema: Kamerayı aç düğmesiyle kamera alanı, altında metin şeridi ile Sil, Boşluk ve Ekle düğmeleri."><br><sub>Telefonda harf ekranı</sub></td>
    <td align="center" width="33%"><img src="docs/assets/screenshots/letter-phone-dark.png" width="240" alt="Aynı harf ekranı, telefonda koyu temada."><br><sub>Koyu tema</sub></td>
    <td align="center" width="33%"><img src="docs/assets/screenshots/camera-help-phone.png" width="240" alt="Kamera izni reddedildikten sonra kamera alanı: “Kamera izni verilmedi” başlığı, Yeniden dene ve Kamerasız dene düğmeleri, iPhone Safari ve Chrome için açılmış adım adım yardım."><br><sub>Kamera izni reddedildiğinde yardım</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/assets/screenshots/word-laptop.png" width="100%" alt="Dizüstü bilgisayarda kelime ekranı: kamera alanı ziyaretçiyi, ancak onayladıktan sonra metne eklenecek bir ASL kelimesi kaydetmeye çağırıyor; yan kartlarda sonuçlar, kelime referansı, önce denenecek kelimeler ve aranabilir 50 kelimelik liste var; alt çubukta kaydetme, yeniden kaydetme ve metne ekleme düğmeleri duruyor."><br><sub>Kelime ekranı (deneysel)</sub></td>
    <td align="center" width="50%"><img src="docs/assets/screenshots/model-test-laptop.png" width="100%" alt="Bütün harf örnekleri çalıştırıldıktan sonra Model Test: 24 örnekten 24'ünün doğru olduğunu ve medyan sürenin 0,5 ms olduğunu söyleyen bir özet, örneklerin eğitim verisinin ayrılmış kümesinden geldiğini belirten bir not ve örnek, beklenen etiket, tahmin, güven, süre ve sonuç sütunlarından oluşan bir tablo."><br><sub>Harf örnekleri gerçekten çalıştırıldıktan sonra Model Test</sub></td>
  </tr>
</table>

Ekran görüntüleri kamerasız bir headless Chrome'da alındı; bu yüzden hiçbir
ekranda canlı tanıma yok. Model Test sonuçları, depodaki harf örneklerinin
yayımlanan modelden gerçekten geçirilmesiyle elde edildi; neyi ölçtükleri
[Nasıl çalışır](#nasıl-çalışır) bölümünde.

## Neler yapar?

| Mod (uygulamadaki adı) | Ne yapar |
|---|---|
| Harf | 24 statik ASL harfini kameradan canlı tanır. Space gösterilen harfi metne ekler, Enter boşluk bırakır, Backspace siler. Metin kopyalanabilir ya da sesli okunabilir. Ana mod budur. |
| Kelime (deneysel) | Tek bir izole işareti kaydeder ve 50 kelime içinden en olası üçünü gösterir. Siz onaylamadan metne hiçbir şey eklenmez. |
| Koç (erken aşamada) | Seçilen bir harf ya da kelimeyle pratik. Harf, sabit tutulduğunda sayılır; ilerleme cihazda saklanır. |
| Model Test (*Kamerasız dene*) | Depodaki örnekleri kamera olmadan aynı modellerden geçirir, tek tek ya da hepsini birden; tahmini, güveni ve süreyi gösterir. |
| QR (*Telefonda aç*) | Yayındaki harf, kelime ya da Model Test ekranını telefonda açan bir QR kodu. |
| Proje (*Nasıl çalışır*) | Modellerin ve sınırlarının kısa özeti. |

## Nasıl çalışır

```text
kamera karesi (sayfada kalır)
  -> MediaPipe Tasks Vision: el, gövde ve yüz landmark'ları
  -> harf:   21 el landmark'ı, sol el aynalanır, yumuşatılır  -> 93 özellik
             -> ONNX'e aktarılmış LightGBM                      -> 24 harf
  -> kelime: en çok 45 kare için 321 boyutlu kareler (eller, yüz, gövde)
             -> 45 x 168 özellik + 45 değerli dolgu maskesi
             -> ONNX'e aktarılmış SignTransformer               -> 50 kelimeden ilk 3
  -> ONNX Runtime Web (WebAssembly)
  -> kullanıcı harfi ekler ya da kelimeyi onaylar
```

Uygulama düz HTML, CSS ve JavaScript'tir. Tarayıcı klasik `<script>`
dosyalarını sabit bir sırayla yükler; framework, bundler, transpiler ya da
derleme adımı yoktur ve `asl-web/` içindeki dosyalar yayımlanan dosyaların
kendisidir. ONNX Runtime ve QR kütüphanesi jsDelivr'dan bütünlük (SRI)
hash'leriyle, MediaPipe jsDelivr'dan, landmark modelleri Google Cloud
Storage'dan gelir. `asl-web/models/` içindeki modeller yalnızca bir şey onlara
ihtiyaç duyduğunda iner; kamerayı hiç açmayan bir ziyaretçi hiç model indirmez.

Kayıtlı sonuçlar, [`asl-web/data/model-card.json`](asl-web/data/model-card.json) dosyasından:

| | Harf modeli | Kelime modeli |
|---|---|---|
| Model | LightGBM | SignTransformer encoder, 446.195 parametre |
| Sınıf | 24 statik harf (J ve Z hareket gerektirdiği için yok) | 50 izole işaret |
| Girdi | 93 tasarlanmış özellik | 45 × 168 özellik ve maske |
| Kayıtlı test sonucu | 8.245 ayrılmış satırda %99,35 doğruluk | 3.918 kayıtta %71,92 doğruluk, 0,714 macro-F1 |
| Ayırma | Landmark satırları üzerinden rastgele; kişiden bağımsız **değil** | Kişiden bağımsız; test kümesi eğitimde görülmemiş 4 kişi |
| Dosya | 13,2 MB ONNX, gzip'li olarak 2,2 MB sunulur | 1,9 MB ONNX |

İki sonucu sınırlarıyla birlikte okuyun. Harf ayrımı birleştirilmiş görüntü
veri setlerinden rastgele seçildi; aynı kişinin neredeyse aynı kareleri
ayrımın iki tarafında da bulunabilir, bu yüzden %99,35 yeni bir kişi için
başarıyı büyük olasılıkla olduğundan yüksek gösterir. Kelime sonucu, ayrılmış
kişilerin izole işaretleri içindir, sürekli işaretleşme için değil; canlı
güven çoğu zaman çok daha düşüktür. Model Test ekran görüntüsündeki 24'te 24,
her harf için ayrılmış bir satırla yapılan bir regresyon kontrolüdür, bir
değerlendirme değildir. Özellik sırası, ONNX sözleşmeleri ve değerlendirmenin
tam kapsamı [Models and data](docs/models-and-data.md) belgesindedir.

## Teknolojiler ve araçlar

| Alan | Kullanılanlar |
|---|---|
| Tarayıcı çalışma zamanı | [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) 0.10.18 (el, gövde ve yüz landmark modelleri), WebAssembly üzerinde [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.22.0, QR kodları için [kjua](https://github.com/lrsjng/kjua) 0.9.0, metni sesli okumak için Web Speech |
| Arayüz | HTML, CSS cascade layer'ları ve klasik script'ler, derleme adımı olmadan; kendi sunucusundan [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) ve [Mono](https://github.com/googlefonts/atkinson-hyperlegible-next-mono); JSDoc türleri TypeScript 5.9.3 ile dosya üretmeden denetlenir (yalnızca geliştirmede) |
| Makine öğrenmesi | Python 3.12, LightGBM, PyTorch, onnx ve onnxruntime, landmark çıkarmak için MediaPipe, scikit-learn; sürümler [`requirements.txt`](requirements.txt) içinde sabitlenmiştir. Kelime modeli bir Kaggle notebook'unda tek bir T4 GPU ile eğitildi. |
| Test | Gerçek tarayıcı script'lerini yükleyen bir `node:vm` düzeneğiyle `node:test`, pytest, npm bağımlılığı olmadan DevTools Protocol üzerinden headless Chrome kontrolleri, Ruff |
| Barındırma | Netlify, elle yüklenen statik site; yanıt başlıkları `asl-web/_headers` içinde |

## Mühendislik uygulamaları

- **Başarısız olduğu gösterilmiş testler.** En önemli kuralların her birinin,
  bilerek bozulmuş bir kopyaya karşı çalıştırılıp başarısız olduğu görülmüş
  bir davranış testi vardır: kullanıcı onaylamadan kelime eklenmez, kelime
  maskesi ters çevrilmez, kareler modele sırasıyla gider ve kamera ekranından
  çıkınca kamera serbest bırakılır. [Headless Chrome
  kontrollerinin](tests/browser/README.md) de bilinçli hatalarda başarısız
  olduğu aynı yolla gösterildi. Yeni testler kaynak metni değil davranışı denetler
  ve yalnızca sistem sınırlarını taklit eder: kamera, ağ, saat, MediaPipe ve
  ONNX Runtime. Bazı eski testler hâlâ kaynak metni eşler; her biri, yerine
  gelen testin aynı hataları yakaladığı gösterildiğinde kaldırılır.
- **Python ve tarayıcı aynı özellikleri hesaplar.** Özellik mühendisliği eğitim
  için Python'da (`asl-features/`), uygulama için JavaScript'te yaşar. Yanlış sıradaki
  bir vektör de çalışır ve sessizce anlamsız tahminler üretir; bu yüzden
  `make parity` aynı deterministik girdileri ikisine de verir ve harfler ile
  kelimeler için 1e-4 içinde uyuşmalarını ister. Yayımlanan her model ayrıca
  kaynağıyla SHA-256 üzerinden ve beklenen ONNX girdi ve çıktılarıyla
  karşılaştırılır.
- **Yayın envanteri.** Site, `asl-web/` klasörü barındırma arayüzüne
  sürüklenerek yayımlanır ve diskte ne varsa yüklenir. `make deploy-check` bu
  yüklemenin taşıyacağı her dosyayı listeler; Git'in yok saydığı ya da gizli
  dosyalarda, bilinmeyen dosya türlerinde ve yeniden dağıtılamayan veriden
  türetilmiş yerel örneklerde başarısız olur.
- **Gizlilik.** Sunucu, hesap ya da analiz aracı yoktur.
  Görüntü sayfada işlenir; kaydedilmez ve hiçbir yere gönderilmez. Tarayıcı
  `localStorage` içinde üç şey tutar: tema, metin ve koç ilerlemesi. CDN
  script'leri tam sürüme ve bütünlük hash'lerine sabitlenmiştir.

## Hızlı başlangıç

Uygulamayı çalıştırmak için herhangi bir statik dosya sunucusu yeterlidir;
hiçbir şey kurmanız gerekmez:

```bash
make web               # asl-web/ klasörünü http://localhost:8080 adresinde sunar
```

Kamera `localhost` ya da HTTPS üzerinde çalışır, `file://` ile açılan bir
sayfada çalışmaz. Modelleri kamerasız denemek için **Kamerasız dene** (Model
Test) ekranını açın.

Kod üzerinde çalışmak için (Python 3.12 ve Node 24; Conda dosyası ikisini
birden kurmanın bir yoludur):

```bash
conda env create -f environment.yml
conda activate asl-assistant
make setup             # sabitlenmiş bağımlılıklar ve yerel paketler
make check             # lint, testler, doğrulama, parity, tür denetimi (önce bir kez npm ci)
make browser-check     # headless Chrome kontrolleri; Chrome gerekir
make deploy-check      # asl-web/ her yüklenmeden önce
```

`venv`, Windows, tüm `make` hedefleri, yayın ve sorun giderme için
[Başlangıç rehberine](docs/getting-started.tr.md) bakın.

## Depo yapısı

```text
asl-web/       uygulama: index.html, css/, js/ (core, media, ml, services, ui), models/, data/
asl-features/  harf ve kelime için Python özellik mühendisliği; iki pipeline için de doğruluk kaynağı
asl-desktop/   Python ile yazılmış eski masaüstü prototipi, çalışır durumda tutuluyor
scripts/       veri hazırlama, eğitim, örnek dışa aktarma, doğrulama
tests/         tarayıcı birim testleri (tests/web), headless Chrome kontrolleri, Python ve depo testleri
notebooks/     kelime modeli eğitim kayıtları ve sonuçları
models/        seçilmiş model dosyaları ve meta verileri
docs/          mimari, başlangıç, modeller ve veri, projenin geçmişi
```

[Dokümantasyon dizini](docs/README.md), tarayıcı mimarisinden projenin
geçmişine kadar hangi sorunun hangi belgede yanıtlandığını gösterir.

## Sınırlamalar

- Uygulama henüz gerçek bir telefonda denenmedi. Otomatik kontroller, sanal
  kamerayla headless masaüstü Chrome'da çalışır; iOS Safari ve Android Chrome
  denenmedi.
- Kelime modeli deneyseldir. İzole işaretleri tanır, sürekli işaretleşmeyi
  değil; güven eşiğinin altındaki bir sonuç onaylanamaz.
- Harf modelinde 24 statik harf vardır; J, Z ve "işaret yok" sınıfı yoktur.
  %99,35'lik sonuç, eğitimle aynı kişileri paylaşan bir ayırmadan gelir;
  modelin hiç görmediği ellerde %69 ölçüldü, en zayıfı yumruk harfleri (M, N,
  T, S, E, A). Ayrıntı: [Models and data](docs/models-and-data.md).
- Uygulamadaki kelime referans görselleri yeniden çiziliyor; o zamana kadar
  bir el şeklini standart bir ASL sözlüğüyle karşılaştırın.
- İçerik Güvenliği Politikası (CSP) yalnızca raporlama modunda. Yayındaki
  sitede gerçek bir tarayıcıda okunduktan sonra zorunlu hâle getirilecek.
- İlk ziyaret ağ bağlantısı ister: ONNX Runtime ve MediaPipe herkese açık
  CDN'lerden gelir; ilk harf oturumunda yaklaşık 17 MB.
- Harf modelini ONNX'e dönüştüren komut depoda yok.

## Gelecek çalışmalar

- Gerçek cihazlarda, gerçek eller ve ışıkla iOS Safari ve Android Chrome
  üzerinde denemek.
- Harf modelini hiç görmediği kişilerle değerlendirmek.
- Daha çok kelime eklemek ve izole işaretlerden sürekli işaretleşmeye geçmek.
- Kelime kelime değil, cümle düzeyinde çeviri yapmak.
- Modelleri siteyi yeniden yayımlamadan cihazda güncellemek.
- CSP'yi zorunlu hâle getirmek.
- Progressive web app (PWA) olarak internetsiz çalışmak.
- Erişilebilirliği ve faydayı Sağır kullanıcılarla birlikte gözden geçirmek.

## Lisans

Kaynak kod ve eğitilmiş model dosyaları
[PolyForm Noncommercial License 1.0.0](LICENSE) ile yayımlanır. Kişisel, eğitim
ve araştırma amaçlı kullanım serbesttir; ticari kullanım için telif hakkı
sahibinin izni gerekir.

`asl-web/models/` ve `models/` altındaki model dosyaları yazılımın parçası
sayılır; aşağıda listelenen eğitim verisi koşulları da geçerlidir. Bu proje,
bir veri seti lisansının (örneğin ana harf kaynağındaki GPL-2.0 etiketinin)
eğitilmiş ağırlıklara geçip geçmediği konusunda bir iddiada bulunmaz.
Kullanımınız için kesinlik gerekiyorsa kaynak koşullarını kontrol edin ya da
buradaki betiklerle kendi modelinizi eğitin. `.pkl` ve `.pt` dosyaları Python
pickle biçimindedir; yalnızca güvendiğiniz bir kopyadan yükleyin.

<a id="data-and-attribution"></a>

## Veri ve atıf

Ham veri setleri bu depoda yoktur. Her kaynağın rolü, ayırma boyutları ve
dışarıda bırakılanlar
[Models and data](docs/models-and-data.md#training-data-and-environments)
belgesinde, Git dışında kalanlar [veri çalışma alanında](data/README.md)
listelenir.

| Model | Kaynak | Koşullar |
|---|---|---|
| Harf | [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet), Akash Nagaraj, 2018, [doi:10.34740/KAGGLE/DSV/29550](https://doi.org/10.34740/KAGGLE/DSV/29550) | GPL-2.0 (sağlayıcının etiketi) |
| Harf | [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset), Ayush Thakur | CC0 1.0 |
| Harf | [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) ile ilişkili yerel `ASL_SemCom` görsel alt kümesi (54.961 landmark satırının 1.580'i) | Kaydedilmemiş; görseller dağıtılmaz |
| Kelime | [Google - Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs) yarışma verisi (Kaggle, 2023); sağlayıcılar Deaf Professional Arts Network ve Georgia Institute of Technology | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), yarışma kurallarına tabi |

Veride yapılan değişiklikler: harf görselleri MediaPipe el landmark'larına,
ardından 93 tasarlanmış özelliğe indirgendi; kelimelerde 250 işaretten 50'si
seçildi ve her landmark dizisi 168 özellikli 45 kareye yeniden örneklendi.
Yayımlanan modeller yalnızca öğrenilmiş parametreleri içerir; görselleri,
kayıtları ya da landmark tablolarını içermez. 24 Model Test harf örneği,
ayrılmış landmark satırlarından alınmış tekil 93 özellikli vektörlerdir: 23'ü
ASL Alphabet'ten, K örneği `ASL_SemCom` alt kümesinden gelir
([ayrıntılar](docs/models-and-data.md#model-test-fixture-contract)).

Yarışma kuralları verinin her amaçla kullanılmasına izin verir (madde 7.A),
ama yeniden dağıtılmasını yasaklar (madde 7.B); ikisi çatıştığında kurallar
CC BY 4.0 lisansından önce gelir. Bu yüzden depo eğitilmiş kelime modelini ve
toplu sonuçları yayımlar, landmark verisi yayımlamaz: yarışma verisinden
üretilen Model Test kelime örnekleri yerelde kalır, yayımlanan kelime örneği
sentetiktir.

Üçüncü taraf yazılımlar:

| Bileşen | Sürüm | Lisans | Nasıl kullanılıyor |
|---|---|---|---|
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) ve Google'ın el, gövde ve yüz landmark modelleri | 0.10.18 | Apache-2.0 | Kod jsDelivr'dan, modeller Google Cloud Storage'dan yüklenir; depoda dağıtılmaz |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | 1.22.0 | MIT | jsDelivr'dan yüklenir; depoda dağıtılmaz |
| [kjua](https://github.com/lrsjng/kjua) | 0.9.0 | MIT | QR ekranı için jsDelivr'dan yüklenir; depoda dağıtılmaz |
| [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) ve [Atkinson Hyperlegible Mono](https://github.com/googlefonts/atkinson-hyperlegible-next-mono) | Sabitlenmedi | SIL Open Font License 1.1 | Latin ve Türkçe karakterlere indirgenmiş hâlleri lisanslarıyla birlikte `asl-web/assets/fonts/` içinde dağıtılır |
| [ASL harf kartı](https://commons.wikimedia.org/wiki/File:Asl_alphabet_gallaudet.svg); Ds13, Gallaudet yazı tipinden; Marnanel vektörleştirdi | 2004 SVG, Commons'ta güncellendi | Yazarı tarafından kamu malına bırakıldı (yazı tipinin kendisi © 1991 David Rakowski) | 26 harfe kırpılarak `asl-web/assets/signs/letters.png` olarak çizildi; harf ekranının referansı |

`asl-web/data/asl_video_links.json` içindeki işaret videosu bağlantıları
üçüncü taraf YouTube videolarına gider; videolar sahiplerine aittir.
