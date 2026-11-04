const CACHE = 'pulse-mobile-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'یک اعلان تازه برای شما آماده است.',
    icon: './favicon.svg',
    badge: './favicon.svg',
    dir: 'rtl',
    lang: 'fa',
    tag: data.notification_id ? `pulse-${data.notification_id}` : undefined,
    renotify: false,
    requireInteraction: data.priority === 'urgent',
    data: {
      href: data.href || './notifications',
      notification_id: data.notification_id || null,
      campaign_id: data.campaign_id || null,
    },
    actions: data.action_label ? [{ action: 'primary', title: String(data.action_label).slice(0, 40) }] : [],
  };
  event.waitUntil(self.registration.showNotification(data.title || 'پالس', options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawHref = event.notification.data?.href || '/mobile/notifications';
  const parsedHref = new URL(String(rawHref), self.registration.scope);
  // A notification is received by the customer PWA, so open the public
  // subscription screen inside the installed app instead of navigating to a
  // root path that the /mobile artifact cannot render.
  if (parsedHref.pathname === '/sub') {
    const mobileSubscription = new URL('./sub', self.registration.scope);
    mobileSubscription.search = parsedHref.search;
    parsedHref.href = mobileSubscription.href;
  } else if (parsedHref.pathname.startsWith('/mobile')) {
    parsedHref.pathname = parsedHref.pathname.replace(/^\/mobile/, new URL('./', self.registration.scope).pathname.replace(/\/$/, ''));
  }
  const href = parsedHref.href;
  const notificationId = event.notification.data?.notification_id;
  event.waitUntil(Promise.all([
    notificationId
      ? fetch('/api/mobile/notifications/' + encodeURIComponent(String(notificationId)) + '/track', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'click' }),
        }).catch(() => undefined)
      : Promise.resolve(),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((item) => 'focus' in item);
      if (client) { client.navigate(href); return client.focus(); }
      return self.clients.openWindow(href);
    }),
  ]));
});