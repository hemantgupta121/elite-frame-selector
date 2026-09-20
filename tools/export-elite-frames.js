/* Export Frame + Sunglass items from the Elite software's SQLite DB into a Frame Finder CSV.
 * Attributes (shape, material, rim, colour, size, gender) are guessed from the item name; staff can correct
 * them in the Frames tab. Usage:  node tools/export-elite-frames.js [path/to/elite.sqlite3] [out.csv]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const Catalog = require('../public/js/catalog.js');

const dbPath = process.argv[2] || path.join(__dirname, '..', '..', 'Elite software', 'db', 'elite.sqlite3');
const out = process.argv[3] || path.join(__dirname, '..', 'elite-frames.csv');
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare(`SELECT i.code, i.name, i.category, i.default_price AS price,
  COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.item_id = i.id), 0) AS qty
  FROM items i WHERE i.is_active = 1 AND i.category IN ('Frame', 'Sunglass') ORDER BY i.name`).all();

const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const lines = [Catalog.FIELDS.join(',')];
const stats = { shape: 0, material: 0, rim: 0, colour: 0, eye: 0 };
for (const r of rows) {
  const g = Catalog.guessFromName(r.name);
  for (const k of Object.keys(stats)) if (g[k]) stats[k]++;
  const f = {
    code: r.code, brand: '', model: r.name, category: r.category === 'Sunglass' ? 'Sunglass' : (g.category || 'Frame'),
    shape: g.shape || 'Rectangle', material: g.material || 'Sheet', rim: g.rim || 'Full', weight: g.weight || 'Medium',
    colour: g.colour || '', colour_family: Catalog.guessFamily(g.colour || ''), eye: g.eye || '', bridge: '', temple: '',
    gender: g.gender || 'Unisex', price: r.price || '', qty: Math.max(0, Math.round(r.qty)), image: ''
  };
  lines.push(Catalog.FIELDS.map((k) => esc(f[k])).join(','));
}
fs.writeFileSync(out, lines.join('\n'));
console.log('Wrote ' + rows.length + ' items to ' + out);
console.log('Guessed from names: ' + Object.entries(stats).map(([k, n]) => k + ' ' + n).join(', ') + ' (the rest use defaults; correct in the Frames tab).');
