import {
  createGame,
  maxRollsPerTurn,
  purchaseExtraRoll,
  rollCurrentDice,
  rollsRemaining,
  scoreTurn,
  scratchScoreBox,
  startingSuckerTokens,
  suckerTokenCosts,
  type Dice,
} from './game.ts';

Deno.test('Edge shared game rules allow extra rolls beyond standard rolls', () => {
  let game = createGame(['Erin', 'Sam']);

  for (let rollIndex = 0; rollIndex < maxRollsPerTurn; rollIndex += 1) {
    game = rollCurrentDice(game, () => 0);
  }

  const purchased = purchaseExtraRoll(game);
  assertEquals(rollsRemaining(purchased), 1);
  assertEquals(purchased.players[0].suckerTokens, startingSuckerTokens - suckerTokenCosts.extraRoll);

  const nextGame = rollCurrentDice(purchased, () => 0.99);
  assertEquals(nextGame.rollNumber, 5);
  assertEquals(rollsRemaining(nextGame), 0);
});

Deno.test('Edge shared game rules award a token for zero scores and scratches', () => {
  const zeroScoreGame = {
    ...createGame(['Erin', 'Sam']),
    dice: [1, 2, 3, 4, 5] as Dice,
    phase: 'scoring' as const,
    rollNumber: 2,
  };
  const scored = scoreTurn(zeroScoreGame, 'sixes');
  assertEquals(scored.players[0].suckerTokens, startingSuckerTokens + 1);

  const scratchGame = {
    ...createGame(['Erin', 'Sam']),
    dice: [6, 6, 6, 6, 6] as Dice,
    phase: 'scoring' as const,
    rollNumber: 2,
  };
  const scratched = scratchScoreBox(scratchGame, 'sucker');
  assertEquals(scratched.players[0].scorecard.sucker, 0);
  assertEquals(scratched.players[0].suckerTokens, startingSuckerTokens + 1);
});

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
