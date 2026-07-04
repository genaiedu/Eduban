// sw.js

// Wird beim ersten Laden der App aufgerufen
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installiert');
  self.skipWaiting(); // Aktiviert den SW sofort
});

// Wird beim Aktivieren aufgerufen – alle alten Caches löschen
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Aktiviert');
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))
  );
  self.clients.claim();
});

// Zwingend erforderlich für den Install-Button:
self.addEventListener('fetch', (event) => {
  // Hier lassen wir die Anfragen einfach durchlaufen (Pass-through)
});
