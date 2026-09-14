/* RailSync shell service worker: offline-capable app WITHOUT stale bundles.
   Navigations are network-first (index.html is no-store on the server),
   hashed assets are cache-first (immutable), /api is never cached. */
const CACHE = 'railsync-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data always fresh
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return r;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return r;
    })),
  );
});
