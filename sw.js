// Uygulama kabuğu önbelleği: baskı uygulaması internetsiz de açılır (yükleme kuyruğu sonra gönderir).
const SURUM = 'ani-0.1.0';
const KABUK = ['baski.html', 'index.html', 'lib/qrcode.js', 'lib/yazici.js', 'lib/ani.js', 'manifest.json', 'ikon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SURUM).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// kabuk: önce ağ, olmazsa önbellek (güncelleme hemen gelsin). Fotoğraflar (p/) ve dış adresler önbelleğe girmez.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/p/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const k = r.clone(); caches.open(SURUM).then(c => c.put(e.request, k)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
