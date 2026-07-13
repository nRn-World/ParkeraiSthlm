const APP_CACHE = "park-stockholm-app-v2";
const MAP_CACHE = "park-stockholm-map-v2";
const BASE = "/ParkeraiSthlm";
const APP_SHELL = [BASE + "/", BASE + "/index.html", BASE + "/manifest.webmanifest", BASE + "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => ![APP_CACHE, MAP_CACHE].includes(key)).map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_APP") {
    event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(
      caches.open(MAP_CACHE).then(async (cache) => {
        // Normalize tiles across subdomains (a/b/c) by caching with path-only key
        const tileKey = url.pathname + url.search;
        let cached = await cache.match(tileKey);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(tileKey, response.clone());
          return response;
        } catch {
          return new Response("", { status: 504 });
        }
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(BASE + "/index.html", copy));
          return response;
        })
        .catch(() => caches.match(BASE + "/index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const update = fetch(request).then((response) => {
        if (response.ok) caches.open(APP_CACHE).then((cache) => cache.put(request, response.clone()));
        return response;
      });
      return cached || update;
    }),
  );
});

// Offline tile pre-caching with progress tracking
self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_APP") {
    event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  }
  if (event.data?.type === "PREPARE_OFFLINE") {
    event.waitUntil(
      (async () => {
        const urls = event.data.urls as string[];
        const total = urls.length;
        const cache = await caches.open(MAP_CACHE);
        let cached = 0;
        const BATCH = 10;
        for (let i = 0; i < total; i += BATCH) {
          const batch = urls.slice(i, i + BATCH);
          await Promise.all(
            batch.map(async (url) => {
              try {
                const tileUrl = new URL(url);
                const tileKey = tileUrl.pathname + tileUrl.search;
                const already = await cache.match(tileKey);
                if (already) return;
                const res = await fetch(url);
                if (res.ok) cache.put(tileKey, res.clone());
              } catch { /* skip failed tiles */ }
            }),
          );
          cached = Math.min(i + BATCH, total);
          if (event.source) {
            (event.source as Client).postMessage({ type: "OFFLINE_PROGRESS", cached, total });
          }
        }
      })(),
    );
  }
});
      return cached || update;
    }),
  );
});