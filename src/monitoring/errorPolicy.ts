import { redactSensitiveText } from '../../shared/redaction';

// Decides which handled errors reach Exceptionless and how they stack. Kept
// free of app imports so the policy is unit tested.
export type ErrorDisposition = 'report' | 'network' | 'expected';

type ErrorShape = { code?: unknown; message?: unknown; name?: unknown; status?: unknown };

const networkErrorNames = new Set([
  'AbortError',
  'AuthRetryableFetchError',
  'FunctionsFetchError',
  'SessionConnectionError',
  'TimeoutError',
]);
const networkMessagePattern =
  /failed to fetch|fetch failed|network request failed|network request timed out|networkerror|load failed|the internet connection appears to be offline|network connection was lost|failed to send a request to the edge function|unable to reach sucker! services|request timed out|timed out/i;

// Auth failures caused by what the player typed or how fast they retried.
const expectedAuthCodes = new Set([
  'email_address_invalid',
  'email_exists',
  'email_not_confirmed',
  'invalid_credentials',
  'otp_expired',
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'over_sms_send_rate_limit',
  'same_password',
  'user_already_exists',
  'weak_password',
]);
const expectedErrorNames = new Set(['AuthWeakPasswordError', 'PendingMultiplayerActionError']);

// Library errors are thrown from the same internal frames for every caller,
// so their stack trace says nothing about what failed.
const libraryErrorPattern = /^(Auth|Functions|Postgrest|Storage|Realtime)\w*Error$|^MultiplayerActionError$/;

export function classifyError(error: unknown): ErrorDisposition {
  const { code, message, name, status } = readError(error);
  if (
    networkErrorNames.has(name) ||
    status === 0 ||
    status === 408 ||
    (message !== '' && networkMessagePattern.test(message))
  ) {
    return 'network';
  }
  if (expectedErrorNames.has(name) || (code !== null && expectedAuthCodes.has(code))) {
    return 'expected';
  }
  if (name.startsWith('Auth') && /token has expired or is invalid/i.test(message)) {
    return 'expected';
  }
  // Game rule rejections. The server reports its own unexpected failures.
  if (name === 'MultiplayerActionError' && typeof status === 'number' && status >= 400 && status < 500) {
    return status === 401 ? 'report' : 'expected';
  }
  return 'report';
}

export function getManualStackingKey(error: unknown, operation: string | null, hasStackFrames: boolean) {
  if (!operation) {
    return null;
  }

  const { code, message, name, status } = readError(error);
  if (hasStackFrames && code === null && !libraryErrorPattern.test(name)) {
    return null;
  }

  const qualifier = code ?? (typeof status === 'number' ? String(status) : '');
  return {
    key: `${operation}|${name || 'Error'}|${qualifier}|${normalizeMessage(message)}`,
    title: `${operation}: ${redactSensitiveText(message)}`,
  };
}

export function normalizeMessage(message: string) {
  return redactSensitiveText(message)
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"…"')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200);
}

export function getErrorDetails(error: unknown): Record<string, string | number> {
  if (typeof error !== 'object' || error === null) {
    return {};
  }

  const details: Record<string, string | number> = {};
  for (const key of ['code', 'details', 'hint', 'status'] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) {
      details[`Error${key[0].toUpperCase()}${key.slice(1)}`] = redactSensitiveText(value).slice(0, 500);
    } else if (typeof value === 'number') {
      details[`Error${key[0].toUpperCase()}${key.slice(1)}`] = value;
    }
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    details.ErrorCause = redactSensitiveText(`${cause.name}: ${cause.message}`);
  }

  return details;
}

// Returns the error itself when nothing needs redacting, so its identity and
// stack stay intact; otherwise a copy with the same name, stack and cause.
export function redactError(error: Error): Error {
  const message = redactSensitiveText(error.message);
  if (message === error.message) {
    return error;
  }

  const copy = new Error(message, { cause: error.cause });
  copy.name = error.name;
  copy.stack = error.stack === undefined ? undefined : redactSensitiveText(error.stack);
  return copy;
}

// Allows one report per key per window, so a failure that repeats while the
// player is offline or a channel keeps reconnecting reports once.
export function createReportThrottle(now: () => number = Date.now) {
  const lastReportedAt = new Map<string, number>();
  return (key: string, windowMs: number) => {
    const current = now();
    const previous = lastReportedAt.get(key);
    if (previous !== undefined && current - previous < windowMs) {
      return false;
    }
    lastReportedAt.set(key, current);
    return true;
  };
}

function readError(error: unknown) {
  const shape: ErrorShape = typeof error === 'object' && error !== null ? (error as ErrorShape) : {};
  return {
    code: typeof shape.code === 'string' && shape.code ? shape.code : null,
    message: typeof shape.message === 'string' ? shape.message : typeof error === 'string' ? error : '',
    name: typeof shape.name === 'string' ? shape.name : '',
    status: typeof shape.status === 'number' ? shape.status : null,
  };
}
