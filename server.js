/* Elite Frame Finder server.
 * - Serves the PWA from ./public (http, or https when certs/key.pem + certs/cert.pem exist).
 * - POST /api/tag: photo of a frame -> Claude reads shape / material / rim / weight / colour as strict JSON.
 * - GET  /api/health: tells the app whether AI tagging is configured.
 * Face scanning itself never touches this server; it runs entirely on the tablet.
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

loadEnv(path.join(__dirname, '.env'));
// Convenience for this shop: fall back to the Elite software app's .env so the same key serves both.
if (!process.env.ANTHROPIC_API_KEY) loadEnv(path.join(__dirname, '..', 'Elite software', '.env'), ['ANTHROPIC_API_KEY']);

const PORT = Number(process.env.PORT) || 4100;
const APP_VERSION = '2026-09-15.2';
const STARTED = new Date().toISOString();
const PUBLIC = path.join(__dirname, 'public');
const MODEL = process.env.ANTHROPIC_TAG_MODEL || 'claude-opus-5';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.csv': 'text/csv', '.ico': 'image/x-icon' };

function loadEnv(file, only) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || (only && !only.includes(m[1])) || process.env[m[1]]) continue;
    const v = m[2].replace(/^["']|["']$/g, '');
    if (v) process.env[m[1]] = v;
  }
}

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// The attribute vocabulary is the same one the catalog uses, so the reading drops straight into a frame record.
const TAG_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    shape: { type: 'string', enum: ['Rectangle', 'Square', 'Round', 'Oval', 'Cat-eye', 'Aviator', 'Wayfarer', 'Browline', 'Geometric', 'Oversized'] },
    material: { type: 'string', enum: ['Sheet', 'Metal', 'TR90', 'Combination', 'Titanium'] },
    rim: { type: 'string', enum: ['Full', 'Half', 'Rimless'] },
    weight: { type: 'string', enum: ['Thin', 'Medium', 'Broad'] },
    colour: { type: 'string' },
    colour_family: { type: 'string', enum: ['Warm', 'Cool', 'Neutral'] },
    gender: { type: 'string', enum: ['Unisex', 'Men', 'Women', 'Kids'] },
    brand: { type: 'string' },
    model: { type: 'string' },
    eye: { type: ['integer', 'null'] },
    bridge: { type: ['integer', 'null'] },
    temple: { type: ['integer', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string' }
  },
  required: ['shape', 'material', 'rim', 'weight', 'colour', 'colour_family', 'gender', 'brand', 'model', 'eye', 'bridge', 'temple', 'confidence', 'notes']
};

const TAG_PROMPT = `You are cataloguing a spectacle frame for an optical shop in India from one photograph.
Classify the frame using ONLY the allowed values.
- shape: the lens shape as an optician names it. Wayfarer = trapezoid with thicker top, Browline = heavy top bar with thin/no bottom rim, Cat-eye = upswept outer corners, Geometric = hexagon/octagon/angular, Oversized = very large lenses.
- material: "Sheet" means acetate/plastic (the Indian trade word), "Metal" for steel/alloy wire, "TR90" for flexible matte nylon plastic, "Combination" for plastic front with metal temples or metal-and-acetate mix, "Titanium" only if clearly ultra-thin titanium.
- rim: Full (rim all round), Half (top rim only, nylon thread below), Rimless (lenses drilled, no rim).
- weight: Thin (fine wire or thin rim), Medium, Broad (thick, bold rim).
- colour: short plain colour name such as "Black", "Tortoise", "Gold", "Gunmetal", "Transparent Grey", "Blue".
- colour_family: Warm (gold, brown, tortoise, honey, olive), Cool (silver, black-blue, grey, blue, burgundy), Neutral (plain black, crystal, gunmetal, rose gold).
- brand and model: read from the temple print if visible, otherwise empty string.
- eye, bridge, temple: the size printed on the inside of the temple (e.g. 52-18-140) if legible, otherwise null. Never guess these.
- confidence: how sure you are about shape/material/rim overall.
- notes: one short sentence for the salesperson, e.g. what was hard to see.`;

async function tagFrame(dataUrl) {
  const c = getClient();
  if (!c) throw Object.assign(new Error('AI tagging is not configured. Add ANTHROPIC_API_KEY to .env and restart.'), { status: 503 });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('Send a JPEG/PNG/WebP data URL in "image".'), { status: 400 });

  const response = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: TAG_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
        { type: 'text', text: TAG_PROMPT }
      ]
    }]
  });
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('The model declined to read this photo' + (response.stop_details && response.stop_details.explanation ? ': ' + response.stop_details.explanation : '.')), { status: 502 });
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = JSON.parse(text);
  data.model_used = response.model;
  return data;
}

// Optional cloud second opinion on face shape. Geometry on the tablet does the measuring (an LLM cannot
// measure millimetres); Claude looks at the whole face the way an experienced optician would and gives a
// shape + reasoning. The app shows it next to the local result and lets staff adopt it.
const SHAPE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    shape: { type: 'string', enum: ['Oval', 'Round', 'Square', 'Heart', 'Oblong', 'Diamond', 'Triangle'] },
    runner_up: { type: 'string', enum: ['Oval', 'Round', 'Square', 'Heart', 'Oblong', 'Diamond', 'Triangle'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    frame_advice: { type: 'string' },
    photo_quality: { type: 'string' }
  },
  required: ['shape', 'runner_up', 'confidence', 'reasoning', 'frame_advice', 'photo_quality']
};
const SHAPE_PROMPT = `You are an experienced optician in India classifying a customer's face shape from one frontal photo, to choose spectacle frames.
Use only these labels: Oval (balanced, slightly longer than wide, gently rounded jaw), Round (width close to length, soft jaw, full cheeks), Square (width close to length, strong angular jaw, broad forehead), Heart (forehead clearly wider than the jaw, chin narrow/pointed), Oblong (clearly longer than wide, straight cheek lines), Diamond (cheekbones widest, forehead and chin both narrow), Triangle (jaw wider than the forehead).
Judge the bone structure, ignore hairstyle, glasses and expression. Give the single best label, the runner-up, your confidence, two sentences of reasoning an optician would recognise, one sentence of frame advice (shape, rim weight, sheet/acetate vs metal), and one short note on photo quality (angle, lighting, hair covering the forehead).`;

async function faceShapeOpinion(dataUrl) {
  const c = getClient();
  if (!c) throw Object.assign(new Error('AI is not configured. Add ANTHROPIC_API_KEY to .env and restart.'), { status: 503 });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('Send a JPEG/PNG/WebP data URL in "image".'), { status: 400 });
  const response = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SHAPE_SCHEMA } },
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: SHAPE_PROMPT }] }]
  });
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('The model declined to assess this photo' + (response.stop_details && response.stop_details.explanation ? ': ' + response.stop_details.explanation : '.')), { status: 502 });
  }
  const data = JSON.parse(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  data.model_used = response.model;
  return data;
}

// ---------- customer records on disk: data/customers/<id>.json + <id>.jpg + <id>-full.pdf / <id>-detail.pdf ----------
// DATA_DIR lets a host mount a persistent volume (Railway: mount a Volume at /data and set DATA_DIR=/data/customers).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data', 'customers');
function safeId(id) { return /^[A-Za-z0-9_-]{1,40}$/.test(String(id || '')) ? String(id) : null; }
function writeDataUrl(file, dataUrl, expectPrefix) {
  // jsPDF emits "data:application/pdf;filename=generated.pdf;base64,..." — allow extra parameters before base64.
  const m = /^data:([^;,]+)(?:;[^,]*?)?;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m || !m[1].startsWith(expectPrefix)) return false;
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return true;
}
function saveCustomer(rec) {
  const id = safeId(rec && rec.id);
  if (!id) throw Object.assign(new Error('Bad record id'), { status: 400 });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const files = {};
  if (rec.photo && writeDataUrl(path.join(DATA_DIR, id + '.jpg'), rec.photo, 'image/')) files.photo = id + '.jpg';
  for (const kind of ['full', 'detail']) {
    const p = rec.pdfs && rec.pdfs[kind];
    if (p && writeDataUrl(path.join(DATA_DIR, id + '-' + kind + '.pdf'), p, 'application/pdf')) files[kind + 'Pdf'] = id + '-' + kind + '.pdf';
  }
  const meta = Object.assign({}, rec); delete meta.photo; delete meta.thumb; delete meta.pdfs;
  const existingPath = path.join(DATA_DIR, id + '.json');
  const existing = fs.existsSync(existingPath) ? JSON.parse(fs.readFileSync(existingPath, 'utf8')) : {};
  meta.files = Object.assign({}, existing.files || {}, files);
  meta.savedAt = new Date().toISOString();
  fs.writeFileSync(existingPath, JSON.stringify(meta, null, 2));
  return { ok: true, id, files: meta.files };
}
function listCustomers() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch (e) { return null; } })
    .filter(Boolean).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
function deleteCustomer(id) {
  id = safeId(id); if (!id || !fs.existsSync(DATA_DIR)) return;
  for (const f of fs.readdirSync(DATA_DIR)) if (f === id + '.json' || f.startsWith(id + '.') || f.startsWith(id + '-')) fs.unlinkSync(path.join(DATA_DIR, f));
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size > limit) { reject(Object.assign(new Error('Photo too large (max 8 MB).'), { status: 413 })); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Access log: printed to the console and kept in memory so /api/debug can show which devices are reaching us.
const RECENT = [];
function logAccess(req) {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  const line = { t: new Date().toISOString(), ip, m: req.method, p: req.url.split('?')[0], ua: (req.headers['user-agent'] || '').slice(0, 80) };
  RECENT.push(line); if (RECENT.length > 300) RECENT.shift();
  if (!/\.(js|css|png|svg|json|webmanifest|mjs|wasm|task)$/.test(line.p)) console.log(line.t.slice(11, 19) + ' ' + ip + ' ' + line.m + ' ' + line.p);
}
const certKey = path.join(__dirname, 'certs', 'key.pem'), certCrt = path.join(__dirname, 'certs', 'cert.pem');
const useHttps = fs.existsSync(certKey) && fs.existsSync(certCrt);
function lanUrls() {
  // Shop Wi-Fi addresses (192.168.x / 10.x) first; VPN addresses such as Tailscale (100.x) after.
  const lanFirst = (ip) => (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ? 0 : 1);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address).sort((a, b) => lanFirst(a) - lanFirst(b));
  const urls = [];
  if (useHttps) ips.forEach((ip) => urls.push('https://' + ip + ':' + HTTPS_PORT));
  ips.forEach((ip) => urls.push('http://' + ip + ':' + PORT));
  return urls;
}

// Staff login. On the shop LAN leave APP_PASSWORD unset (no prompt). On a public host such as Railway set
// APP_PASSWORD (and optionally APP_USER, default "elite"): the browser asks once and remembers it, and every
// page and API call — including the customer records — is refused without it.
const crypto = require('crypto');
const AUTH_USER = process.env.APP_USER || 'elite';
const AUTH_PASS = process.env.APP_PASSWORD || '';
function same(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
// Session cookie: "user|expiry|hmac", signed with SESSION_SECRET (or a key derived from the password), 90 days.
const SESSION_DAYS = 90;
const SESSION_KEY = process.env.SESSION_SECRET || crypto.createHash('sha256').update('eff|' + AUTH_USER + '|' + AUTH_PASS).digest('hex');
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
function sign(s) { return crypto.createHmac('sha256', SESSION_KEY).update(s).digest('base64url'); }
function makeSession(user) { const body = user + '|' + (Date.now() + SESSION_DAYS * 86400000); return body + '|' + sign(body); }
function sessionUser(req) {
  const m = /(?:^|;\s*)eff_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const parts = decodeURIComponent(m[1]).split('|');
  if (parts.length !== 3) return null;
  const body = parts[0] + '|' + parts[1];
  if (!same(sign(body), parts[2])) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return parts[0];
}
function basicUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return null;
  const creds = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = creds.indexOf(':');
  if (i < 0) return null;
  return same(creds.slice(0, i), AUTH_USER) && same(creds.slice(i + 1), AUTH_PASS) ? AUTH_USER : null;
}
function authorized(req) { return !AUTH_PASS || !!sessionUser(req) || !!basicUser(req); }
function cookieHeader(value, maxAge, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || (req.socket && req.socket.encrypted) ? '; Secure' : '';
  return 'eff_session=' + encodeURIComponent(value) + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; SameSite=Lax' + secure;
}
// Small brute-force brake: 8 wrong passwords per IP, then a 15-minute wait.
const FAILS = new Map();
function failCount(ip) { const f = FAILS.get(ip); if (!f || f.until < Date.now()) return 0; return f.n; }
function noteFail(ip) { const f = FAILS.get(ip); const n = (f && f.until > Date.now() ? f.n : 0) + 1; FAILS.set(ip, { n, until: Date.now() + 15 * 60000 }); }
// Pages that must load before sign-in.
const PUBLIC_PATHS = /^\/(login\.html|css\/app\.css|img\/[^/]+|manifest\.webmanifest|favicon\.ico)$/;

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  logAccess(req);
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, ai: !!process.env.ANTHROPIC_API_KEY, model: MODEL, version: APP_VERSION, auth: !!AUTH_PASS, urls: lanUrls() });
    // On a public host, refuse to run until a password exists — otherwise customer records would be open to the internet.
    if (ON_RAILWAY && !AUTH_PASS) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><meta charset="utf-8"><title>Setup required</title><body style="font-family:system-ui;padding:40px;max-width:640px"><h2>Elite Frame Finder: setup required</h2><p>This copy is on a public address but no staff password is configured, so it stays closed.</p><p>In Railway open the <b>elite-frame-selector</b> service → <b>Variables</b> → add <code>APP_PASSWORD</code> (and optionally <code>APP_USER</code>, default <code>elite</code>), then redeploy.</p></body>');
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (!AUTH_PASS) return send(res, 200, { ok: true, note: 'no password configured on this server' });
      if (failCount(ip) >= 8) return send(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' });
      const body = await readJson(req, 64 * 1024);
      if (same(String(body.user || ''), AUTH_USER) && same(String(body.password || ''), AUTH_PASS)) {
        FAILS.delete(ip);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookieHeader(makeSession(AUTH_USER), SESSION_DAYS * 86400, req) });
        return res.end(JSON.stringify({ ok: true, user: AUTH_USER }));
      }
      noteFail(ip);
      return send(res, 401, { error: 'Wrong user name or password.' });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookieHeader('', 0, req) });
      return res.end('{"ok":true}');
    }
    if (!authorized(req) && !PUBLIC_PATHS.test(url.pathname)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Sign in required.' });
      res.writeHead(302, { Location: '/login.html?next=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (AUTH_PASS && url.pathname === '/login.html' && authorized(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
    if (url.pathname === '/api/debug') return send(res, 200, { version: APP_VERSION, urls: lanUrls(), started: STARTED, recent: RECENT.slice(-100).reverse() });
    if (url.pathname === '/api/addresses') {
      const QR = require('qrcode');
      const list = [];
      for (const u of lanUrls()) list.push({ url: u, svg: await QR.toString(u, { type: 'svg', margin: 1, width: 220 }) });
      return send(res, 200, list);
    }
    if (url.pathname === '/api/tag' && req.method === 'POST') {
      const body = await readJson(req, 8 * 1024 * 1024);
      return send(res, 200, await tagFrame(body.image));
    }
    if (url.pathname === '/api/faceshape' && req.method === 'POST') {
      const body = await readJson(req, 8 * 1024 * 1024);
      return send(res, 200, await faceShapeOpinion(body.image));
    }
    // Customer records: a copy of what the tablet stores, written as files the office PC can open.
    if (url.pathname === '/api/customers' && req.method === 'POST') {
      const rec = await readJson(req, 20 * 1024 * 1024);
      return send(res, 200, saveCustomer(rec));
    }
    if (url.pathname === '/api/customers' && req.method === 'GET') return send(res, 200, listCustomers());
    const cm = /^\/api\/customers\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (cm && req.method === 'DELETE') { deleteCustomer(cm[1]); return send(res, 200, { ok: true }); }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

    // static files
    let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(file).toLowerCase();
    // Always revalidate: the service worker handles offline caching, so the browser must not hold stale CSS/JS after an update.
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e.message });
  }
}

// HTTP always on PORT; HTTPS additionally on HTTPS_PORT when certs/ exists (needed for the live camera on tablets).
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 4443;
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
http.createServer(handle).listen(PORT, '0.0.0.0', () => {
  console.log(`Elite Frame Finder ${APP_VERSION} on http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  tablet (photo mode):  http://${ip}:${PORT}`));
  console.log(`  QR codes for the tablet: http://localhost:${PORT}/connect.html`);
  console.log(`AI tagging: ${process.env.ANTHROPIC_API_KEY ? 'ON (' + MODEL + ')' : 'OFF (set ANTHROPIC_API_KEY in .env)'}`);
});
if (useHttps) {
  https.createServer({ key: fs.readFileSync(certKey), cert: fs.readFileSync(certCrt) }, handle).listen(HTTPS_PORT, '0.0.0.0', () => {
    ips.forEach((ip) => console.log(`  tablet (live camera): https://${ip}:${HTTPS_PORT}   (accept the certificate warning once)`));
  });
} else {
  console.log('Live camera preview needs HTTPS on the tablet; run "npm run make-cert" once to enable https on port ' + HTTPS_PORT + '.');
}
