import { createGame, getWinnerId, rageQuitGame, toGameState, type GameState } from './game.ts';
import {
  getRageQuitLastWordsText,
  getRageQuitReplyText,
  isRageQuitLastWordsId,
  isRageQuitReplyId,
  isSaltyAt,
  rageQuitLastWords,
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
  const quit = rageQuitGame(game, game.players[0].id, 'cat-rolled');

  assertEquals(quit.phase, 'complete');
  assertEquals(quit.rageQuit?.playerId, game.players[0].id);
  assertEquals(quit.rageQuit?.lastWordsId, 'cat-rolled');
  assertEquals(getWinnerId(quit), game.players[1].id);
  assertEquals(getWinnerId(game), game.players[0].id);
});

Deno.test('Rage Quit gives the quitter nothing back', () => {
  const game = leadingGame();
  const quit = rageQuitGame(game, game.players[0].id, 'rigged');

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
  const quit = rageQuitGame(game, game.players[1].id, 'ill-be-back');

  assertThrows(() => rageQuitGame(quit, game.players[0].id, 'rigged'), 'already over');
  assertThrows(() => rageQuitGame(game, 'stranger', 'rigged'), 'not in this game');
});

Deno.test('Stored rage quits survive parsing and reject impossible quitters', () => {
  const game = leadingGame();
  const quit = { ...rageQuitGame(game, game.players[0].id, 'phone-died') };
  const replied = { ...quit, rageQuit: { ...quit.rageQuit!, replyId: 'bye-sucker' } };

  assertEquals(toGameState(quit).rageQuit?.lastWordsId, 'phone-died');
  assertEquals(toGameState(replied).rageQuit?.replyId, 'bye-sucker');
  assertEquals(toGameState(game).rageQuit, undefined);
  assertThrows(() => toGameState({ ...quit, rageQuit: { ...quit.rageQuit, playerId: 'stranger' } }), 'rage quit');
  assertThrows(() => toGameState({ ...quit, rageQuit: { ...quit.rageQuit, replyId: 5 } }), 'rage quit');
  assertThrows(() => toGameState({ ...quit, rageQuit: 'yes' }), 'rage quit');
});

Deno.test('Rage Quit lines are a fixed list with stable ids', () => {
  assertEquals(new Set(rageQuitLastWords.map((line) => line.id)).size, rageQuitLastWords.length);
  assertEquals(new Set(rageQuitReplies.map((reply) => reply.id)).size, rageQuitReplies.length);
  assertEquals(isRageQuitLastWordsId('cat-rolled'), true);
  assertEquals(isRageQuitLastWordsId('My cat rolled those.'), false);
  assertEquals(isRageQuitReplyId('bye-sucker'), true);
  assertEquals(isRageQuitReplyId('cat-rolled'), false);
  assertEquals(getRageQuitLastWordsText('cat-rolled'), 'My cat rolled those.');
  // Newer releases may add lines; older clients still render something.
  assertEquals(getRageQuitLastWordsText('from-the-future'), 'I quit.');
  assertEquals(getRageQuitReplyText('from-the-future'), 'Bye, Sucker!');
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
