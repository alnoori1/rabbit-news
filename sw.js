const VERSION = "67";
const SHELL_CACHE = `rabbit-news-shell-${VERSION}`;
const SHELL_FILES = [
  "./",
  "./index.html",
  "./main.js?v=67",
  "./styles.css?v=67"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== SHELL_CACHE) {
          return caches.delete(key);
        }
        return undefined;
      })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate" || (url.origin === self.location.origin && SHELL_FILES.some((file) => url.pathname.endsWith(file.replace("./", "/"))))) {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  event.respondWith(fetch(request, { cache: "no-store" }));
});

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return cache.match("./index.html") || new Response("Offline", { status: 503 });
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request, { cache: "no-store" });
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}
