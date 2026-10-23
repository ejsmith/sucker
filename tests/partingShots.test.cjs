const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createGame } = require('../.build/shared/game');
const {
  getPartingShotOptions,
  getPartingShotText,
  isPartingShotLineId,
  loserPartingShots,
  partingComebacks,
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

test('parting shot lines are canned, unique, and never free text', () => {
  const lines = [...winnerPartingShots, ...loserPartingShots, ...tiePartingShots, ...partingComebacks];
  assert.equal(new Set(lines.map((line) => line.id)).size, lines.length);
  assert.equal(isPartingShotLineId('gg-mostly'), true);
  assert.equal(isPartingShotLineId('GG. Mostly the second G.'), false);
  assert.equal(getPartingShotText('cute'), 'Cute.');
  assert.equal(getPartingShotText('from-a-newer-release'), 'Sucker!');
});

test('each player picks a shot for their result once the game is over', () => {
  assert.equal(getPartingShotOptions({ ...finishedGame(), phase: 'rolling' }, 'alice'), null);
  assert.deepEqual(getPartingShotOptions(finishedGame(), 'alice'), { kind: 'shot', lines: winnerPartingShots });
  assert.deepEqual(getPartingShotOptions(finishedGame(), 'bob'), { kind: 'shot', lines: loserPartingShots });
  assert.deepEqual(getPartingShotOptions(finishedGame({ bob: 50 }), 'bob'), { kind: 'shot', lines: tiePartingShots });
  assert.equal(getPartingShotOptions(finishedGame(), 'charlie'), null);
});

test('a shot unlocks one comeback, and four messages end the exchange', () => {
  const shot = { kind: 'shot', lineId: 'gg-mostly', playerId: 'alice' };
  assert.equal(getPartingShotOptions(finishedGame({ partingShots: [shot] }), 'alice'), null);
  assert.deepEqual(getPartingShotOptions(finishedGame({ partingShots: [shot] }), 'bob'), {
    kind: 'comeback',
    lines: partingComebacks,
  });

  const answered = [shot, { kind: 'comeback', lineId: 'cute', playerId: 'bob' }];
  assert.deepEqual(getPartingShotOptions(finishedGame({ partingShots: answered }), 'bob'), {
    kind: 'shot',
    lines: loserPartingShots,
  });
  const both = [...answered, { kind: 'shot', lineId: 'rematch-now', playerId: 'bob' }];
  assert.equal(getPartingShotOptions(finishedGame({ partingShots: both }), 'alice')?.kind, 'comeback');
  const done = [...both, { kind: 'comeback', lineId: 'screenshot-taken', playerId: 'alice' }];
  assert.equal(getPartingShotOptions(finishedGame({ partingShots: done }), 'alice'), null);
  assert.equal(getPartingShotOptions(finishedGame({ partingShots: done }), 'bob'), null);
});

test('Rage Quit games keep their single reply instead of parting shots', () => {
  const quit = finishedGame({ rageQuit: { playerId: 'bob' } });
  assert.equal(getPartingShotOptions(quit, 'alice'), null);
  assert.equal(getPartingShotOptions(quit, 'bob'), null);
});
