/* Unit tests for the face-shape engine using synthetic landmark sets built from target proportions. */
'use strict';
const assert = require('assert');
const FS = require('../public/js/faceshape.js');
const L = FS.L;
const W = 1000, H = 1000;

// Build a 478-point landmark array whose measured proportions equal the given targets.
function face({ lengthRatio, jawRatio, foreheadRatio, chinAngle, faceWidthMm = 138, pdMm = 62, bridgeRel = 0.02, yaw = 0 }) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const cheekW = 0.4; // normalised
  const cx = 0.5, cy = 0.5;
  lm[L.cheekL] = { x: cx - cheekW / 2, y: cy, z: 0 }; lm[L.cheekR] = { x: cx + cheekW / 2, y: cy, z: 0 };
  const faceLen = lengthRatio * cheekW;
  lm[L.top] = { x: cx, y: cy - faceLen * 0.45, z: 0 }; lm[L.chin] = { x: cx, y: cy + faceLen * 0.55, z: 0 };
  const fw = foreheadRatio * cheekW;
  lm[L.foreheadL] = { x: cx - fw / 2, y: cy - faceLen * 0.3, z: 0 }; lm[L.foreheadR] = { x: cx + fw / 2, y: cy - faceLen * 0.3, z: 0 };
  const jw = jawRatio * cheekW;
  const up = (jw / 2) / Math.tan((chinAngle / 2) * Math.PI / 180); // vertical offset that yields the target chin angle
  const chinY = lm[L.chin].y;
  lm[L.jawL] = { x: cx - jw / 2, y: chinY - up, z: 0 }; lm[L.jawR] = { x: cx + jw / 2, y: chinY - up, z: 0 };
  // iris ruler: iris px = 11.7 mm / (faceWidthMm / cheekWpx)
  const mmPerPx = faceWidthMm / (cheekW * W);
  const irisPx = FS.IRIS_MM / mmPerPx / W; // normalised
  const pd = pdMm / mmPerPx / W;
  lm[L.irisLC] = { x: cx - pd / 2, y: cy - 0.05, z: 0 }; lm[L.irisRC] = { x: cx + pd / 2, y: cy - 0.05, z: 0 };
  lm[L.irisLa] = { x: cx - pd / 2 - irisPx / 2, y: cy - 0.05, z: 0 }; lm[L.irisLb] = { x: cx - pd / 2 + irisPx / 2, y: cy - 0.05, z: 0 };
  lm[L.irisRa] = { x: cx + pd / 2 - irisPx / 2, y: cy - 0.05, z: 0 }; lm[L.irisRb] = { x: cx + pd / 2 + irisPx / 2, y: cy - 0.05, z: 0 };
  const irisPxV = irisPx * W / H;
  lm[L.irisLt] = { x: cx - pd / 2, y: cy - 0.05 - irisPxV / 2, z: 0 }; lm[L.irisLbt] = { x: cx - pd / 2, y: cy - 0.05 + irisPxV / 2, z: 0 };
  lm[L.irisRt] = { x: cx + pd / 2, y: cy - 0.05 - irisPxV / 2, z: 0 }; lm[L.irisRbt] = { x: cx + pd / 2, y: cy - 0.05 + irisPxV / 2, z: 0 };
  lm[L.innerEyeL] = { x: cx - 0.05, y: cy - 0.05, z: 0 }; lm[L.innerEyeR] = { x: cx + 0.05, y: cy - 0.05, z: 0 };
  lm[L.bridge] = { x: cx, y: cy - 0.06, z: -bridgeRel * cheekW };
  lm[L.noseTip] = { x: cx + yaw * cheekW, y: cy + 0.05, z: -0.05 };
  return lm;
}

const cases = [
  ['Oval', { lengthRatio: 1.38, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 108 }],
  ['Round', { lengthRatio: 1.16, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 122 }],
  ['Square', { lengthRatio: 1.2, jawRatio: 0.9, foreheadRatio: 0.92, chinAngle: 130 }],
  ['Oblong', { lengthRatio: 1.65, jawRatio: 0.8, foreheadRatio: 0.9, chinAngle: 108 }],
  ['Heart', { lengthRatio: 1.35, jawRatio: 0.66, foreheadRatio: 0.94, chinAngle: 90 }],
  ['Diamond', { lengthRatio: 1.4, jawRatio: 0.7, foreheadRatio: 0.8, chinAngle: 96 }],
  ['Triangle', { lengthRatio: 1.35, jawRatio: 0.92, foreheadRatio: 0.78, chinAngle: 115 }]
];

let pass = 0;
for (const [expected, t] of cases) {
  const lm = face(t);
  const m = FS.measure(lm, W, H);
  assert(Math.abs(m.lengthRatio - t.lengthRatio) < 0.01, 'lengthRatio built correctly');
  assert(Math.abs(m.chinAngle - t.chinAngle) < 0.5, 'chinAngle built correctly: ' + m.chinAngle);
  const c = FS.classify(m);
  assert.strictEqual(c.shape, expected, `expected ${expected}, got ${c.shape} (${c.ranked.map((r) => r.shape + ':' + r.score.toFixed(2)).join(', ')})`);
  pass++;
}

// Sizing from the iris ruler.
{
  const lm = face({ lengthRatio: 1.38, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 108, faceWidthMm: 138, pdMm: 62 });
  const r = FS.analyze(lm, W, H, null);
  assert(Math.abs(r.measurements.faceWidthMm - 138) < 0.5, 'face width mm: ' + r.measurements.faceWidthMm);
  assert(Math.abs(r.measurements.pdNearMm - 62) < 0.5, 'near pd mm: ' + r.measurements.pdNearMm);
  assert(r.measurements.convergenceMm > 0 && r.measurements.convergenceMm <= 6, 'convergence: ' + r.measurements.convergenceMm);
  assert(Math.abs(r.measurements.pdMm - (62 + r.measurements.convergenceMm)) < 0.01, 'distance pd = near + convergence');
  assert(r.measurements.cameraDistMm > 200 && r.measurements.cameraDistMm < 1200, 'camera distance plausible: ' + r.measurements.cameraDistMm);
  assert.strictEqual(r.size.frameWidth, 136);
  assert.strictEqual(r.size.label, 'Medium');
  assert(r.size.bridge >= 18 && r.size.bridge <= 21, 'bridge from distance PD: ' + r.size.bridge);
  assert.strictEqual(r.bridge.level, 'Medium');
  assert.strictEqual(r.warnings.length, 0, 'no warnings: ' + r.warnings.join('|'));
  pass++;
}
// Warnings: turned head, low bridge advice.
{
  const lm = face({ lengthRatio: 1.38, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 108, yaw: 0.12, bridgeRel: 0.005 });
  const r = FS.analyze(lm, W, H, null);
  assert(r.warnings.some((w) => /turned/.test(w)), 'yaw warning');
  assert.strictEqual(r.bridge.level, 'Low');
  pass++;
}
// Undertone sampler.
{
  const lm = face({ lengthRatio: 1.38, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 108 });
  assert.strictEqual(FS.undertone(lm, W, H, () => ({ r: 220, g: 170, b: 120 })).tone, 'Warm');
  assert.strictEqual(FS.undertone(lm, W, H, () => ({ r: 200, g: 170, b: 160 })).tone, 'Cool');
  pass++;
}
// Recommendation table is complete for every shape.
for (const s of FS.SHAPES) { const r = FS.recommend(s, null); assert(r.shapes.length && r.avoid.length && r.tips.length && r.materials.length); }
pass++;

// Catalog matching + CSV round trip.
{
  const Catalog = require('../public/js/catalog.js');
  const seed = require('../public/frames.json');
  seed.forEach((f) => Catalog.upsert(f));
  const rec = FS.recommend('Round', { tone: 'Warm' });
  const hits = Catalog.match(rec, { frameWidth: 134 }, { inStockOnly: true });
  assert(hits.length > 0, 'matches for Round');
  assert(hits.every((h) => !rec.avoid.includes(h.frame.shape) || h.score >= 2));
  assert(rec.shapes.includes(hits[0].frame.shape), 'top match shape suits: ' + hits[0].frame.shape);
  const csv = Catalog.toCSV();
  const rows = Catalog.parseCSV(csv);
  assert.strictEqual(rows.length, seed.length);
  assert.strictEqual(rows[0].code, seed[0].code);
  assert(Catalog.svg(seed[0], 100).startsWith('<svg'));
  pass++;
}

// Calibration factor scales every mm value; convergence correction and camera distance are unaffected by it.
{
  const lm = face({ lengthRatio: 1.38, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 108, faceWidthMm: 138, pdMm: 61 });
  const raw = FS.analyze(lm, W, H, null);
  const factor = 64 / raw.measurements.pdRawMm;
  const cal = FS.analyze(lm, W, H, null, { scale: factor });
  assert(Math.abs(cal.measurements.pdMm - 64) < 0.01, 'calibrated distance PD: ' + cal.measurements.pdMm);
  assert(Math.abs(cal.measurements.faceWidthMm - raw.measurements.faceWidthMm * factor) < 0.01, 'face width scaled');
  assert(Math.abs(cal.measurements.pdRawMm - raw.measurements.pdRawMm) < 0.01, 'raw PD unchanged by calibration');
  assert(Math.abs(cal.measurements.cameraDistMm - raw.measurements.cameraDistMm) < 0.01, 'camera distance unchanged by calibration');
  pass++;
}
// Aggregate: median of noisy frames, majority vote on shape.
{
  const rs = [61, 63, 62, 70, 62.5].map((pd) => FS.analyze(face({ lengthRatio: 1.38, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 108, pdMm: pd }), W, H, null));
  rs[3] = Object.assign({}, rs[3], { classification: Object.assign({}, rs[3].classification, { shape: 'Round' }) });
  const a = FS.aggregate(rs);
  assert.strictEqual(a.frames, 5);
  assert(Math.abs(a.measurements.pdNearMm - 62.5) < 0.5, 'median near PD ignores the 70 outlier: ' + a.measurements.pdNearMm);
  assert.strictEqual(a.classification.shape, 'Oval');
  assert(a.pdSpread > 8, 'spread reported');
  assert(a.size && a.size.frameWidth, 'size recomputed');
  assert.strictEqual(FS.aggregate([rs[0]]).frames, 1);
  pass++;
}

// Confidence is a margin, not a share: a clear Oblong face should score well above 0.55.
{
  const c = FS.classify(FS.measure(face({ lengthRatio: 1.7, jawRatio: 0.8, foreheadRatio: 0.9, chinAngle: 108 }), W, H));
  assert.strictEqual(c.shape, 'Oblong');
  assert(c.confidence > 0.55, 'clear face confidence: ' + c.confidence);
  const b = FS.classify(FS.measure(face({ lengthRatio: 1.28, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 114 }), W, H));
  assert(b.confidence < c.confidence, 'borderline face is less confident');
  pass++;
}
// Learning: with enough staff-labelled faces, neighbours override the rules near the boundary.
{
  const m = FS.measure(face({ lengthRatio: 1.27, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 114 }), W, H);
  const rules = FS.classify(m);
  const other = FS.SHAPES.find((s) => s !== rules.shape && ['Oval', 'Round'].includes(s));
  const samples = Array.from({ length: 10 }, () => ({ f: FS.features(m), shape: other }));
  const learned = FS.classify(m, { samples });
  assert(learned.learned, 'learning active');
  assert.strictEqual(learned.shape, other, 'labelled neighbours win: ' + learned.shape);
  assert.strictEqual(FS.classify(m, { samples: samples.slice(0, 3) }).learned, false, 'inactive below MIN_SAMPLES');
  pass++;
}
// Frame-on boxing measurements from four tapped corners.
{
  const lm = face({ lengthRatio: 1.38, jawRatio: 0.78, foreheadRatio: 0.9, chinAngle: 108, faceWidthMm: 138, pdMm: 64 });
  const m = FS.measure(lm, W, H);
  const mmPerPx = m.mmPerPx; // ~0.345 mm/px
  const pxR = lm[L.irisLC].x * W < lm[L.irisRC].x * W ? { x: lm[L.irisLC].x * W, y: lm[L.irisLC].y * H } : { x: lm[L.irisRC].x * W, y: lm[L.irisRC].y * H };
  const pxL = pxR.x === lm[L.irisLC].x * W ? { x: lm[L.irisRC].x * W, y: lm[L.irisRC].y * H } : { x: lm[L.irisLC].x * W, y: lm[L.irisLC].y * H };
  const px = (mm) => mm / mmPerPx;
  // 52 mm wide, 38 mm tall lenses, pupil 2 mm inside the lens centre (towards the nose), 20 mm above the box bottom.
  const right = { x1: pxR.x - px(24), y1: pxR.y - px(18), x2: pxR.x + px(28), y2: pxR.y + px(20) };
  const left = { x1: pxL.x - px(28), y1: pxL.y - px(18), x2: pxL.x + px(24), y2: pxL.y + px(20) };
  const f = FS.frameBox({ right, left }, lm, W, H, mmPerPx);
  assert(Math.abs(f.hboxR - 52) < 0.3 && Math.abs(f.hboxL - 52) < 0.3, 'HBOX: ' + f.hboxR + '/' + f.hboxL);
  assert(Math.abs(f.vboxR - 38) < 0.3, 'VBOX: ' + f.vboxR);
  assert(Math.abs(f.fitR - 20) < 0.3 && Math.abs(f.fitL - 20) < 0.3, 'fitting height: ' + f.fitR);
  assert(Math.abs(f.dbl - (64 - 28 - 28)) < 0.5, 'DBL from pupils and boxes: ' + f.dbl);
  assert(Math.abs(f.monoR + f.monoL - 64) < 0.5, 'mono PDs sum to near PD: ' + f.monoR + '+' + f.monoL);
  assert(Math.abs(f.totalWidth - (52 + 52 + f.dbl)) < 0.5, 'front width');
  assert.strictEqual(f.warnings.length, 0, f.warnings.join('|'));
  assert.strictEqual(FS.frameBox(null, lm, W, H, mmPerPx), null);
  pass++;
}

console.log(`OK — ${pass} test groups passed`);
