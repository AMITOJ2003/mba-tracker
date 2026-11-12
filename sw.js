// Offline support: precache the app shell, then serve cache-first and refresh in the background.
// Bump CACHE when you change the file list below.
const CACHE = 'mba-tracker-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/app.js',
  './js/db.js',
  './js/seed.js',
  './js/dates.js',
  './js/chart.js',
  './js/ics.js',
  './js/analyze.js',
  './js/sync.js',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const isNav = req.mode === 'navigate';
      const cached = await cache.match(isNav ? './index.html' : req, { ignoreSearch: isNav });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(isNav ? './index.html' : req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
    })()
  );
});
