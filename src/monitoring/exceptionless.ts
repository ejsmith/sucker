import { Exceptionless, toError } from '@exceptionless/react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

let startupPromise: Promise<void> | null = null;

export function initializeMonitoring() {
  const apiKey = process.env.EXPO_PUBLIC_EXCEPTIONLESS_API_KEY?.trim();
  if (!apiKey) {
    return Promise.resolve();
  }

  startupPromise ??= Exceptionless.startup((configuration) => {
    configuration.apiKey = apiKey;
    const serverUrl = process.env.EXPO_PUBLIC_EXCEPTIONLESS_SERVER_URL?.trim();
    if (serverUrl) {
      configuration.serverUrl = serverUrl.replace(/\/$/, '');
    }

    configuration.includePrivateInformation = false;
    configuration.usePersistedQueueStorage = true;
    configuration.version = getReleaseVersion();
    configuration.defaultTags.push('Sucker', Platform.OS, __DEV__ ? 'development' : 'production');
    configuration.defaultData['App'] = {
      build: Application.nativeBuildVersion ?? 'web',
      channel: Updates.channel ?? 'embedded',
      updateId: Updates.updateId ?? 'embedded',
    };
    configuration.useSessions(true, 60_000, true);
  }).catch((error) => {
    startupPromise = null;
    console.warn('Unable to initialize Exceptionless', error);
  });

  return startupPromise;
}

export function setMonitoringUser(profileId: string | null) {
  if (profileId) {
    Exceptionless.config.setUserIdentity(profileId);
  } else {
    Exceptionless.config.setUserIdentity({ identity: '', name: '' });
  }
}

export function setMonitoringRoute(pathname: string) {
  Exceptionless.config.defaultData['Route'] = sanitizeRoute(pathname);
}

export async function reportError(error: unknown, context?: Record<string, unknown>) {
  if (!process.env.EXPO_PUBLIC_EXCEPTIONLESS_API_KEY) {
    return;
  }

  await initializeMonitoring();
  let builder = Exceptionless.createException(toError(error));
  for (const [key, value] of Object.entries(context ?? {})) {
    builder = builder.setProperty(key, value);
  }
  await builder.submit();
}

function getReleaseVersion() {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'development';
  const build = Application.nativeBuildVersion;
  return build ? `${version}.${build}` : version;
}

function sanitizeRoute(pathname: string) {
  return pathname
    .replace(/\/game\/[^/]+/g, '/game/:gameId')
    .replace(/\/invite\/[^/]+/g, '/invite/:inviteCode')
    .replace(/\/auth\/callback.*/, '/auth/callback');
}
