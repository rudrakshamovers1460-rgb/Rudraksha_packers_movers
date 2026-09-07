/**
 * Service Worker for Rudraksha Packers & Movers PWA
 * Fast UI caching + Network-first live synchronization for APIs
 */

const CACHE_NAME = 'rudraksha-pwa-v1.0.0';
const STATIC_ASSETS = [
  './',
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

// Install Event - Pre-cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use addAll with resilient error handling
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(err => console.warn('[PWA SW] Pre-cache skip:', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up stale old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[PWA SW] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network first for APIs / dynamic requests, Cache-first/stale-while-revalidate for static assets
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Always bypass cache for non-GET requests (POST, PUT, DELETE)
  if (request.method !== 'GET') {
    return;
  }

  // 2. Always fetch LIVE for API calls, backend routes, map geocoders, and Firebase
  if (
    url.pathname.startsWith('/api') ||
    url.port === '5000' ||
    url.hostname.includes('onrender.com') ||
    url.hostname.includes('openstreetmap.org') ||
    url.hostname.includes('komoot.io') ||
    url.hostname.includes('ipwho.is') ||
    url.hostname.includes('ipapi.co') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // 3. For local static assets: Stale-While-Revalidate strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
