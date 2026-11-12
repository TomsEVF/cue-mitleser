// Service Worker: macht die App offline nutzbar (iPad im Theater ohne WLAN).
// Strategie: sofort aus dem Cache antworten und im Hintergrund aktualisieren.
// Das Sprachmodell verwaltet erkennung.js selbst (Cache „cue-sprachmodell-v1“).
const VERSION = 'cue-app-v4';
const DATEIEN = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/editor.js', 'js/show.js', 'js/skript.js', 'js/tracker.js', 'js/zahlen.js',
  'js/hilfen.js', 'js/erkennung.js', 'js/datei-import.js', 'js/beispiel.js', 'js/diagnose.js',
  'vendor/vosk.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/jszip.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cue-app-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/(api|ws|models)(\/|$)/.test(url.pathname)) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const treffer = await cache.match(req, { ignoreSearch: true });
    const netz = fetch(req).then((r) => {
      if (r.ok && r.type === 'basic') cache.put(req, r.clone());
      return r;
    }).catch(() => null);
    if (treffer) { e.waitUntil(netz); return treffer; }
    return (await netz) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});
