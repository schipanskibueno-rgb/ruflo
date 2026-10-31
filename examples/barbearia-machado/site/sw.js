/* Service worker da Barbearia Machado: app instalável e notificações no celular. */
const CACHE = 'machado-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Sempre busca a versão nova; sem internet, abre a última salva.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./'))),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Barbearia Machado', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    tag: data.tag,
    renotify: Boolean(data.tag),
    vibrate: [200, 100, 200],
    data: { url: data.url || './#/admin' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './#/admin', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const win of wins) {
      if ('focus' in win) {
        await win.navigate(url).catch(() => {});
        return win.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
