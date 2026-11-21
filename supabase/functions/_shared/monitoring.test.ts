import { buildReportBody, createServerErrorEvent, InternalServerError, isUnexpectedServerError } from './monitoring.ts';

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

Deno.test('game rule rejections are expected, faults are reported even as 4xx', () => {
  assertEquals(isUnexpectedServerError(new Error('It is not your turn.'), 400), false);
  assertEquals(isUnexpectedServerError({ code: 'PT409', message: 'The game changed on another device.' }, 409), false);
  assertEquals(
    isUnexpectedServerError(
      { code: 'P0001', message: 'You can jab this player again 8 hours after your last jab.' },
      400,
    ),
    false,
  );

  assertEquals(isUnexpectedServerError(new TypeError('Cannot read properties of undefined'), 400), true);
  assertEquals(isUnexpectedServerError(new InternalServerError('SUPABASE_URL is not configured.'), 400), true);
  assertEquals(isUnexpectedServerError({ code: '42703', message: 'column "x" does not exist' }, 400), true);
  assertEquals(
    isUnexpectedServerError({ code: 'P0001', message: 'Move update target is missing or ambiguous' }, 400),
    true,
  );
  assertEquals(isUnexpectedServerError(new Error('Unable to persist the game action outcome.'), 503), true);
});

Deno.test('server events redact personal data and keep the underlying cause', () => {
  const event = createServerErrorEvent(
    Object.assign(new Error('Unable to persist the game action outcome.'), {
      originalError: {
        code: '23505',
        message: 'duplicate key',
        details: 'Key (expo_push_token)=(ExponentPushToken[abc]) exists.',
      },
    }),
    { functionName: 'game-action', operation: 'roll' },
  );
  assertEquals(event.data.ErrorCause, 'SupabaseError 23505: duplicate key');

  const withToken = createServerErrorEvent(
    { code: '23505', message: 'duplicate key', details: 'Key (expo_push_token)=(ExponentPushToken[abc]) exists.' },
    { functionName: 'game-action', operation: 'roll' },
  );
  assertEquals(withToken.data.ErrorDetails, 'Key (expo_push_token)=(…) exists.');
});

Deno.test('an unserializable report is skipped instead of throwing', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    assertEquals(buildReportBody(circular, { functionName: 'game-action', operation: 'roll' }) === null, false);
    assertEquals(
      buildReportBody(new Error('boom'), { functionName: 'game-action', operation: 'roll', properties: { Big: 1n } }),
      null,
    );
  } finally {
    console.error = originalError;
  }
});

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
