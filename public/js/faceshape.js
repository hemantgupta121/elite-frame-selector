/* Elite Frame Finder — face-shape engine.
 * Pure functions over MediaPipe FaceLandmarker output (478 landmarks, normalised x/y/z).
 * Works in the browser (window.FaceShape) and in Node (module.exports) so it can be unit-tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FaceShape = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // MediaPipe Face Mesh landmark indices used for measurement.
  const L = {
    top: 10, chin: 152,
    foreheadL: 21, foreheadR: 251,       // upper temple / hairline edge
    cheekL: 234, cheekR: 454,            // widest face contour at cheekbone level
    jawL: 172, jawR: 397,                // lower jaw, just above the chin curve
    bridge: 6, innerEyeL: 133, innerEyeR: 362,
    irisLC: 468, irisLa: 469, irisLt: 470, irisLb: 471, irisLbt: 472,   // iris centre + ring (right, top, left, bottom)
    irisRC: 473, irisRa: 474, irisRt: 475, irisRb: 476, irisRbt: 477,
    noseTip: 1, nasion: 168,
    skinCheekL: 50, skinCheekR: 280, skinBrow: 9
  };

  const IRIS_MM = 11.7;     // human iris diameter is ~11.7 mm (very low variance) — used as a ruler.
  const EYE_ROT_MM = 12;    // eye's centre of rotation sits ~12 mm behind the pupil plane; drives the convergence correction.
  const DEFAULT_HFOV = 66;  // typical tablet camera field of view (degrees, long side) — only used to estimate camera distance.

  const SHAPES = ['Oval', 'Round', 'Square', 'Heart', 'Oblong', 'Diamond', 'Triangle'];

  // Opticians' fitting rules, encoded once. "Sheet" = acetate/plastic in Indian optical trade language.
  const RULES = {
    Oval: {
      summary: 'Balanced proportions. Most frame shapes suit you, so choose by style and size.',
      shapes: ['Rectangle', 'Square', 'Wayfarer', 'Aviator', 'Cat-eye', 'Round', 'Browline'],
      avoid: ['Oversized'],
      weight: ['Medium', 'Thin', 'Broad'],
      materials: ['Sheet', 'Metal', 'TR90', 'Combination', 'Titanium'],
      rims: ['Full', 'Half', 'Rimless'],
      tips: ['Keep the frame as wide as the face, not wider.', 'Avoid very oversized frames that hide the natural balance.']
    },
    Round: {
      summary: 'Soft, full cheeks with similar length and width. Angular frames add definition.',
      shapes: ['Rectangle', 'Square', 'Wayfarer', 'Cat-eye', 'Geometric', 'Browline'],
      avoid: ['Round', 'Oval', 'Small'],
      weight: ['Broad', 'Medium'],
      materials: ['Sheet', 'Combination', 'TR90'],
      rims: ['Full', 'Half'],
      tips: ['Choose frames slightly wider than the face to lengthen it.', 'Bold sheet (acetate) frames with sharp corners work best.', 'Avoid round, small or rimless frames.']
    },
    Square: {
      summary: 'Strong jaw and broad forehead. Curved frames soften the angles.',
      shapes: ['Round', 'Oval', 'Aviator', 'Cat-eye', 'Browline'],
      avoid: ['Square', 'Rectangle', 'Geometric'],
      weight: ['Thin', 'Medium'],
      materials: ['Metal', 'Titanium', 'Combination'],
      rims: ['Full', 'Half', 'Rimless'],
      tips: ['Thin metal rims or rimless frames keep the look light.', 'Oval and round lenses balance the jawline.', 'Avoid boxy, heavy frames.']
    },
    Heart: {
      summary: 'Wider forehead, narrow chin. Frames that add width below the eyes balance the face.',
      shapes: ['Round', 'Oval', 'Aviator', 'Wayfarer', 'Rimless'],
      avoid: ['Cat-eye', 'Browline', 'Oversized'],
      weight: ['Thin', 'Medium'],
      materials: ['Metal', 'Titanium', 'TR90'],
      rims: ['Rimless', 'Half', 'Full'],
      tips: ['Light, thin frames or rimless keep attention off the wide forehead.', 'Bottom-heavy shapes such as aviators add width at the chin.', 'Avoid top-heavy or cat-eye frames.']
    },
    Oblong: {
      summary: 'Face is longer than wide. Deep, wide frames make it look shorter and fuller.',
      shapes: ['Oversized', 'Square', 'Wayfarer', 'Round', 'Aviator'],
      avoid: ['Rectangle', 'Small', 'Narrow'],
      weight: ['Broad', 'Medium'],
      materials: ['Sheet', 'Combination', 'TR90'],
      rims: ['Full'],
      tips: ['Pick tall (deep) lenses, not narrow rectangles.', 'Decorative or contrasting temples add width.', 'A low bridge shortens the nose visually.']
    },
    Diamond: {
      summary: 'Wide cheekbones, narrow forehead and chin. Detail on the brow line balances the cheeks.',
      shapes: ['Oval', 'Cat-eye', 'Browline', 'Rimless', 'Round'],
      avoid: ['Narrow', 'Geometric'],
      weight: ['Thin', 'Medium'],
      materials: ['Metal', 'Titanium', 'Combination'],
      rims: ['Half', 'Rimless', 'Full'],
      tips: ['Browline and cat-eye frames widen the forehead line.', 'Oval lenses soften the cheekbones.', 'Rimless frames keep the look delicate.']
    },
    Triangle: {
      summary: 'Narrow forehead, wider jaw. Frames with weight and detail on top balance the jaw.',
      shapes: ['Cat-eye', 'Browline', 'Aviator', 'Rectangle', 'Wayfarer'],
      avoid: ['Narrow', 'Small'],
      weight: ['Broad', 'Medium'],
      materials: ['Sheet', 'Combination', 'Metal'],
      rims: ['Full', 'Half'],
      tips: ['Choose frames with a bold top bar or dark upper rim.', 'Slightly wider frames balance the jaw.', 'Avoid frames with heavy detail at the bottom.']
    }
  };

  const COLOURS = {
    Warm: { families: ['Gold', 'Brown', 'Tortoise', 'Honey', 'Olive', 'Copper', 'Cream'], note: 'Warm undertone: gold, brown, tortoise and honey tones flatter the skin.' },
    Cool: { families: ['Silver', 'Black', 'Blue', 'Grey', 'Burgundy', 'Purple', 'Gunmetal'], note: 'Cool undertone: silver, black, blue, grey and burgundy look sharpest.' },
    Neutral: { families: ['Black', 'Tortoise', 'Gunmetal', 'Brown', 'Transparent', 'Rose gold'], note: 'Neutral undertone: both warm and cool colours work; contrast with the skin decides.' }
  };

  // ---------- geometry helpers ----------
  function px(lm, i, w, h) { const p = lm[i]; return { x: p.x * w, y: p.y * h, z: (p.z || 0) * w }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function angleAt(c, a, b) {
    const v1 = { x: a.x - c.x, y: a.y - c.y }, v2 = { x: b.x - c.x, y: b.y - c.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1;
    return Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180 / Math.PI;
  }
  function closeness(value, ideal, tol) { const d = Math.abs(value - ideal) / tol; return Math.max(0, 1 - d * d); }

  // ---------- measurements ----------
  // opts.scale   — staff calibration factor from a PD ruler (1 = none). Multiplies every mm value.
  // opts.hfovDeg — camera field of view used to estimate how far the customer is from the tablet.
  function measure(lm, w, h, opts) {
    opts = opts || {};
    const scale = opts.scale > 0 ? opts.scale : 1;
    const hfov = opts.hfovDeg || DEFAULT_HFOV;
    const P = (i) => px(lm, i, w, h);
    const top = P(L.top), chin = P(L.chin);
    const faceLen = dist(top, chin);
    const foreheadW = dist(P(L.foreheadL), P(L.foreheadR));
    const cheekW = dist(P(L.cheekL), P(L.cheekR));
    const jawW = dist(P(L.jawL), P(L.jawR));
    const chinAngle = angleAt(chin, P(L.jawL), P(L.jawR));

    // Iris ruler: average of four diameters (horizontal + vertical, both eyes) to cut landmark jitter.
    const irisPx = (dist(P(L.irisLa), P(L.irisLb)) + dist(P(L.irisLt), P(L.irisLbt)) + dist(P(L.irisRa), P(L.irisRb)) + dist(P(L.irisRt), P(L.irisRbt))) / 4;
    const mmPerPx = irisPx > 0 ? (IRIS_MM * scale) / irisPx : null;
    const pdPx = dist(P(L.irisLC), P(L.irisRC));
    const pdNearMm = mmPerPx ? pdPx * mmPerPx : null;

    // The customer looks AT the tablet, so the eyes converge and the pupils sit closer together than when
    // looking far away (what a PD ruler measures). Estimate camera distance from the iris size and add the
    // convergence back: each eye rotates about a point ~12 mm behind the pupil, so shift = 12 * (PD/2) / distance per eye.
    const fPx = (Math.max(w, h) / 2) / Math.tan((hfov / 2) * Math.PI / 180);
    const cameraDistMm = irisPx > 0 ? fPx * IRIS_MM / irisPx : null;
    const convergenceMm = pdNearMm && cameraDistMm ? Math.max(0, Math.min(6, EYE_ROT_MM * pdNearMm / cameraDistMm)) : 0;
    const pdMm = pdNearMm ? pdNearMm + convergenceMm : null;

    // Bridge height: how far the nasion (6) sits in front of the inner eye corners. z is negative towards camera.
    const bridgeRel = ((P(L.innerEyeL).z + P(L.innerEyeR).z) / 2 - P(L.bridge).z) / (cheekW || 1);

    // Head pose sanity: nose tip should sit midway between the cheeks when the face is frontal.
    const midX = (P(L.cheekL).x + P(L.cheekR).x) / 2;
    const yaw = (P(L.noseTip).x - midX) / (cheekW || 1); // ~0 = frontal, sign = direction

    return {
      faceLen, foreheadW, cheekW, jawW, chinAngle, irisPx, mmPerPx, pdPx, bridgeRel, yaw,
      scale, cameraDistMm, convergenceMm, pdNearMm,
      pdRawMm: pdMm ? pdMm / scale : null, // distance PD before staff calibration — what a ruler reading is compared against
      lengthRatio: faceLen / (cheekW || 1),
      foreheadRatio: foreheadW / (cheekW || 1),
      jawRatio: jawW / (cheekW || 1),
      foreheadJaw: foreheadW / (jawW || 1),
      pdMm,
      faceWidthMm: mmPerPx ? cheekW * mmPerPx : null,
      faceLengthMm: mmPerPx ? faceLen * mmPerPx : null
    };
  }

  // ---------- classification ----------
  // Each shape is scored by how close the proportions sit to its typical profile. Scores are
  // exposed so staff can see the runner-up and override when the camera angle fooled the numbers.
  function classify(m, opts) {
    const s = {};
    s.Oval = 0.35 * closeness(m.lengthRatio, 1.38, 0.18) + 0.25 * closeness(m.jawRatio, 0.78, 0.08) + 0.2 * closeness(m.foreheadRatio, 0.9, 0.08) + 0.2 * closeness(m.chinAngle, 108, 18);
    s.Round = 0.4 * closeness(m.lengthRatio, 1.18, 0.14) + 0.25 * closeness(m.jawRatio, 0.78, 0.08) + 0.15 * closeness(m.foreheadRatio, 0.9, 0.08) + 0.2 * closeness(m.chinAngle, 120, 16);
    s.Square = 0.35 * closeness(m.lengthRatio, 1.2, 0.15) + 0.35 * closeness(m.jawRatio, 0.88, 0.07) + 0.1 * closeness(m.foreheadRatio, 0.92, 0.08) + 0.2 * closeness(m.chinAngle, 128, 16);
    s.Oblong = 0.7 * closeness(m.lengthRatio, 1.62, 0.2) + 0.15 * closeness(m.jawRatio, 0.8, 0.1) + 0.15 * closeness(m.foreheadRatio, 0.9, 0.1);
    s.Heart = 0.35 * closeness(m.foreheadJaw, 1.35, 0.2) + 0.3 * closeness(m.jawRatio, 0.68, 0.07) + 0.15 * closeness(m.foreheadRatio, 0.94, 0.07) + 0.2 * closeness(m.chinAngle, 92, 16);
    s.Diamond = 0.35 * closeness(m.foreheadRatio, 0.8, 0.07) + 0.35 * closeness(m.jawRatio, 0.7, 0.07) + 0.15 * closeness(m.lengthRatio, 1.4, 0.2) + 0.15 * closeness(m.chinAngle, 96, 16);
    s.Triangle = 0.45 * closeness(m.foreheadJaw, 0.85, 0.12) + 0.3 * closeness(m.jawRatio, 0.9, 0.07) + 0.25 * closeness(m.foreheadRatio, 0.78, 0.08);

    // Learning from the optician: when staff have corrected/confirmed enough faces on this tablet, blend the
    // rule scores with a nearest-neighbour vote over those labelled faces. The rules give a sensible start;
    // the samples pull the boundaries towards this shop's real customers.
    const samples = (opts && opts.samples) || [];
    let learned = false;
    if (samples.length >= MIN_SAMPLES) {
      const f = features(m);
      const k = Math.min(7, samples.length);
      const near = samples.map((sm) => ({ shape: sm.shape, d: fdist(f, sm.f) })).sort((a, b) => a.d - b.d).slice(0, k);
      const votes = {}; let wsum = 0;
      near.forEach((n) => { const w = 1 / (n.d + 0.15); votes[n.shape] = (votes[n.shape] || 0) + w; wsum += w; });
      for (const sh of SHAPES) s[sh] = 0.5 * s[sh] + 0.5 * ((votes[sh] || 0) / (wsum || 1));
      learned = true;
    }

    const ranked = SHAPES.map((k) => ({ shape: k, score: s[k] })).sort((a, b) => b.score - a.score);
    // Confidence = how clearly the winner beats the rest (softmax over scores), not its share of the total.
    // With seven overlapping shapes a share can never be high even when the answer is obvious.
    const T = 0.12;
    const exps = ranked.map((r) => Math.exp((r.score - ranked[0].score) / T));
    const confidence = 1 / exps.reduce((a, b) => a + b, 0);
    return { shape: ranked[0].shape, runnerUp: ranked[1].shape, confidence, scores: s, ranked, learned, sampleCount: samples.length };
  }

  const MIN_SAMPLES = 8;
  // Feature vector for nearest-neighbour learning, each axis scaled by its typical tolerance.
  function features(m) { return [m.lengthRatio / 0.18, m.jawRatio / 0.08, m.foreheadRatio / 0.08, m.chinAngle / 16]; }
  function fdist(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(d); }

  // ---------- frame-on measurements (boxing system) ----------
  // boxes: { right: {x1,y1,x2,y2}, left: {x1,y1,x2,y2} } in image pixels, tapped on the lens edges (inside the rim).
  // "right" = customer's right lens, which is on the LEFT of an unmirrored photo. Returns mm values via mmPerPx.
  function frameBox(boxes, lm, w, h, mmPerPx) {
    if (!boxes || !boxes.right || !boxes.left || !mmPerPx) return null;
    const norm = (b) => ({ x1: Math.min(b.x1, b.x2), x2: Math.max(b.x1, b.x2), y1: Math.min(b.y1, b.y2), y2: Math.max(b.y1, b.y2) });
    const R = norm(boxes.right), Lb = norm(boxes.left);
    const P = (i) => px(lm, i, w, h);
    // Pupil centres by image position (smaller x = customer's right eye), nose centre from the bridge landmarks.
    const irises = [P(L.irisLC), P(L.irisRC)].sort((a, b) => a.x - b.x);
    const pupilR = irises[0], pupilL = irises[1];
    const noseX = (P(L.bridge).x + P(L.nasion).x) / 2;
    const mm = (v) => Math.round(v * mmPerPx * 10) / 10;
    const out = {
      hboxR: mm(R.x2 - R.x1), hboxL: mm(Lb.x2 - Lb.x1),
      vboxR: mm(R.y2 - R.y1), vboxL: mm(Lb.y2 - Lb.y1),
      dbl: mm(Lb.x1 - R.x2),
      totalWidth: mm(Lb.x2 - R.x1),
      // Fitting (segment) height: pupil centre straight down to the lowest edge of the lens box.
      fitR: mm(R.y2 - pupilR.y), fitL: mm(Lb.y2 - pupilL.y),
      // Monocular PD: pupil centre to the nose centre line, each side.
      monoR: mm(noseX - pupilR.x), monoL: mm(pupilL.x - noseX),
      // Pupil position inside the box, for decentration checks.
      pupilFromLensCentreR: mm(pupilR.x - (R.x1 + R.x2) / 2), pupilFromLensCentreL: mm(pupilL.x - (Lb.x1 + Lb.x2) / 2),
      pupils: { right: pupilR, left: pupilL }, noseX
    };
    out.hbox = Math.round((out.hboxR + out.hboxL) / 2 * 10) / 10;
    out.vbox = Math.round((out.vboxR + out.vboxL) / 2 * 10) / 10;
    out.warnings = [];
    if (Math.abs(out.hboxR - out.hboxL) > 2) out.warnings.push('Left and right lens widths differ by ' + Math.abs(out.hboxR - out.hboxL).toFixed(1) + ' mm; check the taps or the head angle.');
    if (out.fitR < 12 || out.fitL < 12) out.warnings.push('Fitting height under 12 mm: too shallow for most progressive designs.');
    if (Math.abs(out.fitR - out.fitL) > 2) out.warnings.push('Fitting heights differ by more than 2 mm; check that the frame sits level.');
    return out;
  }

  // ---------- skin undertone (optional; needs a pixel sampler) ----------
  // sampler(x, y) must return {r,g,b} averaged around the pixel. Lighting shifts this, so it is a hint only.
  function undertone(lm, w, h, sampler) {
    if (!sampler) return null;
    const pts = [L.skinCheekL, L.skinCheekR, L.skinBrow].map((i) => px(lm, i, w, h));
    let r = 0, g = 0, b = 0, n = 0;
    for (const p of pts) { const c = sampler(Math.round(p.x), Math.round(p.y)); if (c) { r += c.r; g += c.g; b += c.b; n++; } }
    if (!n) return null;
    r /= n; g /= n; b /= n;
    const warmIndex = (r - b) / Math.max(1, r);       // higher = more yellow/red than blue
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    let tone = 'Neutral';
    if (warmIndex > 0.4) tone = 'Warm'; else if (warmIndex < 0.28) tone = 'Cool';
    const depth = lum > 175 ? 'Fair' : lum > 110 ? 'Medium' : 'Deep';
    return { tone, depth, warmIndex, rgb: { r: Math.round(r), g: Math.round(g), b: Math.round(b) } };
  }

  // ---------- frame size ----------
  function sizing(m) {
    if (!m.faceWidthMm) return null;
    // Frame total width (across the front) should roughly equal face width at the cheekbones.
    const frameWidth = Math.round(m.faceWidthMm - 2);
    const bridge = m.pdMm ? Math.max(14, Math.min(24, Math.round(m.pdMm - 44))) : 18; // heuristic: PD 62 -> bridge 18
    const eye = Math.round((frameWidth - bridge - 8) / 2);
    const label = frameWidth < 128 ? 'Narrow' : frameWidth <= 138 ? 'Medium' : 'Wide';
    return { frameWidth, eye, bridge, label, pd: m.pdMm ? Math.round(m.pdMm) : null, range: [frameWidth - 4, frameWidth + 4] };
  }

  function bridgeAdvice(m) {
    if (m.bridgeRel > 0.035) return { level: 'High', text: 'High nose bridge: sheet (acetate) frames with a keyhole or fixed bridge sit well.' };
    if (m.bridgeRel < 0.012) return { level: 'Low', text: 'Low nose bridge: prefer metal frames with adjustable nose pads, or a low-bridge-fit sheet frame, so the frame does not slide or touch the cheeks.' };
    return { level: 'Medium', text: 'Medium nose bridge: both sheet and metal frames fit comfortably.' };
  }

  function recommend(shape, tone) {
    const rule = RULES[shape] || RULES.Oval;
    const colour = COLOURS[(tone && tone.tone) || 'Neutral'];
    return {
      shape, summary: rule.summary, shapes: rule.shapes, avoid: rule.avoid, tips: rule.tips,
      weight: rule.weight[0], weights: rule.weight, material: rule.materials[0], materials: rule.materials, rims: rule.rims,
      colourFamilies: colour.families, colourNote: colour.note
    };
  }

  // Combine several frames of the same face (live camera burst): median of the mm values, majority vote on
  // shape. Landmark jitter between frames is the biggest single source of PD/size error on one photo.
  function aggregate(results) {
    if (!results || !results.length) return null;
    if (results.length === 1) return Object.assign({}, results[0], { frames: 1, pdSpread: 0 });
    const withMm = results.filter((r) => r.measurements.pdMm);
    const base = withMm.length ? withMm : results;
    const median = (k) => { const v = base.map((r) => r.measurements[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const votes = {}; base.forEach((r) => { votes[r.classification.shape] = (votes[r.classification.shape] || 0) + 1; });
    const shape = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
    const sortedByPd = base.slice().sort((a, b) => (a.measurements.pdMm || 0) - (b.measurements.pdMm || 0));
    const mid = sortedByPd.find((r) => r.classification.shape === shape) || sortedByPd[Math.floor(sortedByPd.length / 2)];
    const m = Object.assign({}, mid.measurements);
    for (const k of ['pdMm', 'pdNearMm', 'pdRawMm', 'faceWidthMm', 'faceLengthMm', 'cameraDistMm', 'convergenceMm']) { const v = median(k); if (v != null) m[k] = v; }
    const pds = base.map((r) => r.measurements.pdMm).filter(Boolean);
    return Object.assign({}, mid, {
      measurements: m, size: sizing(m), frames: results.length,
      pdSpread: pds.length ? Math.max(...pds) - Math.min(...pds) : 0,
      classification: Object.assign({}, mid.classification, { shape, votes }),
      recommendation: recommend(shape, mid.tone)
    });
  }

  function analyze(lm, w, h, sampler, opts) {
    const m = measure(lm, w, h, opts);
    const cls = classify(m, opts);
    const tone = undertone(lm, w, h, sampler);
    const size = sizing(m);
    const bridge = bridgeAdvice(m);
    const rec = recommend(cls.shape, tone);
    const warnings = [];
    if (Math.abs(m.yaw) > 0.07) warnings.push('Face is turned to one side. Ask the customer to look straight at the camera and scan again.');
    if (!m.mmPerPx) warnings.push('Could not see the iris clearly, so sizes in mm are not available. Move closer or improve lighting.');
    else if (m.cameraDistMm && m.cameraDistMm > 900) warnings.push('Customer is far from the camera (about ' + Math.round(m.cameraDistMm / 10) + ' cm). Sizes are more accurate at 40–60 cm.');
    else if (m.cameraDistMm && m.cameraDistMm < 250) warnings.push('Camera is very close to the face; lens distortion can stretch the measurements. Try 40–60 cm.');
    if (cls.confidence < 0.55) warnings.push('Face shape is borderline between ' + cls.shape + ' and ' + cls.runnerUp + '. Tap the right one below; the tablet learns from your choice.');
    return { measurements: m, classification: cls, tone, size, bridge, recommendation: rec, warnings };
  }

  return { L, SHAPES, RULES, COLOURS, IRIS_MM, EYE_ROT_MM, DEFAULT_HFOV, MIN_SAMPLES, measure, classify, features, undertone, sizing, bridgeAdvice, recommend, analyze, aggregate, frameBox };
});
