var CACHE_NAME = 'workout-buddy-shell-v1';
var SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/config.js',
  '/app.js',
  '/vendor/chart.umd.min.js',
  '/manifest.webmanifest',
  '/icons/favicon.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // Never intercept POST requests or cross-origin API calls (e.g. script.google.com)
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Network-first for HTML navigations so deploys take effect immediately, fallback to cached shell offline
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req)
        .then(function(res) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put('/index.html', copy); });
          return res;
        })
        .catch(function() {
          return caches.match('/index.html');
        })
    );
    return;
  }

  // Stale-while-revalidate for static shell assets
  event.respondWith(
    caches.match(req).then(function(cached) {
      var networkFetch = fetch(req).then(function(res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function() {
        return cached;
      });
      return cached || networkFetch;
    })
  );
});
