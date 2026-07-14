import * as Notifications from 'expo-notifications';
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

  const url = getWebLocation()?.href;
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const queryGameId = parsedUrl.searchParams.get('game') ?? parsedUrl.searchParams.get('gameId');
    return queryGameId?.trim() || null;
  } catch {
    return null;
  }
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

export type NotificationClickSource = 'foreground' | 'initial';

export function useNotificationClicks(onNotificationClick: (gameId: string, source: NotificationClickSource) => void) {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      let active = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        const gameId = getGameIdFromNativeNotification(response);
        if (active && gameId) {
          onNotificationClick(gameId, 'initial');
          void Notifications.clearLastNotificationResponseAsync();
        }
      });
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const gameId = getGameIdFromNativeNotification(response);
        if (gameId) onNotificationClick(gameId, 'foreground');
      });
      return () => {
        active = false;
        subscription.remove();
      };
    }

    const initialGameId = getInitialNotificationGameId();
    if (initialGameId) onNotificationClick(initialGameId, 'initial');
    const serviceWorker = getWebServiceWorker();
    if (!serviceWorker) {
      return undefined;
    }

    const handleMessage = (event: { data?: unknown }) => {
      const gameId = getGameIdFromNotificationMessage(event.data);
      if (gameId) {
        onNotificationClick(gameId, 'foreground');
      }
    };

    serviceWorker.addEventListener('message', handleMessage);
    return () => serviceWorker.removeEventListener('message', handleMessage);
  }, [onNotificationClick]);
}

export const useWebNotificationClicks = useNotificationClicks;

function getGameIdFromNativeNotification(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data;
  if (!data) return null;
  if (typeof data.gameId === 'string' && data.gameId.trim()) return data.gameId.trim();
  return typeof data.url === 'string' ? getGameIdFromUrl(data.url) : null;
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
