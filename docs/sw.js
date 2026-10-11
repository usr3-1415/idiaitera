// Service worker: η εφαρμογή ανοίγει και χωρίς σύνδεση.
// Network-first για τα αρχεία της εφαρμογής, ώστε κάθε αλλαγή να φαίνεται αμέσως.
// Αν το δίκτυο αργεί πάνω από 3", σερβίρεται το αντίγραφο από το cache.
// Οι κλήσεις στο Apps Script (άλλο origin) δεν περνούν από εδώ.
const CACHE = 'tameio-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req, event));
});

async function networkFirst(req, event) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) event.waitUntil(cache.put(req, res.clone()));
    return res;
  });
  const cached = await cache.match(req, { ignoreSearch: true });
  if (!cached) {
    return network.catch(() => (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
  }
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 3000));
  return Promise.race([network.catch(() => cached), timeout]);
}
