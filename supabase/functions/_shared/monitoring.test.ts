import { createServerErrorEvent } from './monitoring.ts';

Deno.test('server errors keep their type, stack, user, and details', () => {
  const error = new TypeError('Cannot read properties of undefined');
  const event = createServerErrorEvent(error, {
    functionName: 'game-action',
    operation: 'score',
    userId: 'player-1',
    properties: { HttpStatus: 500 },
  });
  const simpleError = event.data['@simple_error'] as { message: string; type: string; stack_trace: string };

  assertEquals(event.type, 'error');
  assertEquals(event.source, 'game-action');
  assertEquals(event.tags.join(','), 'Sucker,server,game-action');
  assertEquals(simpleError.type, 'TypeError');
  assertEquals(simpleError.message, 'Cannot read properties of undefined');
  assertEquals(simpleError.stack_trace, error.stack);
  assertEquals((event.data['@user'] as { identity: string }).identity, 'player-1');
  assertEquals(event.data.HttpStatus, 500);
});

Deno.test('Supabase error objects stack by operation and message without ids', () => {
  const first = createServerErrorEvent(
    { message: 'Game 0b9a7e4c-2f61-4a8e-9f00-1c2d3e4f5a6b not found', code: 'PGRST116', details: 'none' },
    { functionName: 'game-action', operation: 'roll' },
  );
  const second = createServerErrorEvent(
    { message: 'Game 7d2f3a10-9c8b-4e6d-8a7f-0123456789ab not found', code: 'PGRST116' },
    { functionName: 'game-action', operation: 'roll' },
  );
  const stackKey = (event: typeof first) =>
    (event.data['@stack'] as { signature_data: { ManualStackingKey: string } }).signature_data.ManualStackingKey;

  assertEquals((first.data['@simple_error'] as { type: string }).type, 'SupabaseError');
  assertEquals(first.data.ErrorCode, 'PGRST116');
  assertEquals(first.data.ErrorDetails, 'none');
  assertEquals(first.data['@user'], undefined);
  assertEquals(stackKey(first), stackKey(second));
});

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
