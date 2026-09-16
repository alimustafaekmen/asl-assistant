// ─── MediaPipe Landmark → 321D Vektör / 321D Landmark Vector ──
//
// TR: MediaPipe sonuçlarını (el + yüz + gövde) tek bir 321 sayılık düz
//     vektöre çevirir. Bu sıra, modelin eğitildiği notebook'taki
//     load_single_parquet çıktısıyla BİREBİR AYNI olmak zorundadır;
//     sıra bozulursa model "farklı bir dil" görür ve yanlış tahmin eder.
// EN: Flattens MediaPipe results (hands + face + pose) into one 321-float
//     vector. The order MUST match the training notebook exactly —
//     if the order drifts, the model sees garbage and mispredicts.
//
// 321D SIRASI / LAYOUT:
//   [0..62]    sağ el / right hand   (21 nokta × 3)
//   [63..125]  sol el / left hand    (21 nokta × 3)
//   [126..245] yüz / face            (40 seçili nokta × 3)
//   [246..320] gövde / pose          (25 seçili nokta × 3)
//
// FACE_INDICES — train_word_model_final.ipynb CELL 1'den birebir kopya.
// (Eski V4 meta'dan farklıdır — bu FINAL modelin sırasıdır.)
// FACE_INDICES is copied verbatim from the final training notebook.

const FACE_INDICES = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375,    // Dudak dış (10)
  78, 191, 80, 13, 312, 308,                       // Dudak iç  (6)
  33, 133, 159, 145, 263, 362, 386, 374,           // Göz       (8)
  70, 63, 105, 66, 300, 293, 334, 296,             // Kaş       (8)
  1, 2, 98, 327, 168, 197, 195, 5,                 // Burun+alın(8)
];

const POSE_INDICES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  23, 24, 25, 26, 27, 28, 29, 30,
];

console.assert(FACE_INDICES.length === 40, "FACE_INDICES 40 eleman olmalı");
console.assert(POSE_INDICES.length === 25, "POSE_INDICES 25 eleman olmalı");

// TR: MediaPipe bazen listeyi "kişi başına liste" olarak iç içe döndürür;
//     biz her zaman ilk kişinin noktalarını kullanırız.
// EN: MediaPipe may nest lists per detected person; we always take the
//     first person's landmarks.
function _firstList(maybeNested) {
  if (!maybeNested) return null;
  if (Array.isArray(maybeNested) && maybeNested.length > 0) {
    // İç eleman array ise (multi-person), ilkini al
    if (Array.isArray(maybeNested[0])) return maybeNested[0];
    return maybeNested; // Düz dizi
  }
  return null;
}

// TR: Görünmeyen parça (ör. sol el yoksa) vektörde 0 olarak kalır — model
//     eğitimde de eksik parçaları 0 olarak gördü, bu yüzden sorun değildir.
// EN: Missing parts (e.g. no left hand) stay 0 in the vector — training
//     used the same convention, so zeros are expected, not an error.
function landmarksTo321D(holisticResult) {
  const vec = new Float32Array(321);
  if (!holisticResult) return vec;

  const rh = _firstList(holisticResult.rightHandLandmarks);
  if (rh) {
    for (let i = 0; i < 21 && i < rh.length; i++) {
      vec[i * 3] = rh[i].x ?? 0;
      vec[i * 3 + 1] = rh[i].y ?? 0;
      vec[i * 3 + 2] = rh[i].z ?? 0;
    }
  }

  const lh = _firstList(holisticResult.leftHandLandmarks);
  if (lh) {
    for (let i = 0; i < 21 && i < lh.length; i++) {
      vec[63 + i * 3] = lh[i].x ?? 0;
      vec[63 + i * 3 + 1] = lh[i].y ?? 0;
      vec[63 + i * 3 + 2] = lh[i].z ?? 0;
    }
  }

  const face = _firstList(holisticResult.faceLandmarks);
  if (face) {
    for (let j = 0; j < FACE_INDICES.length; j++) {
      const fi = FACE_INDICES[j];
      if (fi < face.length) {
        vec[126 + j * 3] = face[fi].x ?? 0;
        vec[126 + j * 3 + 1] = face[fi].y ?? 0;
        vec[126 + j * 3 + 2] = face[fi].z ?? 0;
      }
    }
  }

  const pose = _firstList(holisticResult.poseLandmarks);
  if (pose) {
    for (let j = 0; j < POSE_INDICES.length; j++) {
      const pi = POSE_INDICES[j];
      if (pi < pose.length) {
        vec[246 + j * 3] = pose[pi].x ?? 0;
        vec[246 + j * 3 + 1] = pose[pi].y ?? 0;
        vec[246 + j * 3 + 2] = pose[pi].z ?? 0;
      }
    }
  }

  return vec;
}

// TR: Kelime modeli için normalizasyon — tüm noktaları omuz merkezine göre
//     kaydırır ve omuz genişliğine böler. Böylece kişinin ekrandaki yeri ve
//     kameraya uzaklığı modelin kararını etkilemez.
//     Omuzlar görünmüyorsa notebook'taki min-max fallback'e düşer.
// EN: Word-model normalization — recenter on the shoulder midpoint and
//     scale by shoulder width, so position/distance to camera don't matter.
//     Falls back to the notebook's min-max normalization when shoulders
//     are not visible.
function normalizeShoulders(frame321d) {
  // Sol omuz / left shoulder:  pose 11 → 246 + 11*3 = 279
  // Sağ omuz / right shoulder: pose 12 → 246 + 12*3 = 282
  const LS_OFF = 279;
  const RS_OFF = 282;

  const ls = [frame321d[LS_OFF], frame321d[LS_OFF + 1], frame321d[LS_OFF + 2]];
  const rs = [frame321d[RS_OFF], frame321d[RS_OFF + 1], frame321d[RS_OFF + 2]];

  const lsOk = ls.some((v) => Math.abs(v) > 1e-6);
  const rsOk = rs.some((v) => Math.abs(v) > 1e-6);
  if (!lsOk || !rsOk) return normalizeShouldersFallbackMinMax(frame321d);

  const cx = (ls[0] + rs[0]) / 2;
  const cy = (ls[1] + rs[1]) / 2;
  const cz = (ls[2] + rs[2]) / 2;
  const w = Math.sqrt(
    (ls[0] - rs[0]) ** 2 + (ls[1] - rs[1]) ** 2 + (ls[2] - rs[2]) ** 2,
  );
  if (w < 1e-6) return normalizeShouldersFallbackMinMax(frame321d);

  const out = new Float32Array(321);
  for (let i = 0; i < 321; i += 3) {
    const nonZero =
      Math.abs(frame321d[i]) > 1e-8 ||
      Math.abs(frame321d[i + 1]) > 1e-8 ||
      Math.abs(frame321d[i + 2]) > 1e-8;
    if (nonZero) {
      out[i] = (frame321d[i] - cx) / w;
      out[i + 1] = (frame321d[i + 1] - cy) / w;
      out[i + 2] = (frame321d[i + 2] - cz) / w;
    }
  }
  return out;
}

function normalizeShouldersFallbackMinMax(frame321d) {
  // TR: Notebook parity — omuzlar yoksa sıfır-olmayan değerler üzerinde
  //     min-max normalizasyonu yapılır; sıfırlar "eksik landmark" anlamına
  //     geldiği için sıfır olarak korunur.
  // EN: Notebook parity — min-max over non-zero values when shoulders are
  //     missing; zeros mean "missing landmark" and must stay zero.
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < frame321d.length; i++) {
    const v = frame321d[i];
    if (Math.abs(v) > 1e-8) {
      if (v < minValue) minValue = v;
      if (v > maxValue) maxValue = v;
    }
  }

  const out = new Float32Array(frame321d.length);
  if (minValue === Infinity) return out;

  const range = maxValue - minValue;
  if (range <= 1e-6) {
    out.set(frame321d);
    return out;
  }

  for (let i = 0; i < frame321d.length; i++) {
    const v = frame321d[i];
    out[i] = Math.abs(v) > 1e-8 ? (v - minValue) / range : 0;
  }
  return out;
}
