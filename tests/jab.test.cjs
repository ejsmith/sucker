const assert = require('node:assert/strict');
const test = require('node:test');
const { canJabGame } = require('../.build/src/multiplayer/jab');

const now = Date.parse('2026-09-14T12:00:00Z');
const hour = 60 * 60 * 1_000;
const game = {
  status: 'active',
  current_player_id: 'opponent',
  turn_started_at: new Date(now - hour).toISOString(),
  updated_at: new Date(now).toISOString(),
  last_nudged_at: null,
};

test('Jab becomes available after one hour and hides throughout its eight-hour cooldown', () => {
  assert.equal(canJabGame(game, 'me', now - 1), false);
  assert.equal(canJabGame(game, 'me', now), true);
  const jabbed = { ...game, last_nudged_at: new Date(now).toISOString() };
  assert.equal(canJabGame(jabbed, 'me', now + 8 * hour - 1), false);
  assert.equal(canJabGame(jabbed, 'me', now + 8 * hour), true);
});

test('Jab is unavailable on your turn, inactive games, and unknown timestamps', () => {
  for (const overrides of [
    { current_player_id: 'me' },
    { current_player_id: null },
    { status: 'inviting' },
    { status: 'complete' },
    { turn_started_at: 'invalid' },
    { last_nudged_at: 'invalid' },
  ]) {
    assert.equal(canJabGame({ ...game, ...overrides }, 'me', now), false);
  }
  assert.equal(canJabGame({ ...game, status: 'response_window' }, 'me', now), true);
});

test('Jab times the turn, not the latest move, and falls back to updated_at for older servers', () => {
  // The opponent rolled a minute ago, but their turn started an hour ago.
  assert.equal(canJabGame({ ...game, updated_at: new Date(now - 60_000).toISOString() }, 'me', now), true);
  const olderServerGame = { ...game, turn_started_at: undefined, updated_at: new Date(now - hour).toISOString() };
  assert.equal(canJabGame(olderServerGame, 'me', now - 1), false);
  assert.equal(canJabGame(olderServerGame, 'me', now), true);
});
