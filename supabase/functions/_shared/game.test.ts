import {
  createGame,
  maxRollsPerTurn,
  purchaseExtraRoll,
  rollCurrentDice,
  rollsRemaining,
  scoreCategoryForScorecard,
  scoreTurn,
  scratchScoreBox,
  startingSuckerTokens,
  suckerPunchChanceByDie,
  suckerTokenCosts,
  toGameState,
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

Deno.test('Edge shared game rules award a token for scratches, not zero scores', () => {
  const zeroScoreGame = {
    ...createGame(['Erin', 'Sam']),
    dice: [1, 2, 3, 4, 5] as Dice,
    phase: 'scoring' as const,
    rollNumber: 2,
  };
  const scored = scoreTurn(zeroScoreGame, 'sixes');
  assertEquals(scored.players[0].suckerTokens, startingSuckerTokens);

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

Deno.test('Edge shared game rules expose the Sucker Punch chance ladder', () => {
  assertEquals(suckerPunchChanceByDie[1], 10);
  assertEquals(suckerPunchChanceByDie[2], 20);
  assertEquals(suckerPunchChanceByDie[3], 30);
  assertEquals(suckerPunchChanceByDie[4], 45);
  assertEquals(suckerPunchChanceByDie[5], 60);
  assertEquals(suckerPunchChanceByDie[6], 75);
});

Deno.test('Edge scoring requires a scored Sucker for extra bonuses', () => {
  for (const suckerScore of [null, 0, 50]) {
    const game = {
      ...createGame(['Erin', 'Sam']),
      dice: [5, 5, 5, 5, 5] as Dice,
      phase: 'scoring' as const,
      rollNumber: 1,
    };
    game.players[0].scorecard.sucker = suckerScore;
    const expectedScore = suckerScore === 50 ? 75 : 25;
    assertEquals(scoreCategoryForScorecard(game.dice, 'fives', game.players[0].scorecard), expectedScore);
    const scored = scoreTurn(game, 'fives');
    assertEquals(scored.players[0].scorecard.fives, expectedScore);
    assertEquals(scored.players[0].suckerBonusCategories.includes('fives'), suckerScore === 50);
    assertEquals(scored.players[0].suckerTokens, startingSuckerTokens);
  }
});

Deno.test('Edge shared game state defaults legacy missing extra rolls to zero', () => {
  const game = createGame(['Erin', 'Sam']);
  const { extraRollsAvailable, ...legacyGame } = game;
  const parsedLegacyGame = toGameState(legacyGame);
  const parsedNullExtraRollsGame = toGameState({ ...game, extraRollsAvailable: null });

  assertEquals(extraRollsAvailable, 0);
  assertEquals(parsedLegacyGame.id, game.id);
  assertEquals(parsedLegacyGame.extraRollsAvailable, 0);
  assertEquals(parsedLegacyGame.players.length, game.players.length);
  assertEquals(parsedNullExtraRollsGame.extraRollsAvailable, 0);
  assertThrows(() => toGameState({ ...game, extraRollsAvailable: -1 }), 'invalid extra rolls');
  assertThrows(() => toGameState({ ...game, extraRollsAvailable: 1.5 }), 'invalid extra rolls');
});

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertThrows(action: () => unknown, message: string) {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) {
      return;
    }
    throw error;
  }

  throw new Error(`Expected error including "${message}".`);
}
