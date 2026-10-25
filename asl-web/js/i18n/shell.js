// Shell strings: the header, navigation, language and theme controls, screen
// titles, the camera status and problems, model downloads and start-up.
//
// Screen titles double as the document title (" · ASL Assistant" is added).
// The camera problems and badges are written by core/app.js, which redraws
// what it shows on a language change (renderShellLanguage).

registerStrings("shell", {
  tr: {
    "shell.documentTitle": "Harf tanıma · ASL Assistant",
    "shell.metaDescription":
      "ASL Assistant, ASL harflerini ve kelimelerini tarayıcıda tanır; kamera görüntüsü cihazından hiç çıkmaz.",
    "shell.skipLink": "İçeriğe geç",

    "shell.nav.label": "Mod",
    "shell.nav.letter": "Harf",
    "shell.nav.coach": "Koç",
    "shell.nav.word": "Kelime",
    "shell.nav.experimental": "deneysel",
    "shell.menu.more": "Diğer",
    "shell.menu.project": "Nasıl çalışır",
    "shell.menu.qr": "Telefonda aç",
    "shell.menu.theme": "Koyu tema",

    "shell.language.label": "English",
    "shell.language.action": "Switch to English",
    "shell.language.code": "en",
    "shell.language.changed": "Sayfa artık Türkçe.",

    "shell.route.letter": "Harf tanıma",
    "shell.route.coach": "Koç",
    "shell.route.word": "Kelime (deneysel)",
    "shell.route.project": "Nasıl çalışır",
    "shell.route.test": "Modeli kamerasız deneyin",
    "shell.route.qr": "Telefonda açın",

    "shell.region.camera": "Kamera",
    "shell.region.details": "Ayrıntılar",
    "shell.region.debug": "Debug paneli",

    "shell.modeBadge.letter": "Harf Modu",
    "shell.modeBadge.word": "Kelime Modu",
    "shell.modeBadge.coach": "Öğrenme Koçu",
    "shell.resultKind.letter": "Harf",
    "shell.resultKind.word": "Kelime",
    "shell.resultKind.coach": "Hedef",

    "shell.status.ready": "Hazır",
    "shell.status.cameraOn": "Kamera açık",
    "shell.badge.ready": "Hazır",
    "shell.badge.preparing": "Hazırlanıyor",
    "shell.badge.cameraOn": "Kamera açık",
    "shell.badge.cameraFailed": "Kamera açılamadı",
    "shell.badge.httpsRequired": "HTTPS gerekli",
    "shell.badge.trackingPreparing": "El izleme hazırlanıyor",
    "shell.badge.trackingReady": "El izleme hazır",
    "shell.badge.trackingMissing": "El izleme yok",
    "shell.badge.searching": "El aranıyor",
    "shell.badge.handDetected": "El algılandı",
    "shell.badge.partialDownload": "Eksik yükleme",
    "shell.badge.downloadFailed": "Model indirilemedi",
    "shell.badge.error": "Hata",

    "shell.models.downloading": "Modeller indiriliyor…",
    "shell.models.ready": "Hazır. Elinizi kameraya gösterin.",
    "shell.models.letter": "harf",
    "shell.models.word": "kelime",
    "shell.models.and": " ve ",
    "shell.models.partial": "Yalnızca {models} modeli indirilebildi. Bağlantınızı kontrol edip sayfayı yenileyin.",
    "shell.models.failed": "Model indirilemedi. Bağlantınızı kontrol edip sayfayı yenileyin.",
    "shell.tracking.failed": "El izleme bileşeni indirilemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.",
    "shell.hand.missing": "El görünmüyor. Kol boyu uzaklıkta, iyi ışıkta, eliniz kadrajın ortasında olsun.",
    "shell.hand.detected": "El algılandı.",
    "shell.startupFailed": "Uygulama başlatılamadı. Sayfayı yenileyin; sorun sürerse bağlantınızı kontrol edin.",

    "shell.cameraProblem.denied.title": "Kamera izni verilmedi",
    "shell.cameraProblem.denied.text":
      "Tarayıcının site ayarlarından kameraya izin verin (iPhone'da adres çubuğundaki aA, Android'de kilit simgesi), sonra yeniden deneyin.",
    "shell.cameraProblem.system.title": "Kamera sistem ayarlarında kapalı",
    "shell.cameraProblem.system.text":
      "Bilgisayarınızın gizlilik ayarları tarayıcının kamerayı kullanmasına izin vermiyor. Sistem ayarlarından izin verin, sonra yeniden deneyin.",
    "shell.cameraProblem.busy.title": "Kamera başka bir uygulamada açık",
    "shell.cameraProblem.busy.text": "Kamerayı kullanan uygulamayı ya da sekmeyi kapatın, sonra yeniden deneyin.",
    "shell.cameraProblem.notfound.title": "Kamera bulunamadı",
    "shell.cameraProblem.notfound.text":
      "Bu cihazda kullanılabilir bir kamera yok. Uygulamanın harfleri nasıl okuduğunu kamerasız bir örnekle izleyebilirsiniz.",
    "shell.cameraProblem.insecure.title": "Bu adreste kamera açılamıyor",
    "shell.cameraProblem.insecure.text":
      "Tarayıcılar kameraya yalnızca güvenli (https) adreslerde izin verir. Siteyi {address} adresinden açın.",
    "shell.cameraProblem.unsupported.title": "Bu tarayıcı kameraya erişemiyor",
    "shell.cameraProblem.unsupported.text":
      "Siteyi güncel bir tarayıcıda açın. Bu arada uygulamanın harfleri nasıl okuduğunu kamerasız bir örnekle izleyebilirsiniz.",
    "shell.cameraProblem.failed.title": "Kamera açılamadı",
    "shell.cameraProblem.failed.text":
      "Sayfayı yenileyip yeniden deneyin. Sorun sürerse kamerasız bir örneği izleyebilirsiniz.",
    "shell.cameraProblem.ended.title": "Kamera bağlantısı kesildi",
    "shell.cameraProblem.ended.text": "Kamerayı yeniden açabilirsiniz.",
  },
  en: {
    "shell.documentTitle": "Letter recognition · ASL Assistant",
    "shell.metaDescription":
      "ASL Assistant recognizes ASL letters and words in your browser; your video never leaves your device.",
    "shell.skipLink": "Skip to content",

    "shell.nav.label": "Mode",
    "shell.nav.letter": "Letter",
    "shell.nav.coach": "Coach",
    "shell.nav.word": "Word",
    "shell.nav.experimental": "experimental",
    "shell.menu.more": "More",
    "shell.menu.project": "How it works",
    "shell.menu.qr": "Open on phone",
    "shell.menu.theme": "Dark theme",

    "shell.language.label": "Türkçe",
    "shell.language.action": "Türkçeye geç",
    "shell.language.code": "tr",
    "shell.language.changed": "The page is now in English.",

    "shell.route.letter": "Letter recognition",
    "shell.route.coach": "Coach",
    "shell.route.word": "Word (experimental)",
    "shell.route.project": "How it works",
    "shell.route.test": "Try the model without a camera",
    "shell.route.qr": "Open on your phone",

    "shell.region.camera": "Camera",
    "shell.region.details": "Details",
    "shell.region.debug": "Debug panel",

    "shell.modeBadge.letter": "Letter mode",
    "shell.modeBadge.word": "Word mode",
    "shell.modeBadge.coach": "Learning coach",
    "shell.resultKind.letter": "Letter",
    "shell.resultKind.word": "Word",
    "shell.resultKind.coach": "Target",

    "shell.status.ready": "Ready",
    "shell.status.cameraOn": "Camera on",
    "shell.badge.ready": "Ready",
    "shell.badge.preparing": "Preparing",
    "shell.badge.cameraOn": "Camera on",
    "shell.badge.cameraFailed": "Camera did not open",
    "shell.badge.httpsRequired": "HTTPS required",
    "shell.badge.trackingPreparing": "Preparing hand tracking",
    "shell.badge.trackingReady": "Hand tracking ready",
    "shell.badge.trackingMissing": "No hand tracking",
    "shell.badge.searching": "Looking for a hand",
    "shell.badge.handDetected": "Hand detected",
    "shell.badge.partialDownload": "Download incomplete",
    "shell.badge.downloadFailed": "Download failed",
    "shell.badge.error": "Error",

    "shell.models.downloading": "Downloading the models…",
    "shell.models.ready": "Ready. Show your hand to the camera.",
    "shell.models.letter": "letter",
    "shell.models.word": "word",
    "shell.models.and": " and ",
    "shell.models.partial": "Only the {models} model could be downloaded. Check your connection and reload the page.",
    "shell.models.failed": "The model could not be downloaded. Check your connection and reload the page.",
    "shell.tracking.failed": "Hand tracking could not be downloaded. Check your internet connection and try again.",
    "shell.hand.missing": "No hand in view. Keep your hand at arm's length, in good light, in the middle of the frame.",
    "shell.hand.detected": "Hand detected.",
    "shell.startupFailed": "The app could not start. Reload the page; if that does not help, check your connection.",

    "shell.cameraProblem.denied.title": "Camera not allowed",
    "shell.cameraProblem.denied.text":
      "Allow the camera in your browser's site settings (on iPhone, aA in the address bar; on Android, the lock icon), then try again.",
    "shell.cameraProblem.system.title": "The camera is turned off in system settings",
    "shell.cameraProblem.system.text":
      "Your computer's privacy settings do not let the browser use the camera. Allow it in system settings, then try again.",
    "shell.cameraProblem.busy.title": "Another app is using the camera",
    "shell.cameraProblem.busy.text": "Close the app or tab that is using the camera, then try again.",
    "shell.cameraProblem.notfound.title": "No camera found",
    "shell.cameraProblem.notfound.text":
      "This device has no camera to use. You can watch a camera-free demo of how the app reads letters.",
    "shell.cameraProblem.insecure.title": "The camera cannot open at this address",
    "shell.cameraProblem.insecure.text":
      "Browsers allow the camera only on secure (https) addresses. Open the site at {address}.",
    "shell.cameraProblem.unsupported.title": "This browser cannot use the camera",
    "shell.cameraProblem.unsupported.text":
      "Open the site in an up-to-date browser. In the meantime, you can watch a camera-free demo of how the app reads letters.",
    "shell.cameraProblem.failed.title": "The camera did not open",
    "shell.cameraProblem.failed.text":
      "Reload the page and try again. If it still does not work, you can watch a camera-free demo.",
    "shell.cameraProblem.ended.title": "The camera was disconnected",
    "shell.cameraProblem.ended.text": "You can turn the camera on again.",
  },
});

// The shell's dynamic text is redrawn from state; renderShellLanguage lives
// in core/app.js, which loads later, so it is looked up when a change comes.
onLanguageChange(() => renderShellLanguage());
