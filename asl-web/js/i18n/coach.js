// Coach screen strings: the target tile, cues and hints, session bar, study cards and letter grid.
//
// The coach's sentences about a letter are built from these and from the
// teaching data (data/letter_curriculum.json, data/letter_confusion.json),
// which carries its cues and reasons in both languages. ui/coach.js also
// fills the word screen's side cards, so their counts and labels are here.
// What the coach draws from state is redrawn on a language change
// (renderCoachLanguage).

registerStrings("coach", {
  tr: {
    "coach.tile.enlarge": "Referans görselini büyüt",
    "coach.tile.reference": "Referans",
    "coach.tile.target": "Hedef",

    "coach.plate.waiting": "Bekleniyor",
    "coach.plate.cameraOff": "Kamerayı açtığınızda sonuç burada görünür.",
    "coach.plate.noHand": "Elinizi kadrajın ortasına getirin.",
    "coach.plate.target": "Hedef: {letter}",
    "coach.plate.autoCheck": "Halka dolunca kendiliğinden kontrol edilir.",
    "coach.plate.hold": "Tutun…",
    "coach.plate.notYet": "Henüz olmadı",
    "coach.plate.correct": "Doğru!",
    "coach.plate.shown": "{letter} harfini net gösterdiniz.",
    "coach.plate.upNext": "Sıradaki: {letter}",
    "coach.plate.whenReady": "Hazır olduğunuzda Sonraki'ye basın.",

    "coach.target.letter": "Hedef harf: {letter}. El şekli kameraya net görünmeli; poz en az 1 saniye sabit kalmalı.",
    "coach.target.word":
      "Hedef kelime: {word}. Hareketi 3-5 saniye içinde tamamlayın. El, yüz ve omuzlar kadrajda kalmalı.",
    "coach.cue.failed": "İpuçları yüklenemedi. Referans görseline bakabilirsiniz.",
    "coach.hint.line": "İpucu: {letter}. {cue}",
    "coach.hint.lookAlikes": "Karışabilir: {letters}.",
    "coach.miss.unclear": "El şekli net seçilemedi. Kol boyu uzaklık, iyi ışık, eliniz kadrajın ortasında.",
    "coach.miss.seen": "Şu an {letter} görünüyor.",
    "coach.feedback.letter": "Doğru! {letter} harfini net gösterdiniz.",
    "coach.feedback.wordMatch": "Doğru eşleşme. Hareket akışı ve kadraj koşulları yeterli görünüyor.",
    "coach.feedback.wordMiss": "Hedefle eşleşmedi. Hareket daha yavaş tamamlanmalı; yüz ve omuzlar görünür kalmalı.",
    "coach.check.startFirst": "Önce çalışmayı başlatın.",

    "coach.advance.label": "Sıradaki harfe geçiş",
    "coach.advance.stay": "Burada kal",

    "coach.session.label": "Oturum",
    "coach.session.learn": "Öğrenme: sırayla",
    "coach.session.practice": "Pratik: {count} tekrar",
    "coach.session.quiz": "Sınav: {count} soru",
    "coach.session.progress": "Oturum: {goal} hedeften {done} tamamlandı",

    "coach.dock.skip": "Atla",
    "coach.dock.hint": "İpucu",
    "coach.dock.repeat": "Tekrar",
    "coach.dock.next": "Sonraki",
    "coach.dock.check": "Kaydı başlat",

    "coach.study.title": "Çalışma",
    "coach.study.close": "Kapat",
    "coach.study.flowLabel": "Çalışma biçimi",
    "coach.study.flow.learn": "Öğrenme",
    "coach.study.flow.practice": "Pratik",
    "coach.study.flow.quiz": "Sınav",
    "coach.study.contentLabel": "Çalışma içeriği",
    "coach.study.letters": "Harfler",
    "coach.study.words": "Kelimeler",
    "coach.study.wordTarget": "Kelime hedefi",

    "coach.options.letters": "Harf hedefleri",
    "coach.options.words": "Kelime hedefleri",
    "coach.options.easy": "rahat",
    "coach.options.medium": "orta",
    "coach.options.hard": "riskli",

    "coach.letters.done": "Tamamlanan:",
    "coach.letters.gridLabel": "Hedef harf",
    "coach.letters.quizNote": "Sınav sırasında harf seçilemez.",
    "coach.letters.storageSaved": "İlerlemeniz yalnızca bu cihazda saklanır, kimseyle paylaşılmaz.",
    "coach.letters.storageLost": "İlerleme bu tarayıcıda saklanamıyor; sayfayı kapatınca sıfırlanır.",
    "coach.letters.reset": "İlerlemeyi sıfırla",
    "coach.grid.current": "{letter}, şimdiki hedef",
    "coach.grid.done": "{letter}, tamamlandı",

    "coach.toast.reset": "İlerleme sıfırlandı",
    "coach.toast.undo": "Geri al",

    "coach.wordGuide.easyCount": "{count} kolay kelime",
    "coach.wordGuide.level.easy": "kolay",
    "coach.wordGuide.level.medium": "orta",
    "coach.wordGuide.level.hard": "zor",
    "coach.wordGuide.pairJoin": "ile",
    "coach.wordGuide.percent": "%{n}",
  },
  en: {
    "coach.tile.enlarge": "Reference image, enlarge",
    "coach.tile.reference": "Reference",
    "coach.tile.target": "Target",

    "coach.plate.waiting": "Waiting",
    "coach.plate.cameraOff": "Turn on the camera to see the result here.",
    "coach.plate.noHand": "Bring your hand to the middle of the frame.",
    "coach.plate.target": "Target: {letter}",
    "coach.plate.autoCheck": "It's checked on its own when the ring fills.",
    "coach.plate.hold": "Hold it…",
    "coach.plate.notYet": "Not yet",
    "coach.plate.correct": "Correct!",
    "coach.plate.shown": "You signed {letter} clearly.",
    "coach.plate.upNext": "Next up: {letter}",
    "coach.plate.whenReady": "Press Next when you're ready.",

    "coach.target.letter": "Target letter: {letter}. Keep the handshape clearly in view and hold it still for at least 1 second.",
    "coach.target.word":
      "Target word: {word}. Finish the sign in 3 to 5 seconds. Keep your hands, face and shoulders in the frame.",
    "coach.cue.failed": "Hints couldn't be loaded. You can check the reference image.",
    "coach.hint.line": "Hint: {letter}. {cue}",
    "coach.hint.lookAlikes": "Easy to mix up with {letters}.",
    "coach.miss.unclear": "Your handshape isn't clear yet. Stay an arm's length away, in good light, with your hand in the middle of the frame.",
    "coach.miss.seen": "The camera sees {letter}.",
    "coach.feedback.letter": "Correct! You signed {letter} clearly.",
    "coach.feedback.wordMatch": "It's a match. Your movement and framing look good.",
    "coach.feedback.wordMiss": "That didn't match the target. Sign more slowly, and keep your face and shoulders in view.",
    "coach.check.startFirst": "Start the session first.",

    "coach.advance.label": "Moving on to the next letter",
    "coach.advance.stay": "Stay here",

    "coach.session.label": "Session",
    "coach.session.learn": "Learn: in order",
    "coach.session.practice": { one: "Practice: 1 rep", other: "Practice: {count} reps" },
    "coach.session.quiz": { one: "Quiz: 1 question", other: "Quiz: {count} questions" },
    "coach.session.progress": "Session: {done} of {goal} targets done",

    "coach.dock.skip": "Skip",
    "coach.dock.hint": "Hint",
    "coach.dock.repeat": "Repeat",
    "coach.dock.next": "Next",
    "coach.dock.check": "Start recording",

    "coach.study.title": "Study",
    "coach.study.close": "Close",
    "coach.study.flowLabel": "How to study",
    "coach.study.flow.learn": "Learn",
    "coach.study.flow.practice": "Practice",
    "coach.study.flow.quiz": "Quiz",
    "coach.study.contentLabel": "What to study",
    "coach.study.letters": "Letters",
    "coach.study.words": "Words",
    "coach.study.wordTarget": "Target word",

    "coach.options.letters": "Letter targets",
    "coach.options.words": "Word targets",
    "coach.options.easy": "easy",
    "coach.options.medium": "medium",
    "coach.options.hard": "tricky",

    "coach.letters.done": "Done:",
    "coach.letters.gridLabel": "Target letter",
    "coach.letters.quizNote": "You can't pick a letter during a quiz.",
    "coach.letters.storageSaved": "Your progress stays on this device and is never shared.",
    "coach.letters.storageLost": "This browser can't save your progress; it resets when you close the page.",
    "coach.letters.reset": "Reset progress",
    "coach.grid.current": "{letter}, current target",
    "coach.grid.done": "{letter}, done",

    "coach.toast.reset": "Progress reset",
    "coach.toast.undo": "Undo",

    "coach.wordGuide.easyCount": { one: "1 easy word", other: "{count} easy words" },
    "coach.wordGuide.level.easy": "easy",
    "coach.wordGuide.level.medium": "medium",
    "coach.wordGuide.level.hard": "hard",
    "coach.wordGuide.pairJoin": "and",
    "coach.wordGuide.percent": "{n}%",
  },
});

// renderCoachLanguage lives in ui/coach.js, which loads later, so it is
// looked up when a change comes.
onLanguageChange((language, previous) => renderCoachLanguage(previous));
