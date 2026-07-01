self.addEventListener('push', (event) => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = typeof data.title === 'string' ? data.title : 'Sucker!';
  const options = {
    badge: '/favicon.png',
    body: typeof data.body === 'string' ? data.body : 'A game needs your attention.',
    data: {
      gameId: data.gameId,
      url: typeof data.url === 'string' ? data.url : '/',
    },
    icon: '/icon.png',
    tag: typeof data.gameId === 'string' ? `sucker-game-${data.gameId}` : 'sucker-turn',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url ?? '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return undefined;
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
