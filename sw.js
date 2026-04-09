const CACHE_NAME = 'rivastock-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (url.origin === location.origin && APP_SHELL.includes(url.pathname)) {
    // Cache First for App Shell
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  } else if (url.origin.includes('googleapis.com') || url.origin.includes('firebase')) {
    // Network First for API calls
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
  } else {
    // Cache First for static assets
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  }
});
