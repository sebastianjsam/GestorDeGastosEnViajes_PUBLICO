const CACHE_NAME = 'rutamoto-v5';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const CACHEABLE_API_ORIGINS = [
  'api.open-meteo.com',
  'api.rainviewer.com',
  'tilecache.rainviewer.com',
  'overpass-api.de',
  'tile.openstreetmap.org',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== 'rutamoto-offline-tiles-v1')
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(
      caches.open('rutamoto-offline-tiles-v1').then(async (tileCache) => {
        const cached = await tileCache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) tileCache.put(request, res.clone());
          return res;
        } catch {
          return new Response(null, { status: 503 });
        }
      })
    );
    return;
  }

  if (CACHEABLE_API_ORIGINS.some((origin) => url.hostname.includes(origin))) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (apiCache) => {
        const cached = await apiCache.match(request);
        const fetchPromise = fetch(request)
          .then((res) => {
            if (res.ok) apiCache.put(request, res.clone());
            return res;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(fetchPromise);
          return cached;
        }
        return (
          fetchPromise ||
          new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('./index.html', res.clone());
            return res;
          }
        } catch {
          // sin red
        }
        return (
          (await caches.match('./index.html')) ||
          (await caches.match('./')) ||
          new Response('Sin conexión', { status: 503 })
        );
      })()
    );
    return;
  }

  if (url.origin === self.location.origin) {
    const hashed = /\.[a-f0-9]{8,}\.(js|css|woff2?)$/i.test(url.pathname);
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached && hashed) {
          return cached;
        }
        try {
          const response = await fetch(request);
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        } catch {
          if (cached) return cached;
          throw new Error('offline');
        }
      })
    );
  }
});
