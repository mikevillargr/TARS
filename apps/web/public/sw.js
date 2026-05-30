const CACHE_NAME = 'tars-v2';

const CACHEABLE = (url) => {
  // Only cache hashed static assets — never HTML pages
  return url.includes('/_next/static/') || url.includes('/fonts/');
};

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete all old caches on activate
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never intercept API calls or non-GET requests
  if (url.includes('/api/') || event.request.method !== 'GET') {
    return;
  }

  if (CACHEABLE(url)) {
    // Cache-first for hashed static assets (safe — hash changes on rebuild)
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
  // All other requests (HTML pages, etc.) — network only, no caching
});
