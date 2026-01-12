const CACHE_NAME = 'demcalendar-v5'; // Bump to refresh cached assets
const OFFLINE_PAGE = '/login.html';

// Archivos crÃ­ticos para cache
const CORE_ASSETS = [
  '/',
  '/login.html',
  '/manager.html',
  '/guide.html',
  // Removed missing files: tailwind.min.css, auth.js
  '/js/firebase-config.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/logo-demcalendar.png',
  '/manifest.json'
];

// Install: cachear assets core
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: limpiar caches antiguos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Cache-First solo para assets same-origin
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200) {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || caches.match(OFFLINE_PAGE);
          });
        })
    );
    return;
  }

  // Assets estaticos: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Solo cachear GET y respuestas validas
        if (!response || response.status !== 200) {
          return response;
        }

        // Clonar para cache
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Offline fallback
        if (request.destination === 'document') {
          return caches.match(OFFLINE_PAGE);
        }
        return Response.error();
      });
    })
  );
});



