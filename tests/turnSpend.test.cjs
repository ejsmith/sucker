const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGame,
  mulliganCurrentTurn,
  purchaseExtraRoll,
  rollCurrentDice,
  scoreTurn,
  scratchScoreBox,
  toGameState,
} = require('../.build/shared/game');
const { describeTurnSpend } = require('../.build/src/game/turnSpend');

test('a turn tallies what it bought and the next turn starts clean', () => {
  let game = createGame(['Alice', 'Bob']);
  game = purchaseExtraRoll(game);
  game = purchaseExtraRoll(game);
  game = mulliganCurrentTurn(game);
  game = purchaseExtraRoll(game);
  assert.deepEqual(game.turnSpend, { extraRolls: 3, mulligans: 1 });
  assert.equal(game.players[0].suckerTokens, 4);
  // The spend survives a save and reload.
  assert.deepEqual(toGameState(JSON.parse(JSON.stringify(game))).turnSpend, { extraRolls: 3, mulligans: 1 });

  game = scoreTurn(
    rollCurrentDice(game, () => 0),
    'ones',
  );
  assert.equal(game.currentPlayerIndex, 1);
  assert.equal('turnSpend' in game, false);

  game = scratchScoreBox(purchaseExtraRoll(game), 'chance');
  assert.equal('turnSpend' in game, false);
});

test('stored games reject a malformed turn spend', () => {
  const game = createGame(['Alice', 'Bob']);
  assert.throws(() => toGameState({ ...game, turnSpend: { extraRolls: -1, mulligans: 0 } }), /turn spend/);
  assert.throws(() => toGameState({ ...game, turnSpend: 3 }), /turn spend/);
});

test('the turn reveal says what the tokens bought, never what they were for', () => {
  const turn = (category, score, extraRolls, mulligans, dice = [1, 2, 3, 4, 6]) => ({
    category,
    dice,
    score,
    spend: { extraRolls, mulligans },
  });

  assert.equal(describeTurnSpend(turn('chance', 16, 0, 0)), null);
  assert.equal(describeTurnSpend({ ...turn('chance', 16, 0, 0), spend: null }), null);
  assert.equal(describeTurnSpend(turn('sucker', 50, 2, 1, [6, 6, 6, 6, 6])), 'Spent 5 tokens and rolled a Sucker!');
  // A Sucker in another box still counts.
  assert.equal(describeTurnSpend(turn('fives', 75, 1, 0, [5, 5, 5, 5, 5])), 'Spent 1 token and rolled a Sucker!');
  assert.equal(describeTurnSpend(turn('sucker', 0, 4, 0)), 'Burned 4 tokens for nothing.');
  assert.equal(describeTurnSpend(turn('largeStraight', 0, 3, 0)), 'Burned 3 tokens for nothing.');
  // A Sucker thrown away for a 0, or a Sucker Deal's leftover dice, is still nothing.
  assert.equal(describeTurnSpend(turn('threes', 0, 2, 0, [2, 2, 2, 2, 2])), 'Burned 2 tokens for nothing.');
  assert.equal(describeTurnSpend(turn('ones', 0, 0, 1, [1, 1, 1, 1, 1])), 'Burned 3 tokens for nothing.');
  assert.equal(describeTurnSpend(turn('chance', 28, 2, 1)), 'Spent 5 tokens on 2 Extra Rolls and a Mulligan.');
  assert.equal(describeTurnSpend(turn('chance', 28, 1, 0)), 'Spent 1 token on an Extra Roll.');
  assert.equal(describeTurnSpend(turn('chance', 28, 0, 2)), 'Spent 6 tokens on 2 Mulligans.');
  // A Sucker Deal earns a token; it isn't nothing.
  assert.equal(
    describeTurnSpend({ ...turn('largeStraight', 0, 0, 1), dealt: true, dice: null }),
    'Spent 3 tokens, then took a Sucker Deal.',
  );
});

test('the recap tells each splurge with its result', () => {
  const turn = (category, score, extraRolls, mulligans, dice = [1, 2, 3, 4, 6]) => ({
    category,
    dice,
    score,
    spend: { extraRolls, mulligans },
  });

  assert.equal(
    describeTurnSpend(turn('sucker', 50, 5, 0, [2, 2, 2, 2, 2]), 'You'),
    'You spent 5 tokens and rolled a Sucker for 50!',
  );
  assert.equal(describeTurnSpend(turn('sucker', 0, 5, 0), 'Bob'), 'Bob burned 5 tokens for a 0 on Sucker.');
  assert.equal(describeTurnSpend(turn('fours', 0, 3, 0), 'Bob'), 'Bob burned 3 tokens for a 0 on Fours.');
  assert.equal(describeTurnSpend(turn('chance', 28, 2, 1), 'You'), 'You spent 5 tokens for 28 on Chance.');
  assert.equal(
    describeTurnSpend({ ...turn('largeStraight', 0, 0, 1), dealt: true, dice: null }, 'Bob'),
    'Bob spent 3 tokens, then took a Sucker Deal on Large straight.',
  );
  // A punched turn's score was wiped; the line says so.
  assert.equal(
    describeTurnSpend({ ...turn('fullHouse', 25, 0, 1), punched: true }, 'Alice'),
    'Alice spent 3 tokens for 25 on Full house, then got punched.',
  );
  assert.equal(
    describeTurnSpend({ ...turn('sucker', 50, 2, 0, [6, 6, 6, 6, 6]), punched: true }, 'Alice'),
    'Alice spent 2 tokens and rolled a Sucker for 50, then got punched.',
  );
});
