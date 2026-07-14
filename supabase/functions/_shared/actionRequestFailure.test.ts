import { getActionRequestFailureDisposition, isRetryableDatabaseError } from './actionRequestFailure.ts';

Deno.test('action request failures release only retryable claims that cannot have written', () => {
  assertEquals(
    getActionRequestFailureDisposition({
      httpStatus: 503,
      mutationMayHaveWritten: false,
      persistenceFailed: false,
    }),
    'release',
  );
  assertEquals(
    getActionRequestFailureDisposition({
      httpStatus: 503,
      mutationMayHaveWritten: true,
      persistenceFailed: false,
    }),
    'retain',
  );
  assertEquals(
    getActionRequestFailureDisposition({
      httpStatus: 503,
      mutationMayHaveWritten: false,
      persistenceFailed: true,
    }),
    'retain',
  );
  assertEquals(
    getActionRequestFailureDisposition({
      httpStatus: 400,
      mutationMayHaveWritten: false,
      persistenceFailed: false,
    }),
    'complete',
  );
});

Deno.test('database errors are retryable only for transient failure codes', () => {
  for (const code of ['PGRST000', '08006', '53300', '40001', '40P01', '55P03', 'ECONNRESET']) {
    assertEquals(isRetryableDatabaseError({ code }), true);
  }

  for (const code of ['PGRST116', '22P02', '23505', '42501', 'UNKNOWN']) {
    assertEquals(isRetryableDatabaseError({ code }), false);
  }

  assertEquals(isRetryableDatabaseError(new Error('No database code')), false);
});

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`);
  }
}
