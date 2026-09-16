import { discardRequestBody } from './discardRequestBody.ts';

Deno.test('discard completes finite uploads without cancelling them', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(33_000));
      controller.enqueue(new Uint8Array(256_000));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  await discardRequestBody(body);
  assertEquals(cancelled, false);
  assertEquals(body.locked, false);
  await discardRequestBody(null);
});

Deno.test('discard cancels a stalled upload within a fixed deadline', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(source) {
      controller = source;
      source.enqueue(new Uint8Array(33_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const drain = discardRequestBody(body);

  try {
    await within(drain, 2_000);
    assertEquals(cancelled, true);
    assertEquals(body.locked, false);
  } finally {
    if (!cancelled) controller.close();
    await drain;
  }
});

Deno.test('discard stops reading a continuously available oversized upload', async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls > 128) {
        controller.error(new Error('Discard kept reading beyond its byte budget.'));
        return;
      }
      controller.enqueue(new Uint8Array(65_536));
    },
    cancel() {
      cancelled = true;
    },
  });

  await discardRequestBody(body);
  assertEquals(cancelled, true);
  assertEquals(body.locked, false);
  if (pulls > 17) throw new Error(`Expected at most 1 MiB plus one prefetched chunk, received ${pulls} chunks.`);
});

Deno.test('discard bounds the number of reads for tiny and empty chunks', async () => {
  for (const chunkSize of [1, 0]) {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1_024) {
          controller.error(new Error('Discard kept reading tiny chunks beyond its read budget.'));
          return;
        }
        controller.enqueue(new Uint8Array(chunkSize));
      },
      cancel() {
        cancelled = true;
      },
    });

    await discardRequestBody(body);
    assertEquals(cancelled, true);
    assertEquals(body.locked, false);
    if (pulls > 129) throw new Error(`Expected at most 128 reads plus one prefetched chunk, received ${pulls}.`);
  }
});

Deno.test('discard deadline does not wait for stalled source cancellation', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const cancellation = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>({
    start(source) {
      controller = source;
    },
    cancel() {
      cancelled = true;
      return cancellation.promise;
    },
  });
  const drain = discardRequestBody(body);

  try {
    await within(drain, 2_000);
    assertEquals(cancelled, true);
    assertEquals(body.locked, false);
  } finally {
    cancellation.resolve();
    if (!cancelled) controller.close();
    await drain;
  }
});

async function within(promise: Promise<void>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Discard exceeded its deadline.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`);
}
