/* Elite Frame Finder service worker.
 * Two caches: the app shell (versioned; replaced on every release) and the face-model files (kept across
 * releases, ~6 MB, so a tablet can still scan offline right after an update). Own files are network-first.
 */
const VERSION = 'eff-shell-v7';
const MODELS = 'eff-models-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/faceshape.js', 'js/catalog.js', 'js/app.js', 'js/store.js', 'js/customer.js', 'vendor/jspdf.umd.min.js', 'frames.json', 'manifest.webmanifest', 'img/Elitelogo.svg', 'img/icon-192.png', 'img/icon-512.png'];
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const MODEL_FILES = [
  MP + '/vision_bundle.mjs',
  MP + '/wasm/vision_wasm_internal.js', MP + '/wasm/vision_wasm_internal.wasm',
  MP + '/wasm/vision_wasm_nosimd_internal.js', MP + '/wasm/vision_wasm_nosimd_internal.wasm',
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(VERSION);
    try { await shell.addAll(SHELL); } catch (err) { /* offline install: runtime caching will fill in */ }
    // Warm the model cache in the background so the first offline scan works even if no scan happened online.
    const models = await caches.open(MODELS);
    await Promise.all(MODEL_FILES.map(async (u) => {
      try { if (!(await models.match(u))) { const r = await fetch(u); if (r.ok) await models.put(u, r); } } catch (err) { /* keep going */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== MODELS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  const isModel = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com';
  if (isModel) {
    // Large, versioned model files: cache-first in the persistent model cache.
    e.respondWith(caches.open(MODELS).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
  } else if (url.origin === location.origin) {
    // Own files: network-first so an online tablet always gets the latest; cached copy only when offline.
    // Never cache redirects (sign-in bounces) or error pages.
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok && !res.redirected && res.type === 'basic') caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { cacheName: VERSION })));
  }
});
