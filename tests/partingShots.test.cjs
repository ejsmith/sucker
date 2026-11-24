const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createGame } = require('../.build/shared/game');
const {
  getPartingShotHand,
  getPartingShotPool,
  getPartingShotText,
  isPartingShotLineId,
  loserPartingShots,
  partingShotHandSize,
  tiePartingShots,
  winnerPartingShots,
} = require('../.build/shared/partingShots');

const root = path.resolve(__dirname, '..');

function finishedGame({ alice = 50, bob = 20, partingShots, rageQuit } = {}) {
  const game = createGame(['Alice', 'Bob']);
  const players = game.players.map((player, index) => ({
    ...player,
    id: index === 0 ? 'alice' : 'bob',
    scorecard: { ...player.scorecard, chance: index === 0 ? alice : bob },
  }));
  return {
    ...game,
    phase: 'complete',
    players,
    ...(partingShots ? { partingShots } : {}),
    ...(rageQuit ? { rageQuit } : {}),
  };
}

test('the Edge Function parting shots module mirrors shared/partingShots.ts apart from import specifiers', () => {
  const appSource = fs.readFileSync(path.join(root, 'shared/partingShots.ts'), 'utf8');
  const edgeSource = fs.readFileSync(path.join(root, 'supabase/functions/_shared/partingShots.ts'), 'utf8');

  assert.equal(edgeSource.replace("from './game.ts'", "from './game'"), appSource);
});

test('parting shot lines are canned, unique, short, and never free text', () => {
  const lines = [...winnerPartingShots, ...loserPartingShots, ...tiePartingShots];
  assert.equal(new Set(lines.map((line) => line.id)).size, lines.length);
  assert.equal(new Set(lines.map((line) => line.text)).size, lines.length);
  // Longer lines wrap in the Game Over panel, which cannot scroll.
  assert.deepEqual(
    lines.filter((line) => line.text.length > 36),
    [],
  );
  assert.equal(isPartingShotLineId('scoreboard'), true);
  assert.equal(isPartingShotLineId('Scoreboard, Sucker.'), false);
  assert.equal(getPartingShotText('scoreboard'), 'Scoreboard, Sucker.');
  assert.equal(getPartingShotText('from-a-newer-release'), 'Sucker!');
});

test('each player draws from the lines for their result once the game is over', () => {
  assert.equal(getPartingShotPool({ ...finishedGame(), phase: 'rolling' }, 'alice'), null);
  assert.equal(getPartingShotHand({ ...finishedGame(), phase: 'rolling' }, 'alice'), null);
  assert.equal(getPartingShotPool(finishedGame(), 'alice'), winnerPartingShots);
  assert.equal(getPartingShotPool(finishedGame(), 'bob'), loserPartingShots);
  assert.equal(getPartingShotPool(finishedGame({ bob: 50 }), 'bob'), tiePartingShots);
  assert.equal(getPartingShotPool(finishedGame(), 'charlie'), null);

  for (const [playerId, pool] of [
    ['alice', winnerPartingShots],
    ['bob', loserPartingShots],
  ]) {
    const hand = getPartingShotHand(finishedGame(), playerId);
    assert.equal(hand.length, partingShotHandSize);
    assert.equal(new Set(hand).size, partingShotHandSize);
    assert.ok(hand.every((line) => pool.includes(line)));
  }
});

test('a hand stays fixed for a game and player, and varies across games', () => {
  const game = finishedGame();
  assert.deepEqual(getPartingShotHand(game, 'alice'), getPartingShotHand({ ...game }, 'alice'));

  const hands = Array.from({ length: 500 }, (_, index) =>
    getPartingShotHand({ ...game, id: `3f2993f8-d6a9-4ec7-a8e8-${index}` }, 'alice'),
  );
  const dealt = new Map();
  for (const line of hands.flat()) dealt.set(line.id, (dealt.get(line.id) ?? 0) + 1);
  // Every line turns up, and none hogs the table: a fair share is 100 of 500.
  assert.equal(dealt.size, winnerPartingShots.length);
  assert.ok(Math.max(...dealt.values()) < 160, `most dealt ${Math.max(...dealt.values())}`);
  assert.ok(Math.min(...dealt.values()) > 50, `least dealt ${Math.min(...dealt.values())}`);
  assert.ok(
    new Set(
      hands.map((hand) =>
        hand
          .map((line) => line.id)
          .sort()
          .join(),
      ),
    ).size > 300,
  );

  // Two players on the same list usually see different hands.
  const tied = finishedGame({ bob: 50 });
  assert.notDeepEqual(getPartingShotHand(tied, 'alice'), getPartingShotHand(tied, 'bob'));
});

test('each player gets one last word, whatever the other player does', () => {
  const said = { lineId: 'scoreboard', playerId: 'alice' };
  const onlyAlice = finishedGame({ partingShots: [said] });
  assert.equal(getPartingShotPool(onlyAlice, 'alice'), null);
  assert.equal(getPartingShotHand(onlyAlice, 'alice'), null);
  assert.equal(getPartingShotPool(onlyAlice, 'bob'), loserPartingShots);

  const both = finishedGame({ partingShots: [said, { lineId: 'recount', playerId: 'bob' }] });
  assert.equal(getPartingShotPool(both, 'alice'), null);
  assert.equal(getPartingShotPool(both, 'bob'), null);
});

test('Rage Quit games keep their single reply instead of parting shots', () => {
  const quit = finishedGame({ rageQuit: { playerId: 'bob' } });
  assert.equal(getPartingShotPool(quit, 'alice'), null);
  assert.equal(getPartingShotHand(quit, 'bob'), null);
});
