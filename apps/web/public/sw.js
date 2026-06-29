// TARS service worker — minimal + installability only.
//
// History: an earlier worker cached HTML and JS bundles, which left users stuck
// on stale code after deploys (the v2.15.x saga). v2.15.3 replaced it with a
// kill switch — but unregistering the worker entirely also removed the one thing
// desktop Chrome/Edge require to fire `beforeinstallprompt`, so the PWA stopped
// being installable on desktop.
//
// This worker threads the needle: it exists and has a fetch handler (so the app
// is installable), but it NEVER caches app code. JS/CSS/API requests pass
// straight through to the network, so a deploy is always picked up immediately.
// The only thing cached is a tiny offline fallback page, served solely when a
// navigation fails because the network is unreachable. Online loads are always
// network-first → never stale.
const CACHE = 'tars-offline-v2';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop every cache except the offline shell — clears any old stale-bundle
    // caches left behind by previous worker versions.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Only intercept top-level navigations. Everything else (JS, CSS, API, images)
  // is left untouched so the browser fetches it from the network as normal — we
  // never cache app code, so deploys are never masked by the worker.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
  }
});
