import type { Session } from '@supabase/supabase-js';

export const sessionConnectionMessage = 'Unable to reach Sucker! services. Please try again.';

export class SessionConnectionError extends Error {
  constructor() {
    super(sessionConnectionMessage);
    this.name = 'SessionConnectionError';
  }
}

export async function withSessionTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new SessionConnectionError()), 3_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// This snapshot is only for restoring the UI. Supabase still refreshes and
// validates credentials before any server operation; never write it back.
export function parseStoredSession(serialized: string | null): Session | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<Session> | null;
    return value &&
      typeof value.access_token === 'string' &&
      value.access_token.length > 0 &&
      typeof value.refresh_token === 'string' &&
      value.refresh_token.length > 0 &&
      typeof value.expires_at === 'number' &&
      typeof value.user?.id === 'string' &&
      value.user.id.length > 0
      ? (value as Session)
      : null;
  } catch {
    return null;
  }
}

export function isTemporarySessionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const { name, status, message } = error as { name?: string; status?: number; message?: string };
  return (
    name === 'AuthRetryableFetchError' ||
    name === 'SessionConnectionError' ||
    name === 'AbortError' ||
    status === 0 ||
    status === 408 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500) ||
    /failed to fetch|network request failed|load failed|networkerror/i.test(message ?? '')
  );
}
