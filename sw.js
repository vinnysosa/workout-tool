var CACHE_NAME = 'workout-buddy-shell-v2';
var SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/config.js',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/favicon.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/v1/',
  '/v1/index.html',
  '/v1/styles.css',
  '/v1/app.js',
  '/vendor/chart.umd.min.js'
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

  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname === '/v1/') {
    var fallbackPath = url.pathname.startsWith('/v1') ? '/v1/index.html' : '/index.html';
    event.respondWith(
      fetch(req)
        .then(function(res) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(fallbackPath, copy); });
          return res;
        })
        .catch(function() {
          return caches.match(fallbackPath);
        })
    );
    return;
  }

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
