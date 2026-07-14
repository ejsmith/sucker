const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createOrReuseActionRequest,
  getActionKey,
  mergeRecoveredActions,
  selectActionRequestsForRecovery,
} = require('../.build/src/multiplayer/actionRecovery');

const now = Date.parse('2026-07-14T12:00:00.000Z');
const maxAgeMs = 5 * 60_000;

test('manual retries reuse the pending request ID for the same account and action', () => {
  const first = createOrReuseActionRequest([], 'alice', { type: 'create_invite' }, now, () => 'request-1', maxAgeMs);
  const retried = createOrReuseActionRequest(
    first.pending,
    'alice',
    { type: 'create_invite' },
    now + 1_000,
    () => 'request-2',
    maxAgeMs,
  );

  assert.equal(retried.request.requestId, 'request-1');
  assert.equal(retried.pending.length, 1);
});

test('pending requests and recovery are scoped to the signed-in account', () => {
  const alice = createOrReuseActionRequest([], 'alice', { type: 'create_invite' }, now, () => 'alice-1', maxAgeMs);
  const bob = createOrReuseActionRequest(
    alice.pending,
    'bob',
    { type: 'create_invite' },
    now + 1_000,
    () => 'bob-1',
    maxAgeMs,
  );
  const selected = selectActionRequestsForRecovery(bob.pending, 'bob', now + 2_000, maxAgeMs);

  assert.equal(bob.request.requestId, 'bob-1');
  assert.deepEqual(
    selected.recoverable.map((request) => request.requestId),
    ['bob-1'],
  );
  assert.deepEqual(
    selected.pending.map((request) => request.requestId),
    ['alice-1', 'bob-1'],
  );
});

test('expired requests are discarded before retry or recovery', () => {
  const expired = createOrReuseActionRequest(
    [],
    'alice',
    { gameId: 'game-1', type: 'roll' },
    now,
    () => 'expired',
    maxAgeMs,
  );
  const replacement = createOrReuseActionRequest(
    expired.pending,
    'alice',
    { gameId: 'game-1', type: 'roll' },
    now + maxAgeMs + 1,
    () => 'replacement',
    maxAgeMs,
  );

  assert.equal(replacement.request.requestId, 'replacement');
  assert.deepEqual(
    replacement.pending.map((request) => request.requestId),
    ['replacement'],
  );
});

test('action keys normalize invite codes and distinguish meaningful action input', () => {
  assert.equal(
    getActionKey({ inviteCode: ' ab12cd34 ', type: 'accept_invite' }),
    getActionKey({ inviteCode: 'AB12CD34', type: 'accept_invite' }),
  );
  assert.notEqual(
    getActionKey({ gameId: 'game-1', held: [true, false, false, false, false], type: 'roll' }),
    getActionKey({ gameId: 'game-1', held: [false, true, false, false, false], type: 'roll' }),
  );
});

test('recovered results preserve invite codes and deduplicate repeated delivery', () => {
  const recovered = {
    action: { type: 'create_invite' },
    actorId: 'alice',
    requestId: 'request-1',
    result: { inviteCode: 'AB12CD34' },
  };
  const merged = mergeRecoveredActions([recovered], [{ ...recovered, result: { inviteCode: 'EF56AB78' } }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].result.inviteCode, 'EF56AB78');
});
