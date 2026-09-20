/* Elite Frame Finder — UI glue: camera, MediaPipe face landmarks, results, catalog screens, AI tagging. */
(function () {
  'use strict';

  const MP_VERSION = '1.0.1';
  const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VERSION;
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const SEED_URL = 'frames.json';

  const $ = (id) => document.getElementById(id);
  const el = {
    status: $('status'), video: $('video'), photo: $('photo'), overlay: $('overlay'), stageHint: $('stageHint'),
    btnCamera: $('btnCamera'), btnCapture: $('btnCapture'), btnRetake: $('btnRetake'), btnFlip: $('btnFlip'), filePhoto: $('filePhoto'), lblPhoto: $('lblPhoto'),
    results: $('results'), shapeName: $('shapeName'), shapeConf: $('shapeConf'), shapeChips: $('shapeChips'), shapeSummary: $('shapeSummary'),
    btnConfirm: $('btnConfirm'), learnInfo: $('learnInfo'), btnAiShape: $('btnAiShape'), aiShape: $('aiShape'),
    stage: $('stage'), btnFit: $('btnFit'), fitTools: $('fitTools'), fitStep: $('fitStep'), fitUndo: $('fitUndo'), fitCancel: $('fitCancel'), fitResult: $('fitResult'),
    measures: $('measures'), warnings: $('warnings'), recShapes: $('recShapes'), recAvoid: $('recAvoid'), recWeight: $('recWeight'),
    recMaterial: $('recMaterial'), recRims: $('recRims'), recSize: $('recSize'), recColours: $('recColours'), recColourNote: $('recColourNote'),
    recBridge: $('recBridge'), recTips: $('recTips'), matches: $('matches'), inStockOnly: $('inStockOnly'), btnShare: $('btnShare'), btnCopy: $('btnCopy'),
    frameCount: $('frameCount'), search: $('search'), frameList: $('frameList'), btnAdd: $('btnAdd'), fileCsv: $('fileCsv'), btnExport: $('btnExport'),
    btnTemplate: $('btnTemplate'), btnReset: $('btnReset'), editDlg: $('editDlg'), editForm: $('editForm'), editTitle: $('editTitle'), btnDelete: $('btnDelete'), btnCancel: $('btnCancel'),
    fileFrame: $('fileFrame'), btnTag: $('btnTag'), tagStatus: $('tagStatus'), framePreview: $('framePreview'), tagResult: $('tagResult'), tagFields: $('tagFields'), tagNotes: $('tagNotes'), btnTagSave: $('btnTagSave')
  };

  const state = { landmarker: null, stream: null, result: null, overrideShape: null, tagImage: null, tagData: null, aiAvailable: false };

  // ---------------- tabs ----------------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'frames') renderFrames();
  }

  function setStatus(msg) { el.status.textContent = msg; }

  // ---------------- MediaPipe ----------------
  async function getLandmarker() {
    if (state.landmarker) return state.landmarker;
    setStatus('Loading face model (first time only)…');
    const vision = await import(MP_BASE + '/vision_bundle.mjs');
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_BASE + '/wasm');
    const make = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'IMAGE', numFaces: 1
    });
    try { state.landmarker = await make('GPU'); } catch (e) { state.landmarker = await make('CPU'); }
    setStatus('Ready.');
    return state.landmarker;
  }

  // ---------------- camera ----------------
  const canUseCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  if (!canUseCamera) {
    el.btnCamera.hidden = true;
    setStatus('Live camera needs HTTPS. Use "Take / choose photo" (opens the tablet camera).');
  } else {
    setStatus('Tap Start camera, or take a photo.');
  }

  // Back camera by default: staff hold the tablet and point it at the customer. Flip switches to the selfie camera.
  state.facing = 'environment';

  const SIZE = { width: { ideal: 1280 }, height: { ideal: 1600 } };

  async function listCameras() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); }
    catch (e) { return []; }
  }
  // Guess which way a camera faces from its label ("camera2 0, facing back", "Front Camera", ...).
  function facingFromLabel(label, fallback) {
    const l = String(label || '').toLowerCase();
    if (/back|rear|environment|world/.test(l)) return 'environment';
    if (/front|user|face|selfie/.test(l)) return 'user';
    return fallback;
  }

  // Opens a camera. `facing` is what we want; `deviceId` (when known) pins an exact camera, which is the only
  // reliable way to switch on Android tablets — a facingMode "ideal" hint is often ignored and the same camera
  // comes back. Tries: exact device -> exact facing -> preferred facing -> any camera.
  async function startCamera(facing, deviceId) {
    stopCamera();
    const attempts = [];
    if (deviceId) attempts.push({ deviceId: { exact: deviceId } });
    attempts.push({ facingMode: { exact: facing } });
    attempts.push({ facingMode: facing });
    attempts.push({});
    let stream = null, lastErr = null;
    for (const v of attempts) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: Object.assign({}, v, SIZE), audio: false }); break; }
      catch (e) { lastErr = e; }
    }
    if (!stream) throw lastErr || new Error('no camera');
    state.stream = stream;
    const track = stream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    state.deviceId = settings.deviceId || deviceId || null;
    // Trust what the camera reports over what we asked for, so the mirror is right on one-camera devices.
    state.facing = settings.facingMode || facingFromLabel(track && track.label, facing);
    el.video.srcObject = stream;
    el.video.classList.toggle('mirror', state.facing === 'user');
    el.video.hidden = false; el.photo.hidden = true; el.stageHint.hidden = false;
    el.btnCamera.hidden = true; el.btnCapture.hidden = false; el.btnRetake.hidden = true; el.btnFlip.hidden = false;
    el.btnFlip.title = state.facing === 'user' ? 'Switch to back camera' : 'Switch to front camera';
    // Kick playback but never wait on it: play() only settles once frames arrive, and a slow camera would
    // otherwise leave the flip button locked.
    const p = el.video.play(); if (p && p.catch) p.catch(() => { /* autoplay attribute covers this */ });
    clearOverlay();
    return stream;
  }

  el.btnCamera.addEventListener('click', async () => {
    try {
      const wanted = state.facing;
      await startCamera(wanted);
      // Some tablets ignore the facing hint and open the selfie camera anyway; once permission is granted the
      // labels are readable, so correct it by device id.
      if (state.facing !== wanted) {
        const cams = await listCameras();
        const right = cams.find((c) => c.deviceId !== state.deviceId && facingFromLabel(c.label, null) === wanted);
        if (right) await startCamera(wanted, right.deviceId);
      }
      getLandmarker().catch((e) => setStatus('Model failed to load: ' + e.message));
    } catch (e) {
      setStatus('Camera not available (' + e.message + '). Use "Take / choose photo".');
    }
  });

  el.btnFlip.addEventListener('click', async () => {
    if (state.flipping) return;
    state.flipping = true; el.btnFlip.disabled = true;
    try {
      const want = state.facing === 'user' ? 'environment' : 'user';
      // Labels and ids are only populated once permission has been granted, which it has by now.
      const cams = await listCameras();
      if (cams.length > 1) {
        // Prefer a camera whose label says it faces the other way; otherwise just take the next one in the list.
        const other = cams.filter((c) => c.deviceId !== state.deviceId);
        const byLabel = other.find((c) => facingFromLabel(c.label, null) === want);
        const idx = cams.findIndex((c) => c.deviceId === state.deviceId);
        const next = byLabel || cams[(idx + 1) % cams.length];
        await startCamera(facingFromLabel(next.label, want), next.deviceId);
        setStatus((state.facing === 'user' ? 'Front' : 'Back') + ' camera' + (cams.length > 2 ? ' (' + (cams.indexOf(next) + 1) + ' of ' + cams.length + ', tap again for the next)' : '') + '.');
      } else {
        await startCamera(want);
        if (cams.length === 1) setStatus('This device reports only one camera.');
      }
    } catch (e) {
      setStatus('Could not switch camera (' + e.message + ').');
    } finally { state.flipping = false; el.btnFlip.disabled = false; }
  });

  function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
    el.video.hidden = true; el.btnFlip.hidden = true;
  }

  const BURST_FRAMES = 7;   // live camera: analyse a short burst and take the median — far steadier than one frame
  const BURST_GAP_MS = 120;

  el.btnCapture.addEventListener('click', async () => {
    const v = el.video;
    if (!v.videoWidth) { setStatus('Camera is still starting…'); return; }
    el.btnCapture.disabled = true;
    try {
      await getLandmarker();
      const frames = [];
      for (let i = 0; i < BURST_FRAMES; i++) {
        setStatus('Hold still… ' + (i + 1) + '/' + BURST_FRAMES);
        const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        frames.push(c);
        await new Promise((r) => setTimeout(r, BURST_GAP_MS));
      }
      stopCamera();
      el.stageHint.hidden = true; el.btnCapture.hidden = true; el.btnRetake.hidden = false;
      await runAnalysis(frames);
    } finally { el.btnCapture.disabled = false; }
  });

  el.filePhoto.addEventListener('change', async () => {
    const f = el.filePhoto.files && el.filePhoto.files[0];
    if (!f) return;
    stopCamera();
    const img = await loadImage(f);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    el.stageHint.hidden = true;
    el.btnCamera.hidden = true; el.btnCapture.hidden = true; el.btnRetake.hidden = false;
    el.filePhoto.value = '';
    await runAnalysis([c]);
  });

  el.btnRetake.addEventListener('click', () => {
    el.results.hidden = true; state.result = null; state.overrideShape = null; state.frames = null;
    el.photo.hidden = true; el.stageHint.hidden = false; clearOverlay();
    el.btnRetake.hidden = true;
    if (canUseCamera) el.btnCamera.hidden = false;
    setStatus(canUseCamera ? 'Tap Start camera, or take a photo.' : 'Take a photo to scan.');
  });

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ---------------- calibration (per tablet, from a PD ruler) ----------------
  // Each sample = ruler PD / app's uncalibrated PD. The mean of the samples scales every mm value.
  // This absorbs the two things the app cannot know: this camera's true field of view and the
  // customer population's average iris size.
  const CALIB_KEY = 'eff.calib.v1';
  function loadCalib() { try { return JSON.parse(localStorage.getItem(CALIB_KEY) || '{"samples":[]}'); } catch (e) { return { samples: [] }; } }
  function saveCalib(c) { try { localStorage.setItem(CALIB_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } }
  function calibFactor() {
    const s = loadCalib().samples;
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 1;
  }
  function renderCalib() {
    const s = loadCalib().samples;
    $('calibInfo').textContent = s.length ? 'Calibration ×' + calibFactor().toFixed(3) + ' from ' + s.length + ' ruler reading' + (s.length > 1 ? 's' : '') : 'Not calibrated yet.';
    $('btnCalibReset').hidden = !s.length;
  }
  $('btnCalib').addEventListener('click', () => {
    const ruler = Number($('calibPd').value);
    const raw = state.result && state.result.measurements.pdRawMm;
    if (!raw) { setStatus('Scan a face first, then enter the ruler PD.'); return; }
    if (!(ruler >= 45 && ruler <= 80)) { setStatus('Enter the ruler PD in mm (45–80).'); return; }
    const c = loadCalib(); c.samples.push(ruler / raw); c.samples = c.samples.slice(-10); saveCalib(c);
    $('calibPd').value = '';
    reanalyse();
    setStatus('Calibrated. This and future scans use ×' + calibFactor().toFixed(3) + '.');
  });
  $('btnCalibReset').addEventListener('click', () => { if (confirm('Remove all ruler calibration readings?')) { saveCalib({ samples: [] }); reanalyse(); } });

  // ---------------- analysis ----------------
  function samplerFor(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const W = canvas.width, H = canvas.height;
    return (x, y) => {
      const r = 3; if (x < r || y < r || x >= W - r || y >= H - r) return null;
      const d = ctx.getImageData(x - r, y - r, 2 * r + 1, 2 * r + 1).data;
      let rr = 0, gg = 0, bb = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
      return { r: rr / n, g: gg / n, b: bb / n };
    };
  }

  // frames: canvases of the same face. Detects each, aggregates, shows the chosen frame in the stage.
  async function runAnalysis(frames) {
    try {
      const lmk = await getLandmarker();
      setStatus('Analysing…');
      const detected = [];
      for (const c of frames) {
        const res = lmk.detect(c);
        const lm = res.faceLandmarks && res.faceLandmarks[0];
        if (lm) detected.push({ canvas: c, lm });
      }
      if (!detected.length) {
        showFrame(frames[frames.length - 1]);
        setStatus('No face found. Face the camera straight, with good light, and try again.');
        return;
      }
      state.frames = detected;
      state.overrideShape = null;
      reanalyse();
      setStatus('Done' + (detected.length > 1 ? ' (' + detected.length + ' frames averaged)' : '') + '. Scroll for the recommendation.');
    } catch (e) {
      console.error(e);
      setStatus('Could not analyse: ' + e.message);
    }
  }

  // Re-run the maths on the stored frames (after a calibration change) without re-detecting.
  function reanalyse() {
    if (!state.frames) { renderCalib(); return; }
    const opts = { scale: calibFactor(), samples: loadSamples() };
    const results = state.frames.map((f) => FaceShape.analyze(f.lm, f.canvas.width, f.canvas.height, samplerFor(f.canvas), opts));
    const agg = FaceShape.aggregate(results);
    // Show the frame the aggregate was built on so the overlay lines sit on the right pixels.
    const idx = results.indexOf(results.find((r) => r.measurements === agg.measurements)) ;
    const chosen = state.frames[idx >= 0 ? idx : results.findIndex((r) => r.classification.shape === agg.classification.shape)] || state.frames[0];
    state.result = agg;
    state.chosen = chosen;
    showFrame(chosen.canvas);
    drawOverlay(chosen.lm, chosen.canvas.width, chosen.canvas.height);
    if (state.fit && state.fit.active) drawFit();
    renderResult();
  }

  function showFrame(canvas) {
    el.photo.width = canvas.width; el.photo.height = canvas.height;
    el.photo.getContext('2d').drawImage(canvas, 0, 0);
    el.photo.hidden = false;
  }

  function clearOverlay() { const c = el.overlay; c.width = c.clientWidth; c.height = c.clientHeight; c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  function drawOverlay(lm, W, H) {
    const c = el.overlay; c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
    const L = FaceShape.L;
    const line = (a, b, colour) => { g.strokeStyle = colour; g.lineWidth = Math.max(2, W / 400); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); };
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < lm.length; i += 3) { const p = P(i); g.fillRect(p.x - 0.7, p.y - 0.7, 1.4, 1.4); }
    line(P(L.top), P(L.chin), '#ffd166');
    line(P(L.cheekL), P(L.cheekR), '#06d6a0');
    line(P(L.foreheadL), P(L.foreheadR), '#4cc9f0');
    line(P(L.jawL), P(L.jawR), '#f77f00');
    line(P(L.irisLC), P(L.irisRC), '#ef476f');
  }

  // ---------------- results ----------------
  function chips(container, list, opts) {
    opts = opts || {};
    container.innerHTML = '';
    list.forEach((s) => {
      const b = document.createElement('span'); b.className = 'chip' + (opts.on === s ? ' on' : ''); b.textContent = s;
      if (opts.onClick) b.addEventListener('click', () => opts.onClick(s));
      container.appendChild(b);
    });
  }

  function currentShape() { return state.overrideShape || state.result.classification.shape; }

  function renderResult() {
    const r = state.result; if (!r) return;
    const shape = currentShape();
    const rec = FaceShape.recommend(shape, r.tone);
    const m = r.measurements, c = r.classification;
    el.results.hidden = false;
    el.shapeName.textContent = shape;
    const confLabel = c.confidence >= 0.75 ? 'Clear' : c.confidence >= 0.55 ? 'Fairly clear' : 'Borderline';
    el.shapeConf.textContent = state.overrideShape ? 'Set by staff (camera said ' + c.shape + ')' : confLabel + ' (' + Math.round(c.confidence * 100) + '%) · next: ' + c.runnerUp;
    chips(el.shapeChips, FaceShape.SHAPES, { on: shape, onClick: (s) => { state.overrideShape = s === c.shape ? null : s; recordSample(s); renderResult(); } });
    const n = loadSamples().length;
    el.learnInfo.textContent = n ? 'Learning from ' + n + ' face' + (n > 1 ? 's' : '') + ' confirmed by staff' + (c.learned ? ' (active).' : ' (active from ' + FaceShape.MIN_SAMPLES + ').') : 'Tap ✓ Correct or the right shape after each customer; the tablet learns your judgement.';
    el.btnAiShape.hidden = !state.aiAvailable;
    el.aiShape.hidden = true;
    if (!(state.fit && state.fit.active)) { el.fitTools.hidden = true; el.fitResult.hidden = true; }
    el.shapeSummary.textContent = rec.summary;
    const mm = (v) => (v ? Math.round(v) + ' mm' : '—');
    const pdNote = m.pdMm ? '<span class="muted small">near ' + Math.round(m.pdNearMm) + (m.cameraDistMm ? ' · at ' + Math.round(m.cameraDistMm / 10) + ' cm' : '') + '</span>' : '';
    el.measures.innerHTML = [
      ['Face width', mm(m.faceWidthMm)], ['Face length', mm(m.faceLengthMm)], ['PD (distance)', mm(m.pdMm) + ' ' + pdNote],
      ['Length ÷ width', m.lengthRatio.toFixed(2)], ['Jaw ÷ cheek', m.jawRatio.toFixed(2)], ['Forehead ÷ cheek', m.foreheadRatio.toFixed(2)]
    ].map(([k, v]) => '<div class="m"><span class="muted">' + k + '</span><b>' + v + '</b></div>').join('');
    const notes = r.warnings.slice();
    if (r.frames > 1 && r.pdSpread > 2) notes.push('Readings varied by ' + r.pdSpread.toFixed(1) + ' mm across frames. Ask the customer to hold still and scan again for a tighter result.');
    el.warnings.innerHTML = notes.map((w) => '<li>' + w + '</li>').join('');
    renderCalib();

    chips(el.recShapes, rec.shapes); chips(el.recAvoid, rec.avoid);
    el.recWeight.textContent = rec.weights.join(' or ') + ' rim (' + (rec.weight === 'Broad' ? 'bold, broad' : rec.weight === 'Thin' ? 'thin, light' : 'medium') + ')';
    el.recMaterial.textContent = rec.materials.map((x) => x === 'Sheet' ? 'Sheet (acetate)' : x).join(', ');
    el.recRims.textContent = rec.rims.join(', ');
    el.recSize.textContent = r.size ? r.size.label + ' · total width ' + r.size.range[0] + '–' + r.size.range[1] + ' mm · eye ≈ ' + r.size.eye + ' · bridge ≈ ' + r.size.bridge : 'Size needs a clearer view of the eyes';
    chips(el.recColours, rec.colourFamilies);
    el.recColourNote.textContent = r.tone ? rec.colourNote + ' (' + r.tone.depth + ' skin, ' + r.tone.tone.toLowerCase() + ' undertone — lighting affects this.)' : rec.colourNote;
    el.recBridge.textContent = r.bridge.text;
    el.recTips.innerHTML = rec.tips.map((t) => '<li>' + t + '</li>').join('');
    renderMatches(rec);
  }

  function renderMatches(rec) {
    const list = Catalog.match(rec, state.result.size, { inStockOnly: el.inStockOnly.checked });
    el.matches.innerHTML = list.length ? '' : '<div class="empty">No matching frames in the catalog yet. Add frames in the Frames tab.</div>';
    list.slice(0, 24).forEach(({ frame: f, why, against }) => {
      const d = document.createElement('div'); d.className = 'match';
      d.innerHTML = '<div class="pic">' + (f.image ? '<img src="' + esc(f.image) + '" alt="">' : Catalog.svg(f, 150)) + '</div>' +
        '<div class="name">' + esc(f.brand) + ' ' + esc(f.model) + '</div>' +
        '<div class="meta">' + esc(f.code) + ' · ' + esc(f.shape) + ' · ' + esc(f.material) + ' · ' + esc(f.rim) + ' rim · ' + esc(f.colour) + (f.total_width ? ' · ' + f.total_width + ' mm' : '') + '</div>' +
        (why.length ? '<div class="why">✓ ' + esc(why.join(', ')) + '</div>' : '') +
        (against.length ? '<div class="against">✗ ' + esc(against.join(', ')) + '</div>' : '') +
        '<div class="price">' + (f.price ? '₹' + Number(f.price).toLocaleString('en-IN') : '') + (Number(f.qty) > 0 ? ' <span class="muted small">· ' + f.qty + ' in stock</span>' : ' <span class="against small">· out of stock</span>') + '</div>';
      el.matches.appendChild(d);
    });
  }
  el.inStockOnly.addEventListener('change', () => state.result && renderResult());

  function summaryText() {
    const r = state.result; if (!r) return '';
    const shape = currentShape(); const rec = FaceShape.recommend(shape, r.tone);
    const lines = ['Elite Optical Clinic — Frame suggestion', 'Face shape: ' + shape, 'Choose: ' + rec.shapes.join(', '), 'Avoid: ' + rec.avoid.join(', '),
      'Rim: ' + rec.weights.join('/') + ', ' + rec.rims.join('/'), 'Material: ' + rec.materials.join(', '),
      r.measurements.pdMm ? 'PD (distance): ' + Math.round(r.measurements.pdMm) + ' mm' : '',
      fitText(),
      r.size ? 'Size: ' + r.size.label + ' (' + r.size.range[0] + '–' + r.size.range[1] + ' mm, eye ~' + r.size.eye + ', bridge ~' + r.size.bridge + ')' : '',
      'Colours: ' + rec.colourFamilies.join(', '), r.bridge.text, '', 'Elite Optical Clinic, Sector 7 Faridabad · +91 7970070059'];
    return lines.filter((l) => l !== undefined).join('\n');
  }
  el.btnShare.addEventListener('click', () => window.open('https://wa.me/?text=' + encodeURIComponent(summaryText()), '_blank'));
  el.btnCopy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(summaryText()); setStatus('Summary copied.'); } catch (e) { setStatus('Copy failed.'); } });

  // ---------------- learning from staff (face-shape samples) ----------------
  const SAMPLES_KEY = 'eff.shapes.v1';
  function loadSamples() { try { return JSON.parse(localStorage.getItem(SAMPLES_KEY) || '[]'); } catch (e) { return []; } }
  function recordSample(shape) {
    if (!state.result || !FaceShape.SHAPES.includes(shape)) return;
    const list = loadSamples();
    list.push({ f: FaceShape.features(state.result.measurements), shape, t: Date.now() });
    try { localStorage.setItem(SAMPLES_KEY, JSON.stringify(list.slice(-300))); } catch (e) { /* ignore */ }
  }
  el.btnConfirm.addEventListener('click', () => {
    if (!state.result) return;
    recordSample(currentShape());
    setStatus('Thanks. ' + currentShape() + ' recorded for this face.');
    renderResult();
  });

  // ---------------- AI second opinion (cloud, optional) ----------------
  function chosenJpeg(max) {
    const src = state.chosen.canvas;
    const scale = Math.min(1, (max || 1024) / Math.max(src.width, src.height));
    const c = document.createElement('canvas'); c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }
  el.btnAiShape.addEventListener('click', async () => {
    if (!state.chosen) return;
    el.btnAiShape.disabled = true; el.aiShape.hidden = false; el.aiShape.textContent = 'Asking the AI… (the photo is sent to Anthropic for this step)';
    try {
      const r = await fetch('api/faceshape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: chosenJpeg(1024) }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      const local = state.result.classification.shape;
      el.aiShape.innerHTML = '<b>AI says: ' + esc(d.shape) + '</b> (' + esc(d.confidence) + ' confidence, runner-up ' + esc(d.runner_up) + ')' +
        (d.shape === local ? ' · agrees with the camera' : ' · camera said ' + esc(local)) +
        '<div class="small">' + esc(d.reasoning) + '</div><div class="small"><b>Frames:</b> ' + esc(d.frame_advice) + '</div><div class="muted small">Photo: ' + esc(d.photo_quality) + '</div>' +
        '<div class="row"><button id="btnUseAi" class="btn small-btn" type="button">Use ' + esc(d.shape) + '</button></div>';
      $('btnUseAi').addEventListener('click', () => { state.overrideShape = d.shape === local ? null : d.shape; recordSample(d.shape); renderResult(); });
    } catch (e) {
      el.aiShape.textContent = 'AI opinion failed: ' + e.message;
    } finally { el.btnAiShape.disabled = false; }
  });

  // ---------------- frame-on measurement (HBOX / VBOX / DBL / fitting height) ----------------
  const FIT_STEPS = ['Tap the TOP-LEFT edge of the customer\'s RIGHT lens (left side of photo)', 'Tap the BOTTOM-RIGHT edge of the RIGHT lens', 'Tap the TOP-LEFT edge of the LEFT lens', 'Tap the BOTTOM-RIGHT edge of the LEFT lens', 'Done — nudge any point with the arrows, or Undo'];
  state.fit = { active: false, points: [] };

  el.btnFit.addEventListener('click', () => {
    if (!state.chosen) { setStatus('Scan the customer wearing the frame first.'); return; }
    if (!state.result.measurements.mmPerPx) { setStatus('The eyes were not seen clearly, so there is no mm scale. Rescan with better light.'); return; }
    state.fit = { active: true, points: [] };
    el.stage.classList.add('measure');
    el.fitTools.hidden = false; el.fitResult.hidden = true;
    drawFit(); updateFitStep();
    el.stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  el.fitCancel.addEventListener('click', () => { state.fit = { active: false, points: [] }; el.stage.classList.remove('measure'); el.fitTools.hidden = true; drawOverlay(state.chosen.lm, state.chosen.canvas.width, state.chosen.canvas.height); });
  el.fitUndo.addEventListener('click', () => { state.fit.points.pop(); drawFit(); updateFitStep(); computeFit(); });
  document.querySelectorAll('.nudge').forEach((b) => b.addEventListener('click', () => {
    const p = state.fit.points[state.fit.points.length - 1]; if (!p) return;
    p.x += Number(b.dataset.dx); p.y += Number(b.dataset.dy); drawFit(); computeFit();
  }));

  // Map a tap on the stage to photo pixels (the photo is shown with object-fit: contain while measuring).
  function stageToCanvas(evt) {
    const rect = el.stage.getBoundingClientRect();
    const W = el.photo.width, H = el.photo.height;
    const scale = Math.min(rect.width / W, rect.height / H);
    const offX = (rect.width - W * scale) / 2, offY = (rect.height - H * scale) / 2;
    const x = (evt.clientX - rect.left - offX) / scale, y = (evt.clientY - rect.top - offY) / scale;
    if (x < 0 || y < 0 || x > W || y > H) return null;
    return { x: Math.round(x), y: Math.round(y) };
  }
  el.stage.addEventListener('click', (evt) => {
    if (!state.fit.active || state.fit.points.length >= 4) return;
    const p = stageToCanvas(evt); if (!p) return;
    state.fit.points.push(p);
    drawFit(); updateFitStep(); computeFit();
  });
  function updateFitStep() { el.fitStep.textContent = (state.fit.points.length + 1) + '. ' + FIT_STEPS[Math.min(state.fit.points.length, 4)]; }

  function drawFit() {
    const ch = state.chosen; if (!ch) return;
    drawOverlay(ch.lm, ch.canvas.width, ch.canvas.height);
    const g = el.overlay.getContext('2d');
    const pts = state.fit.points, lw = Math.max(2, el.overlay.width / 400);
    g.lineWidth = lw; g.strokeStyle = '#ffd60a'; g.fillStyle = '#ffd60a';
    pts.forEach((p, i) => { g.beginPath(); g.arc(p.x, p.y, lw * 2.2, 0, Math.PI * 2); g.fill(); g.fillText(String(i + 1), p.x + lw * 3, p.y - lw * 2); });
    for (let i = 0; i + 1 < pts.length; i += 2) { const a = pts[i], b = pts[i + 1]; g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
  }

  function computeFit() {
    const pts = state.fit.points;
    if (pts.length < 4) { el.fitResult.hidden = true; state.fitResult = null; return; }
    const ch = state.chosen;
    const boxes = { right: { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y }, left: { x1: pts[2].x, y1: pts[2].y, x2: pts[3].x, y2: pts[3].y } };
    const f = FaceShape.frameBox(boxes, ch.lm, ch.canvas.width, ch.canvas.height, state.result.measurements.mmPerPx);
    state.fitResult = f;
    if (!f) return;
    const cell = (k, v) => '<div class="m"><span class="muted">' + k + '</span><b>' + v + '</b></div>';
    el.fitResult.innerHTML = '<div class="fit-grid">' +
      cell('HBOX (A) right / left', f.hboxR + ' / ' + f.hboxL + ' mm') + cell('VBOX (B) right / left', f.vboxR + ' / ' + f.vboxL + ' mm') +
      cell('DBL (bridge)', f.dbl + ' mm') + cell('Frame front width', f.totalWidth + ' mm') +
      cell('Fitting height R / L', f.fitR + ' / ' + f.fitL + ' mm') + cell('Mono PD R / L', f.monoR + ' / ' + f.monoL + ' mm') + '</div>' +
      (f.warnings.length ? '<ul class="warnings">' + f.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
      '<p class="muted small">Scale from the iris ruler' + (calibFactor() !== 1 ? ' with your ruler calibration' : '') + '. Strong lenses magnify or shrink the eyes a little behind the frame; confirm fitting height with a marker for high powers.</p>';
    el.fitResult.hidden = false;
  }

  function fitText() {
    const f = state.fitResult; if (!f) return '';
    return 'Frame on face: HBOX ' + f.hboxR + '/' + f.hboxL + ', VBOX ' + f.vboxR + '/' + f.vboxL + ', DBL ' + f.dbl + ', fitting ht ' + f.fitR + '/' + f.fitL + ', mono PD ' + f.monoR + '/' + f.monoL + ' mm';
  }

  // ---------------- frames screen ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderFrames() {
    const q = (el.search.value || '').toLowerCase().trim();
    const list = Catalog.all().filter((f) => !q || [f.code, f.brand, f.model, f.colour, f.shape, f.material].join(' ').toLowerCase().includes(q));
    el.frameCount.textContent = Catalog.all().length;
    el.frameList.innerHTML = list.length ? '' : '<div class="empty">No frames yet. Tap Add frame, import a CSV, or use Tag frame.</div>';
    list.forEach((f) => {
      const d = document.createElement('div'); d.className = 'frame';
      d.innerHTML = '<div class="pic">' + (f.image ? '<img src="' + esc(f.image) + '" alt="">' : Catalog.svg(f, 100)) + '</div>' +
        '<div><div class="name">' + esc(f.brand) + ' ' + esc(f.model) + '</div>' +
        '<div class="meta">' + esc(f.code) + ' · ' + (f.shape ? esc(f.shape) : '<span class="oos">shape?</span>') + ' · ' + esc(f.material) + ' · ' + esc(f.rim) + ' · ' + esc(f.weight) + '</div>' +
        '<div class="meta">' + esc(f.colour) + (f.eye ? ' · ' + f.eye + '-' + f.bridge + '-' + f.temple : '') + ' · ' + (f.price ? '₹' + f.price : '') + (Number(f.qty) > 0 ? ' · qty ' + f.qty : ' · <span class="oos">out of stock</span>') + '</div></div>';
      d.addEventListener('click', () => openEdit(f));
      el.frameList.appendChild(d);
    });
  }
  el.search.addEventListener('input', renderFrames);
  el.btnAdd.addEventListener('click', () => openEdit(null));
  el.btnExport.addEventListener('click', () => download('elite-frames.csv', Catalog.toCSV(), 'text/csv'));
  el.btnTemplate.addEventListener('click', () => download('elite-frames-template.csv', Catalog.FIELDS.join(',') + '\nFR1001,Ray-Ban,RB5228,Rectangle,Sheet,Full,Broad,Black,Neutral,53,17,140,Unisex,6990,2,\n', 'text/csv'));
  el.fileCsv.addEventListener('change', async () => {
    const f = el.fileCsv.files && el.fileCsv.files[0]; if (!f) return;
    const r = Catalog.importCSV(await f.text()); el.fileCsv.value = '';
    alert(r.imported + ' frames imported / updated' + (r.skipped ? ', ' + r.skipped + ' non-frame items skipped' : '') + '.'); renderFrames();
  });
  el.btnReset.addEventListener('click', async () => { if (confirm('Delete ALL frames from the catalog on every tablet? Photos stay on the server.')) { await Catalog.reset(); renderFrames(); } });

  // ---------------- frame photo upload ----------------
  // File name = item code (e.g. 011158.jpg) attaches automatically; anything else is matched by hand below.
  const assign = { items: [] };
  function toJpeg(img, max) { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.85); }
  async function uploadPhoto(code, dataUrl) {
    const r = await fetch('api/frames/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, image: dataUrl }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d.url;
  }
  $('filePhotos').addEventListener('change', async () => {
    const files = [...($('filePhotos').files || [])]; $('filePhotos').value = '';
    if (!files.length) return;
    if (!Catalog.isOnline()) { alert('Photo upload needs the Frame Finder server (sign in on the online address).'); return; }
    const codes = new Map(Catalog.all().map((f) => [String(f.code).toLowerCase(), f.code]));
    $('codeList').innerHTML = Catalog.all().map((f) => '<option value="' + esc(f.code) + '">' + esc(f.brand + ' ' + f.model) + '</option>').join('');
    assign.items = []; $('assignRows').innerHTML = ''; $('photoAssign').hidden = false; $('assignMsg').textContent = 'Preparing ' + files.length + ' photo(s)…';
    let auto = 0;
    for (const file of files) {
      let dataUrl, fullUrl;
      try { const img = await loadImage(file); dataUrl = toJpeg(img, 900); fullUrl = toJpeg(img, 2400); } catch (e) { continue; }
      const stem = file.name.replace(/\.[^.]+$/, '').trim();
      const hit = codes.get(stem.toLowerCase());
      const item = { file: file.name, dataUrl, fullUrl, fileObj: file, code: hit || '', done: false };
      assign.items.push(item);
      if (hit) { try { Catalog.setImage(hit, await uploadPhoto(hit, dataUrl)); item.done = true; auto++; } catch (e) { item.error = e.message; } }
    }
    renderAssign();
    $('assignMsg').textContent = auto + ' attached by file name, ' + assign.items.filter((i) => !i.done).length + ' to match by hand.';
    renderFrames();
  });
  function renderAssign() {
    $('assignRows').innerHTML = '';
    assign.items.forEach((it, i) => {
      const row = document.createElement('div'); row.className = 'assign';
      row.innerHTML = '<img src="' + it.dataUrl + '" alt="" title="Tap to enlarge"><div><div class="fn">' + esc(it.file) + (it.scanned && !it.done ? ' · <span class="done">sticker read: ' + esc(it.code) + '</span>' : '') + '</div>' +
        (it.done ? '<div class="done">✓ Attached to ' + esc(it.code) + '</div>' : '<input list="codeList" placeholder="Item code (type to search code or name)" value="' + esc(it.code) + '" data-i="' + i + '">' + (it.error ? '<div class="against small">' + esc(it.error) + '</div>' : '')) +
        '</div>' + (it.done ? '<span></span>' : '<div class="acts"><button class="btn small-btn" type="button" data-save="' + i + '">Save</button>' + (it.fullUrl ? '<button class="btn small-btn" type="button" data-tray="' + i + '">Split tray</button>' : '') + '</div>');
      $('assignRows').appendChild(row);
    });
    $('assignRows').querySelectorAll('input[data-i]').forEach((inp) => inp.addEventListener('input', () => { assign.items[Number(inp.dataset.i)].code = inp.value.trim(); }));
    $('assignRows').querySelectorAll('button[data-save]').forEach((b) => b.addEventListener('click', () => saveAssign(Number(b.dataset.save))));
    $('assignRows').querySelectorAll('button[data-tray]').forEach((b) => b.addEventListener('click', () => openTray(Number(b.dataset.tray))));
    $('assignRows').querySelectorAll('.assign img').forEach((im) => im.addEventListener('click', () => im.closest('.assign').classList.toggle('big')));
  }

  // ---------------- tray photos: one photo of a display tray -> one picture per frame ----------------
  // Staff tap the tray's four corners; the quadrilateral is divided into columns x rows and each cell becomes a
  // separate photo in the assignment list (the original tray row is removed).
  const tray = { index: -1, img: null, pts: [] };
  function openTray(i) {
    const it = assign.items[i]; if (!it) return;
    const img = new Image();
    img.onload = () => {
      tray.index = i; tray.img = img; tray.pts = [];
      const c = $('trayCanvas'); const s = Math.min(1, 1400 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      drawTray(); $('trayDlg').showModal();
    };
    img.src = it.fullUrl || it.dataUrl;
  }
  function drawTray() {
    const c = $('trayCanvas'), g = c.getContext('2d');
    g.drawImage(tray.img, 0, 0, c.width, c.height);
    const lw = Math.max(2, c.width / 400);
    g.lineWidth = lw; g.strokeStyle = '#ffd60a'; g.fillStyle = '#ffd60a';
    tray.pts.forEach((p, i) => { g.beginPath(); g.arc(p.x, p.y, lw * 3, 0, Math.PI * 2); g.fill(); g.font = (lw * 6) + 'px sans-serif'; g.fillText(String(i + 1), p.x + lw * 4, p.y - lw * 2); });
    if (tray.pts.length === 4) {
      const cols = Number($('trayCols').value) || 3, rows = Number($('trayRows').value) || 4;
      for (let r = 0; r <= rows; r++) for (let col = 0; col <= cols; col++) {
        if (r < rows) { const a = quadPt(col / cols, r / rows), b = quadPt(col / cols, (r + 1) / rows); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
        if (col < cols) { const a = quadPt(col / cols, r / rows), b = quadPt((col + 1) / cols, r / rows); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      }
    }
    $('traySplit').disabled = tray.pts.length !== 4;
    $('trayHint').textContent = tray.pts.length < 4 ? 'Tap corner ' + (tray.pts.length + 1) + ' of 4: ' + ['top-left', 'top-right', 'bottom-right', 'bottom-left'][tray.pts.length] + ' of the tray.' : 'Check the grid lines sit on the tray dividers, adjust columns/rows if needed, then Split.';
  }
  // Bilinear point inside the tapped quadrilateral (u across, v down).
  function quadPt(u, v) {
    const [tl, tr, br, bl] = tray.pts;
    const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
    const bot = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
    return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
  }
  $('trayCanvas').addEventListener('click', (e) => {
    if (tray.pts.length >= 4) return;
    const c = $('trayCanvas'), r = c.getBoundingClientRect();
    if (!r.width || !r.height) return; // dialog not laid out yet
    tray.pts.push({ x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height });
    drawTray();
  });
  $('trayUndo').addEventListener('click', () => { tray.pts.pop(); drawTray(); });
  $('trayCols').addEventListener('input', drawTray); $('trayRows').addEventListener('input', drawTray);
  $('trayCancel').addEventListener('click', () => $('trayDlg').close());
  // Read the barcode sticker inside a tray cell (Android Chrome has a built-in detector; elsewhere this is a no-op).
  // The sticker's barcode carries the Elite item code, so a hit prefills the code for staff to confirm.
  const detector = ('BarcodeDetector' in window) ? new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'itf', 'codabar'] }) : null;
  // Fallback for browsers without a built-in detector (Windows/Mac Chrome, Firefox): ZXing, loaded on first use.
  let zxingP = null;
  function loadZXing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (!zxingP) zxingP = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'; s.onload = () => resolve(window.ZXing); s.onerror = () => reject(new Error('barcode library failed to load')); document.head.appendChild(s); });
    return zxingP;
  }
  function matchCode(raw, codes) {
    raw = String(raw || '').trim();
    if (codes.has(raw.toLowerCase())) return codes.get(raw.toLowerCase());
    const digits = raw.replace(/\D/g, ''); // stickers sometimes wrap the code in extra characters
    if (digits.length >= 5) for (const [k, v] of codes) if (digits === k || digits.endsWith(k) || (k.length >= 5 && k.endsWith(digits))) return v;
    return '';
  }
  // Decode with ZXing from a canvas, trying the crop upright and rotated (stickers on temples are often vertical).
  function zxingDecode(ZX, canvas) {
    const reader = new ZX.MultiFormatReader();
    const hints = new Map(); hints.set(ZX.DecodeHintType.TRY_HARDER, true); reader.setHints(hints);
    const tryCanvas = (cv) => { try { return reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.HTMLCanvasElementLuminanceSource(cv)))).getText(); } catch (e) { return ''; } };
    let t = tryCanvas(canvas); if (t) return t;
    const rot = document.createElement('canvas'); rot.width = canvas.height; rot.height = canvas.width;
    const g = rot.getContext('2d'); g.translate(rot.width / 2, rot.height / 2); g.rotate(Math.PI / 2); g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return tryCanvas(rot);
  }
  async function readCellCode(file, sx, sy, sw, sh, codes) {
    if (!file || !('createImageBitmap' in window)) return '';
    try {
      const bmp = await createImageBitmap(file, Math.max(0, Math.round(sx)), Math.max(0, Math.round(sy)), Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
      if (detector) {
        const found = await detector.detect(bmp);
        for (const b of found) { const m = matchCode(b.rawValue, codes); if (m) { bmp.close && bmp.close(); return m; } }
      }
      // ZXing works best around 1200 px wide; downscale huge crops, keep small ones.
      const ZX = await loadZXing().catch(() => null);
      if (ZX) {
        const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
        cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
        const m = matchCode(zxingDecode(ZX, cv), codes);
        if (m) { bmp.close && bmp.close(); return m; }
      }
      bmp.close && bmp.close();
    } catch (e) { /* unreadable cell: staff type the code */ }
    return '';
  }

  $('traySplit').addEventListener('click', async () => {
    const cols = Number($('trayCols').value) || 3, rows = Number($('trayRows').value) || 4;
    const src = $('trayCanvas'); const it = assign.items[tray.index];
    const codes = new Map(Catalog.all().map((f) => [String(f.code).toLowerCase(), f.code]));
    const pieces = [];
    $('traySplit').disabled = true; $('trayHint').textContent = 'Cutting the tray and reading the code stickers…';
    let sx0 = 0, sy0 = 0, fw = tray.img.width, fh = tray.img.height; // full-resolution geometry for barcode reading
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const corners = [quadPt(col / cols, r / rows), quadPt((col + 1) / cols, r / rows), quadPt((col + 1) / cols, (r + 1) / rows), quadPt(col / cols, (r + 1) / rows)];
      const x1 = Math.max(0, Math.min(...corners.map((p) => p.x))), x2 = Math.min(src.width, Math.max(...corners.map((p) => p.x)));
      const y1 = Math.max(0, Math.min(...corners.map((p) => p.y))), y2 = Math.min(src.height, Math.max(...corners.map((p) => p.y)));
      if (!(x2 - x1 >= 10 && y2 - y1 >= 10)) continue; // also skips NaN
      const c = document.createElement('canvas'); c.width = Math.round(x2 - x1); c.height = Math.round(y2 - y1);
      c.getContext('2d').drawImage(tray.img, x1 * tray.img.width / src.width, y1 * tray.img.height / src.height, (x2 - x1) * tray.img.width / src.width, (y2 - y1) * tray.img.height / src.height, 0, 0, c.width, c.height);
      const out = document.createElement('canvas'); const s = Math.min(1, 900 / Math.max(c.width, c.height)); out.width = Math.round(c.width * s); out.height = Math.round(c.height * s);
      out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
      // Barcode read from the original file at native resolution (the preview canvas is too small to decode).
      const scaleX = (it.fileObj ? fw : tray.img.width) / src.width, scaleY = (it.fileObj ? fh : tray.img.height) / src.height;
      const code = await readCellCode(it.fileObj, x1 * scaleX, y1 * scaleY, (x2 - x1) * scaleX, (y2 - y1) * scaleY, codes);
      pieces.push({ file: it.file.replace(/\.[^.]+$/, '') + ' — row ' + (r + 1) + ', col ' + (col + 1), dataUrl: out.toDataURL('image/jpeg', 0.85), code, scanned: !!code, done: false });
    }
    if (it.fileObj && !detector) { /* desktop browsers: no sticker reading, staff type the codes */ }
    assign.items.splice(tray.index, 1, ...pieces);
    $('trayDlg').close(); $('traySplit').disabled = false; renderAssign();
    const read = pieces.filter((p) => p.scanned).length;
    $('assignMsg').textContent = pieces.length + ' frame pictures cut from the tray' + (detector ? ', ' + read + ' code stickers read automatically' : '') + '. Check or type the item code for each, then Save all matched.';
  });
  async function saveAssign(i) {
    const it = assign.items[i]; if (!it || it.done) return;
    const code = String(it.code || '').trim(); if (!code) { $('assignMsg').textContent = 'Enter an item code for ' + it.file + '.'; return; }
    try {
      let f = Catalog.all().find((x) => String(x.code).toLowerCase() === code.toLowerCase());
      if (!f) { if (!confirm('Item ' + code + ' is not in the catalog. Create it (you can fill the details later)?')) return; f = Catalog.upsert({ code, model: code, shape: 'Rectangle', material: 'Sheet', rim: 'Full', weight: 'Medium', gender: 'Unisex', qty: 1 }); }
      const url = await uploadPhoto(f.code, it.dataUrl);
      Catalog.setImage(f.code, url); it.code = f.code; it.done = true; it.error = '';
    } catch (e) { it.error = e.message; }
    renderAssign(); renderFrames();
    $('assignMsg').textContent = assign.items.filter((x) => x.done).length + ' of ' + assign.items.length + ' photos attached.';
  }
  $('assignAll').addEventListener('click', async () => { for (let i = 0; i < assign.items.length; i++) if (!assign.items[i].done && assign.items[i].code) await saveAssign(i); });
  $('assignClose').addEventListener('click', () => { $('photoAssign').hidden = true; assign.items = []; });

  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // edit dialog
  const form = el.editForm;
  function fillSelect(name, opts) { const s = form.elements[name]; s.innerHTML = opts.map((o) => '<option>' + o + '</option>').join(''); }
  fillSelect('category', Catalog.CATEGORIES); fillSelect('shape', Catalog.SHAPES); fillSelect('material', Catalog.MATERIALS); fillSelect('rim', Catalog.RIMS);
  fillSelect('weight', Catalog.WEIGHTS); fillSelect('colour_family', Catalog.FAMILIES); fillSelect('gender', Catalog.GENDERS);

  function openEdit(f) {
    form.reset();
    el.editTitle.textContent = f ? 'Edit frame' : 'Add frame';
    el.btnDelete.hidden = !f;
    form.elements.code.readOnly = !!f;
    if (f) for (const k of Catalog.FIELDS) if (form.elements[k]) form.elements[k].value = f[k] == null ? '' : f[k];
    el.editDlg.showModal();
  }
  el.btnCancel.addEventListener('click', () => el.editDlg.close());
  el.btnDelete.addEventListener('click', () => { if (confirm('Delete this frame from the catalog?')) { Catalog.remove(form.elements.code.value); el.editDlg.close(); renderFrames(); } });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const o = {}; for (const k of Catalog.FIELDS) if (form.elements[k]) o[k] = form.elements[k].value;
    try { Catalog.upsert(o); el.editDlg.close(); renderFrames(); if (state.result) renderResult(); } catch (err) { alert(err.message); }
  });

  // ---------------- quick photo: live barcode -> snap -> attach ----------------
  const qp = { stream: null, timer: null, code: '', busy: false };
  function qpCodes() { return new Map(Catalog.all().map((f) => [String(f.code).toLowerCase(), f.code])); }
  function qpShow(code) {
    const f = code ? Catalog.all().find((x) => x.code === code) : null;
    const box = $('qpFound');
    if (f) { box.className = 'found'; box.textContent = 'Code ' + f.code + ' — ' + (f.brand + ' ' + f.model).trim() + (f.image ? ' (has a photo; Snap replaces it)' : ''); $('qpSnap').hidden = false; }
    else { box.className = 'found none'; box.textContent = detector ? 'Looking for a barcode sticker… or type the code above.' : 'Type the item code above, then Snap.'; $('qpSnap').hidden = !$('qpCode').value.trim(); }
  }
  async function qpScanLoop() {
    if (!qp.stream) return;
    const v = $('qpVideo');
    if (detector && v.videoWidth && !qp.busy) {
      try {
        const found = await detector.detect(v);
        const codes = qpCodes();
        for (const b of found) { const m = matchCode(b.rawValue, codes); if (m && m !== qp.code) { qp.code = m; $('qpCode').value = m; qpShow(m); break; } }
      } catch (e) { /* keep scanning */ }
    }
    qp.timer = setTimeout(qpScanLoop, 350);
  }
  $('qpStart').addEventListener('click', async () => {
    if (!Catalog.isOnline()) { $('qpMsg').textContent = 'Quick photo needs the Frame Finder server (sign in on the online address).'; return; }
    try {
      qp.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    } catch (e) { $('qpMsg').textContent = 'Camera not available (' + e.message + '). Live camera needs the https address.'; return; }
    $('qpVideo').srcObject = qp.stream; $('qpCam').hidden = false; $('qpStart').hidden = true; $('qpStop').hidden = false;
    $('codeList').innerHTML = Catalog.all().map((f) => '<option value="' + esc(f.code) + '">' + esc(f.brand + ' ' + f.model) + '</option>').join('');
    qp.code = ''; $('qpCode').value = ''; qpShow(''); qpScanLoop();
    $('qpMsg').textContent = detector ? 'Scanning for barcodes.' : 'This browser cannot read barcodes live; type the code, then Snap.';
  });
  function qpStop() { clearTimeout(qp.timer); if (qp.stream) qp.stream.getTracks().forEach((t) => t.stop()); qp.stream = null; $('qpCam').hidden = true; $('qpStart').hidden = false; $('qpStop').hidden = true; $('qpSnap').hidden = true; }
  $('qpStop').addEventListener('click', qpStop);
  $('qpCode').addEventListener('input', () => { const m = qpCodes().get($('qpCode').value.trim().toLowerCase()); qp.code = m || ''; qpShow(qp.code); if (!qp.code) $('qpSnap').hidden = !$('qpCode').value.trim(); });
  $('qpSnap').addEventListener('click', async () => {
    const typed = $('qpCode').value.trim();
    let f = Catalog.all().find((x) => String(x.code).toLowerCase() === typed.toLowerCase());
    if (!f) { if (!typed || !confirm('Item ' + typed + ' is not in the catalog. Create it and attach the photo?')) return; f = Catalog.upsert({ code: typed, model: typed, shape: '', material: 'Sheet', rim: 'Full', weight: 'Medium', gender: 'Unisex', qty: 1 }); }
    const v = $('qpVideo'); if (!v.videoWidth) return;
    qp.busy = true; $('qpSnap').disabled = true; $('qpMsg').textContent = 'Saving photo for ' + f.code + '…';
    try {
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
      const url = await uploadPhoto(f.code, toJpeg(c, 1000));
      Catalog.setImage(f.code, url);
      const im = document.createElement('img'); im.src = url; im.title = f.code; $('qpRecent').prepend(im); while ($('qpRecent').children.length > 8) $('qpRecent').lastChild.remove();
      $('qpMsg').textContent = 'Saved photo for ' + f.code + ' (' + (f.brand + ' ' + f.model).trim() + '). Next frame.';
      qp.code = ''; $('qpCode').value = ''; qpShow('');
    } catch (e) { $('qpMsg').textContent = 'Could not save: ' + e.message; }
    finally { qp.busy = false; $('qpSnap').disabled = false; }
  });

  // ---------------- AI tagging ----------------
  const APP_VERSION = '2026-09-21.3'; // shown in the header so staff can tell which build the tablet is running
  $('verPill').textContent = 'v' + APP_VERSION;
  function netStatus(ok, text) { const p = $('netPill'); p.textContent = text; p.className = 'net ' + (ok ? 'on' : 'off'); }
  fetch('api/health', { cache: 'no-store' }).then((r) => r.json()).then((h) => {
    state.aiAvailable = !!h.ai;
    netStatus(true, 'server connected' + (h.version && h.version !== APP_VERSION ? ' · server v' + h.version + ', reload' : ''));
    $('btnLogout').hidden = !h.auth;
    el.tagStatus.textContent = h.ai ? 'AI tagging ready (' + h.model + ').' : 'AI tagging is off: add ANTHROPIC_API_KEY to the server .env and restart.';
  }).catch(() => {
    netStatus(false, 'offline copy — server not reached');
    el.tagStatus.textContent = 'AI tagging needs the Frame Finder server (npm start). You can still add frames by hand.';
  });

  el.fileFrame.addEventListener('change', async () => {
    const f = el.fileFrame.files && el.fileFrame.files[0]; if (!f) return;
    const img = await loadImage(f);
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    state.tagImage = c.toDataURL('image/jpeg', 0.85);
    el.framePreview.src = state.tagImage; el.framePreview.hidden = false;
    el.btnTag.disabled = !state.aiAvailable; el.tagResult.hidden = true; el.fileFrame.value = '';
    if (!state.aiAvailable) el.tagStatus.textContent = 'AI tagging is not configured on the server; add the frame by hand in the Frames tab.';
  });

  el.btnTag.addEventListener('click', async () => {
    if (!state.tagImage) return;
    el.btnTag.disabled = true; el.tagStatus.textContent = 'Reading the frame…';
    try {
      const r = await fetch('api/tag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: state.tagImage }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      state.tagData = data;
      el.tagFields.innerHTML = ['brand', 'model', 'shape', 'material', 'rim', 'weight', 'colour', 'colour_family', 'gender', 'eye', 'bridge', 'temple']
        .map((k) => '<div><div class="k">' + k.replace('_', ' ') + '</div><div class="v">' + esc(data[k] == null || data[k] === '' ? '—' : data[k]) + '</div></div>').join('');
      el.tagNotes.textContent = (data.notes || '') + (data.confidence ? ' Confidence: ' + data.confidence + '.' : '');
      el.tagResult.hidden = false; el.tagStatus.textContent = 'Check the reading, then save.';
    } catch (e) {
      el.tagStatus.textContent = 'Tagging failed: ' + e.message;
    } finally { el.btnTag.disabled = false; }
  });
  el.btnTagSave.addEventListener('click', () => {
    const d = state.tagData || {};
    openEdit(null);
    for (const k of Catalog.FIELDS) if (form.elements[k] && d[k] != null && d[k] !== '') form.elements[k].value = d[k];
    form.elements.code.readOnly = false;
    form.elements.code.focus();
    // After saving, jump to Frames so the new item is visible.
    el.editDlg.addEventListener('close', () => showTab('frames'), { once: true });
  });

  // ---------------- boot ----------------
  Catalog.load(SEED_URL).then(() => { el.frameCount.textContent = Catalog.all().length; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
    // When an updated service worker takes over, reload once so the tablet shows the new version immediately
    // instead of on the next open. Guarded so it never loops.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !navigator.serviceWorker.controller) return;
      reloaded = true;
      if (!state.result) location.reload();
      else setStatus('A new version of the app is ready. It will load on the next scan.');
    });
  }
  window.addEventListener('resize', () => { if (!state.result) clearOverlay(); });

  $('btnLogout').addEventListener('click', async () => {
    if (!confirm('Sign out of Frame Finder on this device?')) return;
    try { await fetch('api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    location.href = 'login.html';
  });

  // Small hook for customer.js (records, PDFs): read-only view of the current scan, plus a reset.
  window.EFF = {
    getScan: () => (state.result ? { result: state.result, chosen: state.chosen, fit: state.fitResult || null, shape: currentShape(), rec: FaceShape.recommend(currentShape(), state.result.tone), calib: calibFactor() } : null),
    reset: () => { if (!el.btnRetake.hidden) el.btnRetake.click(); }
  };
})();
