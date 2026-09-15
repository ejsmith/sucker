export async function discardRequestBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;

  const reader = body.getReader();
  let finished = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timeout = setTimeout(() => resolve(undefined), 1_000);
  });

  try {
    let discardedBytes = 0;
    while (discardedBytes < 1_048_576) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (!chunk) return;
      if (chunk.done) {
        finished = true;
        return;
      }
      discardedBytes += chunk.value.byteLength;
    }
  } finally {
    clearTimeout(timeout);
    // Cancellation itself can stall; it must not extend the discard deadline.
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
