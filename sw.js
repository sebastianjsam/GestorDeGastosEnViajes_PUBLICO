// scripts/prepare-gitpages.mjs reemplaza estas dos líneas en cada build: la versión
// cambia con cada deploy (el navegador instala el SW nuevo) y la lista incluye
// todos los archivos del build, para que la app completa funcione sin red desde
// la primera apertura.
const CACHE_NAME = 'rutamoto-8d1f58f87980';
const SHELL_ASSETS = ["./","./chunk-27RW7JR7.js","./chunk-3INR3RVQ.js","./chunk-43TBCQIJ.js","./chunk-4MRDDQTV.js","./chunk-5IWU2RLI.js","./chunk-72NBBJVT.js","./chunk-77CPMYIS.js","./chunk-A7NOAHRV.js","./chunk-AF5RPGXI.js","./chunk-CWGXLQT5.js","./chunk-DVKBPP3W.js","./chunk-EEU4T2LT.js","./chunk-FSHED327.js","./chunk-GYB274TT.js","./chunk-HMFFHJNE.js","./chunk-HVYO322Q.js","./chunk-IIT6ZI2E.js","./chunk-JPEFYZQX.js","./chunk-JV27IKDM.js","./chunk-LAJG77HD.js","./chunk-LDA6CGZM.js","./chunk-LTASWVZ2.js","./chunk-MNZJXCCN.js","./chunk-MSM2CGAC.js","./chunk-PHG7CDJL.js","./chunk-PXTKUQO3.js","./chunk-QASX3FNW.js","./chunk-QFW3DYDC.js","./chunk-QOM7EB37.js","./chunk-RJ5WNWBB.js","./chunk-RJHBZWDU.js","./chunk-RZHKMMGS.js","./chunk-TQYHHTQD.js","./chunk-UDF6LZ3O.js","./chunk-UFCQBBYB.js","./chunk-VIPZUJP7.js","./chunk-WDXFCSSP.js","./chunk-XIXF6LJJ.js","./chunk-XO7RWZ4S.js","./chunk-XWUHIYAL.js","./chunk-YZIB4N2D.js","./chunk-ZSO62ZDR.js","./favicon.ico","./icon.svg","./icons/icon-128.png","./icons/icon-144.png","./icons/icon-152.png","./icons/icon-192.png","./icons/icon-384.png","./icons/icon-512.png","./icons/icon-72.png","./icons/icon-96.png","./index.html","./main-I2NPHGFP.js","./manifest.json","./media/layers-2x-TBM42ERR.png","./media/layers-55W3Q4RM.png","./media/marker-icon-2V3QKKVC.png","./polyfills-5CFQRCPP.js","./styles-BBKVSA4K.css"];

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
