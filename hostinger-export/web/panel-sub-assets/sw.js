const CACHE_NAME = 'pulse-shell-v3';
const APP_SHELL = ['./', './login', './manifest.webmanifest', './favicon.svg'];
const scopePath = new URL('./', self.location.href).pathname;

function isPrivateOrDynamicPath(relativePath) {
  const route = relativePath.replace(/^\/+/, '');
  return [
    'api',
    'sub',
    'mobile',
    'panel',
    'store',
    'panel-sub-assets',
  ].some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

function mayCache(request, url) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith(scopePath)) return false;
  const relativePath = url.pathname.slice(scopePath.length);
  if (isPrivateOrDynamicPath(relativePath)) return false;
  return (
    request.mode === 'navigate' ||
    relativePath === '' ||
    relativePath === 'login' ||
    relativePath === 'manifest.webmanifest' ||
    relativePath === 'favicon.svg' ||
    relativePath.startsWith('assets/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('pulse-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!mayCache(request, url)) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shellUrl = new URL('./', self.registration.scope).toString();
          return (await caches.match(shellUrl)) || new Response('Offline', { status: 503 });
        }
        return new Response('Offline', { status: 503 });
      }),
  );
});