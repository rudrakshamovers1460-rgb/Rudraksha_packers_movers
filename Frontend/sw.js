/**
 * Service Worker for Rudraksha Packers & Movers PWA (v2.0.0)
 * Ultra-resilient, crash-proof caching with live network priority
 */

const CACHE_NAME = 'rudraksha-pwa-v3.9.0';
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
  './favicon.ico',
  './app-icon.png',
  './app-icon-192.png',
  './app-logo.png',
  './driver-manifest.json',
  './driver-icon.png',
  './driver-icon-192.png',
  './driver-icon-512.png'
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
    url.pathname.endsWith('.apk') ||
    url.pathname.includes('.apk') ||
    url.pathname.includes('RudrakshaDriver') ||
    url.pathname.includes('download') ||
    url.hostname.includes('github') ||
    url.hostname.includes('githubusercontent') ||
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
          return caches.match(request).then((cached) => {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // 4. Critical Logic Scripts & CSS: Network-First to guarantee immediate live updates
  const isCodeAsset = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  if (isCodeAsset) {
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkRes;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 5. Static Media (Images, Fonts, Icons): Cache-first with Network Fallback
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
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

// 6. Notification Click Event - Handle Accept, Decline, Silent & Focus
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action; // 'accept', 'decline', 'silent', or empty if body clicked
  const orderId = event.notification.data?.orderId;
  const targetUrl = event.notification.data?.url || './driver.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Broadcast the rider action to all open driver windows
      clientList.forEach((client) => {
        client.postMessage({
          type: 'RIDER_NOTIFICATION_ACTION',
          action: action || 'focus',
          orderId: orderId
        });
      });

      // If user tapped Silent or Decline, do NOT force window to foreground if action was directly from lock screen
      if (action === 'silent') {
        return;
      }

      // If Accept or clicked on notification body, bring Driver App to foreground & focus
      for (const client of clientList) {
        if (client.url && client.url.includes('driver.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// 7. Notification Dismissed / Swiped Away Event - Silence audio
self.addEventListener('notificationclose', (event) => {
  const orderId = event.notification.data?.orderId;
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    clientList.forEach((client) => {
      client.postMessage({
        type: 'RIDER_NOTIFICATION_ACTION',
        action: 'silent',
        orderId: orderId
      });
    });
  });
});

