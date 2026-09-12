const CACHE_NAME = 'assistencia-tecnica-shell-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/ui-stage7.css', '/app-core.js', '/app-catalog.js', '/app-orders.js', '/app-os-tools.js', '/app-operations.js', '/app-stage7.js', '/app-assistencia.js', '/app-admin.js', '/pwa-register.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      return (await caches.match(request)) || (request.mode === 'navigate' ? await caches.match('/index.html') : Response.error());
    }
  })());
});
