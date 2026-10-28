/*
 * Service worker of Elbasani Raporton.
 * - Static files (/_next/static, icons, fonts) are kept in the cache: the app opens fast on a weak connection.
 * - Public pages are fetched from the network first; without a connection the last copy is shown,
 *   so a resident can still fill in a report (it is kept on the phone and sent later).
 * - The municipal panel, sign-in pages and every API are never cached.
 */
const STATIC_CACHE = 'er-static-v3';
const PAGE_CACHE = 'er-pages-v3';
const OFFLINE_PAGES = ['/', '/raporto'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGE_CACHE).then((cache) => cache.addAll(OFFLINE_PAGES)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const PRIVATE = /^\/(admin|hyrje|api|konfirmo)(\/|$)/;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || PRIVATE.test(url.pathname)) return;
  // React Server Component requests change with every navigation: always from the network.
  if (request.headers.get('RSC') || url.searchParams.has('_rsc')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.svg')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/raporto')) || Response.error()),
    );
  }
});
