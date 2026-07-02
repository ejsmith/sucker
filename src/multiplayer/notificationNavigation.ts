import { useEffect } from 'react';
import { Platform } from 'react-native';

export const notificationClickMessageType = 'sucker.notification-click';

type NotificationClickMessage = {
  gameId?: unknown;
  type?: unknown;
  url?: unknown;
};
type ServiceWorkerMessageTarget = {
  addEventListener: (type: 'message', listener: (event: { data?: unknown }) => void) => void;
  removeEventListener: (type: 'message', listener: (event: { data?: unknown }) => void) => void;
};

export function getInitialNotificationGameId() {
  if (Platform.OS !== 'web') {
    return null;
  }

  return getGameIdFromUrl(getWebLocation()?.href ?? null);
}

export function getGameIdFromUrl(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url, getWebLocation()?.origin ?? 'https://sucker.games');
    const queryGameId = parsedUrl.searchParams.get('game') ?? parsedUrl.searchParams.get('gameId');
    if (queryGameId?.trim()) {
      return queryGameId.trim();
    }

    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'game' && pathParts[1]?.trim()) {
      return pathParts[1].trim();
    }
  } catch {
    return null;
  }

  return null;
}

export function useWebNotificationClicks(onNotificationClick: (gameId: string) => void) {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return undefined;
    }

    const serviceWorker = getWebServiceWorker();
    if (!serviceWorker) {
      return undefined;
    }

    const handleMessage = (event: { data?: unknown }) => {
      const gameId = getGameIdFromNotificationMessage(event.data);
      if (gameId) {
        onNotificationClick(gameId);
      }
    };

    serviceWorker.addEventListener('message', handleMessage);
    return () => serviceWorker.removeEventListener('message', handleMessage);
  }, [onNotificationClick]);
}

function getGameIdFromNotificationMessage(data: unknown) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const message = data as NotificationClickMessage;
  if (message.type !== notificationClickMessageType) {
    return null;
  }

  if (typeof message.gameId === 'string' && message.gameId.trim().length > 0) {
    return message.gameId.trim();
  }

  return typeof message.url === 'string' ? getGameIdFromUrl(message.url) : null;
}

function getWebLocation() {
  return (globalThis as typeof globalThis & { location?: Location }).location ?? null;
}

function getWebServiceWorker() {
  return (
    (globalThis as typeof globalThis & { navigator?: { serviceWorker?: ServiceWorkerMessageTarget } }).navigator
      ?.serviceWorker ?? null
  );
}
