import {
  createGame,
  type Dice,
  type GameState,
  maxRollsPerTurn,
  mulliganCurrentTurn,
  purchaseExtraRoll,
  rollCurrentDice,
  rollsRemaining,
  scoreCategory,
  scoreCategoryForScorecard,
  scoreTurn,
  scratchScoreBox,
  startingSuckerTokens,
  suckerTokenCosts,
  toggleHold,
  totalScore,
  upperBonus,
} from "../shared/game.ts";

Deno.test("scores upper categories by matching faces", () => {
  assertEquals(scoreCategory([1, 1, 3, 5, 1], "ones"), 3);
  assertEquals(scoreCategory([6, 2, 6, 6, 4], "sixes"), 18);
});

Deno.test("scores lower categories", () => {
  assertEquals(scoreCategory([3, 3, 3, 4, 5], "threeOfAKind"), 18);
  assertEquals(scoreCategory([3, 3, 3, 3, 5], "fourOfAKind"), 17);
  assertEquals(scoreCategory([2, 2, 2, 5, 5], "fullHouse"), 25);
  assertEquals(scoreCategory([1, 2, 3, 4, 6], "smallStraight"), 30);
  assertEquals(scoreCategory([2, 3, 4, 5, 6], "largeStraight"), 40);
  assertEquals(scoreCategory([4, 4, 4, 4, 4], "sucker"), 50);
  assertEquals(scoreCategory([1, 2, 3, 4, 6], "chance"), 16);
});

Deno.test("returns zero when category conditions are not met", () => {
  assertEquals(scoreCategory([1, 1, 2, 3, 4], "threeOfAKind"), 0);
  assertEquals(scoreCategory([1, 1, 2, 2, 3], "fullHouse"), 0);
  assertEquals(scoreCategory([1, 2, 3, 5, 6], "largeStraight"), 0);
});

Deno.test("turn scoring advances to the next player", () => {
  const game: GameState = {
    ...createGame(["Erin", "Sam"]),
    dice: [6, 6, 6, 2, 1],
    rollNumber: 2,
    phase: "scoring",
  };

  const next = scoreTurn(game, "threeOfAKind");

  assertEquals(next.players[0].scorecard.threeOfAKind, 21);
  assertEquals(next.currentPlayerIndex, 1);
  assertEquals(next.rollNumber, 0);
  assertEquals(next.held, [false, false, false, false, false]);
});

Deno.test("players start with sucker tokens and can roll up to four times", () => {
  let game = createGame(["Erin", "Sam"]);
  assertEquals(game.players[0].suckerTokens, startingSuckerTokens);
  assertEquals(maxRollsPerTurn, 4);

  for (let i = 0; i < maxRollsPerTurn; i += 1) {
    game = rollDeterministic(game);
  }

  const blocked = rollDeterministic(game);
  assertEquals(blocked.rollNumber, 4);
});

Deno.test("scoring a sucker does not earn a sucker token", () => {
  const game: GameState = {
    ...createGame(["Erin", "Sam"]),
    dice: [6, 6, 6, 6, 6],
    rollNumber: 2,
    phase: "scoring",
  };

  const next = scoreTurn(game, "sucker");

  assertEquals(next.players[0].scorecard.sucker, 50);
  assertEquals(next.players[0].suckerTokens, startingSuckerTokens);
});

Deno.test("scoring zero in a category earns one sucker token", () => {
  const game: GameState = {
    ...createGame(["Erin", "Sam"]),
    dice: [1, 2, 3, 4, 5],
    rollNumber: 2,
    phase: "scoring",
  };

  const next = scoreTurn(game, "sixes");

  assertEquals(next.players[0].scorecard.sixes, 0);
  assertEquals(next.players[0].suckerTokens, startingSuckerTokens + 1);
});

Deno.test("sucker deal scratches a selected score box and earns one token", () => {
  const game: GameState = {
    ...createGame(["Erin", "Sam"]),
    dice: [6, 6, 6, 6, 6],
    rollNumber: 2,
    phase: "scoring",
  };

  const next = scratchScoreBox(game, "sucker");

  assertEquals(next.players[0].scorecard.sucker, 0);
  assertEquals(next.players[0].suckerTokens, startingSuckerTokens + 1);
  assertEquals(next.currentPlayerIndex, 1);
  assertEquals(next.rollNumber, 0);
});

Deno.test("extra sucker adds 50 when sucker is already scored elsewhere", () => {
  const game: GameState = {
    ...createGame(["Erin", "Sam"]),
    dice: [4, 4, 4, 4, 4],
    rollNumber: 2,
    phase: "scoring",
  };
  game.players[0].scorecard.sucker = 50;

  assertEquals(
    scoreCategoryForScorecard(
      game.dice,
      "fourOfAKind",
      game.players[0].scorecard,
    ),
    70,
  );

  const next = scoreTurn(game, "fourOfAKind");

  assertEquals(next.players[0].scorecard.fourOfAKind, 70);
  assertEquals(next.players[0].suckerTokens, startingSuckerTokens);
  assertEquals(next.players[0].suckerBonusCategories, ["fourOfAKind"]);
});

Deno.test("extra roll spends a token and adds one roll after available rolls are used", () => {
  let game = createGame(["Erin", "Sam"]);

  for (let i = 0; i < maxRollsPerTurn; i += 1) {
    game = rollDeterministic(game);
  }
  game = toggleHold(toggleHold(game, 0), 2);

  const purchased = purchaseExtraRoll(game);

  assertEquals(purchased.rollNumber, 4);
  assertEquals(rollsRemaining(purchased), 1);
  assertEquals(
    purchased.players[0].suckerTokens,
    startingSuckerTokens - suckerTokenCosts.extraRoll,
  );
  assertEquals(purchased.dice, game.dice);
  assertEquals(purchased.held, game.held);

  const nextGame = rollCurrentDice(purchased, () => 0.99);

  assertEquals(nextGame.rollNumber, 5);
  assertEquals(rollsRemaining(nextGame), 0);
  assertEquals(nextGame.dice, [game.dice[0], 6, game.dice[2], 6, 6]);
});

Deno.test("mulligan spends tokens and resets the current turn", () => {
  const game: GameState = {
    ...createGame(["Erin", "Sam"]),
    dice: [2, 3, 4, 5, 6],
    held: [true, false, true, false, true],
    rollNumber: 3,
    phase: "scoring",
  };

  const next = mulliganCurrentTurn(game);

  assertEquals(next.rollNumber, 0);
  assertEquals(next.phase, "rolling");
  assertEquals(
    next.players[0].suckerTokens,
    startingSuckerTokens - suckerTokenCosts.mulligan,
  );
  assertEquals(next.dice, [1, 1, 1, 1, 1]);
  assertEquals(next.held, [false, false, false, false, false]);
});

Deno.test("dice cannot be held before first roll", () => {
  const game = createGame(["Erin", "Sam"]);

  assertEquals(toggleHold(game, 0).held, [false, false, false, false, false]);
});

Deno.test("upper bonus is included in total score", () => {
  const scorecard = createGame(["Erin"]).players[0].scorecard;
  scorecard.ones = 3;
  scorecard.twos = 6;
  scorecard.threes = 9;
  scorecard.fours = 12;
  scorecard.fives = 15;
  scorecard.sixes = 18;

  assertEquals(upperBonus(scorecard), 35);
  assertEquals(totalScore(scorecard), 98);
});

function rollDeterministic(game: GameState) {
  return rollCurrentDice(game, () => 0);
}

function assertEquals<T>(actual: T, expected: T) {
  if (!isEqual(actual, expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function isEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
