// Letter screen strings, and the plate's word-result wording, which the camera
// screens share. A percentage is its own string: Turkish writes "%90".

registerStrings("letter", {
  tr: {
    "letter.stage.headline.letter": "Kameraya bir ASL harfi gösterin; tanınan harf metne yazılır.",
    "letter.stage.headline.coach": "Gösterilen harfi kameraya yapın; doğru tuttuğunuzda halka dolar.",
    "letter.stage.headline.word": "Bir ASL kelimesi kaydedin; onaylarsanız metne eklenir.",
    "letter.stage.lead": "Kamerayı açınca tarayıcı izin ister. Görüntü cihazınızdan çıkmaz, kaydedilmez.",
    "letter.stage.coachStart": "Çalışmayı başlat",
    "letter.stage.watchDemo": "Örneği izleyin",
    "letter.stage.fact.letters": "24 ASL harfi · J ve Z hareketli olduğu için yok",
    "letter.stage.fact.words": "50 kelime · deneysel; el, yüz ve omuzlar görünmeli",
    "letter.stage.fact.asl": "ASL (Amerikan İşaret Dili), TİD değil",
    "letter.stage.fact.download": "İlk kamera açılışında yaklaşık 15 MB iner; sonraki açılışlarda inmez",
    "letter.stage.fact.wordDownload": "İlk kamera açılışında en fazla 24 MB iner; Wi-Fi önerilir",

    "letter.camera.turnOn": "Kamerayı aç",
    "letter.camera.turnOff": "Kamerayı kapat",
    "letter.camera.tasksReady": "Hazırlanıyor ({ready}/{total})",

    "letter.help.retry": "Yeniden dene",
    "letter.help.summary": "Kamera iznini nasıl veririm?",
    "letter.help.iosSafari":
      "<strong>iPhone ve iPad (Safari):</strong> Adres çubuğundaki <strong>aA</strong> (yeni sürümlerde <strong>⋯</strong>) düğmesine dokunun → <strong>Web Sitesi Ayarları</strong> → <strong>Kamera</strong> → <strong>İzin Ver</strong>. Sonra <strong>Yeniden dene</strong>'ye dokunun. Seçenek görünmüyorsa: <strong>Ayarlar → Uygulamalar → Safari → Kamera</strong> → <strong>Sor</strong> ya da <strong>İzin Ver</strong>.",
    "letter.help.iosChrome":
      "<strong>iPhone'da Chrome:</strong> <strong>Ayarlar</strong>'da <strong>Chrome</strong>'u bulun ve <strong>Kamera</strong>'yı açın, sonra sayfaya dönüp <strong>Yeniden dene</strong>'ye dokunun.",
    "letter.help.androidChrome":
      "<strong>Android (Chrome):</strong> Adres çubuğunun solundaki simgeye (ayar ya da kilit) dokunun → <strong>İzinler</strong> → <strong>Kamera</strong> → <strong>İzin ver</strong>. Kamera listede yoksa: <strong>Ayarlar → Uygulamalar → Chrome → İzinler → Kamera → Uygulamayı kullanırken izin ver</strong>.",
    "letter.help.desktopChrome":
      "<strong>Bilgisayarda Chrome ya da Edge:</strong> Adres çubuğunun solundaki site bilgileri simgesine tıklayın → <strong>Kamera</strong>'yı açın ya da <strong>İzin ver</strong>'i seçin. Yine açılmazsa macOS'ta <strong>Sistem Ayarları → Gizlilik ve Güvenlik → Kamera</strong>, Windows'ta <strong>Ayarlar → Gizlilik ve güvenlik → Kamera</strong> bölümünden tarayıcınıza izin verin. Tarayıcıyı yeniden başlatmanız gerekebilir.",
    "letter.help.firefox":
      "<strong>Firefox:</strong> Adres çubuğundaki üzeri çizili kamera simgesine tıklayın → <strong>Engellendi</strong> yazısının yanındaki <strong>×</strong> ile engeli kaldırın → <strong>Yeniden dene</strong>.",
    "letter.help.macSafari":
      "<strong>Mac'te Safari:</strong> Menü çubuğunda <strong>Safari → bu sitenin ayarları</strong> → <strong>Kamera</strong> → <strong>İzin Ver</strong>.",

    "letter.demo.title": "Kamerasız örnek",
    "letter.demo.skip": "Atlayın",
    "letter.demo.camera": "Kamerayı açın",
    "letter.demo.stop": "Durdurun",
    "letter.demo.close": "Kapatın",
    "letter.demo.loading": "Örnek hazırlanıyor…",
    "letter.demo.playing": "Okunan harfi metne eklemek için Ekle'ye dokunun ya da Space tuşuna basın.",
    "letter.demo.done": "Örnek tamamlandı. Şimdi kamerayı açıp kendi elinizle deneyin.",
    "letter.demo.loadFailed": "Örnek yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.",
    "letter.demo.modelLoading": "Harf tanıma hazırlanıyor…",
    "letter.demo.modelFailed": "Harf tanıma yüklenemedi. Bağlantınızı kontrol edip örneği yeniden başlatın.",
    "letter.demo.badge.loading": "Örnek hazırlanıyor",
    "letter.demo.badge.playing": "Örnek oynatılıyor",
    "letter.demo.badge.done": "Örnek bitti",

    "letter.plate.percent": "%{n}",
    "letter.plate.idle": "Kamerayı açtığınızda sonuç burada görünür.",
    "letter.plate.decision.waiting": "Bekleniyor",
    "letter.plate.decision.unsure": "Emin değil",
    "letter.plate.decision.close": "Çok yakın",
    "letter.plate.decision.likely": "Büyük olasılıkla",
    "letter.plate.decision.sure": "Emin",
    "letter.plate.letterUnsure": "Emin olunamadı. Işığı artırmayı ya da elinizi biraz yaklaştırmayı deneyin.",
    "letter.plate.letterLikely": "Büyük olasılıkla {letter}. Biraz daha sabit tutun.",
    "letter.plate.letterClear": "{letter} harfi net görünüyor.",
    "letter.plate.wordUnsure":
      "Emin olunamadı. En yakın sonuçlar: {top}. Eliniz, yüzünüz ve omuzlarınız görünür olacak şekilde yeniden kaydedin.",
    "letter.plate.wordClose": "İlk iki sonuç çok yakın: {top}. Doğru olanı kontrol edin.",
    "letter.plate.wordLikely": "En olası sonuçlar: {top}.",
    "letter.plate.near": "Yakın: {words}",

    "letter.wordGuide.waiting": "Sonuç bekleniyor",
    "letter.wordGuide.waitingAction": "Kayıt tamamlandığında model sonucu burada yorumlanır.",
    "letter.wordGuide.noResult": "Sonuç çıkmadı",
    "letter.wordGuide.noResultAction": "Kamerayı, ışığı ve kadrajı kontrol edip yeniden kaydedin.",
    "letter.wordGuide.unsure": "Emin olunamadı",
    "letter.wordGuide.unsureAction":
      "En yakın sonuç {word}, ama metne eklemek için yeterince net değil. Daha net bir kayıtla yeniden deneyin: eliniz, yüzünüz ve omuzlarınız görünür olsun.",
    "letter.wordGuide.check": "Kontrol ederek ekleyin",
    "letter.wordGuide.closeAction": "İlk iki sonuç çok yakın. Doğrusu {word} ise ekleyin; değilse yeniden kaydedin.",
    "letter.wordGuide.qualityAction": "{warning} Sonucu kontrol ederek ekleyin.",
    "letter.wordGuide.usable": "Sonuç kullanılabilir",
    "letter.wordGuide.usableAction": "Doğruysa metne ekleyin; değilse yeniden kaydedin.",

    "letter.wordQuality.pose": "Omuzlarınız az göründü.",
    "letter.wordQuality.face": "Yüzünüz az göründü.",
    "letter.wordQuality.hand": "Eliniz aralıklarla kayboldu.",
    "letter.wordQuality.fewFrames": "Kayıt kısa kaldı.",
    "letter.wordQuality.slow": "Kayıt yavaş doldu; ışığı artırın.",
    "letter.wordQuality.still": "Hareket algılanmadı; işareti tam yapın.",

    "letter.ranked.title": "En olası sonuçlar",
    "letter.ranked.empty": "Kamera açılınca en olası sonuçlar burada görünür.",
    "letter.ranked.wordNote": "Kayıt bittikten sonra önce sonuçlara bakın; emin değilseniz yeniden kaydedin.",

    "letter.transcript.heading": "Yazılan metin",
    "letter.transcript.placeholder": "Metin burada görünür",
    "letter.transcript.placeholderLang": "tr",
    "letter.transcript.copy": "Metni kopyala",
    "letter.transcript.speak": "Sesli oku",
    "letter.transcript.clear": "Metni temizle",
    "letter.transcript.letterAdded": "{letter} eklendi",
    "letter.transcript.wordAdded": "“{word}” metne eklendi",
    "letter.transcript.wordRemoved": "{word} metinden çıkarıldı",
    "letter.transcript.cleared": "Metin temizlendi",
    "letter.transcript.restored": "Metin geri alındı",
    "letter.transcript.nothingToCopy": "Kopyalanacak metin yok",
    "letter.transcript.nothingToSpeak": "Okunacak metin yok",
    "letter.transcript.copied": "Metin kopyalandı",
    "letter.transcript.copyFailed": "Kopyalanamadı. Metni seçip elle kopyalayabilirsiniz.",
    "letter.toast.undo": "Geri al",

    "letter.dock.label": "İşlemler",
    "letter.dock.delete": "Sil",
    "letter.dock.space": "Boşluk",
    "letter.dock.add": "Ekle",

    "letter.shortcuts.title": "Kısayollar",
    "letter.shortcuts.add": "Harfi metne ekle",
    "letter.shortcuts.space": "Boşluk bırak",
    "letter.shortcuts.delete": "Son karakteri sil",
    "letter.shortcuts.note": "Bir düğme ya da form alanı seçiliyken tuşlar ona gider.",
  },
  en: {
    "letter.stage.headline.letter": "Show an ASL letter to the camera; it's typed into your text.",
    "letter.stage.headline.coach": "Sign the letter shown; hold it correctly and the ring fills.",
    "letter.stage.headline.word": "Record an ASL word; accept it to add it to your text.",
    "letter.stage.lead": "Your browser asks to use the camera. The video stays on your device and isn't saved.",
    "letter.stage.coachStart": "Start session",
    "letter.stage.watchDemo": "Watch the demo",
    "letter.stage.fact.letters": "24 ASL letters · no J or Z, since they move",
    "letter.stage.fact.words": "50 words · experimental; show hands, face and shoulders",
    "letter.stage.fact.asl": "ASL (American Sign Language), not Turkish Sign Language",
    "letter.stage.fact.download": "About 15 MB downloads the first time, nothing after that",
    "letter.stage.fact.wordDownload": "Up to 24 MB downloads the first time; Wi-Fi is best",

    "letter.camera.turnOn": "Turn on camera",
    "letter.camera.turnOff": "Turn off camera",
    "letter.camera.tasksReady": "Preparing ({ready}/{total})",

    "letter.help.retry": "Try again",
    "letter.help.summary": "How do I allow the camera?",
    "letter.help.iosSafari":
      "<strong>iPhone and iPad (Safari):</strong> Tap <strong>aA</strong> in the address bar (<strong>⋯</strong> in newer versions) → <strong>Website Settings</strong> → <strong>Camera</strong> → <strong>Allow</strong>. Then tap <strong>Try again</strong>. If you don't see the option: <strong>Settings → Apps → Safari → Camera</strong> → <strong>Ask</strong> or <strong>Allow</strong>.",
    "letter.help.iosChrome":
      "<strong>Chrome on iPhone:</strong> Find <strong>Chrome</strong> in <strong>Settings</strong> and turn on <strong>Camera</strong>, then go back to the page and tap <strong>Try again</strong>.",
    "letter.help.androidChrome":
      "<strong>Android (Chrome):</strong> Tap the icon to the left of the address bar (settings or a lock) → <strong>Permissions</strong> → <strong>Camera</strong> → <strong>Allow</strong>. If Camera is not listed: <strong>Settings → Apps → Chrome → Permissions → Camera → Allow only while using the app</strong>.",
    "letter.help.desktopChrome":
      "<strong>Chrome or Edge on a computer:</strong> Click the site information icon to the left of the address bar → turn on <strong>Camera</strong> or choose <strong>Allow</strong>. If it still does not open, allow your browser under <strong>System Settings → Privacy & Security → Camera</strong> on macOS, or <strong>Settings → Privacy & security → Camera</strong> on Windows. You may need to restart the browser.",
    "letter.help.firefox":
      "<strong>Firefox:</strong> Click the crossed-out camera icon in the address bar → remove the block with the <strong>×</strong> next to <strong>Blocked</strong> → <strong>Try again</strong>.",
    "letter.help.macSafari":
      "<strong>Safari on Mac:</strong> In the menu bar, choose <strong>Safari → Settings for this website</strong> → <strong>Camera</strong> → <strong>Allow</strong>.",

    "letter.demo.title": "Camera-free demo",
    "letter.demo.skip": "Skip",
    "letter.demo.camera": "Turn on camera",
    "letter.demo.stop": "Stop",
    "letter.demo.close": "Close",
    "letter.demo.loading": "Preparing the demo…",
    "letter.demo.playing": "Tap Add or press Space to add the letter shown to your text.",
    "letter.demo.done": "Demo finished. Now turn on the camera and try it with your own hand.",
    "letter.demo.loadFailed": "The demo could not load. Check your connection and try again.",
    "letter.demo.modelLoading": "Preparing letter recognition…",
    "letter.demo.modelFailed": "Letter recognition could not load. Check your connection and restart the demo.",
    "letter.demo.badge.loading": "Preparing demo",
    "letter.demo.badge.playing": "Demo playing",
    "letter.demo.badge.done": "Demo finished",

    "letter.plate.percent": "{n}%",
    "letter.plate.idle": "Turn on the camera to see the result here.",
    "letter.plate.decision.waiting": "Waiting",
    "letter.plate.decision.unsure": "Not sure",
    "letter.plate.decision.close": "Close call",
    "letter.plate.decision.likely": "Likely",
    "letter.plate.decision.sure": "Sure",
    "letter.plate.letterUnsure": "Not sure. Try more light, or bring your hand a little closer.",
    "letter.plate.letterLikely": "Probably {letter}. Hold it a little steadier.",
    "letter.plate.letterClear": "{letter} is clear.",
    "letter.plate.wordUnsure": "Not sure. Closest results: {top}. Record again with your hands, face and shoulders in view.",
    "letter.plate.wordClose": "The top two results are very close: {top}. Check which one is right.",
    "letter.plate.wordLikely": "Most likely results: {top}.",
    "letter.plate.near": "Other results: {words}",

    "letter.wordGuide.waiting": "Waiting for a result",
    "letter.wordGuide.waitingAction": "When the recording ends, the model's result is explained here.",
    "letter.wordGuide.noResult": "No result",
    "letter.wordGuide.noResultAction": "Check the camera, the light and the framing, then record again.",
    "letter.wordGuide.unsure": "Not sure",
    "letter.wordGuide.unsureAction":
      "The closest result is {word}, but it is not clear enough to add to your text. Try again with a clearer recording: keep your hands, face and shoulders in view.",
    "letter.wordGuide.check": "Check before adding",
    "letter.wordGuide.closeAction": "The top two results are very close. If {word} is right, add it; if not, record again.",
    "letter.wordGuide.qualityAction": "{warning} Check the result before you add it.",
    "letter.wordGuide.usable": "Result looks usable",
    "letter.wordGuide.usableAction": "If it's right, add it to your text; if not, record again.",

    "letter.wordQuality.pose": "Your shoulders were hardly in view.",
    "letter.wordQuality.face": "Your face was hardly in view.",
    "letter.wordQuality.hand": "Your hand kept dropping out of view.",
    "letter.wordQuality.fewFrames": "The recording was too short.",
    "letter.wordQuality.slow": "The recording filled slowly; add more light.",
    "letter.wordQuality.still": "No movement was seen; make the whole sign.",

    "letter.ranked.title": "Most likely results",
    "letter.ranked.empty": "Once the camera is on, the most likely results show up here.",
    "letter.ranked.wordNote": "After recording, look at the results first; if you're not sure, record again.",

    "letter.transcript.heading": "Your text",
    "letter.transcript.placeholder": "Text shows here",
    "letter.transcript.placeholderLang": "en",
    "letter.transcript.copy": "Copy text",
    "letter.transcript.speak": "Read aloud",
    "letter.transcript.clear": "Clear text",
    "letter.transcript.letterAdded": "{letter} added",
    "letter.transcript.wordAdded": "“{word}” added to your text",
    "letter.transcript.wordRemoved": "“{word}” removed from your text",
    "letter.transcript.cleared": "Text cleared",
    "letter.transcript.restored": "Text restored",
    "letter.transcript.nothingToCopy": "No text to copy",
    "letter.transcript.nothingToSpeak": "No text to read aloud",
    "letter.transcript.copied": "Text copied",
    "letter.transcript.copyFailed": "Couldn't copy. You can select the text and copy it yourself.",
    "letter.toast.undo": "Undo",

    "letter.dock.label": "Actions",
    "letter.dock.delete": "Delete",
    "letter.dock.space": "Space",
    "letter.dock.add": "Add",

    "letter.shortcuts.title": "Shortcuts",
    "letter.shortcuts.add": "Add the letter to your text",
    "letter.shortcuts.space": "Insert a space",
    "letter.shortcuts.delete": "Delete the last character",
    "letter.shortcuts.note": "While a button or form field is selected, keys go to it.",
  },
});

// Looked up when called, as the modules load later. Separate listeners, so
// one failing does not stop the others.
onLanguageChange(() => renderPredictionLanguage());
onLanguageChange(() => renderToastLanguage());
onLanguageChange(() => renderTranscript());
