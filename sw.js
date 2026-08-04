// Offline support. The app makes no network calls of its own, so caching the
// shell is enough to make it work with no connection at all.
//
// Bump CACHE when the shell changes — activate deletes every other cache, which
// is what evicts the previous version.
const CACHE = 'grid-collage-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Page loads go to the network first so a new deploy is picked up straight
  // away, and fall back to the cached shell when there's no connection.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Static assets: answer from cache immediately, then refresh it in the
  // background. Without the refresh, a cache-first worker would keep serving
  // an old app.js after a deploy until someone remembered to bump CACHE.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);

      const fresh = fetch(request).then((response) => {
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(() => null);

      if (hit) {
        event.waitUntil(fresh);
        return hit;
      }
      return (await fresh) || Response.error();
    }),
  );
});
