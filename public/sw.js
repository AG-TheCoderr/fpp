/* Network-first. Do not stash HTML/JS (that was serving old game). Images only. */
const CACHE = 'stride-pwa-v5';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppCode(url) {
  const p = url.pathname.toLowerCase();
  return (
    p.endsWith('.html') ||
    p.endsWith('.js') ||
    p.endsWith('.css') ||
    p.endsWith('.json') ||
    p.endsWith('.webmanifest') ||
    p === '/' ||
    p.endsWith('/')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isAppCode(url)) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
