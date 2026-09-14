/* Generates PWA icons (brand-red tile with a white spectacles glyph) as PNG using only Node built-ins. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) { const [r, g, b, a] = pixel(x, y); const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function glyph(size) {
  const s = size;
  const r = s * 0.155, t = s * 0.045, cy = s * 0.52, lx = s * 0.31, rx = s * 0.69;
  const ring = (x, y, cx) => { const d = Math.hypot(x - cx, y - cy); return Math.abs(d - r) < t; };
  const bridge = (x, y) => x > lx + r - t && x < rx - r + t && Math.abs(y - (cy - r * 0.35)) < t * 0.8;
  const temple = (x, y) => (x < lx - r + t && x > s * 0.08 && Math.abs(y - (cy - r * 0.55)) < t * 0.8) || (x > rx + r - t && x < s * 0.92 && Math.abs(y - (cy - r * 0.55)) < t * 0.8);
  return (x, y) => {
    const rad = s * 0.2;
    const inside = (x > rad || y > rad || Math.hypot(x - rad, y - rad) < rad) && (x < s - rad || y > rad || Math.hypot(x - (s - rad), y - rad) < rad) &&
      (x > rad || y < s - rad || Math.hypot(x - rad, y - (s - rad)) < rad) && (x < s - rad || y < s - rad || Math.hypot(x - (s - rad), y - (s - rad)) < rad);
    if (!inside) return [0, 0, 0, 0];
    if (ring(x, y, lx) || ring(x, y, rx) || bridge(x, y) || temple(x, y)) return [255, 255, 255, 255];
    return [0xe1, 0x50, 0x3a, 255];
  };
}
const out = path.join(__dirname, '..', 'public', 'img');
for (const size of [192, 512]) { fs.writeFileSync(path.join(out, `icon-${size}.png`), png(size, glyph(size))); console.log('wrote icon-' + size + '.png'); }
