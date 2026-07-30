const CACHE = 'atlas-nav-v5';
const DATA_CACHE = 'atlas-nav-data-v1';
const ASSETS = ['/', '/styles.css', '/js/shared.js', '/js/home.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![CACHE, DATA_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const pathname = new URL(event.request.url).pathname;
  if (pathname === '/api/nav') {
    event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); event.waitUntil(caches.open(DATA_CACHE).then(cache => cache.put(event.request, copy))); return response; }).catch(() => caches.open(DATA_CACHE).then(cache => cache.match(event.request)).then(response => response || new Response(JSON.stringify({ settings: {}, categories: [], pinned: [], searchEngines: [] }), { headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); } return response; }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') return caches.match('/');
    return Response.error();
  }));
});
