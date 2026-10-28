// Service worker mínimo: permite instalar la web como app. No guarda nada en caché,
// así cada vez que se abre se ve la versión publicada y la disponibilidad real.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
