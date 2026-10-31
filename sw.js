// scripts/prepare-gitpages.mjs reemplaza estas dos líneas en cada build: la versión
// cambia con cada deploy (el navegador instala el SW nuevo) y la lista incluye
// todos los archivos del build, para que la app completa funcione sin red desde
// la primera apertura.
const CACHE_NAME = 'rutamoto-6893bb7f6a8d';
const SHELL_ASSETS = ["./","./chunk-2VA4JMPW.js","./chunk-3VANKBZQ.js","./chunk-4G7KHGS4.js","./chunk-5ZWFAY7G.js","./chunk-AF5RPGXI.js","./chunk-B6XQIZRZ.js","./chunk-BZGZOLNQ.js","./chunk-C25CXQJ3.js","./chunk-CLHUVQDU.js","./chunk-CWGXLQT5.js","./chunk-CYYWPSPV.js","./chunk-CZIRWT3X.js","./chunk-ECCTIAX6.js","./chunk-F2MTNWHK.js","./chunk-GK2HWQSC.js","./chunk-HHZ5QIUF.js","./chunk-JBTN2QVT.js","./chunk-JWZZDMR5.js","./chunk-KBWWX7Z7.js","./chunk-KLWOF72M.js","./chunk-KXYFAKEI.js","./chunk-LAJG77HD.js","./chunk-LLJWH6VW.js","./chunk-MO53D34K.js","./chunk-OM3EZPQC.js","./chunk-PK276FZ6.js","./chunk-QOTCB33J.js","./chunk-RFJ3TSDW.js","./chunk-SEII26K4.js","./chunk-SMBMMGUL.js","./chunk-TOSP2MQU.js","./chunk-VAPDPOQL.js","./chunk-VEEZUON3.js","./chunk-VZRA4ED7.js","./chunk-W5JZ5JE3.js","./chunk-WMXDZCNB.js","./chunk-WOEIOP7Z.js","./chunk-WOTJ5SBX.js","./chunk-WU6FXXZK.js","./chunk-XLQK4FYU.js","./chunk-XPVRA33Q.js","./chunk-XX3UDOCO.js","./chunk-ZJKAJOLT.js","./favicon.ico","./icon.svg","./icons/icon-128.png","./icons/icon-144.png","./icons/icon-152.png","./icons/icon-192.png","./icons/icon-384.png","./icons/icon-512.png","./icons/icon-72.png","./icons/icon-96.png","./index.html","./main-AYPCBQQ4.js","./manifest.json","./media/layers-2x-TBM42ERR.png","./media/layers-55W3Q4RM.png","./media/marker-icon-2V3QKKVC.png","./polyfills-5CFQRCPP.js","./styles-BBKVSA4K.css"];

const TILE_CACHE_NAME = 'rutamoto-offline-tiles-v1';
const TILE_CACHE_MAX_ENTRIES = 500;
/** Con señal débil, tras este tiempo se abre la copia guardada en vez de esperar la red. */
const NAVIGATE_TIMEOUT_MS = 3000;

const CACHEABLE_API_ORIGINS = [
  'api.open-meteo.com',
  'api.rainviewer.com',
  'tilecache.rainviewer.com',
  'overpass-api.de',
  'tile.openstreetmap.org',
];

self.addEventListener('install', (event) => {
  // Uno a uno: si un archivo falla, el resto igual queda disponible offline.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Conserva también la versión anterior: una pestaña que siga abierta con ella
    // puede pedir sus chunks aunque ya no existan en el servidor.
    caches.keys().then((keys) => {
      // rutamoto-offline-*: mapas y rutas guardados por el usuario, no dependen de la versión.
      const shells = keys.filter((k) => k !== CACHE_NAME && !k.startsWith('rutamoto-offline-'));
      return Promise.all(shells.slice(0, -1).map((k) => caches.delete(k)));
    })
  );
  self.clients.claim();
});

/** Evita que el caché de tiles crezca sin límite (mapa offline de las últimas rutas vistas). */
async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length > TILE_CACHE_MAX_ENTRIES) {
    await cache.delete(keys[0]);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (tileCache) => {
        const cached = await tileCache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) {
            await tileCache.put(request, res.clone());
            trimTileCache();
          }
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
          const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), NAVIGATE_TIMEOUT_MS)
          );
          const res = await Promise.race([fetch(request), timeout]);
          if (res.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('./index.html', res.clone());
            return res;
          }
        } catch {
          // sin red o señal débil
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
    // Angular nombra los archivos con hash como chunk-AB12CD34.js / styles-AB12CD34.css.
    const hashed = /[-.][A-Z0-9]{8,}\.(js|css|woff2?)$/i.test(url.pathname);
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
