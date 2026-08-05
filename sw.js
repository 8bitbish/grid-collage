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

// The files whose contents are the app itself. A change to any of them is an
// update worth telling someone about; a new icon is not.
const CORE = ['/app.js', '/styles.css', '/index.html', '/'];

// index.html points at app.js and styles.css with a ?v= stamp on them, and
// those are the URLs the page will actually ask for — so those are the ones
// worth having in the cache before it does. Read out of the HTML rather than
// written down here: this file has no idea what the current stamp is, and
// should not have to be edited every deploy to find out.
async function stampedShell() {
  try {
    const res = await fetch('./index.html', { cache: 'reload' });
    const html = await res.text();
    const found = [...html.matchAll(/(?:src|href)="\.?\/?((?:app\.js|styles\.css)\?v=[^"]+)"/g)];
    return SHELL.concat(found.map((m) => `./${m[1]}`));
  } catch {
    // Unstamped is still a working app; it just costs the extra launch.
    return SHELL;
  }
}

// A stamped URL is a new URL every deploy, so without this the cache would
// keep every build of app.js ever served. Anything at the same path under a
// different stamp is a previous build, and goes.
async function pruneOlder(cache, url) {
  const here = new URL(url);
  if (!here.search) return;
  const keys = await cache.keys();
  await Promise.all(keys.map((req) => {
    const was = new URL(req.url);
    if (was.pathname !== here.pathname || was.search === here.search) return null;
    return cache.delete(req);
  }));
}

// Deliberately no skipWaiting here. A worker that takes over mid-session
// swaps the cached files under a page still running the old ones, which is
// how you end up with a shell that only updates if you close the app. It
// waits instead, and the page decides when to let it in.
self.addEventListener('install', (event) => {
  event.waitUntil(
    stampedShell().then((files) => caches.open(CACHE).then((cache) => cache.addAll(files))),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

// Whether two responses are the same file. GitHub Pages sends an ETag; the
// other two are there for hosts that don't.
function stamp(res) {
  if (!res) return '';
  return res.headers.get('etag')
    || res.headers.get('last-modified')
    || res.headers.get('content-length')
    || '';
}

const isCore = (url) => {
  const p = new URL(url).pathname;
  return CORE.some((c) => p.endsWith(c));
};

async function announceUpdate() {
  // Said as often as it is found, with no guard here. One load finding both
  // app.js and the stylesheet changed announces twice, and the page shows one
  // toast either way — whereas anything remembered on this side outlives the
  // load and swallows the next deploy. A worker lives far longer than a page.
  const windows = await self.clients.matchAll({ type: 'window' });
  windows.forEach((c) => c.postMessage({ type: 'update-ready' }));
}

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
          // The page is already running the copy in `hit`. If what just came
          // back is a different file, the page it is running is out of date —
          // this is the moment to say so, rather than leaving it to be
          // noticed the next time the app is opened from cold.
          const changed = hit && stamp(hit) && stamp(hit) !== stamp(response);
          cache.put(request, response.clone());
          // Arriving here with nothing cached under this exact URL, for a
          // file that is versioned, means a deploy just landed and this is
          // the new build being read for the first time. The old one is now
          // dead weight.
          if (!hit && isCore(request.url)) pruneOlder(cache, request.url);
          if (changed && isCore(request.url)) announceUpdate();
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
