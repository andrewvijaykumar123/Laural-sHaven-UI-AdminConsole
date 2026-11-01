// Offline support: the app shell is cached; live data stays with Firebase and its own offline cache.
const CACHE = 'lh-shell-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'fb-config.js', 'fb.js', 'core.js', 'map.js', 'map.css', 'mailtpl.js', 'app.js', 'pwa.js',
  'manifest.webmanifest', 'assets/icon-192.png', 'assets/apple-touch-icon.png', 'assets/payment-upi.jpeg',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
];

// Also cache the exact (cache-busted) URLs the current index.html asks for.
async function shellUrls() {
  const urls = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));
  try {
    const html = await (await fetch('./', { cache: 'reload' })).text();
    for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      const u = new URL(m[1], self.registration.scope);
      if (u.origin === location.origin) urls.add(u.href);
    }
  } catch (e) { /* offline during install: precache the static list only */ }
  return [...urls];
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled((await shellUrls()).map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// Network first so a deploy is picked up at once; the cache answers when offline or slow.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), req.mode === 'navigate' ? 4000 : 8000);
    if (res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' && await cache.match(new URL('index.html', self.registration.scope).href));
    return hit || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(networkFirst(req));
});
