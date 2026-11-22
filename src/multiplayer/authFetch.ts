import { sessionConnectionMessage } from './sessionRecovery';

const authTokenTimeoutMs = 10_000;
// Database reads are small. On a dead connection (a Wi-Fi to cellular
// handoff, say) Android's HTTP client never times out on its own, which left
// screens loading forever.
const restTimeoutMs = 15_000;

export const fetchWithAuthRecovery: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const { pathname } = new URL(url);
  if (pathname.includes('/rest/v1/')) return fetchRestWithTimeout(input, init);
  if (!pathname.endsWith('/auth/v1/token')) return fetch(input, init);

  const controller = new AbortController();
  const originalSignal = init?.signal;
  const abort = () => controller.abort();
  if (originalSignal?.aborted) abort();
  originalSignal?.addEventListener('abort', abort);
  const timeout = setTimeout(abort, authTokenTimeoutMs);
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

async function fetchRestWithTimeout(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) {
  const controller = new AbortController();
  const originalSignal = init?.signal;
  const abort = () => controller.abort();
  if (originalSignal?.aborted) abort();
  originalSignal?.addEventListener('abort', abort);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, restTimeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // Report a timeout the way a dropped connection is reported, so callers
    // treat it as temporary and retry.
    if (timedOut) throw new TypeError('Network request failed: the request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
    originalSignal?.removeEventListener('abort', abort);
  }
}
