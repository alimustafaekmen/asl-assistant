// ─── Compact 168D + Letter 93D Feature Engineering ──────────
//
// Python build_compact_features (kelime) ve compute_letter_93d (harf)
// fonksiyonlarının JS portu.
//
// 168D Segment sırası:
//   [0..62]    dominant el landmark    63D
//   [63..92]   el şekil özellikleri    30D
//   [93..104]  el-yüz mesafeleri       12D
//   [105..167] hareket vektörleri      63D
//
// 93D harf feature (LightGBM input): tip-wrist + adjacent + pairwise + ext + bbox + 21 raw → toplam 93
// Dikkat: training Python ile birebir eşleşmesi için detaylı doğrulama gerekir.

function buildCompactFeatures(frame321d, prevFrame321d) {
  const t0 = performance.now();

  const dominant = computeDominantHand(frame321d);
  const shape = computeShapeFeatures(dominant);
  const handBody = computeHandBodyRelations(frame321d);

  const motion = new Float32Array(63);
  if (prevFrame321d) {
    const prevDom = computeDominantHand(prevFrame321d);
    for (let i = 0; i < 63; i++) {
      motion[i] = dominant[i] - prevDom[i];
    }
  }

  const compact = new Float32Array(168);
  compact.set(dominant, 0);
  compact.set(shape, 63);
  compact.set(handBody, 93);
  compact.set(motion, 105);

  if (typeof recordBenchmark === "function") {
    recordBenchmark("feature", performance.now() - t0);
  }
  return compact;
}

function buildCompactSequenceFeatures(seq321dFrames) {
  const t0 = performance.now();
  if (!Array.isArray(seq321dFrames) || seq321dFrames.length === 0) return [];

  const dominantSeq = computeDominantHandSequence(seq321dFrames);
  const compactSeq = [];

  for (let t = 0; t < seq321dFrames.length; t++) {
    const dominant = dominantSeq[t];
    const shape = computeShapeFeatures(dominant);
    const handBody = computeHandBodyRelations(seq321dFrames[t]);

    const motion = new Float32Array(63);
    if (t > 0) {
      const prevDom = dominantSeq[t - 1];
      for (let i = 0; i < 63; i++) {
        motion[i] = dominant[i] - prevDom[i];
      }
    }

    const compact = new Float32Array(168);
    compact.set(dominant, 0);
    compact.set(shape, 63);
    compact.set(handBody, 93);
    compact.set(motion, 105);
    compactSeq.push(compact);
  }

  if (typeof recordBenchmark === "function") {
    recordBenchmark("feature_sequence", performance.now() - t0);
  }
  return compactSeq;
}

function computeDominantHand(frame321d) {
  const right = frame321d.slice(0, 63);
  const left = frame321d.slice(63, 126);

  let rZeros = 0;
  let lZeros = 0;
  for (let i = 0; i < 63; i++) {
    if (Math.abs(right[i]) < 1e-8) rZeros++;
    if (Math.abs(left[i]) < 1e-8) lZeros++;
  }

  if (rZeros <= lZeros) return new Float32Array(right);

  // Sol el dominant — x mirror
  const mirrored = new Float32Array(63);
  for (let i = 0; i < 63; i += 3) {
    mirrored[i] = -left[i];
    mirrored[i + 1] = left[i + 1];
    mirrored[i + 2] = left[i + 2];
  }
  return mirrored;
}

function computeDominantHandSequence(seq321dFrames) {
  let rightZeros = 0;
  let leftZeros = 0;
  let total = 0;

  for (const frame321d of seq321dFrames) {
    for (let i = 0; i < 63; i++) {
      if (Math.abs(frame321d[i]) < 1e-8) rightZeros++;
      if (Math.abs(frame321d[63 + i]) < 1e-8) leftZeros++;
      total++;
    }
  }

  const useRight = total === 0 || rightZeros <= leftZeros;
  return seq321dFrames.map((frame321d) => {
    if (useRight) return new Float32Array(frame321d.slice(0, 63));

    const mirrored = new Float32Array(63);
    for (let i = 0; i < 63; i += 3) {
      mirrored[i] = -frame321d[63 + i];
      mirrored[i + 1] = frame321d[63 + i + 1];
      mirrored[i + 2] = frame321d[63 + i + 2];
    }
    return mirrored;
  });
}

function computeShapeFeatures(hand63) {
  // Notebook compute_per_frame_shape_features ile birebir:
  // 1) wrist'i merkez kabul et, palm_size = ||hand[9] - wrist|| ile normalize et
  // 2) tüm mesafeleri NORMALIZED hand üzerinde hesapla
  // 3) extension flag BINARY (1.0/0.0)
  // 4) bbox NORMALIZED görünür noktalar üzerinde
  const result = new Float32Array(30);

  const pts = [];
  for (let i = 0; i < 21; i++) {
    pts.push([hand63[i * 3], hand63[i * 3 + 1], hand63[i * 3 + 2]]);
  }

  const TIPS = [4, 8, 12, 16, 20];
  const MCPS = [1, 5, 9, 13, 17];
  const wrist = pts[0];

  // palm_size = wrist → middle_mcp (landmark 9) mesafesi
  const palmSize = Math.max(dist3d(pts[9], wrist), 1e-8);

  // Wrist-merkezli + palm_size ile normalize
  const norm = pts.map((p) => [
    (p[0] - wrist[0]) / palmSize,
    (p[1] - wrist[1]) / palmSize,
    (p[2] - wrist[2]) / palmSize,
  ]);

  let idx = 0;

  // 5 fingertip-wrist mesafe (normalized origin = wrist)
  for (const t of TIPS) result[idx++] = safeNorm(norm[t]);

  // 4 adjacent tip mesafe
  for (let i = 0; i < TIPS.length - 1; i++) {
    result[idx++] = dist3d(norm[TIPS[i]], norm[TIPS[i + 1]]);
  }

  // 10 pairwise tip mesafe
  for (let i = 0; i < TIPS.length; i++) {
    for (let j = i + 1; j < TIPS.length; j++) {
      result[idx++] = dist3d(norm[TIPS[i]], norm[TIPS[j]]);
    }
  }

  // 5 finger extension flag — BINARY (1.0 / 0.0)
  for (let i = 0; i < 5; i++) {
    const tipDist = safeNorm(norm[TIPS[i]]);
    const mcpDist = safeNorm(norm[MCPS[i]]);
    result[idx++] = tipDist > mcpDist ? 1.0 : 0.0;
  }

  // 3 PIP açısı: notebook for finger_position in [1,2,3] → MCP=[5,9,13], PIP=[6,10,14], DIP=[7,11,15]
  // jointAngle(a, b, c) = b'deki açı (a-b ve c-b vektörleri arasında)
  const angleTriples = [
    [5, 6, 7],   // index PIP
    [9, 10, 11], // middle PIP
    [13, 14, 15],// ring PIP
  ];
  for (const [a, b, c] of angleTriples) {
    result[idx++] = wordJointAngle(norm[a], norm[b], norm[c]);
  }

  // 2 bounding box (NORMALIZED, sıfır olmayan noktalar, sadece x,y ekseni)
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let visibleCount = 0;
  for (const p of norm) {
    // Notebook: visible = np.any(normalized_hand != 0, axis=1)
    if (p[0] !== 0 || p[1] !== 0 || p[2] !== 0) {
      visibleCount++;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (visibleCount > 2) {
    const bw = maxX - minX;
    const bh = maxY - minY;
    result[idx++] = bw / Math.max(bh, 1e-8);
    result[idx++] = bw * bh;
  } else {
    result[idx++] = 0;
    result[idx++] = 0;
  }

  // 1 ortalama fingertip mesafe (normalized)
  let sumTip = 0;
  for (const t of TIPS) sumTip += safeNorm(norm[t]);
  result[idx++] = sumTip / 5;

  return result;
}

function computeHandBodyRelations(frame321d) {
  // Notebook FACE_INDICES sırasına göre (FINAL model):
  // burun  (landmark 1)   → FACE_INDICES.indexOf(1)   = 32 → 126 + 32*3 = 222
  // ağız   (landmark 13)  → FACE_INDICES.indexOf(13)  = 13 → 126 + 13*3 = 165
  // alın   (landmark 168) → FACE_INDICES.indexOf(168) = 36 → 126 + 36*3 = 234
  const nose = [frame321d[222], frame321d[223], frame321d[224]];
  const mouth = [frame321d[165], frame321d[166], frame321d[167]];
  const forehead = [frame321d[234], frame321d[235], frame321d[236]];

  const result = new Float32Array(12);

  // Sağ el: işaret tip = landmark 8 (offset 24..26), wrist 0..2
  const rTip = [frame321d[24], frame321d[25], frame321d[26]];
  const rWrist = [frame321d[0], frame321d[1], frame321d[2]];
  result[0] = dist3d(rTip, nose);
  result[1] = dist3d(rTip, mouth);
  result[2] = dist3d(rTip, forehead);
  result[3] = dist3d(rWrist, nose);
  result[4] = rTip[1] - nose[1];
  result[5] = dist3d(rTip, rWrist);

  // Sol el
  const lTip = [frame321d[63 + 24], frame321d[63 + 25], frame321d[63 + 26]];
  const lWrist = [frame321d[63], frame321d[64], frame321d[65]];
  result[6] = dist3d(lTip, nose);
  result[7] = dist3d(lTip, mouth);
  result[8] = dist3d(lTip, forehead);
  result[9] = dist3d(lWrist, nose);
  result[10] = lTip[1] - nose[1];
  result[11] = dist3d(lTip, lWrist);

  return result;
}

// ─── Harf modeli için 93D feature ───────────────────────────
// Masaüstü Python pipeline ile birebir:
// asl_ml.utils.landmarks::normalize_landmarks + asl_ml.features.letter_features::extract_features
//   [0..62]    bilek merkezli, orta MCP mesafesiyle normalize edilmiş el
//   [63..67]   fingertip-wrist mesafeleri (5)
//   [68..71]   komşu fingertip mesafeleri (4)
//   [72..85]   parmak eklem açıları (14)
//   [86..87]   el bounding box aspect/area (2)
//   [88..92]   parmak extended flag (5)

// ─── Letter LandmarkSmoother (EMA) + motion metric ───
// Desktop landmark_smoother.py ile aynı algoritma (α=0.6 default).
// Mirror std SONRASI, normalize ÖNCESİ uygulanır → "right-hand standardized"
// 63D koordinatlara EMA. Reset: hand kaybı, mode değişimi, kamera reset.
//
// Word pipeline ETKİLENMEZ — bu sadece computeLetterFeatures içinde aktif.
let _letterPrevHandSmoothed = null; // Float32Array(63) | null
let _letterLastMotion = null;       // {meanAbsDelta, ts} | null

function _smoothLetterHand63(current63) {
  const enabled =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_LANDMARK_SMOOTHING_ENABLED != null
      ? CONFIG.LETTER_LANDMARK_SMOOTHING_ENABLED
      : true;
  const alpha =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_LANDMARK_SMOOTHING_ALPHA != null
      ? CONFIG.LETTER_LANDMARK_SMOOTHING_ALPHA
      : 0.6;

  // Hand "tamamen sıfır" ise reset (hand kaybı durumu)
  let allZero = true;
  for (let i = 0; i < 63; i++) {
    if (Math.abs(current63[i]) > 1e-8) { allZero = false; break; }
  }
  if (allZero) {
    _letterPrevHandSmoothed = null;
    return current63;
  }

  if (!enabled) {
    _letterPrevHandSmoothed = new Float32Array(current63);
    return current63;
  }

  if (!_letterPrevHandSmoothed || _letterPrevHandSmoothed.length !== 63) {
    _letterPrevHandSmoothed = new Float32Array(current63);
    return current63;
  }

  const out = new Float32Array(63);
  for (let i = 0; i < 63; i++) {
    out[i] = alpha * current63[i] + (1 - alpha) * _letterPrevHandSmoothed[i];
  }
  _letterPrevHandSmoothed = out;
  return out;
}

function _computeLetterMotion63(current63) {
  // current63 = mirror std + EMA sonrası "right-hand standardized" hand.
  // Motion = mean(abs(current - prev)). prev null ise 0 döner.
  // Bu fonksiyon EMA'dan ÖNCE prev'i tutmalı, ama EMA da prev kullanıyor.
  // Çözüm: ayrı _letterPrevHandRawForMotion tut — EMA ile karışmasın.
  if (!_letterPrevHandRawForMotion || _letterPrevHandRawForMotion.length !== 63) {
    _letterPrevHandRawForMotion = new Float32Array(current63);
    return { meanAbsDelta: 0, ts: performance.now() };
  }
  let sum = 0;
  for (let i = 0; i < 63; i++) {
    sum += Math.abs(current63[i] - _letterPrevHandRawForMotion[i]);
  }
  _letterPrevHandRawForMotion = new Float32Array(current63);
  return { meanAbsDelta: sum / 63, ts: performance.now() };
}
let _letterPrevHandRawForMotion = null;

function getLastLetterMotion() {
  return _letterLastMotion;
}

function getLetterSmoothingState() {
  // Debug için: enabled, alpha, prev'in olup olmadığı
  const enabled =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_LANDMARK_SMOOTHING_ENABLED != null
      ? CONFIG.LETTER_LANDMARK_SMOOTHING_ENABLED
      : true;
  const alpha =
    typeof CONFIG !== "undefined" && CONFIG.LETTER_LANDMARK_SMOOTHING_ALPHA != null
      ? CONFIG.LETTER_LANDMARK_SMOOTHING_ALPHA
      : 0.6;
  return { enabled, alpha, prevSet: _letterPrevHandSmoothed != null };
}

function resetLetterLandmarkSmoother() {
  _letterPrevHandSmoothed = null;
  _letterPrevHandRawForMotion = null;
  _letterLastMotion = null;
}

function computeLetterFeatures(frame321d) {
  const t0 = performance.now();
  // 1. Primary el seç (mirror std sol el için x = 1 - x içinde)
  const handPrimary = selectPrimaryHandForLetter(frame321d);
  // 2. Motion metric (EMA öncesi raw delta — kullanıcı hareketini ölçer)
  _letterLastMotion = _computeLetterMotion63(handPrimary);
  // 3. EMA smoothing (jitter düşür, normalize öncesi)
  const handSmoothed = _smoothLetterHand63(handPrimary);
  // 4. Wrist+MCP normalize
  const hand = normalizeHandForLetter(handSmoothed);
  // 5. 30D shape features
  const shape = computeLetterShapeFeatures(hand);

  const out = new Float32Array(93);
  out.set(hand, 0);
  out.set(shape, 63);

  if (typeof recordBenchmark === "function") {
    recordBenchmark("feature", performance.now() - t0);
  }
  return out;
}

function selectPrimaryHandForLetter(frame321d) {
  // Web harf modu MIRROR INVARIANCE sağlar:
  // ASL alfabesi görsel olarak mirror invariant'tır (A harfi sağ veya sol elle
  // yapılırsa kullanıcıya aynı görünür). AMA modeli besleyen ham landmark
  // koordinatları mirror invariant DEĞİL — Group 0 (raw 63 normalized koord)
  // x işaretleri farklı çıkar. Eğitim verisi (Kaggle ASL Alphabet) çoğunlukla
  // sağ-el-yoğun olduğu için sol elle yanlış sınıfa kaymalar olur.
  //
  // Çözüm: sol el algılandığında landmark x'lerini mirror et (1 - x). Bu sayede
  // her el "right-hand-standardized" formatta normalize_landmarks'a girer ve
  // model her durumda tutarlı tahmin verir. Masaüstü Python'dan farklı (orada
  // mirror yok) ama web kullanıcı deneyimi için DAHA İYİ.
  const right = frame321d.slice(0, 63);
  const left = frame321d.slice(63, 126);

  const rightVisible = _nonZeroTriplets(right);
  const leftVisible = _nonZeroTriplets(left);

  if (rightVisible === 0 && leftVisible === 0) return new Float32Array(63);
  if (rightVisible >= leftVisible) return new Float32Array(right);

  // Sol el dominant → x mirror (1 - x) ile sağ-el formatına çevir.
  // MediaPipe normalized image space [0..1] → mirror = 1 - x.
  // Sıfır landmark'lar (algılanmamış noktalar) DOKUNULMAZ — yine 0 kalsın.
  const mirrored = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    const x = left[i * 3];
    const y = left[i * 3 + 1];
    const z = left[i * 3 + 2];
    const isZero = Math.abs(x) < 1e-8 && Math.abs(y) < 1e-8 && Math.abs(z) < 1e-8;
    mirrored[i * 3] = isZero ? 0 : 1.0 - x;
    mirrored[i * 3 + 1] = y;
    mirrored[i * 3 + 2] = z;
  }
  return mirrored;
}

function _nonZeroTriplets(hand63) {
  let count = 0;
  for (let i = 0; i < 63; i += 3) {
    if (
      Math.abs(hand63[i]) > 1e-8 ||
      Math.abs(hand63[i + 1]) > 1e-8 ||
      Math.abs(hand63[i + 2]) > 1e-8
    ) {
      count++;
    }
  }
  return count;
}

function normalizeHandForLetter(hand63) {
  const pts = [];
  for (let i = 0; i < 21; i++) {
    pts.push([hand63[i * 3], hand63[i * 3 + 1], hand63[i * 3 + 2]]);
  }

  const wrist = pts[0];
  const centered = pts.map((p) => [
    p[0] - wrist[0],
    p[1] - wrist[1],
    p[2] - wrist[2],
  ]);
  const refDist = safeNorm(centered[9]);
  if (refDist <= 1e-6) return new Float32Array(63);

  const out = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    out[i * 3] = centered[i][0] / refDist;
    out[i * 3 + 1] = centered[i][1] / refDist;
    out[i * 3 + 2] = centered[i][2] / refDist;
  }
  return out;
}

function computeLetterShapeFeatures(hand63) {
  const result = new Float32Array(30);
  const pts = [];
  for (let i = 0; i < 21; i++) {
    pts.push([hand63[i * 3], hand63[i * 3 + 1], hand63[i * 3 + 2]]);
  }

  const fingertipIds = [4, 8, 12, 16, 20];
  const adjacentPairs = [[4, 8], [8, 12], [12, 16], [16, 20]];
  const angleTriples = [
    [1, 2, 3], [2, 3, 4],
    [0, 5, 6], [5, 6, 7], [6, 7, 8],
    [0, 9, 10], [9, 10, 11], [10, 11, 12],
    [0, 13, 14], [13, 14, 15], [14, 15, 16],
    [0, 17, 18], [17, 18, 19], [18, 19, 20],
  ];
  const extendedPairs = [[4, 2], [8, 5], [12, 9], [16, 13], [20, 17]];

  let idx = 0;
  const wrist = pts[0];

  for (const tip of fingertipIds) {
    result[idx++] = dist3d(pts[tip], wrist);
  }

  for (const [a, b] of adjacentPairs) {
    result[idx++] = dist3d(pts[a], pts[b]);
  }

  for (const [a, b, c] of angleTriples) {
    result[idx++] = jointAngle(pts[a], pts[b], pts[c]);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  result[idx++] = boxWidth / (boxHeight + 1e-8);
  result[idx++] = boxWidth * boxHeight;

  for (const [tip, mcp] of extendedPairs) {
    result[idx++] = dist3d(pts[tip], wrist) > dist3d(pts[mcp], wrist) ? 1.0 : 0.0;
  }

  return result;
}

function dist3d(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function safeNorm(v) {
  return Math.max(Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]), 1e-8);
}

function wordJointAngle(a, b, c) {
  // a-b ve c-b vektörleri arası açı (radyan)
  const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = safeNorm(v1);
  const n2 = safeNorm(v2);
  const cos = Math.max(-1, Math.min(1, dot / (n1 * n2)));
  return Math.acos(cos);
}

function jointAngle(a, b, c) {
  // Harf pipeline kontratı: eksik/sıfır eklemde açı 0 döner.
  const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = Math.sqrt(v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2);
  const n2 = Math.sqrt(v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2);
  if (n1 < 1e-8 || n2 < 1e-8) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (n1 * n2)));
  return Math.acos(cos);
}
