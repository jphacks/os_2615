/* UIはキャッシュしない。通知の受信・クリックだけを担当する。 */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { /* 汎用通知を表示する。 */ }
  event.waitUntil(self.registration.showNotification(
    typeof payload.title === 'string' ? payload.title : 'こねくと',
    { body: typeof payload.body === 'string' ? payload.body : 'こねくとを確認してください。',
      tag: typeof payload.tag === 'string' ? payload.tag : 'konekuto',
      icon: '/icons/crayon-192.png', badge: '/icons/crayon-192.png', data: { url: '/' } }
  ));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  })());
});
