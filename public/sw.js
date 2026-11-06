const CACHE = 'dogovorimsya-public-v2';
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

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Always show a visible, safe fallback. */ }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : 'Договоримся';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 250) : 'В вашей книжке что-то новое. Заходи ♡';
  const positiveId = value => Number.isSafeInteger(value) && value > 0 ? value : null;
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', lang: 'ru',
      tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 100) : undefined,
      silent: payload.silent === true ? true : undefined,
      data: { reviewId: positiveId(payload.reviewId), userId: positiveId(payload.userId) },
    }),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => clients.forEach(client => client.postMessage({ type: 'JOURNAL_CHANGED' }))),
  ]));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { reviewId, userId } = event.notification.data || {};
  const url = new URL('/', self.location.origin);
  if (Number.isSafeInteger(reviewId) && reviewId > 0 && Number.isSafeInteger(userId) && userId > 0) {
    url.searchParams.set('review', String(reviewId)); url.searchParams.set('for', String(userId));
  }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      const navigated = await client.navigate(url.href);
      if (navigated) { await navigated.focus(); return; }
    }
    await self.clients.openWindow(url.href);
  }));
});
