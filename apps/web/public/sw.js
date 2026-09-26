/* Branch Pulse service worker (HLD s7).
 *
 * - App shell + static assets: cache-first, so the app opens instantly and works offline.
 * - Navigations: network-first, falling back to the cached page, then the offline page.
 * - API traffic is NEVER cached here: money data must not outlive a session in a shared cache.
 *   Master data for offline entry is cached per user in IndexedDB by the app instead.
 * - Background Sync wakes the app to flush the outbox when connectivity returns.
 */
const VERSION = 'bp-v1';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const PRECACHE = ['/login', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // hashed build assets and icons never change: cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/b/home')) || (await caches.match('/offline.html'))),
    );
  }
});

// The app asks us to warm the branch screens once, so they open with no signal.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'precache' && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(SHELL).then((cache) =>
        Promise.all(
          data.urls.map((u) =>
            fetch(u, { credentials: 'same-origin' })
              .then((r) => (r.ok ? cache.put(u, r) : undefined))
              .catch(() => undefined),
          ),
        ),
      ),
    );
  }
  if (data.type === 'clear-api-cache') {
    event.waitUntil(caches.delete(SHELL).then(() => caches.open(SHELL).then((c) => c.addAll(PRECACHE))));
  }
});

// Background Sync (Chrome/Android): wake open clients so they flush the outbox with a fresh token.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-outbox') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => clients.forEach((c) => c.postMessage({ type: 'flush-outbox' }))),
    );
  }
});
