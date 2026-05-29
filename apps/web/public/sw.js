const CACHE_NAME = 'tars-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never intercept API calls — always go to network
  if (url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for everything else; fall back to cache on failure
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful GET responses for static assets
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
