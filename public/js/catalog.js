/* Elite Frame Finder — frame catalog (attributes, not photos), stored in localStorage.
 * Seeded from frames.json; staff edit it in the Frames tab; CSV import/export matches the Elite
 * inventory item `code` so the same barcode can be scanned at billing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Catalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'eff.frames.v1';
  const FIELDS = ['code', 'brand', 'model', 'category', 'shape', 'material', 'rim', 'weight', 'colour', 'colour_family', 'eye', 'bridge', 'temple', 'gender', 'price', 'qty', 'image'];
  const CATEGORIES = ['Frame', 'Sunglass'];
  const SHAPES = ['Rectangle', 'Square', 'Round', 'Oval', 'Cat-eye', 'Aviator', 'Wayfarer', 'Browline', 'Geometric', 'Oversized'];
  const MATERIALS = ['Sheet', 'Metal', 'TR90', 'Combination', 'Titanium'];
  const RIMS = ['Full', 'Half', 'Rimless'];
  const WEIGHTS = ['Thin', 'Medium', 'Broad'];
  const FAMILIES = ['Warm', 'Cool', 'Neutral'];
  const GENDERS = ['Unisex', 'Men', 'Women', 'Kids'];

  const COLOUR_HEX = {
    black: '#111', matte: '#222', gunmetal: '#4a4f57', silver: '#b8bcc4', grey: '#7d838c', gray: '#7d838c',
    gold: '#c9a227', 'rose gold': '#d4988a', copper: '#b5651d', brown: '#6b4423', tortoise: '#7a4a1e', havana: '#7a4a1e',
    honey: '#c98f2a', olive: '#6b7a2a', green: '#2f7a4a', blue: '#2b5ea8', navy: '#1f2f5a', burgundy: '#6e1b2c', wine: '#6e1b2c',
    red: '#c8322b', purple: '#5b3a8a', pink: '#d97aa6', transparent: '#cfd8dc', crystal: '#cfd8dc', cream: '#e8dcc2', white: '#eee'
  };

  let frames = [];
  // The catalog lives on the Frame Finder server (shared by every tablet); localStorage is the offline copy.
  // The sample list is only used when there is no server at all (pure offline first run).
  const API = 'api/frames';
  let serverOk = false, pushTimer = null;

  function readLocal() { try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; } }
  function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(frames)); } catch (e) { /* ignore */ } }
  function push() {
    if (!serverOk || typeof fetch !== 'function') return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frames) }).catch(() => { /* retried on next change */ }); }, 400);
  }
  function load(seedUrl) {
    frames = readLocal().map(normalise);
    return fetch(API, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then((list) => {
      serverOk = true;
      if (Array.isArray(list) && list.length) { frames = list.map(normalise); saveLocal(); }
      else if (frames.length) push(); // server is empty but this tablet has a catalog: seed the server from it
      return frames;
    }).catch(() => {
      serverOk = false;
      if (frames.length || !seedUrl) return frames;
      return fetch(seedUrl).then((r) => r.json()).then((list) => { frames = list.map(normalise); saveLocal(); return frames; }).catch(() => frames);
    });
  }
  function save() { saveLocal(); push(); }
  function all() { return frames.slice(); }
  function reset() { frames = []; save(); return Promise.resolve(frames); }
  function isOnline() { return serverOk; }

  function normalise(f) {
    const o = {};
    for (const k of FIELDS) o[k] = f[k] == null ? '' : f[k];
    for (const k of ['eye', 'bridge', 'temple', 'price', 'qty']) o[k] = o[k] === '' ? '' : Number(o[k]);
    if (!o.category) o.category = /sun/i.test(o.model + ' ' + o.brand) ? 'Sunglass' : 'Frame';
    if (!o.colour_family) o.colour_family = guessFamily(o.colour);
    o.total_width = o.eye && o.bridge ? 2 * Number(o.eye) + Number(o.bridge) + 8 : '';
    return o;
  }
  function guessFamily(colour) {
    const c = String(colour || '').toLowerCase();
    if (/gold|brown|tortoise|havana|honey|olive|copper|cream|orange|yellow|green/.test(c)) return 'Warm';
    if (/silver|blue|grey|gray|burgundy|wine|purple|pink|navy|gunmetal/.test(c)) return 'Cool';
    return 'Neutral';
  }
  // Elite inventory names carry the attributes in shop shorthand ("ARMANI BRW FULL FR SHEET 52", "Metal supra",
  // "Sleek Metal", "ASST RIMLESS BLUE"). Turn that into catalog fields so an import needs no retyping.
  function guessFromName(name) {
    const n = ' ' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    const has = (re) => re.test(n);
    const g = {};
    if (has(/ (sheet|acetate|plastic|shet) /)) g.material = 'Sheet';
    else if (has(/ (tr|tr90|tr 90|flex|flexi|ultem) /)) g.material = 'TR90';
    else if (has(/ titan(ium)? /)) g.material = 'Titanium';
    else if (has(/ (metal|steel|mtl) /)) g.material = 'Metal';
    if (has(/ (rimless|3 ?pc|3 ?piece|drill) /)) { g.rim = 'Rimless'; if (!g.material) g.material = 'Metal'; }
    else if (has(/ (supra|half|semi|nylon|hr) /)) { g.rim = 'Half'; if (!g.material) g.material = 'Metal'; }
    else if (has(/ (full|ff|fr|fullrim) /)) g.rim = 'Full';
    if (has(/ (aviator|avi) /)) g.shape = 'Aviator';
    else if (has(/ (round|rnd|circle) /)) g.shape = 'Round';
    else if (has(/ (oval) /)) g.shape = 'Oval';
    else if (has(/ (cat|cateye|cat eye|butterfly) /)) g.shape = 'Cat-eye';
    else if (has(/ (wayfarer|wf|way) /)) g.shape = 'Wayfarer';
    else if (has(/ (browline|clubmaster|club) /)) g.shape = 'Browline';
    else if (has(/ (hexa|hexagon|octa|geo|geometric) /)) g.shape = 'Geometric';
    else if (has(/ (oversize|oversized|big) /)) g.shape = 'Oversized';
    else if (has(/ (sq|square|squre) /)) g.shape = 'Square';
    else if (has(/ (rect|rectangle|rectangular) /)) g.shape = 'Rectangle';
    if (has(/ (sleek|thin|slim|light|fine) /)) g.weight = 'Thin';
    else if (has(/ (bold|broad|thick|heavy|chunky) /)) g.weight = 'Broad';
    if (has(/ (kids|kid|baby|child|children|teenager|teen|junior) /)) g.gender = 'Kids';
    else if (has(/ (ladies|lady|women|woman|female|girls) /)) g.gender = 'Women';
    else if (has(/ (gents|gent|men|man|male|boys) /)) g.gender = 'Men';
    const colours = [['black', /(blk|black)/], ['Gold', /(gold|gld)/], ['Silver', /(silver|slv)/], ['Grey', /(grey|gray)/], ['Brown', /(brw|brown|brn)/], ['Tortoise', /(tortoise|torto|demi|havana)/],
      ['Blue', /(blue|blu)/], ['Green', /(green|grn)/], ['Red', /(red)/], ['Pink', /(pink)/], ['Purple', /(purple|violet)/], ['Transparent', /(trans|transparent|clear|crystal)/], ['Gunmetal', /(gun|gunmetal)/], ['Rose gold', /(rose)/], ['Wine', /(wine|maroon|burgundy)/], ['White', /(white)/]];
    const found = colours.filter(([, re]) => has(new RegExp(' ' + re.source + ' '))).map(([c]) => c[0].toUpperCase() + c.slice(1));
    if (found.length) g.colour = found.join(' / ');
    const size = n.match(/ (4[2-9]|5[0-9]|6[0-2]) /);
    if (size) g.eye = Number(size[1]);
    if (has(/ (sun|sunglass|sunglasses|goggle|goggles) /)) g.category = 'Sunglass';
    return g;
  }

  function upsert(f) {
    const n = normalise(f);
    if (!n.code) throw new Error('Item code is required');
    const i = frames.findIndex((x) => x.code === n.code);
    if (i >= 0) frames[i] = n; else frames.push(n);
    save();
    return n;
  }
  function remove(code) { frames = frames.filter((f) => f.code !== code); save(); }

  // ---------- matching ----------
  function match(rec, size, opts) {
    opts = opts || {};
    const out = [];
    for (const f of frames) {
      if (opts.inStockOnly && !(Number(f.qty) > 0)) continue;
      let score = 0; const why = []; const against = [];
      if (rec.shapes.includes(f.shape)) { score += 3; why.push(f.shape + ' shape suits'); }
      if (rec.avoid.includes(f.shape)) { score -= 3; against.push(f.shape + ' shape to avoid'); }
      if (f.rim === 'Rimless' && rec.shapes.includes('Rimless')) { score += 2; why.push('rimless suits'); }
      if (rec.rims.includes(f.rim)) score += 0.5;
      if (f.weight === rec.weight) { score += 1.5; why.push(f.weight.toLowerCase() + ' rim'); }
      else if (rec.weights.includes(f.weight)) score += 0.5;
      if (f.material === rec.material) { score += 1; why.push(f.material.toLowerCase()); }
      else if (rec.materials.includes(f.material)) score += 0.5;
      if (size && f.total_width) {
        const d = Math.abs(f.total_width - size.frameWidth);
        if (d <= 3) { score += 2; why.push('size fits'); } else if (d <= 6) score += 1; else if (d > 10) { score -= 1; against.push('size off by ' + d + ' mm'); }
      }
      if (rec.colourFamilies.some((c) => String(f.colour).toLowerCase().includes(c.toLowerCase()))) { score += 1; why.push('colour flatters'); }
      else if (f.colour_family === 'Neutral') score += 0.5;
      out.push({ frame: f, score, why, against });
    }
    return out.filter((r) => r.score >= 2).sort((a, b) => b.score - a.score);
  }

  // ---------- schematic frame drawing (no photo needed) ----------
  function colourHex(colour) {
    const c = String(colour || '').toLowerCase();
    for (const k of Object.keys(COLOUR_HEX)) if (c.includes(k)) return COLOUR_HEX[k];
    return '#555';
  }
  function lensPath(shape, cx, cy, w, h) {
    const l = cx - w / 2, r = cx + w / 2, t = cy - h / 2, b = cy + h / 2;
    switch (shape) {
      case 'Round': return `M${cx - w / 2},${cy} a${w / 2},${h / 2} 0 1,0 ${w},0 a${w / 2},${h / 2} 0 1,0 -${w},0`;
      case 'Oval': return `M${cx - w / 2},${cy} a${w / 2},${h / 2 * 0.85} 0 1,0 ${w},0 a${w / 2},${h / 2 * 0.85} 0 1,0 -${w},0`;
      case 'Square': return `M${l + 6},${t} H${r - 6} q6,0 6,6 V${b - 6} q0,6 -6,6 H${l + 6} q-6,0 -6,-6 V${t + 6} q0,-6 6,-6 Z`;
      case 'Rectangle': return `M${l + 5},${t + 4} H${r - 5} q5,0 5,5 V${b - 9} q0,5 -5,5 H${l + 5} q-5,0 -5,-5 V${t + 9} q0,-5 5,-5 Z`;
      case 'Cat-eye': return `M${l},${cy} Q${l + 4},${t - 6} ${r - 4},${t + 2} Q${r + 4},${t - 2} ${r},${cy} Q${r - 6},${b} ${cx},${b} Q${l + 2},${b} ${l},${cy} Z`;
      case 'Aviator': return `M${l + 2},${t + 2} H${r - 2} Q${r + 6},${t + 2} ${r},${cy + 4} Q${r - 8},${b + 4} ${cx},${b} Q${l + 4},${b - 4} ${l + 2},${cy - 4} Z`;
      case 'Wayfarer': return `M${l},${t} H${r + 2} Q${r + 8},${t} ${r + 4},${t + 8} L${r - 6},${b} H${l + 8} Q${l},${b} ${l},${b - 8} Z`;
      case 'Browline': return `M${l},${t} H${r} V${cy} Q${r},${b} ${cx},${b} Q${l},${b} ${l},${cy} Z`;
      case 'Geometric': return `M${l + 10},${t} H${r - 10} L${r},${cy} L${r - 10},${b} H${l + 10} L${l},${cy} Z`;
      case 'Oversized': return `M${l - 4},${t - 4} H${r + 4} q8,0 8,8 V${b} q0,8 -8,8 H${l - 4} q-8,0 -8,-8 V${t + 4} q0,-8 8,-8 Z`;
      default: return `M${l + 5},${t + 4} H${r - 5} q5,0 5,5 V${b - 9} q0,5 -5,5 H${l + 5} q-5,0 -5,-5 V${t + 9} q0,-5 5,-5 Z`;
    }
  }
  function svg(f, sizePx) {
    const W = 160, H = 70, stroke = f.weight === 'Broad' ? 7 : f.weight === 'Thin' ? 2 : 4;
    const col = colourHex(f.colour), lw = 62, lh = f.shape === 'Oversized' ? 46 : 40, cy = 34;
    const left = lensPath(f.shape, 44, cy, lw, lh), right = lensPath(f.shape, 116, cy, lw, lh);
    let lensStroke = col, lensWidth = stroke, dash = '';
    if (f.rim === 'Rimless') { lensStroke = '#9aa'; lensWidth = 1; dash = ' stroke-dasharray="3 3"'; }
    let extra = '';
    if (f.rim === 'Half') extra = `<path d="M13,${cy - 14} H75 M85,${cy - 14} H147" stroke="${col}" stroke-width="${stroke + 2}" fill="none" stroke-linecap="round"/>`;
    if (f.rim === 'Rimless') extra = `<path d="M13,${cy - 10} q0,-6 6,-6 M147,${cy - 10} q0,-6 -6,-6" stroke="${col}" stroke-width="2" fill="none"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="${sizePx || 160}" xmlns="http://www.w3.org/2000/svg" aria-label="${f.shape} ${f.rim} frame">
      <path d="${left}" fill="rgba(120,160,200,0.12)" stroke="${lensStroke}" stroke-width="${lensWidth}" stroke-linejoin="round"${dash}/>
      <path d="${right}" fill="rgba(120,160,200,0.12)" stroke="${lensStroke}" stroke-width="${lensWidth}" stroke-linejoin="round"${dash}/>
      <path d="M75,${cy - 4} q5,-6 10,0" stroke="${col}" stroke-width="${Math.max(2, stroke - 1)}" fill="none"/>
      <path d="M13,${cy - 10} L2,${cy - 12} M147,${cy - 10} L158,${cy - 12}" stroke="${col}" stroke-width="${Math.max(2, stroke - 1)}" stroke-linecap="round"/>
      ${extra}</svg>`;
  }

  // ---------- CSV ----------
  function toCSV() {
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [FIELDS.join(',')].concat(frames.map((f) => FIELDS.map((k) => esc(f[k])).join(','))).join('\n');
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    return rows.slice(1).filter((r) => r.some((c) => c.trim() !== '')).map((r) => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] || '').trim(); }); return o; });
  }
  // Accepts our own export, or an Elite inventory export (Item Stock Summary / items list): code, name,
  // default_price/price, closing_stock/qty, category. Missing attributes are guessed from the item name.
  function importCSV(text) {
    const list = parseCSV(text); let n = 0, skipped = 0;
    // Importing a real inventory retires the built-in sample frames (FR1001…FR1030) unless a photo was attached to one.
    if (list.some((r) => r.code && !/^FR10\d\d$/.test(r.code))) frames = frames.filter((f) => !(/^FR10\d\d$/.test(f.code) && !f.image));
    for (const raw of list) {
      const o = Object.assign({}, raw);
      if (!o.code) continue;
      if (o.category && !/frame|sun|goggle/i.test(o.category)) { skipped++; continue; }
      const name = o.name || o.item_name || o.item || '';
      if (name && !o.model) o.model = name;
      if (o.default_price != null && o.default_price !== '' && (o.price == null || o.price === '')) o.price = o.default_price;
      if (o.closing_stock != null && o.closing_stock !== '' && (o.qty == null || o.qty === '')) o.qty = o.closing_stock;
      if (o.stock != null && o.stock !== '' && (o.qty == null || o.qty === '')) o.qty = o.stock;
      const g = guessFromName(name || o.model);
      for (const k of Object.keys(g)) if (o[k] == null || o[k] === '') o[k] = g[k];
      // Shape stays blank when the name does not say: an unknown shape must not score as a match.
      if (!o.material) o.material = 'Sheet';
      if (!o.rim) o.rim = 'Full';
      if (!o.weight) o.weight = 'Medium';
      if (!o.gender) o.gender = 'Unisex';
      if (o.category && /sun|goggle/i.test(o.category)) o.category = 'Sunglass'; else if (o.category) o.category = 'Frame';
      const existing = frames.find((f) => f.code === o.code);
      if (existing) { // keep hand-entered attributes and photo; refresh name/price/qty from the inventory
        for (const k of FIELDS) if (existing[k] !== '' && existing[k] != null && !['price', 'qty', 'model'].includes(k)) o[k] = existing[k];
        if (existing.image) o.image = existing.image;
      }
      upsertQuiet(o); n++;
    }
    save();
    return { imported: n, skipped };
  }
  function upsertQuiet(f) {
    const n = normalise(f);
    const i = frames.findIndex((x) => x.code === n.code);
    if (i >= 0) frames[i] = n; else frames.push(n);
    return n;
  }
  function setImage(code, url) { const f = frames.find((x) => x.code === code); if (!f) return null; f.image = url; save(); return f; }

  return { FIELDS, CATEGORIES, SHAPES, MATERIALS, RIMS, WEIGHTS, FAMILIES, GENDERS, load, save, all, reset, isOnline, upsert, remove, setImage, match, svg, colourHex, guessFamily, guessFromName, toCSV, parseCSV, importCSV, normalise };
});
