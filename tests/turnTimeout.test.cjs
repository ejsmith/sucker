const assert = require('node:assert/strict');
const test = require('node:test');
const {
  formatTurnTimeoutCountdown,
  getTurnTimeoutRemainingMs,
  turnTimeoutMs,
} = require('../.build/shared/turnTimeout');

const startedAt = '2026-10-01T12:00:00.000Z';
const deadline = Date.parse(startedAt) + turnTimeoutMs;
const hour = 60 * 60 * 1_000;
const day = 24 * hour;

test('The lobby counts down only through the final week', () => {
  assert.equal(formatTurnTimeoutCountdown(startedAt, deadline - 7 * day - 1), null);
  assert.equal(formatTurnTimeoutCountdown(startedAt, deadline - 7 * day), 'Forfeits in 7 days');
  assert.equal(formatTurnTimeoutCountdown(startedAt, deadline - 6 * day + hour), 'Forfeits in 6 days');
  assert.equal(formatTurnTimeoutCountdown(startedAt, deadline - day - hour), 'Forfeits in 2 days');
  assert.equal(formatTurnTimeoutCountdown(startedAt, deadline - day), 'Forfeits today');
  assert.equal(formatTurnTimeoutCountdown(startedAt, deadline - hour), 'Forfeits today');
  assert.equal(formatTurnTimeoutCountdown(startedAt, deadline + hour), 'Forfeits today');
});

test('Unknown turn starts show no countdown', () => {
  assert.equal(formatTurnTimeoutCountdown(undefined, deadline), null);
  assert.equal(formatTurnTimeoutCountdown('invalid', deadline), null);
  assert.equal(getTurnTimeoutRemainingMs(startedAt, deadline), 0);
});
