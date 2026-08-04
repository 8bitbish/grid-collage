// Offline support. The app makes no network calls of its own, so caching the
// shell is enough to make it work with no connection at all.
//
// Bump CACHE when the shell changes — activate deletes every other cache, which
// is what evicts the previous version.
const CACHE = 'grid-collage-v1';

// Photos handed to us by the OS share sheet wait here until the page picks
// them up. Kept out of CACHE so a shell update can't throw them away.
const INBOX = 'grid-collage-share-inbox';

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
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== INBOX).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Share target. The OS POSTs the chosen photos here as a form navigation.
// There's no server behind this app, so the worker is what answers: stash the
// files and bounce the browser to the app, which collects them on load.
async function receiveShare(request) {
  let count = 0;
  try {
    const form = await request.formData();
    const files = form.getAll('photos').filter((f) => f && f.size);
    const cache = await caches.open(INBOX);

    // Drop anything a previous share left behind.
    await Promise.all((await cache.keys()).map((k) => cache.delete(k)));

    for (const file of files) {
      await cache.put(
        new Request(`./shared/${count}`),
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-filename': encodeURIComponent(file.name || `shared-${count + 1}`),
          },
        }),
      );
      count += 1;
    }
  } catch {
    count = 0;
  }
  // 303 so the browser follows with a GET rather than re-POSTing.
  return Response.redirect(`./?share=${count}`, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request));
    return;
  }

  if (request.method !== 'GET') return;

  // The manifest decides whether the browser rebuilds the installed app, so
  // it must never be answered from a stale cache: serving the old one is how
  // an installed app keeps missing a newly declared share target. Network
  // first, cache only as an offline fallback.
  if (request.destination === 'manifest' || new URL(request.url).pathname.endsWith('.webmanifest')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

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
