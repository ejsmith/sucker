// Sends Edge Function failures to Exceptionless using the same event shape as
// the app's client. Reporting is fire-and-forget: it never delays or fails the
// response, and it does nothing until EXCEPTIONLESS_API_KEY is configured.
import { redactSensitiveText } from '../../../shared/redaction.ts';

type ErrorContext = {
  functionName: string;
  operation: string;
  userId?: string | null;
  properties?: Record<string, unknown>;
};

type EdgeRuntimeGlobal = { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } };

const defaultServerUrl = 'https://collector.exceptionless.io';
const submitTimeoutMs = 5_000;

/** A server fault, as opposed to a game rule rejecting the player's action. */
export class InternalServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalServerError';
  }
}

// Database errors that are part of the game's rules rather than faults.
const ruleDatabaseMessages = [/^You can jab this player again/, /^A Jab must have a recipient/];

/**
 * Game rules reject actions with a plain `Error` and a message for the player.
 * Anything else is a fault worth a stack trace: runtime errors, internal
 * invariants, and database errors other than version conflicts and rule
 * triggers. Those are reported even when the response status is 4xx.
 */
export function isUnexpectedServerError(error: unknown, httpStatus: number) {
  if (httpStatus >= 500) return true;
  if (error instanceof Error) return error.constructor !== Error;
  if (!error || typeof error !== 'object') return true;

  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== 'string') return true;
  if (code === 'PT409') return false;
  return !(code === 'P0001' && typeof message === 'string' && ruleDatabaseMessages.some((rule) => rule.test(message)));
}

export function logServerError(message: string, error: unknown, context: ErrorContext) {
  console.error(message, error);
  reportServerError(error, context);
}

export function reportServerError(error: unknown, context: ErrorContext) {
  const apiKey = readEnv('EXCEPTIONLESS_API_KEY');
  if (!apiKey) return;

  const body = buildReportBody(error, context);
  if (!body) return;

  const serverUrl = (readEnv('EXCEPTIONLESS_SERVER_URL') || defaultServerUrl).replace(/\/$/, '');
  const submission = fetch(`${serverUrl}/api/v2/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(submitTimeoutMs),
  })
    .then((response) => {
      if (!response.ok) console.error('Exceptionless rejected an error report', response.status);
      return response.body?.cancel();
    })
    .catch((submitError) => console.error('Unable to report error to Exceptionless', submitError));

  (globalThis as EdgeRuntimeGlobal).EdgeRuntime?.waitUntil(submission);
}

/** Serializes one report, or returns null. Reporting runs inside error handlers, so it must never throw. */
export function buildReportBody(error: unknown, context: ErrorContext) {
  try {
    return JSON.stringify([createServerErrorEvent(error, context)]);
  } catch (eventError) {
    console.error('Unable to build Exceptionless error report', eventError);
    return null;
  }
}

export function createServerErrorEvent(error: unknown, { functionName, operation, userId, properties }: ErrorContext) {
  const { code, message, type, stack } = describeError(error);
  const data: Record<string, unknown> = {
    '@simple_error': { message, type, stack_trace: stack },
    '@stack': {
      signature_data: {
        ManualStackingKey: `${functionName}|${operation}|${type}|${code}|${normalizeMessage(message)}`,
      },
      title: `${functionName} ${operation}: ${message}`,
    },
    Operation: operation,
  };
  const region = readEnv('SB_REGION');
  if (region) data.Region = region;
  if (userId) data['@user'] = { identity: userId };

  for (const [key, value] of Object.entries({ ...getErrorDetails(error), ...properties })) {
    if (value !== undefined && value !== null && value !== '') data[key] = value;
  }

  return {
    type: 'error',
    date: new Date().toISOString(),
    message,
    source: functionName,
    tags: ['Sucker', 'server', functionName],
    data,
  };
}

function describeError(error: unknown) {
  const code =
    error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';
  if (error instanceof Error) {
    return {
      code,
      message: redactSensitiveText(error.message || error.name),
      type: error.name || 'Error',
      stack: redactSensitiveText(error.stack ?? ''),
    };
  }

  // Supabase returns plain `{ message, code, details, hint }` objects.
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return {
      code,
      message: redactSensitiveText((error as { message: string }).message),
      type: 'SupabaseError',
      stack: '',
    };
  }

  return { code, message: redactSensitiveText(describeUnknown(error)), type: 'Error', stack: '' };
}

function describeUnknown(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function getErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {};

  const details: Record<string, unknown> = {};
  for (const key of ['code', 'details', 'hint', 'status'] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) {
      details[`Error${key[0].toUpperCase()}${key.slice(1)}`] = redactSensitiveText(value).slice(0, 500);
    } else if (typeof value === 'number') {
      details[`Error${key[0].toUpperCase()}${key.slice(1)}`] = value;
    }
  }

  // Wrapper errors keep what actually failed underneath.
  const { cause, originalError } = error as { cause?: unknown; originalError?: unknown };
  const inner = originalError ?? cause;
  if (inner !== undefined && inner !== null) {
    const described = describeError(inner);
    details.ErrorCause = `${described.type}${described.code ? ` ${described.code}` : ''}: ${described.message}`;
  }

  return details;
}

function normalizeMessage(message: string) {
  return message
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"…"')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200);
}

function readEnv(name: string) {
  try {
    return Deno.env.get(name)?.trim() || undefined;
  } catch {
    // Environment access can be denied, as in tests.
    return undefined;
  }
}
