import { Exceptionless, toError } from '@exceptionless/react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { classifyError, createReportThrottle, getErrorDetails, getManualStackingKey, redactError } from './errorPolicy';

type ConsoleLevel = 'error' | 'warn';
type ReportOptions = {
  // Report at most once per window for this operation, for failures that can
  // repeat on a loop such as a reconnecting realtime channel.
  throttleMs?: number;
};

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
// Offline players retry on a loop; one network report per operation per
// window still shows an outage without flooding the project.
const networkReportWindowMs = 10 * 60_000;
const shouldReportNow = createReportThrottle();
// Credentials and personal data that error objects or context can carry.
const dataExclusions = [
  '*password*',
  '*secret*',
  '*token*',
  'auth_key',
  'details',
  'email',
  'endpoint',
  'hint',
  'p256dh*',
];

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
    configuration.addDataExclusions(...dataExclusions);
    configuration.usePersistedQueueStorage = true;
    configuration.version = getReleaseVersion();
    configuration.defaultTags.push('Sucker', Platform.OS, __DEV__ ? 'development' : 'production');
    if (Updates.updateId && !Updates.isEmbeddedLaunch) {
      configuration.defaultTags.push('ota');
    }
    configuration.defaultData['App'] = {
      build: Application.nativeBuildVersion ?? 'web',
      channel: Updates.channel ?? 'embedded',
      release: process.env.EXPO_PUBLIC_RELEASE_ID?.trim() || undefined,
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

/** Attaches the open game to every event until it is cleared with `null`. */
export function setMonitoringGame(gameId: string | null) {
  if (gameId) {
    Exceptionless.config.defaultData['GameId'] = gameId;
  } else {
    delete Exceptionless.config.defaultData['GameId'];
  }
}

/** Marks an error as reported so a caller that catches it again skips it. */
export function markErrorReported<T extends object>(error: T): T {
  reportedErrors.add(error);
  return error;
}

/**
 * Reports a handled error. Safe to call from any catch block: it never throws,
 * reports each error object once, and does nothing without an API key.
 * Expected player mistakes are skipped and network failures are throttled
 * (see errorPolicy.ts). Pass `Operation` so handled errors stack by what
 * failed, not by where the shared helper that threw them lives.
 */
export async function reportError(error: unknown, context?: Record<string, unknown>, options?: ReportOptions) {
  if (!getApiKey()) {
    return;
  }

  const disposition = classifyError(error);
  const operation = typeof context?.Operation === 'string' ? context.Operation : null;
  const throttleMs = disposition === 'network' ? networkReportWindowMs : options?.throttleMs;
  if (
    disposition === 'expected' ||
    (throttleMs !== undefined && !shouldReportNow(`${disposition}|${operation ?? ''}`, throttleMs)) ||
    !claimError(error)
  ) {
    return;
  }

  await submitError(error, context, (builder) => {
    let next = builder.addTags('handled');
    if (disposition === 'network') next = next.addTags('network');
    return next;
  });
}

/** Reports a render crash caught by an error boundary as critical. */
export async function reportCrash(error: unknown, componentStack: string) {
  if (!getApiKey() || !claimError(error)) {
    return;
  }

  await submitError(error, { ComponentStack: componentStack, Operation: 'Render' }, (builder) =>
    builder.addTags('render-crash').markAsCritical(),
  );
}

async function submitError(
  error: unknown,
  context: Record<string, unknown> | undefined,
  decorate: (
    builder: ReturnType<typeof Exceptionless.createException>,
  ) => ReturnType<typeof Exceptionless.createException>,
) {
  try {
    await initializeMonitoring();
    const exception = redactError(toMonitoringError(error));
    let builder = decorate(Exceptionless.createException(exception));
    for (const [key, value] of Object.entries({ ...getErrorDetails(error), ...context })) {
      if (value !== undefined && value !== '') {
        builder = builder.setProperty(key, value);
      }
    }

    // Errors thrown from app code stack (and source map) by where they were
    // thrown. Frameless errors and library errors, whose frames are the same
    // for every caller, stack by operation, code and message instead.
    const operation = typeof context?.Operation === 'string' ? context.Operation : null;
    const stacking = getManualStackingKey(error, operation, hasStackFrames(exception));
    if (stacking) {
      builder = builder.setManualStackingKey(stacking.key, stacking.title);
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

function getApiKey() {
  return process.env.EXPO_PUBLIC_EXCEPTIONLESS_API_KEY?.trim();
}

// Native: app version and build, plus the over-the-air update when one is
// running, since an update changes code without changing the build. Web: the
// app version plus the deployed commit.
function getReleaseVersion() {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'development';
  const build = Application.nativeBuildVersion;
  const release = build ? `${version}.${build}` : version;
  if (Updates.updateId && !Updates.isEmbeddedLaunch) {
    return `${release}+update.${Updates.updateId.slice(0, 8)}`;
  }
  const commit = process.env.EXPO_PUBLIC_RELEASE_ID?.trim().slice(0, 7);
  return Platform.OS === 'web' && commit ? `${release}+${commit}` : release;
}

function sanitizeRoute(pathname: string) {
  return pathname
    .replace(/\/game\/[^/]+/g, '/game/:gameId')
    .replace(/\/invite\/[^/]+/g, '/invite/:inviteCode')
    .replace(/\/auth\/callback.*/, '/auth/callback');
}
