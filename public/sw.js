const APP_CACHE = "park-stockholm-app-v5";
const MAP_CACHE = "park-stockholm-map-v5";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

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

  if (event.data?.type !== "PREPARE_OFFLINE") return;

  event.waitUntil((async () => {
    const urls = event.data.urls;
    const cache = await caches.open(MAP_CACHE);
    const total = urls.length;
    let cached = 0;

    for (let index = 0; index < total; index += 10) {
      await Promise.all(urls.slice(index, index + 10).map(async (url) => {
        try {
          const tileUrl = new URL(url);
          const key = tileUrl.pathname + tileUrl.search;
          if (await cache.match(key)) return;
          const response = await fetch(url);
          if (response.ok) await cache.put(key, response.clone());
        } catch {
          // A missing tile must not abort the offline preparation.
        }
      }));
      cached = Math.min(index + 10, total);
      event.source?.postMessage({ type: "OFFLINE_PROGRESS", cached, total });
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(caches.open(MAP_CACHE).then(async (cache) => {
      const key = url.pathname + url.search;
      const cached = await cache.match(key);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) void cache.put(key, response.clone());
        return response;
      } catch {
        return new Response("", { status: 504 });
      }
    }));
    return;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/src/") || url.pathname.startsWith("/@vite/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request)
      .then((response) => {
        void caches.open(APP_CACHE).then((cache) => cache.put("./index.html", response.clone()));
        return response;
      })
      .catch(() => caches.match("./index.html")));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => {
    const update = fetch(request).then((response) => {
      if (response.ok) void caches.open(APP_CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    });
    return cached || update;
  }));
});
