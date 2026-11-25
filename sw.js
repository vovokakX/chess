/* Офлайн-кэш: сначала сеть (чтобы обновления приходили сразу), при отсутствии сети — кэш. */
const CACHE = 'chessplus-v3';
const FILES = [
  './', 'index.html', 'style.css', 'abilities.css', 'manifest.json',
  'js/engine.js', 'js/ai.js', 'js/ai-worker.js', 'js/net.js', 'js/app.js', 'js/fx.js', 'js/peerjs.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  ...['w', 'b'].flatMap((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map((p) => `pieces/${c}${p}.svg`)),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  const isFont = url.host.includes('fonts.g');
  if (!sameOrigin && !isFont) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
