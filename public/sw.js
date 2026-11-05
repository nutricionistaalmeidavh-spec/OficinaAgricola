const CACHE_NAME = 'artisys-oficina-shell-v14';
const SHELL = ['/', '/index.html', '/styles.css', '/ui-stage7.css', '/theme-lote-a.css', '/local-runtime.css', '/command-queue.js', '/tenant-switch.js', '/app-tenancy.js', '/app-core.js', '/app-journey.js', '/paged-lookups.js', '/app-market.js', '/app-market-crm.js', '/app-market-fleet.js', '/app-market-units.js', '/app-market-references.js', '/app-market-approval.js', '/app-market-actions.js', '/approval.js', '/approval.css', '/obd-serial.js', '/obd-diagnostics.js', '/app-catalog.js', '/app-orders.js', '/app-os-tools.js', '/app-operations.js', '/app-stage7.js', '/app-assistencia.js', '/app-admin.js', '/local-runtime.js', '/pwa-register.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('/index.html')) || Response.error();
  }
}

async function networkFirstStatic(request) {
  try {
    // Os recursos da UI precisam ver a última versão após atualizar o sistema.
    const response=await fetch(request,{cache:'no-store'});
    if(response.ok){
      const cache=await caches.open(CACHE_NAME);
      await cache.put(request,response.clone());
    }
    return response;
  }catch{
    return await caches.match(request)||Response.error();
  }
}

async function cachedAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if(url.pathname==='/approval.html')return; // never retain private approval-link tokens in Cache API
  const executable=/\.(?:js|css|webmanifest)$/i.test(url.pathname);
  event.respondWith(request.mode==='navigate'
    ? networkFirstNavigation(request)
    : executable ? networkFirstStatic(request) : cachedAsset(request));
});

