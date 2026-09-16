# UI/UX Fix V3 — Ekran Akışı ve Mod Bazlı Deneyim

Bu sürüm, önceki görsel düzenlemenin eksik bıraktığı ürün akışı problemlerini düzeltir.

## Değişen ana kararlar

- Harf, Kelime ve Koç artık aynı sağ paneli paylaşan tek ekran gibi değil; mod bazlı içerikler gösterir.
- Kamera alanı büyütüldü. Harf ve kelime modlarında ana iş alanı kamera + sonuçtur.
- Harf ekle davranışı artık keyboard event taklidiyle değil, uygulamanın kendi `acceptPrediction()` fonksiyonuyla yapılır. Böylece çift ekleme sorunu engellenir.
- Koç hedefleri Harfler / Kelimeler olarak ayrıldı.
- Her modda referans görsel ve video rehber bağlantısı bulunur.
- Kelime Pratik panelinde jüri için kolaylaştırıcı alanlar var:
  - modelin rahat algıladığı kelimeler,
  - dikkatli gösterilecek kelimeler,
  - sık karışan çiftler,
  - kalite ipuçları.

## Görsel referans stratejisi

Güncel asset yapısı harf ve kelime domainlerini ayrı ele alır:

- `assets/signs/letters.png`
- `assets/signs/word-1.png`
- `assets/signs/word-2.png`
- `assets/signs/word-3.png`
- `assets/signs/word-4.png`
- `assets/signs/word-5.png`
- `assets/signs/kelime.png` (legacy/genel poster)

Kelime referansı artık tek geniş poster yerine 5 dikey sayfadan oluşan
galeriyle gösterilir. Bu, yeni görsellerin yaklaşık `1055×1491` boyutuna
daha uygundur; kullanıcı sayfa butonlarıyla geçiş yapar ve mobilde görsel
taşması azalır.

Gelecekte ideal yapı:

- harfler için ayrı kart görselleri,
- 50 kelime için kelime veya kategori bazlı ayrı görseller,
- `asset-index.json` ile her hedefe görsel ve video eşlemesi.

## Video rehber

Masaüstü uygulamasındaki video rehber yaklaşımı web'e taşındı. Web tarafı önce
`asl-web/data/asl_video_links.json` dosyasındaki sabit linkleri okur; hedef için
link yoksa YouTube arama fallback'i üretir:

- Harf hedefi: genel `alphabet_video` linki veya `ASL letter A hand sign tutorial`
- Kelime hedefi: `words.water` benzeri sabit link veya `ASL water sign tutorial`
- Genel harf modu: `ASL alphabet hand signs tutorial`

Bu yüzden video link dosyası varsa kullanıcı doğrudan rehber videoya gider,
eksik hedeflerde ise uygulama kırılmadan arama sonucuna düşer.

## Test checklist

1. `make web`
2. Hard reload
3. Giriş ekranı → Harf Çeviri
4. Kamera alanı yeterince büyük mü?
5. Harf ekle tek ekliyor mu?
6. Boşluk ve son harfi sil state ile uyumlu mu?
7. Koç ekranında Harfler/Kelimeler ayrımı çalışıyor mu?
8. Referans görsel ve video rehber her modda doğru mu?
9. Kelime Pratik panelinde önerilen/riskli/karışan kelimeler görünüyor mu?
10. `make health`

---

## V4 Düzeltme Notları

Bu sürüm, canlı testte görülen 4 ana problemi hedefler:

1. **Kamera alanı küçük görünüyordu.**
   - Desktop grid oranı kamera lehine büyütüldü.
   - Sağ panel daha kompakt tutuldu.
   - Kamera minimum yüksekliği artırıldı.

2. **Harf ekle çift ekleme yapabiliyordu.**
   - Buton artık klavye Space event'i taklit etmez.
   - `acceptPrediction(true)` doğrudan çağrılır.
   - Aynı hedefin 350 ms içinde tekrar eklenmesini önleyen küçük debounce eklendi.

3. **Koç kelime hedefi taşma/üst üste binme yapıyordu.**
   - Koç kartına `data-target-type="letter|word"` verilir.
   - Kelime hedeflerinde büyük kare harf kutusu yerine esnek, sığan kelime etiketi kullanılır.
   - Metin daha profesyonel hale getirildi: “benimle konuşur” gibi cümleler yerine hedef/koşul dili kullanıldı.

4. **Kelime modunda yüz/omuz/kol landmarkları görünmüyordu.**
   - `camera.js` overlay çizimi kelime ve kelime-koç modlarında kritik pose/face noktalarını gösterir.
   - Full face mesh çizilmez; sadece düşük maliyetli kritik noktalar çizilir.
   - Harf modunda kalabalık olmaması için yüz/pose overlay kapalı kalır.

### Desktop video link uyumu

Desktop uygulama `REFERENCE_DIR/asl_video_links.json` dosyasını okuyarak şu yapıyı kullanır:

```json
{
  "alphabet_video": "...",
  "words": {
    "water": "..."
  }
}
```

Web tarafı da aynı yapıyı `asl-web/data/asl_video_links.json` yolunda arar. Dosya yoksa hedefe göre YouTube arama linkine düşer. Gerçek linkler taşınırsa web otomatik olarak birebir linkleri kullanır.

---

## V5 Model Test Sadeleştirme Notları

Jüri sunumu için Model Test ekranı teknik ama sade bir akışa indirildi:

- Ekran artık üç net alana ayrılır: **Girdi**, **Sonuç**, **Fixture bilgisi**.
- Tahmin sonucu büyük bir “Tahmin” alanında gösterilir; beklenen etiket, güven skoru ve süre ikincil metrik olarak kalır.
- JSON şema bilgisi açıkta kalabalık yapmaz; `JSON formatı` açılır alanına taşındı.
- Harf/Kelime model seçimi artık iki belirgin karttır; her kart hangi veri tipini kullandığını kısa cümleyle açıklar.
- “Jüriye kısa açıklama” ve “Jüri için kısa cevaplar” alanları, panelin F1 skoru değil tek fixture inference demosu olduğunu basit dille anlatır.
- Hızlı demo için `Harf A Demo` ve `Kelime Bird Demo` butonları korunur.
- Renk kullanımı daha sakin tutulur: ana vurgu tahmin kartında, destek bilgileri nötr yüzeylerde gösterilir.
- Kamera bu panelde kullanılmaz. Amaç, web ONNX modelinin hazır fixture veya kullanıcı JSON girdisine verdiği sonucu güvenilir biçimde göstermektir.

Sunum için önerilen hızlı akış:

1. `Model Test` sekmesine geç.
2. `Harf A Demo` → `Model Sonucunu Göster`.
3. Sonuçta `A`, güven skoru ve top-3 listesini göster.
4. `Kelime Bird Demo` → `Model Sonucunu Göster`.
5. Sonuçta `bird`, beklenen etiket ve fixture bilgisini göster.

---

## V6 QR Demo Sekmesi

Sunumda hocanın telefonu ile siteye hızlı girmesi için `QR Demo` modu eklendi:

- Büyük QR kodu tarayıcıda canlı üretilir.
- `Canlı Harf`, `Kelime`, `Model Test` hedefleri arasında geçiş yapılır.
- Lokalde çalışırken de QR public demo adresine (`https://asl-demo.netlify.app/`) yönlendirir.
- Netlify'da yayınlandıktan sonra QR aynı domain üzerinden `#letter`, `#word` veya `#test` açar.
- QR kutusunda hafif pulse/scan animasyonu vardır; amaç sahnede QR'ın kolay fark edilmesi, ama ana arayüzü kalabalıklaştırmamasıdır.

Sunum için öneri: önce `Canlı Harf` QR'ını okut, telefonda kamera izni ile harf
modelini göster. Kelime modu telefonda denenebilir ama ışık, kadraj ve cihaz
performansı daha değişken olduğundan ikinci seçenek olarak tutulmalıdır.

---

## V7 Final UI/UX Sadeleştirme

Bu sürüm, sunum öncesi ekran karmaşıklığını azaltmak ve mobil kullanımı
iyileştirmek için yapıldı:

- Sağ panel artık “canlı sonuç + o modda ne yapmalıyım + detaylar” mantığına yaklaştı.
- Harf/kelime referans görselleri kamera çıktısının altından alınıp sağdaki bağlamsal panele taşındı.
  Kullanıcı artık çalışırken aynı ekranda `Hızlı referans` kartını açıp kapatabilir.
- Kelime modunda kayıt süreci `1. Başlat → 2. İşareti yap → 3. Sonucu incele`
  adımlarıyla gösterilir.
- Kelime demo/risk/karışma bilgileri canlı akışı bölmeden kapalı ikincil kartlarda tutulur.
- Öğrenme Koçu `1. Hedef → 2. Kamera → 3. Kontrol` adımlarıyla daha anlaşılır hale getirildi.
- Model Test ekranı iki seviyeye ayrıldı:
  - üstte tek tık hızlı demo (`Harf Modelini Test Et`, `Kelime Modelini Test Et`),
  - altta kapalı “Gelişmiş” alanında model tipi, JSON/fixture yükleme ve şema bilgisi.
- Hızlı demo butonları artık fixture yükleyip modeli otomatik çalıştırır.
- Mobilde ana aksiyon barı altta sticky davranır; butonlar daha kolay basılır.
- Üst menü sadeleştirildi; kelime sekmesindeki ekstra rozet kaldırıldı.

Bu değişiklikler model dosyalarını, feature pipeline'ı, ONNX kontratını veya
threshold davranışını değiştirmez. Sadece sunum ve kullanım katmanı
sadeleştirilmiştir.
