const CACHE = 'naarros-v2';
const SHELL = ['./', './index.html', './nc-features.js', './share.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CACHEABLE = host =>
  host === self.location.hostname ||
  host === 'cdnjs.cloudflare.com' ||
  host === 'fonts.googleapis.com' ||
  host === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!CACHEABLE(url.hostname)) return;   // Drive, Google Auth, remove.bg: nunca se cachean

  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const copia = res.clone();                 // clonar ANTES de devolver la respuesta
        caches.open(CACHE).then(c => c.put(req, copia));
      }
      return res;
    }).catch(() =>
      caches.match(req)
        .then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : null))
        .then(r => r || new Response('Sin conexión', { status: 503 }))
    )
  );
});
