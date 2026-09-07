/**
 * Service Worker for Rudraksha Packers & Movers PWA (v2.0.0)
 * Ultra-resilient, crash-proof caching with live network priority
 */

const CACHE_NAME = 'rudraksha-pwa-v2.0.0';
const STATIC_ASSETS = [
  './index.html',
  './parcel.html',
  './track.html',
  './driver.html',
  './admin.html',
  './style.css',
  './parcel.css',
  './track.css',
  './admin.css',
  './driver.css',
  './pwa-install.css',
  './app.js',
  './parcel.js',
  './track.js',
  './admin.js',
  './driver.js',
  './pwa-install.js',
  './favicon.png',
  './icon-192.png',
  './logo.png'
];

// Install Event - Pre-cache with resilient per-item handling
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of STATIC_ASSETS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[PWA SW] Pre-cache skipped:', url, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up any old broken caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[PWA SW] Purging old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Crash-proof strategy
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Never intercept non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // 2. Completely bypass APIs, maps, geocoders, Firebase & backend
  if (
    url.pathname.startsWith('/api') ||
    url.port === '5000' ||
    url.port === '3000' ||
    url.hostname.includes('onrender.com') ||
    url.hostname.includes('openstreetmap.org') ||
    url.hostname.includes('komoot.io') ||
    url.hostname.includes('ipwho.is') ||
    url.hostname.includes('ipapi.co') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com')
  ) {
    return; // Let browser fetch natively without interference
  }

  // 3. Navigation Requests (Opening the App / Loading Pages): Network-first with Cache Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkRes;
        })
        .catch(() => {
          // If offline or network fails, load cached version
          return caches.match(request).then((cached) => {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // 4. Static Assets (CSS, JS, Images, Fonts): Cache-first with Network Fallback
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Revalidate in background
        fetch(request)
          .then((netRes) => {
            if (netRes && netRes.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, netRes));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      // If not in cache, fetch from network
      return fetch(request).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkRes;
      });
    })
  );
});
