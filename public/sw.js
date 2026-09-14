/* Elite Frame Finder service worker: app shell + model files cached so the tablet works offline after first load. */
const VERSION = 'eff-v4';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/faceshape.js', 'js/catalog.js', 'js/app.js', 'js/store.js', 'js/customer.js', 'vendor/jspdf.umd.min.js', 'frames.json', 'manifest.webmanifest', 'img/Elitelogo.svg', 'img/icon-192.png', 'img/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  const isModel = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com';
  const store = (res) => { if (res && (res.ok || res.type === 'opaque')) caches.open(VERSION).then((c) => c.put(e.request, res.clone())); return res; };
  if (isModel) {
    // Large, versioned model files: cache-first (they never change for a given version).
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then(store)));
  } else if (url.origin === location.origin) {
    // Our own files: network-first so an online tablet always gets the latest, cache only when offline.
    e.respondWith(fetch(e.request).then(store).catch(() => caches.match(e.request)));
  }
});
