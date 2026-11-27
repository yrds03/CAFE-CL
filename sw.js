// CAFE CL — Auto-Updating Service Worker
// Versi cache di-update otomatis setiap build/perbaikan oleh scripts/bump-and-deploy.mjs
const SW_VERSION = '1.0.5-20261127-1215';
const CACHE_NAME = `cafe-cl-cache-${SW_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './api.js',
  './printer.js',
  './app.js',
  './Code.gs',
  './manifest.json',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

// Install: langsung cache aset inti dan aktifkan tanpa menunggu tab lama ditutup
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Bypass HTTP cache browser agar selalu menarik versi terbaru dari server
        return Promise.all(
          CORE_ASSETS.map((url) =>
            fetch(new Request(url, { cache: 'reload' }))
              .then((res) => {
                if (res && res.ok) return cache.put(url, res);
              })
              .catch(() => null)
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: hapus seluruh cache versi lama & ambil alih semua client aktif segera
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('cafe-cl-cache-') && key !== CACHE_NAME)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: 'SW_UPDATED',
              version: SW_VERSION
            });
          });
        })
      )
  );
});

// Pesan dari aplikasi (misal tombol cek update / paksa aktivasi)
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (data.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ version: SW_VERSION });
  }
  if (data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

// Strategi Fetch:
// 1. version.json & API Google Apps Script -> SELALU Network-Only (tidak pernah dicache!)
// 2. Aset aplikasi (HTML, CSS, JS) -> Network-First dengan fallback cache (agar perbaikan langsung terasa)
// 3. Gambar & font eksternal -> Cache-First dengan pembaruan latar belakang
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Jangan pernah cache pengecekan versi atau API eksternal (Google Apps Script)
  if (
    url.pathname.endsWith('/version.json') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('script.googleusercontent.com')
  ) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => new Response('{}', { status: 503 }))
    );
    return;
  }

  // Same-origin app shell & code -> Network-First (selalu utamakan versi terbaru)
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            if (req.mode === 'navigate') return caches.match('./index.html');
            return new Response('Offline', { status: 503 });
          })
        )
    );
    return;
  }

  // External fonts/images -> Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
