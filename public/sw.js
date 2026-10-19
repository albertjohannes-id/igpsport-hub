// Only this public offline screen is cached. API requests and mutations bypass us.
const CACHE = 'apex-offline-v2';
const OFFLINE = ['/offline.html', '/offline.css'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('apex-offline-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match('/offline.html');
        // Cloudflare canonicalizes .html URLs. Strip redirect metadata for navigation.
        return cached
          ? new Response(cached.body, { status: cached.status, headers: cached.headers })
          : Response.error();
      }),
    );
  } else if (OFFLINE.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(request)));
  }
});
