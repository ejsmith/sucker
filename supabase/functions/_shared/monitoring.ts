// Sends Edge Function failures to Exceptionless using the same event shape as
// the app's client. Reporting is fire-and-forget: it never delays or fails the
// response, and it does nothing until EXCEPTIONLESS_API_KEY is configured.

type ErrorContext = {
  functionName: string;
  operation: string;
  userId?: string | null;
  properties?: Record<string, unknown>;
};

type EdgeRuntimeGlobal = { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } };

const defaultServerUrl = 'https://collector.exceptionless.io';

export function logServerError(message: string, error: unknown, context: ErrorContext) {
  console.error(message, error);
  reportServerError(error, context);
}

export function reportServerError(error: unknown, context: ErrorContext) {
  const apiKey = Deno.env.get('EXCEPTIONLESS_API_KEY')?.trim();
  if (!apiKey) return;

  const serverUrl = (Deno.env.get('EXCEPTIONLESS_SERVER_URL')?.trim() || defaultServerUrl).replace(/\/$/, '');
  const submission = fetch(`${serverUrl}/api/v2/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([createServerErrorEvent(error, context)]),
  })
    .then((response) => {
      if (!response.ok) console.error('Exceptionless rejected an error report', response.status);
      return response.body?.cancel();
    })
    .catch((submitError) => console.error('Unable to report error to Exceptionless', submitError));

  (globalThis as EdgeRuntimeGlobal).EdgeRuntime?.waitUntil(submission);
}

export function createServerErrorEvent(error: unknown, { functionName, operation, userId, properties }: ErrorContext) {
  const { message, type, stack } = describeError(error);
  const data: Record<string, unknown> = {
    '@simple_error': { message, type, stack_trace: stack },
    '@stack': {
      signature_data: { ManualStackingKey: `${functionName}|${operation}|${type}|${normalizeMessage(message)}` },
      title: `${functionName} ${operation}: ${message}`,
    },
    Operation: operation,
  };
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
  if (error instanceof Error) {
    return { message: error.message || error.name, type: error.name || 'Error', stack: error.stack ?? '' };
  }

  // Supabase returns plain `{ message, code, details, hint }` objects.
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return { message: (error as { message: string }).message, type: 'SupabaseError', stack: '' };
  }

  return {
    message: typeof error === 'string' ? error : (JSON.stringify(error) ?? 'Unknown error'),
    type: 'Error',
    stack: '',
  };
}

function getErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {};

  const details: Record<string, unknown> = {};
  for (const key of ['code', 'details', 'hint', 'status'] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === 'string' || typeof value === 'number') {
      details[`Error${key[0].toUpperCase()}${key.slice(1)}`] = value;
    }
  }

  return details;
}

function normalizeMessage(message: string) {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200);
}
