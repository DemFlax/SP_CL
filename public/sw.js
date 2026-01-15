const CACHE_NAME = 'sfs-calendar-v6'; // ← Bumping to v6 to force update
const OFFLINE_PAGE = '/login.html';

// Archivos críticos para cache
const CORE_ASSETS = [
  '/',
  '/login.html',
  '/manager.html',
  '/guide.html',
  '/js/firebase-config.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/logo-sfs.png',
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

// Fetch: estrategia Network-First para Firestore, Cache-First para assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // No interceptar llamadas a APIs de Google (Auth, Cloud Functions, etc)
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('cloudfunctions.net')) {
    return; // Dejar que el navegador maneje estas peticiones normalmente
  }

  // Assets estáticos: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Solo cachear GET y respuestas válidas de nuestro dominio
        if (request.method !== 'GET' || !response || response.status !== 200) {
          return response;
        }

        // No cachear peticiones de otros dominios (externas)
        if (!url.origin.includes(self.location.origin)) {
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
        // Retornar una respuesta vacía válida en lugar de undefined para evitar el error de conversión
        return new Response('', { status: 408, statusText: 'Network Error or Offline' });
      });
    })
  );
});
