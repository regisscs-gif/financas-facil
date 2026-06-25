var CACHE = 'ff-v94';
var SHELL = ['/financas-facil/', '/financas-facil/index.html'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Deixa passar requisições externas (Supabase, CDNs)
  if (!url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then(function(response) {
      // Atualiza cache do shell sempre que online
      if (url.includes('/financas-facil/index.html') || url.endsWith('/financas-facil/')) {
        var clone = response.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
      }
      return response;
    }).catch(function() {
      // Offline: serve do cache
      return caches.match(e.request).then(function(cached) {
        return cached || caches.match('/financas-facil/index.html');
      });
    })
  );
});
