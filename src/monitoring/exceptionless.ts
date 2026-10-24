import { Exceptionless, toError } from '@exceptionless/react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

type ConsoleLevel = 'error' | 'warn';

let startupPromise: Promise<void> | null = null;
let isConsoleCaptureInstalled = false;
const reportedErrors = new WeakSet<object>();
// Catch blocks often rethrow `new Error(message)` for the caller to display.
// Treat the same message within a few seconds as the error already reported.
const recentMessages = new Map<string, number>();
const recentMessageWindowMs = 5_000;
const originalConsole: Record<ConsoleLevel, (...args: unknown[]) => void> = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};
const networkErrorPattern =
  /failed to fetch|network request failed|networkerror|load failed|fetch failed|the internet connection appears to be offline|network connection was lost/i;

export function initializeMonitoring() {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Promise.resolve();
  }

  installConsoleCapture();
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
    originalConsole.warn('Unable to initialize Exceptionless', error);
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

/**
 * Reports a handled error. Safe to call from any catch block: it never throws,
 * reports each error object once, and does nothing without an API key.
 * Pass `Operation` so handled errors stack by what failed, not by where the
 * shared helper that threw them lives.
 */
export async function reportError(error: unknown, context?: Record<string, unknown>) {
  if (!getApiKey() || !claimError(error)) {
    return;
  }

  try {
    await initializeMonitoring();
    const exception = toMonitoringError(error);
    let builder = Exceptionless.createException(exception).addTags('handled');
    if (isNetworkError(exception)) {
      builder = builder.addTags('network');
    }

    for (const [key, value] of Object.entries({ ...getErrorDetails(error), ...context })) {
      if (value !== undefined && value !== '') {
        builder = builder.setProperty(key, value);
      }
    }

    // Errors with frames stack (and source map) by where they were thrown.
    // Frameless ones, such as Supabase objects and native module rejections,
    // need the operation to stay apart.
    const operation = typeof context?.Operation === 'string' ? context.Operation : null;
    if (operation && !hasStackFrames(exception)) {
      builder = builder.setManualStackingKey(
        `${operation}|${exception.name}|${normalizeMessage(exception.message)}`,
        `${operation}: ${exception.message}`,
      );
    }

    await builder.submit();
  } catch (submitError) {
    originalConsole.warn('Unable to report error to Exceptionless', submitError);
  }
}

/**
 * Reports an error the player is about to see and returns the message to show.
 * The fallback doubles as the operation name unless the context provides one.
 */
export function reportErrorMessage(error: unknown, fallback: string, context?: Record<string, unknown>) {
  void reportError(error, { Operation: fallback.replace(/[.!…]+$/, ''), ...context });
  return error instanceof Error ? error.message : fallback;
}

export function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return networkErrorPattern.test(message);
}

// Most handled failures are already logged with the error object. Forward those
// so every `console.warn('Unable to …', error)` reaches Exceptionless without
// each call site opting in. Reporting waits a tick so an explicit report with
// richer context, such as an error boundary's component stack, wins.
function installConsoleCapture() {
  if (isConsoleCaptureInstalled) {
    return;
  }

  isConsoleCaptureInstalled = true;
  for (const level of ['error', 'warn'] as const) {
    console[level] = (...args: unknown[]) => {
      originalConsole[level](...args);
      const error = args.find(isErrorLike);
      if (!error || isReactNativePromiseRejectionLog(error)) {
        return;
      }

      const message = args.filter((arg) => typeof arg === 'string').join(' ');
      setTimeout(() => void reportError(error, { ConsoleLevel: level, Operation: message || undefined }), 0);
    };
  }
}

function claimError(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    if (reportedErrors.has(error)) {
      return false;
    }

    reportedErrors.add(error);
  }

  const message = isErrorLike(error) ? error.message : typeof error === 'string' ? error : '';
  if (!message) {
    return true;
  }

  const now = Date.now();
  for (const [recentMessage, reportedAt] of recentMessages) {
    if (now - reportedAt > recentMessageWindowMs) recentMessages.delete(recentMessage);
  }

  if (recentMessages.has(message)) {
    return false;
  }

  recentMessages.set(message, now);
  return true;
}

function toMonitoringError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  // Supabase returns plain `{ message, code, details, hint }` objects.
  if (isErrorLike(error)) {
    const exception = new Error(error.message);
    exception.name = typeof error.name === 'string' && error.name ? error.name : 'SupabaseError';
    exception.stack = undefined;
    return exception;
  }

  return toError(error);
}

function getErrorDetails(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) {
    return {};
  }

  const details: Record<string, unknown> = {};
  for (const key of ['code', 'details', 'hint', 'status'] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === 'string' || typeof value === 'number') {
      details[`Error${key[0].toUpperCase()}${key.slice(1)}`] = value;
    }
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    details.ErrorCause = `${cause.name}: ${cause.message}`;
  }

  return details;
}

function isErrorLike(value: unknown): value is { message: string; name?: unknown } {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { message?: unknown }).message === 'string' &&
      ('code' in value || 'details' in value || 'hint' in value || 'status' in value))
  );
}

function isReactNativePromiseRejectionLog(error: { message: string }) {
  // The Exceptionless global handler already reports these with the cause.
  return error.message.startsWith('Uncaught (in promise');
}

function hasStackFrames(error: Error) {
  return /^\s*at\s|@\S+:\d+/m.test(error.stack ?? '');
}

function normalizeMessage(message: string) {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200);
}

function getApiKey() {
  return process.env.EXPO_PUBLIC_EXCEPTIONLESS_API_KEY?.trim();
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
