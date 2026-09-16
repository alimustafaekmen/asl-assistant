# docs/

Dokümantasyon haritası. Bu klasör **proje sahibinin ve yeni gelen
geliştiricinin** ihtiyaç duyduğu tüm referans bilgileri tutar.

## Önce ne okumalıyım?

```text
1) ../README.md              kısa tanıtım, hızlı başlangıç, yönlendirme tablosu
2) ../HANDBOOK.md            yolculuk-bazlı detaylı rehber
3) docs/project-usage.md     güncel terminal komutları + cross-platform kurulum + sorun giderme
4) ilgili klasör README'si   (asl-web/, asl-ml/, scripts/, …)
5) docs/current/*            teknik kontrat / pipeline detayları
```

## Kullanım kılavuzu

| Doküman | İçerik |
|---|---|
| [`project-usage.md`](project-usage.md) | Cross-platform kullanım: macOS ARM/Intel, Windows, Linux + Makefile + conda/venv + ortam kontrolü + sorun giderme |

## Aktif teknik dokümanlar

> Bu dosyalar **kırmızı çizgi** tutar. İçeriği değiştirmek istiyorsan önce
> oku, sonra `asl-web/` runtime ile birlikte güncelle ve hash chain'i
> doğrula.

| Doküman | İçerik |
|---|---|
| [`current/model-contract.md`](current/model-contract.md) | Harf 93D + Kelime 168D feature breakdown, ONNX I/O sözleşmesi, ZipMap fallback |
| [`current/data-contract.md`](current/data-contract.md) | `asl-web/data/` JSON şemaları + provenance hash chain (9 dosya çifti) |
| [`current/runtime-pipeline.md`](current/runtime-pipeline.md) | Tarayıcı inference akışı: kameradan tahmin gösterimine, smoother formülü, threshold'lar |
| [`current/project-structure.md`](current/project-structure.md) | Repo katman rehberi (web / shared / legacy) |
| [`current/system-architecture.md`](current/system-architecture.md) | Jüri "tam hakimiyet rehberi" — kapsamlı sistem mimarisi (1247 satır) |

## Demo ve kullanım dokümanları

| Doküman | İçerik |
|---|---|
| [`current/demo-plan.md`](current/demo-plan.md) | Jüri sunumu adım adım — kontrol listesi, kolay/zor kelime sırası, yedek video |
| [`current/word-model-card.md`](current/word-model-card.md) | Kelime modeli per-word performans bantları (GREEN/YELLOW/ORANGE/RED) + confusion çiftleri + güvenli demo kelime listesi |
| [`current/ui-ux-guide.md`](current/ui-ux-guide.md) | UI/UX tasarım sistemi: renk paleti, spacing/typography token'ları, modül hiyerarşisi, responsive davranış, JS class/ID kontratı, yeni component pattern'i |

## Sınır (`docs/current/` içinde tarihsel-niteliklı tek dosya)

| Doküman | Durum |
|---|---|
| [`current/project-history.md`](current/project-history.md) | "Proje yapım süreci ve öğrenilen dersler" — tarihsel anlatım, ama portfolyo değeri için `docs/current/`'ta tutulur (ileride taşınabilir) |

## Arşiv

| Klasör | İçerik |
|---|---|
| [`archive/historical/`](archive/historical/) | Eski proje durum raporu, geliştirme planı, project overview ve dosya audit snapshot'ları (2026-04-30'da `docs/current/`'tan taşındı). Hepsinin başında "Tarihsel arşiv" banner'ı vardır. |
| [`archive/analysis/`](archive/analysis/) | Eski strateji + analiz + plan dokümanları |
| [`archive/notes/`](archive/notes/) | Literatür / cevap notları |

## Görseller

Dokümanlarda kullanılan görseller [`assets/`](assets/) altında tutulur.
Yeni görsellerde boşluk ve Türkçe karakter yerine `kebab-case` dosya adı
tercih edilir.

## Bu klasör dışındaki ana referanslar

| Dosya | Rolü |
|---|---|
| [`../README.md`](../README.md) | Kök tanıtım + yönlendirme |
| [`../HANDBOOK.md`](../HANDBOOK.md) | Yolculuk-bazlı detaylı rehber |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Değişiklik geçmişi |
