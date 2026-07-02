self.addEventListener('push', (event) => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const gameId = typeof data.gameId === 'string' && data.gameId.length > 0 ? data.gameId : null;
  const targetUrl = typeof data.url === 'string' ? data.url : gameId ? `/?game=${encodeURIComponent(gameId)}` : '/';
  const title = typeof data.title === 'string' ? data.title : 'Sucker!';
  const options = {
    badge: '/favicon.png',
    body: typeof data.body === 'string' ? data.body : 'A game needs your attention.',
    data: {
      actionType: data.actionType,
      gameId,
      url: targetUrl,
    },
    icon: '/icon.png',
    tag: gameId ? `sucker-game-${gameId}` : 'sucker-turn',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification.data ?? {};
  const targetUrl = new URL(
    notificationData.url ??
      (typeof notificationData.gameId === 'string' ? `/?game=${encodeURIComponent(notificationData.gameId)}` : '/'),
    self.location.origin,
  ).href;
  const clickMessage = {
    actionType: notificationData.actionType,
    gameId: notificationData.gameId,
    type: 'sucker.notification-click',
    url: targetUrl,
  };

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(async (clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          const focusedClient = await client.focus();
          if ('postMessage' in focusedClient) {
            focusedClient.postMessage(clickMessage);
          }
          return focusedClient;
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
