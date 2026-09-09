const CACHE = 'pulse-mobile-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'پالس', {
    body: data.body || 'یک اعلان تازه برای شما آماده است.',
    icon: '../favicon.svg',
    badge: '../favicon.svg',
    dir: 'rtl',
    lang: 'fa',
    data: { href: data.href || './notifications' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawHref = event.notification.data?.href || '/mobile/notifications';
  const href = new URL(String(rawHref).replace(/^\/mobile/, './'), self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const client = clients.find((item) => 'focus' in item);
    if (client) { client.navigate(href); return client.focus(); }
    return self.clients.openWindow(href);
  }));
});