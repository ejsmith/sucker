import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

declare const process:
  | {
      env: Record<string, string | undefined>;
    }
  | undefined;

type WebPushSubscriptionJson = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: {
    auth?: unknown;
    p256dh?: unknown;
  };
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerPushToken(profileId: string) {
  if (Platform.OS === 'web') {
    return registerWebPushSubscription(profileId);
  }

  if (!Device.isDevice || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      importance: Notifications.AndroidImportance.MAX,
      name: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  const finalStatus =
    existingStatus === 'granted' ? existingStatus : (await Notifications.requestPermissionsAsync()).status;

  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId = getExpoProjectId();
  if (!projectId) {
    throw new Error('Expo project ID is required to register push notifications.');
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { data, error } = await supabase
    .from('push_tokens')
    .upsert(
      {
        device_name: Device.deviceName ?? null,
        expo_push_token: token,
        platform: Platform.OS,
        profile_id: profileId,
      },
      {
        onConflict: 'expo_push_token',
      },
    )
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export function canRegisterWebPush() {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

export function hasWebPushVapidPublicKey() {
  return getWebPushVapidPublicKey().length > 0;
}

export async function registerWebPushSubscription(profileId: string) {
  if (!canRegisterWebPush()) {
    return null;
  }

  const vapidPublicKey = getWebPushVapidPublicKey();
  if (!vapidPublicKey) {
    throw new Error('Web push VAPID public key is required to enable browser notifications.');
  }

  const permission =
    Notification.permission === 'granted' ? Notification.permission : await Notification.requestPermission();

  if (permission !== 'granted') {
    return null;
  }

  const registration = await navigator.serviceWorker.register('/service-worker.js');
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      userVisibleOnly: true,
    }));
  const subscriptionJson = subscription.toJSON() as WebPushSubscriptionJson;
  const endpoint = typeof subscriptionJson.endpoint === 'string' ? subscriptionJson.endpoint : subscription.endpoint;
  const authKey = typeof subscriptionJson.keys?.auth === 'string' ? subscriptionJson.keys.auth : null;
  const p256dhKey = typeof subscriptionJson.keys?.p256dh === 'string' ? subscriptionJson.keys.p256dh : null;

  if (!endpoint || !authKey || !p256dhKey) {
    throw new Error('Browser did not return a complete web push subscription.');
  }

  const { data, error } = await supabase
    .from('web_push_subscriptions')
    .upsert(
      {
        auth_key: authKey,
        endpoint,
        expiration_time:
          typeof subscriptionJson.expirationTime === 'number'
            ? new Date(subscriptionJson.expirationTime).toISOString()
            : null,
        p256dh_key: p256dhKey,
        profile_id: profileId,
        user_agent: navigator.userAgent,
      },
      {
        onConflict: 'endpoint',
      },
    )
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

function getExpoProjectId() {
  return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
}

function getWebPushVapidPublicKey() {
  const envVapidPublicKey =
    typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY : undefined;
  if (envVapidPublicKey) {
    return envVapidPublicKey.trim();
  }

  const vapidPublicKey = Constants.expoConfig?.extra?.webPush?.vapidPublicKey;
  return typeof vapidPublicKey === 'string' ? vapidPublicKey.trim() : '';
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }

  return output;
}
