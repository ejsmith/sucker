export async function discardRequestBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;

  const reader = body.getReader();
  let finished = false;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    // Cancellation itself can stall; do not wait for it to settle.
    void reader.cancel().catch(() => {});
  };
  // Cancelling settles a pending read even if the underlying source stalls.
  const timeout = setTimeout(cancel, 1_000);

  try {
    let discardedBytes = 0;
    // The read budget also bounds continuously available tiny or empty chunks.
    for (let reads = 0; reads < 128 && discardedBytes < 1_048_576; reads += 1) {
      const chunk = await reader.read();
      if (chunk.done) {
        finished = true;
        return;
      }
      discardedBytes += chunk.value.byteLength;
    }
  } finally {
    clearTimeout(timeout);
    if (!finished) cancel();
    reader.releaseLock();
  }
}
