import { getActionRequestFailureDisposition } from './actionRequestFailure.ts';

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

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`);
  }
}
