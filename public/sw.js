const CACHE = 'dogovorimsya-public-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/offline.js', '/icon.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dogovorimsya-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// Personal API responses and photographs never enter Cache Storage.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (['/offline.js', '/icon.svg'].includes(new URL(event.request.url).pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
    return;
  }
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
