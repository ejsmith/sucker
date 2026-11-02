const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyError,
  createReportThrottle,
  getErrorDetails,
  getManualStackingKey,
  normalizeMessage,
  redactError,
} = require('../.build/src/monitoring/errorPolicy');
const { redactSensitiveText } = require('../.build/shared/redaction');

function namedError(name, message, extra = {}) {
  return Object.assign(Object.assign(new Error(message), { name }), extra);
}

test('connectivity failures are network noise, not bugs', () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    new TypeError('Network request failed'),
    namedError('FunctionsFetchError', 'Failed to send a request to the Edge Function'),
    namedError('AuthRetryableFetchError', 'fetch failed'),
    namedError('AbortError', 'The operation was aborted.'),
    new Error('Realtime subscription timed out'),
    namedError('MultiplayerActionError', 'Game action failed', { status: 0 }),
  ]) {
    assert.equal(classifyError(error), 'network', error.message);
  }
});

test('player mistakes and game rule rejections are expected', () => {
  for (const error of [
    namedError('AuthApiError', 'Token has expired or is invalid', { status: 403 }),
    namedError('AuthApiError', 'Invalid login credentials', { code: 'invalid_credentials', status: 400 }),
    namedError('AuthApiError', 'For security purposes, you can only request this after 42 seconds.', {
      code: 'over_email_send_rate_limit',
      status: 429,
    }),
    namedError('MultiplayerActionError', 'That invite code was not found.', { status: 400 }),
    namedError('MultiplayerActionError', 'The game changed on another device.', { status: 409 }),
    namedError('PendingMultiplayerActionError', 'We could not confirm the move yet.'),
  ]) {
    assert.equal(classifyError(error), 'expected', error.message);
  }
});

test('faults are reported, including unauthorized game actions and server errors', () => {
  assert.equal(classifyError(new TypeError("Cannot read property 'scorecard' of undefined")), 'report');
  assert.equal(classifyError(namedError('MultiplayerActionError', 'Unauthorized', { status: 401 })), 'report');
  assert.equal(classifyError(namedError('MultiplayerActionError', 'Internal error', { status: 500 })), 'report');
  assert.equal(classifyError({ code: '42501', message: 'new row violates row-level security policy' }), 'report');
  assert.equal(classifyError(namedError('AuthApiError', 'Database error saving new user', { status: 500 })), 'report');
});

test('app errors with frames keep stack-trace grouping', () => {
  const error = new TypeError('x is undefined');
  error.stack = 'TypeError: x is undefined\n    at render (App.tsx:10:5)';
  assert.equal(getManualStackingKey(error, 'Load game', true), null);
});

test('library and frameless errors stack by operation, code and normalized message', () => {
  const first = namedError('MultiplayerActionError', 'Game 0b9a7e4c-2f61-4a8e-9f00-1c2d3e4f5a6b has 3 turns', {
    status: 503,
  });
  const second = namedError('MultiplayerActionError', 'Game 7d2f3a10-9c8b-4e6d-8a7f-0123456789ab has 12 turns', {
    status: 503,
  });
  const firstKey = getManualStackingKey(first, 'MultiplayerAction', true);
  assert.equal(firstKey.key, getManualStackingKey(second, 'MultiplayerAction', true).key);
  assert.equal(firstKey.key, 'MultiplayerAction|MultiplayerActionError|503|Game <id> has <n> turns');
  assert.notEqual(firstKey.key, getManualStackingKey(first, 'Lobby action', true).key);

  const coded = getManualStackingKey(
    namedError('Error', 'User interaction is not allowed.', { code: 'ERR_KEY_CHAIN' }),
    'Read session',
    true,
  );
  assert.equal(coded.key, 'Read session|Error|ERR_KEY_CHAIN|User interaction is not allowed.');
  assert.equal(getManualStackingKey(new Error('x'), null, false), null);
});

test('messages are normalized without quoted values, ids, numbers or personal data', () => {
  assert.equal(
    normalizeMessage('Email address "a.player@example.com" is invalid for user 42'),
    'Email address "…" is invalid for user <n>',
  );
  assert.equal(normalizeMessage('Key (username)=(salty) already exists'), 'Key (username)=(…) already exists');
});

test('sensitive values are redacted from text', () => {
  assert.equal(
    redactSensitiveText('Failing row contains (ExponentPushToken[abc123], player@example.com).'),
    'Failing row contains (…).',
  );
  assert.equal(redactSensitiveText('Push to ExponentPushToken[abc123] failed'), 'Push to ExponentPushToken[…] failed');
  assert.equal(
    redactSensitiveText('POST https://fcm.googleapis.com/fcm/send/abc:def failed'),
    'POST <push-endpoint> failed',
  );
  assert.equal(redactSensitiveText('Authorization: Bearer abc.def.ghi'), 'Authorization: Bearer <token>');
  assert.equal(redactSensitiveText('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-nature'), 'token <jwt>');
  assert.equal(redactSensitiveText('Nothing to hide'), 'Nothing to hide');
});

test('error details are redacted and include the cause', () => {
  const error = {
    code: '23505',
    details: 'Key (expo_push_token)=(ExponentPushToken[abc]) already exists.',
    hint: null,
    message: 'duplicate key value violates unique constraint',
    cause: new Error('socket hang up'),
  };
  assert.deepEqual(getErrorDetails(error), {
    ErrorCause: 'Error: socket hang up',
    ErrorCode: '23505',
    ErrorDetails: 'Key (expo_push_token)=(…) already exists.',
  });
});

test('redacting an error keeps its identity when nothing is sensitive', () => {
  const safe = new Error('Unable to load game');
  assert.equal(redactError(safe), safe);

  const cause = new Error('inner');
  const sensitive = namedError('AuthApiError', 'Email address "a@b.co" is invalid', { cause });
  const redacted = redactError(sensitive);
  assert.equal(redacted.message, 'Email address "<email>" is invalid');
  assert.equal(redacted.name, 'AuthApiError');
  assert.equal(redacted.cause, cause);
  assert.ok(!redacted.stack.includes('a@b.co'));
});

test('the throttle allows one report per key per window', () => {
  let now = 0;
  const shouldReport = createReportThrottle(() => now);
  assert.equal(shouldReport('network|Refresh game', 1000), true);
  now = 999;
  assert.equal(shouldReport('network|Refresh game', 1000), false);
  assert.equal(shouldReport('network|Load lobby', 1000), true);
  now = 1000;
  assert.equal(shouldReport('network|Refresh game', 1000), true);
});
