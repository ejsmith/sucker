import { createGame, getWinnerId, rageQuitGame, toGameState, type GameState } from './game.ts';
import {
  assignRageQuitConfession,
  getRageQuitConfessionText,
  getRageQuitReplyText,
  isRageQuitConfessionId,
  isRageQuitReplyId,
  isSaltyAt,
  rageQuitConfessions,
  rageQuitReplies,
  rageQuitSaltDurationMs,
} from './rageQuit.ts';

function leadingGame(): GameState {
  const game = createGame(['Quitter', 'Stayer']);
  return {
    ...game,
    counterPunchCost: 1,
    counterPunchPlayerId: game.players[1].id,
    players: [
      {
        ...game.players[0],
        revengePunchDiscount: 2,
        scorecard: { ...game.players[0].scorecard, chance: 30, sucker: 50 },
        suckerTokens: 7,
      },
      { ...game.players[1], revengePunchDiscount: 1, scorecard: { ...game.players[1].scorecard, ones: 1 } },
    ],
    rollNumber: 2,
  };
}

Deno.test('Rage Quit ends the game for the opponent even when the quitter leads', () => {
  const game = leadingGame();
  const quit = rageQuitGame(game, game.players[0].id, 'better-than-me');

  assertEquals(quit.phase, 'complete');
  assertEquals(quit.rageQuit?.playerId, game.players[0].id);
  assertEquals(quit.rageQuit?.confessionId, 'better-than-me');
  assertEquals(getWinnerId(quit), game.players[1].id);
  assertEquals(getWinnerId(game), game.players[0].id);
});

Deno.test('Rage Quit gives the quitter nothing back', () => {
  const game = leadingGame();
  const quit = rageQuitGame(game, game.players[0].id, 'sore-loser');

  // Tokens, scores, and dice stay exactly as they were. Unused punch
  // opportunities expire like any other game end.
  assertEquals(quit.players[0].suckerTokens, 7);
  assertEquals(quit.players[0].scorecard.sucker, 50);
  assertEquals(quit.counterPunchPlayerId, undefined);
  assertEquals(quit.counterPunchCost, undefined);
  assertEquals(quit.players[0].revengePunchDiscount, undefined);
  assertEquals(quit.players[1].revengePunchDiscount, undefined);
});

Deno.test('Rage Quit cannot end a finished game or be thrown by an outsider', () => {
  const game = leadingGame();
  const quit = rageQuitGame(game, game.players[1].id, 'juice-box');

  assertThrows(() => rageQuitGame(quit, game.players[0].id, 'sore-loser'), 'already over');
  assertThrows(() => rageQuitGame(game, 'stranger', 'sore-loser'), 'not in this game');
});

Deno.test('Stored rage quits survive parsing and reject impossible quitters', () => {
  const game = leadingGame();
  const quit = { ...rageQuitGame(game, game.players[0].id, 'tried-hardest') };
  const replied = { ...quit, rageQuit: { ...quit.rageQuit!, replyId: 'bye-sucker' } };

  assertEquals(toGameState(quit).rageQuit?.confessionId, 'tried-hardest');
  assertEquals(toGameState(replied).rageQuit?.replyId, 'bye-sucker');
  assertEquals(toGameState(game).rageQuit, undefined);
  assertThrows(() => toGameState({ ...quit, rageQuit: { ...quit.rageQuit, playerId: 'stranger' } }), 'rage quit');
  assertThrows(() => toGameState({ ...quit, rageQuit: { ...quit.rageQuit, replyId: 5 } }), 'rage quit');
  assertThrows(() => toGameState({ ...quit, rageQuit: 'yes' }), 'rage quit');
});

Deno.test('Confessions and replies are fixed lists with stable ids', () => {
  assertEquals(new Set(rageQuitConfessions.map((line) => line.id)).size, rageQuitConfessions.length);
  assertEquals(new Set(rageQuitConfessions.map((line) => line.text)).size, rageQuitConfessions.length);
  assertEquals(new Set(rageQuitReplies.map((reply) => reply.id)).size, rageQuitReplies.length);
  assertEquals(isRageQuitConfessionId('sore-loser'), true);
  assertEquals(isRageQuitConfessionId("I'm a sore loser."), false);
  assertEquals(isRageQuitReplyId('bye-sucker'), true);
  assertEquals(isRageQuitReplyId('sore-loser'), false);
  assertEquals(getRageQuitConfessionText('juice-box'), 'I need a juice box and a nap.');
  // Newer releases may add lines; older clients still render something.
  assertEquals(getRageQuitConfessionText('from-the-future'), "I can't handle losing.");
  assertEquals(getRageQuitReplyText('from-the-future'), 'Bye, Sucker!');
});

Deno.test('Each game assigns one stable confession per player', () => {
  const gameId = '6f0c2a54-1f9b-4d6e-9a43-5d8f0e7b2c11';
  const playerId = 'b3d1e9a2-7c44-4f0a-8e6b-2a9d5c1f7e30';
  const assigned = assignRageQuitConfession(gameId, playerId);

  assertEquals(isRageQuitConfessionId(assigned), true);
  assertEquals(assignRageQuitConfession(gameId, playerId), assigned);

  // Across many games every confession comes up, so nobody can count on a mild one.
  const seen = new Set<string>();
  for (let index = 0; index < 500; index += 1) {
    seen.add(assignRageQuitConfession(`game-${index}`, playerId));
  }
  assertEquals(seen.size, rageQuitConfessions.length);
});

Deno.test('The salt badge lasts 24 hours', () => {
  const quitAt = Date.parse('2026-10-16T12:00:00Z');
  const iso = new Date(quitAt).toISOString();

  assertEquals(isSaltyAt(iso, quitAt), true);
  assertEquals(isSaltyAt(iso, quitAt + rageQuitSaltDurationMs - 1), true);
  assertEquals(isSaltyAt(iso, quitAt + rageQuitSaltDurationMs), false);
  assertEquals(isSaltyAt(null, quitAt), false);
  assertEquals(isSaltyAt('not a date', quitAt), false);
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
