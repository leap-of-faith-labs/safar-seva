importScripts('./assets.js');
const ASSETS = self.SAFAR_OFFLINE_ASSETS;
// Bump this release whenever code or the seed task pack changes.
const CACHE = self.SAFAR_RELEASE;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(asset => new Request(asset,{cache:'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('safar-seva-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/__editor/')) return;
  url.search = '';
  const known = ASSETS.map(asset => new URL(asset, self.registration.scope).href);
  if (!known.includes(url.href) && event.request.mode !== 'navigate') return;
  // Publication changes are visible on refresh without waiting for an app release.
  // Retain the last fetched publication for use offline.
  if (['stories.json', 'test-publication.json'].some(file => url.href === new URL(file, self.registration.scope).href)) {
    event.respondWith(fetch(event.request).then(async response => {
      if (!response.ok) throw new Error('Publication unavailable');
      const cache = await caches.open(CACHE); await cache.put(url.href, response.clone()); return response;
    }).catch(() => caches.match(url.href)));
  } else if (event.request.mode === 'navigate') {
    const page = url.pathname.endsWith('/review.html') ? './review.html' : './index.html';
    event.respondWith(fetch(event.request).catch(() => caches.match(new URL(page, self.registration.scope).href)));
  } else {
    event.respondWith(caches.match(url.href).then(cached => cached || fetch(event.request)));
  }
});

self.addEventListener('message',event => {
  if (event.data?.type === 'SAFAR_VERSION') event.source?.postMessage({type:'SAFAR_VERSION',release:CACHE});
});
