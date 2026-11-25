const assert = require('node:assert/strict');
const test = require('node:test');
const { createGame } = require('../.build/shared/game');
const { describeGameResult } = require('../.build/src/game/gameResult');

const base = createGame(['Alice', 'You']);
const withScores = (aliceOnes, bobOnes, extra = {}) => ({
  ...base,
  ...extra,
  phase: 'complete',
  players: base.players.map((player, index) => ({
    ...player,
    id: index === 0 ? 'alice' : 'bob',
    scorecard: { ...player.scorecard, ones: index === 0 ? aliceOnes : bobOnes },
  })),
});
// Bob's display name is literally "You".
const nameOf = (playerId) => (playerId === 'alice' ? 'Alice' : 'You');

test('the result line speaks to the viewer by id, not by name', () => {
  const game = withScores(4, 1);
  assert.equal(describeGameResult({ game, nameOf, viewerId: 'alice' }), 'You won by 3!');
  assert.equal(describeGameResult({ game, nameOf, viewerId: 'bob' }), 'You lost by 3.');
  assert.equal(describeGameResult({ game, nameOf, viewerId: 'carol' }), 'Alice won by 3.');
  assert.equal(describeGameResult({ game, nameOf, viewerId: null }), 'Alice won by 3.');
  assert.equal(describeGameResult({ game: withScores(2, 2), nameOf, viewerId: 'alice' }), 'Tie game!');
});

test('a forfeit says who left', () => {
  const quit = withScores(4, 1, { rageQuit: { playerId: 'alice' } });
  assert.equal(describeGameResult({ game: quit, nameOf, viewerId: 'carol' }), 'Alice rage quit.');
  assert.equal(describeGameResult({ game: quit, nameOf, viewerId: 'alice' }), 'You rage quit.');
  const timedOut = withScores(4, 1, { timedOut: { playerId: 'alice' } });
  assert.equal(describeGameResult({ game: timedOut, nameOf, viewerId: 'bob' }), 'Alice ran out of time.');
});
