// ─── Güven Yönetimi + Confusion Feedback ─────────────────────

let confusionPairs = [];
let perWordStats = {};
let curriculumData = null;

async function loadGatingData() {
  try {
    const tasks = [
      fetch("./data/confusion_pairs.json").then((r) => r.json()).catch(() => []),
      fetch("./data/per_word_stats.json").then((r) => r.json()).catch(() => ({})),
      fetch("./data/curriculum.json").then((r) => r.json()).catch(() => null),
    ];
    const [conf, stats, curr] = await Promise.all(tasks);
    confusionPairs = Array.isArray(conf) ? conf : [];
    perWordStats = stats || {};
    curriculumData = curr;
    console.log(
      `Gating yüklendi: ${confusionPairs.length} confusion pair, ${Object.keys(perWordStats).length} word stats`,
    );
    return true;
  } catch (err) {
    console.warn("Gating verileri yüklenemedi:", err);
    return false;
  }
}

function getConfusionFeedback(top1, top2) {
  if (!top1 || !top2) return null;
  const margin = top1.confidence - top2.confidence;
  if (margin > 0.2) return null;

  const pair = confusionPairs.find((p) => {
    const a = p.word_a || p.a || (Array.isArray(p) ? p[0] : null);
    const b = p.word_b || p.b || (Array.isArray(p) ? p[1] : null);
    return (
      (a === top1.label && b === top2.label) ||
      (a === top2.label && b === top1.label)
    );
  });

  if (pair) {
    return `⚠ ${top1.label} / ${top2.label} sık karışır. Hareketi daha belirgin yapın.`;
  }
  return null;
}

function getWordDifficulty(word) {
  const stats = perWordStats[word];
  if (!stats) return "unknown";
  if (stats.difficulty) return stats.difficulty;
  const f1 = stats.f1 || stats.f1_score || stats.test_f1 || 0;
  if (f1 >= 0.8) return "easy";
  if (f1 >= 0.6) return "medium";
  return "hard";
}

function getDifficultyMessage(word) {
  const diff = getWordDifficulty(word);
  if (diff === "hard") {
    return `⚠ "${word}" model için zor sınıfta. Tahmini dikkatli yorumlayın.`;
  }
  return null;
}

// ─── Smoother (harf modu için) ───────────────────────────────
// Son N tahminin ETİKET YOĞUNLUĞU ile yumuşatılmış sonuç.
//
// Her tahmin tek bir label içerir (ONNX label-only fallback nedeniyle
// gerçek probability vektörü yok). Smoother window'unu doldurup en
// baskın label'ı seçer; confidence = (o label'ın oranı × o label'ın
// raw confidence ortalaması). Bu sayede:
//   - 5/5 stabil A → confidence 1.0 × 1.0 = 1.0 (Güvenli)
//   - 3/5 A, 2/5 B → confidence 0.6 × 1.0 = 0.6 (Muhtemel)
//   - 1/5 A, 4 farklı → 0.2 × ... = 0.2 (Emin değil)
const _smoother = {
  buffer: [],
  push(prediction) {
    this.buffer.push(prediction);
    if (this.buffer.length > (typeof CONFIG !== "undefined" ? CONFIG.SMOOTHER_WINDOW : 5)) {
      this.buffer.shift();
    }
  },
  get() {
    if (this.buffer.length === 0) return null;
    const window = this.buffer.length;
    // Her label için count + confidence sum
    const counts = {};
    const confSum = {};
    let best = null;
    let bestCount = 0;
    for (const p of this.buffer) {
      counts[p.label] = (counts[p.label] || 0) + 1;
      confSum[p.label] = (confSum[p.label] || 0) + (p.confidence ?? 0);
      if (counts[p.label] > bestCount) {
        bestCount = counts[p.label];
        best = p.label;
      }
    }
    // Best label için raw avg confidence
    const rawAvg = bestCount > 0 ? confSum[best] / bestCount : 0;
    // Window dominance oranı (0..1)
    const dominance = bestCount / window;
    // Final confidence = stability × raw avg
    const smoothedConf = dominance * rawAvg;
    // En son alternatives'i kullan (top-3 göstermek için)
    const matching = this.buffer.filter((p) => p.label === best);
    const last = matching[matching.length - 1];
    return {
      label: best,
      confidence: smoothedConf,
      alternatives: last.alternatives || [],
    };
  },
  reset() {
    this.buffer = [];
  },
};

function smoothLetterPrediction(prediction) {
  _smoother.push(prediction);
  return _smoother.get();
}

function resetSmoother() {
  _smoother.reset();
}
