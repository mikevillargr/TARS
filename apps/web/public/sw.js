// Service-worker KILL SWITCH.
// A previous version of this app shipped a caching service worker that cached HTML
// and persistently served stale JS bundles (users stuck on old code even after
// deploys). A no-op worker wasn't enough because the old registration kept
// controlling the page. This worker purges every cache, UNREGISTERS itself, and
// force-reloads all open clients so the next load comes straight from the network.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {
      // ignore — best effort
    }
    try {
      await self.registration.unregister();
    } catch (e) {
      // ignore
    }
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      try {
        client.navigate(client.url);
      } catch (e) {
        // some clients can't be navigated; they'll pick up fresh code on next load
      }
    }
  })());
});

// No fetch handler — never intercept requests.
