// Offline support: the app shell is cached; live data stays with Firebase and its own offline cache.
const CACHE = 'lh-shell-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'luxe.css', 'fb-config.js', 'fb.js', 'core.js', 'map.js', 'map.css', 'mailtpl.js', 'invoicepdf.js', 'app.js', 'pwa.js',
  'manifest.webmanifest', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png',
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
    for (const k of await caches.keys()) if (k !== CACHE && k !== 'lh-meta') await caches.delete(k);
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
    // no-cache revalidates with the server; plain fetch() would reuse the browser's 10-minute GitHub Pages cache.
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), req.mode === 'navigate' ? 4000 : 8000);
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

/* Background notifications from the relay Worker: { t: title, b: text, g: tag, h: '#orders' | '#events' | '' }. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil((async () => {
    // Lets the app show whether pushes reach this device at all.
    try { await (await caches.open('lh-meta')).put('push-last', new Response(JSON.stringify({ t: Date.now(), title: String(d.t || '') }))); } catch (err) { /* diagnostics only */ }
    // Always shown, even with the app in front: an alert the person cannot see is the worst outcome.
    await self.registration.showNotification(String(d.t || "Laural's Haven").slice(0, 80), {
      body: String(d.b || '').slice(0, 200),
      tag: String(d.g || 'lh').slice(0, 60),
      renotify: true,
      icon: 'assets/icon-192.png',
      badge: 'assets/icon-192.png',
      data: { h: /^#[a-z]{1,12}$/.test(d.h) ? d.h : '' }
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.h) || '';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); win.postMessage({ lhGo: hash }); return; }
    await self.clients.openWindow(self.registration.scope + hash);
  })());
});
