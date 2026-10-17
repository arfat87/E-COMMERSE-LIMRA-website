/**
 * LIMRA Restaurant PWA Service Worker (v2.1)
 * Provides offline shell caching, network-first navigation, and stale-while-revalidate for static assets.
 * Strictly bypasses API requests, Razorpay, Supabase, and dynamic database endpoints.
 */

const CACHE_NAME = 'limra-pwa-v2.1';

const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/admin.html',
  '/table/index.html',
  '/manifest.json',
  '/favicon.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching app shell assets');
      return cache.addAll(STATIC_PRECACHE).catch((err) => {
        console.warn('[SW] Precache partial error (non-fatal):', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith('limra-pwa-')) {
            console.log('[SW] Removing outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Never cache non-GET requests
  if (req.method !== 'GET') {
    return;
  }

  // 2. Never cache or intercept API, Supabase, Razorpay, or external dynamic endpoints
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('razorpay.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('googleapis.com') ||
    url.pathname.includes('/auth/')
  ) {
    return;
  }

  // 3. Navigation requests (HTML pages): Network-First, fallback to Cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          if (url.pathname.includes('/admin')) {
            return (await caches.match('/admin.html')) || (await caches.match('/'));
          }
          if (url.pathname.includes('/table')) {
            return (await caches.match('/table/index.html')) || (await caches.match('/'));
          }
          return (await caches.match('/index.html')) || (await caches.match('/'));
        })
    );
    return;
  }

  // 4. Static assets (JS, CSS, images, fonts): Stale-While-Revalidate
  const isStatic =
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|webp|woff2?|ico)$/i) ||
    url.pathname.startsWith('/assets/');

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              const copy = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
            return networkRes;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
  }
});
