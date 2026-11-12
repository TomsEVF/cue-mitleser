// Service Worker: macht die App offline nutzbar (iPad im Theater ohne WLAN).
// App-Dateien (HTML/JS/CSS): zuerst aus dem Netz (immer aktuelle Version), offline aus dem Speicher.
// Bibliotheken und Icons: aus dem Speicher (groß, ändern sich selten).
// Das Sprachmodell verwaltet erkennung.js selbst (Cache „cue-sprachmodell-v1“).
const VERSION = 'cue-app-v5';
const DATEIEN = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/editor.js', 'js/show.js', 'js/skript.js', 'js/tracker.js', 'js/zahlen.js',
  'js/hilfen.js', 'js/erkennung.js', 'js/datei-import.js', 'js/beispiel.js', 'js/diagnose.js',
  'vendor/vosk.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/jszip.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // „reload“: am HTTP-Cache vorbei, damit wirklich die neuen Dateien gespeichert werden
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(DATEIEN.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  const bibliothek = /\/(vendor|icons)\//.test(url.pathname);
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    if (bibliothek) {
      const treffer = await cache.match(req, { ignoreSearch: true });
      if (treffer) return treffer;
    }
    const netz = fetch(req, { cache: 'no-cache' }).then((r) => {
      if (r.ok && r.type === 'basic') cache.put(req, r.clone());
      return r;
    }).catch(() => null);
    // schlechtes WLAN: nach 4 s aus dem Speicher antworten
    const r = await Promise.race([netz, new Promise((ok) => setTimeout(ok, 4000, null))]);
    if (r) return r;
    const gespeichert = await cache.match(req, { ignoreSearch: true });
    if (gespeichert) return gespeichert;
    return (await netz) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});
