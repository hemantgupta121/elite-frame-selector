/* Elite Frame Finder — customer record: photo + details + mood, Save / Draft / Reset, PDF printing, WhatsApp, Customers list. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Same chips as the Elite software's customer_tag_options (Sale Invoice mood chips), so the two systems agree.
  const MOODS = [
    { key: 'happy', label: 'Happy', emoji: '😊', color: '#16a34a' },
    { key: 'price', label: 'Price', emoji: '💰', color: '#d97706' },
    { key: 'brand', label: 'Brand', emoji: '⭐', color: '#7c3aed' },
    { key: 'complain', label: 'Complain', emoji: '😠', color: '#dc2626' },
    { key: 'quiet', label: 'Quiet', emoji: '😐', color: '#6b7280' },
    { key: 'comparing', label: 'Comparing', emoji: '⚖️', color: '#2563eb' },
    { key: 'discount', label: 'Discount', emoji: '🏷️', color: '#ea580c' }
  ];
  const FRAME_WANTS = ['Sheet (acetate)', 'Metal', 'Rimless', 'Half rim', 'TR90 / flexible', 'Sunglasses', 'Kids', 'Any / undecided'];
  const LENS_WANTS = ['Single vision', 'Bifocal', 'Progressive', 'Blue-cut', 'Photochromic', 'Sunglass tint', 'Contact lens', 'Not sure'];
  const SHOP = { name: 'Elite Optical Clinic', tagline: 'Trust • Quality  ·  Since 1986', address: 'H.No. 396, Sector 7B, near Sector 7 HUDA Market, Faridabad 121006', phone: '+91 7970070059', email: 'info@eliteopticalclinic.com' };

  const form = $('custForm');
  const state = { currentId: null, mood: null, viewing: null };

  // ---------- form setup ----------
  const fill = (name, opts) => { form.elements[name].innerHTML = '<option value="">—</option>' + opts.map((o) => '<option>' + esc(o) + '</option>').join(''); };
  fill('frameWant', FRAME_WANTS); fill('lensWant', LENS_WANTS);
  form.elements.date.value = today();
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // The chips stay hidden behind a plain "Mood" button so the customer does not see them; staff tap to open,
  // pick one, and the row collapses again. The button only shows a small dot when a mood has been set.
  function renderMoods() {
    const open = state.moodOpen;
    $('moodChips').hidden = !open;
    $('moodChips').innerHTML = MOODS.map((m) => '<button type="button" class="mood-chip' + (state.mood === m.key ? ' on' : '') + '" data-key="' + m.key + '" style="--chip-color:' + m.color + '" title="' + esc(m.label) + '">' + m.emoji + '<span>' + esc(m.label) + '</span></button>').join('');
    $('moodChips').querySelectorAll('.mood-chip').forEach((b) => b.addEventListener('click', () => { state.mood = state.mood === b.dataset.key ? null : b.dataset.key; state.moodOpen = false; renderMoods(); }));
    const btn = $('btnMood');
    btn.classList.toggle('set', !!state.mood);
    btn.classList.toggle('open', !!open);
    btn.textContent = open ? 'Mood ▴' : 'Mood';
  }
  $('btnMood').addEventListener('click', () => { state.moodOpen = !state.moodOpen; renderMoods(); });
  renderMoods();
  const moodOf = (key) => MOODS.find((m) => m.key === key);

  function setMsg(t, bad) { const m = $('custMsg'); m.textContent = t; m.style.color = bad ? '#b3261e' : ''; }

  // ---------- record building ----------
  function readForm() {
    const f = form.elements;
    return { name: f.name.value.trim(), phone: f.phone.value.trim(), date: f.date.value || today(), gender: f.gender.value, frameWant: f.frameWant.value, lensWant: f.lensWant.value, notes: f.notes.value.trim(), mood: state.mood };
  }
  function scaled(canvas, max, q) {
    const s = Math.min(1, max / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas'); c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }
  function buildRecord(status) {
    const scan = window.EFF ? window.EFF.getScan() : null;
    const base = readForm();
    const now = new Date().toISOString();
    const rec = Object.assign({ id: state.currentId || ('C' + Date.now().toString(36).toUpperCase()), createdAt: now, updatedAt: now, status }, base);
    if (state.currentId && state.existingCreatedAt) rec.createdAt = state.existingCreatedAt;
    if (scan && scan.result) {
      const r = scan.result, m = r.measurements, rc = scan.rec;
      rec.scan = {
        shape: scan.shape, cameraShape: r.classification.shape, confidence: Math.round(r.classification.confidence * 100),
        pd: m.pdMm ? Math.round(m.pdMm) : null, pdNear: m.pdNearMm ? Math.round(m.pdNearMm) : null,
        faceWidth: m.faceWidthMm ? Math.round(m.faceWidthMm) : null, faceLength: m.faceLengthMm ? Math.round(m.faceLengthMm) : null,
        size: r.size ? { label: r.size.label, range: r.size.range, eye: r.size.eye, bridge: r.size.bridge } : null,
        tone: r.tone ? r.tone.tone : null, bridge: r.bridge.text,
        rec: { summary: rc.summary, shapes: rc.shapes, avoid: rc.avoid, weights: rc.weights, materials: rc.materials, rims: rc.rims, colours: rc.colourFamilies, tips: rc.tips }
      };
      rec.fit = scan.fit || null;
      if (scan.chosen) { rec.photo = scaled(scan.chosen.canvas, 900, 0.85); rec.thumb = scaled(scan.chosen.canvas, 160, 0.7); }
    } else if (state.viewing) {
      rec.scan = state.viewing.scan || null; rec.fit = state.viewing.fit || null; rec.photo = state.viewing.photo; rec.thumb = state.viewing.thumb;
    }
    return rec;
  }

  async function persist(rec, pdfs) {
    const stored = await Store.get(rec.id);
    if (stored && stored.pdfs) rec.pdfs = Object.assign({}, stored.pdfs, rec.pdfs || {});
    if (pdfs) rec.pdfs = Object.assign({}, rec.pdfs || {}, pdfs);
    await Store.put(rec);
    state.currentId = rec.id; state.existingCreatedAt = rec.createdAt;
    // Best-effort copy to the server (office PC) — the tablet copy is the one that matters offline.
    try {
      const body = Object.assign({}, rec);
      if (pdfs) body.pdfs = Object.fromEntries(Object.entries(pdfs).map(([k, v]) => [k, v.dataUrl]));
      else delete body.pdfs;
      const r = await fetch('api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      rec.synced = r.ok;
    } catch (e) { rec.synced = false; }
    await Store.put(rec);
    refreshCount();
    return rec;
  }

  function validate(rec) {
    if (!rec.name) return 'Customer name is required.';
    if (!/^\+?\d[\d\s-]{7,}$/.test(rec.phone)) return 'Enter a valid phone number.';
    return null;
  }

  // ---------- buttons ----------
  $('btnCustSave').addEventListener('click', async () => {
    const rec = buildRecord('saved'); const err = validate(rec); if (err) { setMsg(err, true); return; }
    await persist(rec); setMsg('Saved ' + rec.name + ' (' + rec.id + ')' + (rec.synced ? ', copied to server.' : ', stored on this tablet.'));
  });
  $('btnCustDraft').addEventListener('click', async () => {
    const rec = buildRecord('draft'); if (!rec.name && !rec.phone) { setMsg('Enter at least a name or phone for a draft.', true); return; }
    await persist(rec); setMsg('Draft saved (' + rec.id + ').');
  });
  $('btnCustReset').addEventListener('click', () => {
    if (!confirm('Clear the customer details and the scan?')) return;
    resetForm();
    if (window.EFF) window.EFF.reset();
  });
  function resetForm() {
    form.reset(); form.elements.date.value = today(); state.mood = null; state.currentId = null; state.existingCreatedAt = null; state.viewing = null; renderMoods(); setMsg('');
  }
  $('btnCustPdf').addEventListener('click', () => printRecord(true));
  $('btnCustPdfDetail').addEventListener('click', () => printRecord(false));
  $('btnCustWa').addEventListener('click', () => { const rec = buildRecord('saved'); whatsapp(rec); });

  async function printRecord(withPhoto) {
    const rec = buildRecord(state.currentId ? undefined : 'saved');
    if (rec.status === undefined) rec.status = (await Store.get(rec.id) || {}).status || 'saved';
    const err = validate(rec); if (err) { setMsg(err, true); return; }
    const kind = withPhoto ? 'full' : 'detail';
    const doc = makePdf(rec, withPhoto);
    const dataUrl = doc.output('datauristring');
    const blob = doc.output('blob');
    const pdfs = {}; pdfs[kind] = { dataUrl, at: new Date().toISOString() };
    await persist(rec, pdfs);
    setMsg('PDF stored with ' + rec.name + '\'s record' + (rec.synced ? ' and on the server.' : ' on this tablet.'));
    await deliverPdf(blob, fileName(rec, kind));
  }
  function fileName(rec, kind) { return 'Elite-' + (rec.name || 'customer').replace(/[^\w]+/g, '_') + '-' + rec.date + (kind === 'detail' ? '-details' : '') + '.pdf'; }
  async function deliverPdf(blob, name) {
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { /* user cancelled: fall through to download */ }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- text for WhatsApp ----------
  function detailText(rec) {
    const s = rec.scan, lines = [];
    lines.push('*' + SHOP.name + '* — Frame recommendation');
    lines.push('Customer: ' + rec.name + (rec.gender ? ' (' + rec.gender + ')' : '') + ' · ' + rec.date);
    if (rec.frameWant || rec.lensWant) lines.push('Looking for: ' + [rec.frameWant, rec.lensWant].filter(Boolean).join(' / '));
    if (s) {
      lines.push('Face shape: ' + s.shape);
      lines.push('Choose: ' + s.rec.shapes.join(', '));
      lines.push('Avoid: ' + s.rec.avoid.join(', '));
      lines.push('Rim: ' + s.rec.weights.join('/') + ' · ' + s.rec.rims.join('/') + ' · Material: ' + s.rec.materials.join(', '));
      if (s.size) lines.push('Size: ' + s.size.label + ' (' + s.size.range[0] + '–' + s.size.range[1] + ' mm, eye ~' + s.size.eye + ', bridge ~' + s.size.bridge + ')');
      if (s.pd) lines.push('PD (distance): ' + s.pd + ' mm');
      lines.push('Colours: ' + s.rec.colours.join(', '));
      lines.push(s.bridge);
    }
    if (rec.fit) lines.push('Frame on face: HBOX ' + rec.fit.hboxR + '/' + rec.fit.hboxL + ', VBOX ' + rec.fit.vboxR + '/' + rec.fit.vboxL + ', DBL ' + rec.fit.dbl + ', fitting ht ' + rec.fit.fitR + '/' + rec.fit.fitL + ', mono PD ' + rec.fit.monoR + '/' + rec.fit.monoL + ' mm');
    if (rec.notes) lines.push('Notes: ' + rec.notes);
    lines.push(''); lines.push(SHOP.name + ', Sector 7 Faridabad · ' + SHOP.phone);
    return lines.join('\n');
  }
  function waNumber(phone) { let d = String(phone || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; if (d.startsWith('0') && d.length === 11) d = '91' + d.slice(1); return d; }
  function whatsapp(rec) {
    if (!rec.name) { setMsg('Enter the customer name first.', true); return; }
    const n = waNumber(rec.phone);
    window.open('https://wa.me/' + (n.length >= 10 ? n : '') + '?text=' + encodeURIComponent(detailText(rec)), '_blank');
  }

  // ---------- PDF ----------
  function makePdf(rec, withPhoto) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 14; let y = 16;
    const brand = [225, 80, 58];
    doc.setFillColor(brand[0], brand[1], brand[2]); doc.rect(0, 0, W, 4, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(brand[0], brand[1], brand[2]); doc.text(SHOP.name, M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(SHOP.tagline, M, y + 5); doc.text(SHOP.address, M, y + 9.5); doc.text('Ph: ' + SHOP.phone + '  ·  ' + SHOP.email, M, y + 14);
    doc.setTextColor(30); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(withPhoto ? 'Frame Recommendation' : 'Frame Recommendation — Details', W - M, y, { align: 'right' });
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    doc.text('Ref ' + rec.id + '  ·  ' + rec.date + (rec.status === 'draft' ? '  ·  DRAFT' : ''), W - M, y + 5, { align: 'right' });
    y += 22; doc.setDrawColor(220); doc.line(M, y, W - M, y); y += 7;

    let textRight = W - M;
    if (withPhoto && rec.photo) {
      const pw = 50, ph = 62;
      try { doc.addImage(rec.photo, 'JPEG', W - M - pw, y, pw, ph); } catch (e) { /* skip photo if it fails */ }
      textRight = W - M - pw - 6;
    }
    const section = (title) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(brand[0], brand[1], brand[2]); doc.text(title, M, y); y += 5.5; doc.setTextColor(30); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); };
    const kv = (k, v) => {
      if (v == null || v === '') return;
      const lines = doc.splitTextToSize(String(v), textRight - M - 38);
      doc.setFont('helvetica', 'bold'); doc.text(k, M, y); doc.setFont('helvetica', 'normal'); doc.text(lines, M + 38, y);
      y += 5 * lines.length;
    };
    section('Customer');
    kv('Name', rec.name); kv('Phone', rec.phone); kv('Visit date', rec.date); kv('Gender', rec.gender);
    kv('Frame wanted', rec.frameWant); kv('Lens wanted', rec.lensWant);
    const md = moodOf(rec.mood); kv('Mood', md ? md.label : ''); kv('Notes', rec.notes);
    y = Math.max(y, withPhoto && rec.photo ? 45 + 62 + 4 : y) + 3;
    textRight = W - M;

    const s = rec.scan;
    if (s) {
      section('Face analysis');
      kv('Face shape', s.shape + (s.cameraShape && s.cameraShape !== s.shape ? ' (camera: ' + s.cameraShape + ')' : '') + (s.confidence ? ' · ' + s.confidence + '% clear' : ''));
      if (s.pd) kv('PD (distance)', s.pd + ' mm' + (s.pdNear ? ' (near ' + s.pdNear + ' mm)' : ''));
      if (s.faceWidth) kv('Face width', s.faceWidth + ' mm' + (s.faceLength ? ' · length ' + s.faceLength + ' mm' : ''));
      kv('Nose bridge', s.bridge);
      y += 3; section('Recommended frame');
      kv('Summary', s.rec.summary);
      kv('Choose', s.rec.shapes.join(', ')); kv('Avoid', s.rec.avoid.join(', '));
      kv('Rim weight', s.rec.weights.join(' or ')); kv('Rim type', s.rec.rims.join(', '));
      kv('Material', s.rec.materials.map((x) => x === 'Sheet' ? 'Sheet (acetate)' : x).join(', '));
      if (s.size) kv('Size', s.size.label + ' · total width ' + s.size.range[0] + '-' + s.size.range[1] + ' mm · eye ~' + s.size.eye + ' · bridge ~' + s.size.bridge);
      kv('Colours', s.rec.colours.join(', ') + (s.tone ? ' (' + s.tone.toLowerCase() + ' undertone)' : ''));
      kv('Tips', s.rec.tips.join(' '));
    }
    if (rec.fit) {
      y += 3; section('Frame on face (boxing)');
      kv('HBOX (A) R / L', rec.fit.hboxR + ' / ' + rec.fit.hboxL + ' mm'); kv('VBOX (B) R / L', rec.fit.vboxR + ' / ' + rec.fit.vboxL + ' mm');
      kv('DBL', rec.fit.dbl + ' mm'); kv('Front width', rec.fit.totalWidth + ' mm');
      kv('Fitting height R / L', rec.fit.fitR + ' / ' + rec.fit.fitL + ' mm'); kv('Mono PD R / L', rec.fit.monoR + ' / ' + rec.fit.monoL + ' mm');
    }
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text('Measurements are camera estimates for frame selection; final fitting is confirmed in store. Prepared with Elite Frame Finder on ' + new Date().toLocaleString('en-IN') + '.', M, 288, { maxWidth: W - 2 * M });
    return doc;
  }

  // ---------- customers list ----------
  async function refreshCount() { try { $('custCount').textContent = (await Store.all()).length; } catch (e) { /* ignore */ } }
  async function renderList() {
    const q = ($('custSearch').value || '').toLowerCase().trim();
    let list = [];
    try { list = await Store.all(); } catch (e) { $('custList').innerHTML = '<div class="empty">Storage unavailable in this browser.</div>'; return; }
    list = list.filter((r) => !q || [r.name, r.phone, r.date, r.frameWant, r.lensWant, r.scan && r.scan.shape].join(' ').toLowerCase().includes(q));
    $('custCount').textContent = list.length;
    $('custList').innerHTML = list.length ? '' : '<div class="empty">No customers saved yet. Scan a face and tap Save.</div>';
    list.forEach((r) => {
      const md = moodOf(r.mood);
      const d = document.createElement('div'); d.className = 'cust';
      d.innerHTML = '<div class="pic">' + (r.thumb ? '<img src="' + r.thumb + '" alt="">' : '<span class="muted">no photo</span>') + '</div>' +
        '<div><div class="name">' + esc(r.name || '(no name)') + (r.status === 'draft' ? ' <span class="draft">DRAFT</span>' : '') + '</div>' +
        '<div class="meta">' + esc(r.phone) + ' · ' + esc(r.date) + (r.gender ? ' · ' + esc(r.gender) : '') + '</div>' +
        '<div class="meta">' + (r.scan ? esc(r.scan.shape) + (r.scan.pd ? ' · PD ' + r.scan.pd : '') : 'no scan') + (md ? ' · ' + md.emoji + ' ' + esc(md.label) : '') + (r.pdfs && (r.pdfs.full || r.pdfs.detail) ? ' · PDF' : '') + (r.synced ? '' : ' · <span class="muted">not synced</span>') + '</div></div>';
      d.addEventListener('click', () => openRecord(r));
      $('custList').appendChild(d);
    });
  }
  $('custSearch').addEventListener('input', renderList);
  document.querySelector('.tab[data-tab="customers"]').addEventListener('click', renderList);

  function openRecord(r) {
    state.viewing = r;
    const md = moodOf(r.mood);
    const box = $('custDetail'); box.hidden = false;
    box.innerHTML = '<div class="cust-detail-grid"><div class="pic">' + (r.photo ? '<img src="' + r.photo + '" alt="">' : '') + '</div><div>' +
      '<h3>' + esc(r.name) + (r.status === 'draft' ? ' <span class="draft">DRAFT</span>' : '') + '</h3>' +
      '<div class="meta">' + esc(r.phone) + ' · ' + esc(r.date) + (r.gender ? ' · ' + esc(r.gender) : '') + (md ? ' · ' + md.emoji + ' ' + esc(md.label) : '') + '</div>' +
      '<div class="meta">Looking for: ' + esc([r.frameWant, r.lensWant].filter(Boolean).join(' / ') || '—') + '</div>' +
      (r.scan ? '<div class="meta">Face: ' + esc(r.scan.shape) + (r.scan.pd ? ' · PD ' + r.scan.pd + ' mm' : '') + (r.scan.size ? ' · ' + esc(r.scan.size.label) + ' ' + r.scan.size.range[0] + '–' + r.scan.size.range[1] + ' mm' : '') + '</div>' +
        '<div class="meta">Choose ' + esc(r.scan.rec.shapes.join(', ')) + ' · avoid ' + esc(r.scan.rec.avoid.join(', ')) + '</div>' : '') +
      (r.fit ? '<div class="meta">HBOX ' + r.fit.hboxR + '/' + r.fit.hboxL + ' · VBOX ' + r.fit.vboxR + '/' + r.fit.vboxL + ' · DBL ' + r.fit.dbl + ' · fit ht ' + r.fit.fitR + '/' + r.fit.fitL + '</div>' : '') +
      (r.notes ? '<div class="meta">Notes: ' + esc(r.notes) + '</div>' : '') +
      '<div class="row">' +
      '<button class="btn small-btn" data-act="edit">Edit in Scan tab</button>' +
      '<button class="btn small-btn" data-act="pdf">Print (PDF)</button>' +
      '<button class="btn small-btn" data-act="pdfd">Print Detail (PDF)</button>' +
      '<button class="btn small-btn" data-act="wa">WhatsApp</button>' +
      (r.pdfs && r.pdfs.full ? '<button class="btn small-btn" data-act="openfull">Open stored PDF</button>' : '') +
      (r.pdfs && r.pdfs.detail ? '<button class="btn small-btn" data-act="opendetail">Open stored detail PDF</button>' : '') +
      '<button class="btn small-btn danger" data-act="del">Delete</button>' +
      '<button class="btn small-btn" data-act="close">Close</button></div></div></div>';
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'close') { box.hidden = true; state.viewing = null; }
      else if (act === 'del') { if (confirm('Delete ' + r.name + '\'s record?')) { await Store.remove(r.id); try { await fetch('api/customers/' + encodeURIComponent(r.id), { method: 'DELETE' }); } catch (e) { /* ignore */ } box.hidden = true; state.viewing = null; renderList(); } }
      else if (act === 'edit') { loadIntoForm(r); document.querySelector('.tab[data-tab="scan"]').click(); }
      else if (act === 'wa') whatsapp(r);
      else if (act === 'pdf' || act === 'pdfd') {
        const withPhoto = act === 'pdf'; const kind = withPhoto ? 'full' : 'detail';
        const doc = makePdf(r, withPhoto); const pdfs = {}; pdfs[kind] = { dataUrl: doc.output('datauristring'), at: new Date().toISOString() };
        state.currentId = r.id; state.existingCreatedAt = r.createdAt; loadIntoForm(r);
        await persist(r, pdfs); await deliverPdf(doc.output('blob'), fileName(r, kind)); renderList();
      }
      else if (act === 'openfull' || act === 'opendetail') {
        const p = r.pdfs[act === 'openfull' ? 'full' : 'detail'];
        const bin = atob(p.dataUrl.split(',')[1]); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        await deliverPdf(new Blob([arr], { type: 'application/pdf' }), fileName(r, act === 'openfull' ? 'full' : 'detail'));
      }
    }));
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function loadIntoForm(r) {
    const f = form.elements;
    f.name.value = r.name || ''; f.phone.value = r.phone || ''; f.date.value = r.date || today(); f.gender.value = r.gender || '';
    f.frameWant.value = r.frameWant || ''; f.lensWant.value = r.lensWant || ''; f.notes.value = r.notes || '';
    state.mood = r.mood || null; state.currentId = r.id; state.existingCreatedAt = r.createdAt; state.viewing = r; renderMoods();
    setMsg('Editing ' + r.name + ' (' + r.id + '). Save to update.');
  }

  refreshCount();
  window.Customer = { MOODS, detailText, makePdf, buildRecord };
})();
