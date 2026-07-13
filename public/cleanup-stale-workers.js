if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    if (registrations.length === 0) return;
    var unregistered = registrations.map(function (registration) { return registration.unregister(); });
    if ('caches' in window) caches.keys().then(function (names) { names.forEach(function (name) { caches.delete(name); }); });
    Promise.all(unregistered).then(function () { location.reload(); });
  });
}
