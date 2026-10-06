import { sessionConnectionMessage } from './sessionRecovery';

export const fetchWithAuthRecovery: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!new URL(url).pathname.endsWith('/auth/v1/token')) return fetch(input, init);

  const controller = new AbortController();
  const originalSignal = init?.signal;
  const abort = () => controller.abort();
  if (originalSignal?.aborted) abort();
  originalSignal?.addEventListener('abort', abort);
  const timeout = setTimeout(abort, 10_000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    // Auth treats some HTTP errors (including 429) as invalid credentials.
    // Infrastructure failures must follow its retryable network-error path,
    // preserving the stored refresh token instead of emitting SIGNED_OUT.
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new TypeError(sessionConnectionMessage);
    }
    return response;
  } finally {
    clearTimeout(timeout);
    originalSignal?.removeEventListener('abort', abort);
  }
};
