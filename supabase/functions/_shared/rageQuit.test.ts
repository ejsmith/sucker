import {
  canPlayOut,
  createGame,
  getWinnerId,
  isPlayingOut,
  isRageQuitUnlocked,
  rageQuitGame,
  startPlayOut,
  toGameState,
  type GameState,
} from './game.ts';
import {
  getRageQuitReplyText,
  isRageQuitReplyId,
  isSaltyAt,
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
        scorecard: { ...game.players[0].scorecard, chance: 30, ones: 2, sucker: 50 },
        suckerTokens: 7,
      },
      {
        ...game.players[1],
        revengePunchDiscount: 1,
        scorecard: { ...game.players[1].scorecard, ones: 1, threes: 9, twos: 4 },
      },
    ],
    rollNumber: 2,
  };
}

Deno.test('Rage Quit ends the game for the opponent even when the quitter leads', () => {
  const game = leadingGame();
  const quit = rageQuitGame(game, game.players[0].id);

  assertEquals(quit.phase, 'complete');
  assertEquals(quit.rageQuit?.playerId, game.players[0].id);
  assertEquals(getWinnerId(quit), game.players[1].id);
  assertEquals(getWinnerId(game), game.players[0].id);
});

Deno.test('Rage Quit gives the quitter nothing back', () => {
  const game = leadingGame();
  const quit = rageQuitGame(game, game.players[0].id);

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
  const quit = rageQuitGame(game, game.players[1].id);

  assertThrows(() => rageQuitGame(quit, game.players[0].id), 'already over');
  assertThrows(() => rageQuitGame(game, 'stranger'), 'not in this game');
});

Deno.test('Rage Quit stays locked until the quitter has filled 3 boxes', () => {
  const fresh = createGame(['Quitter', 'Stayer']);
  const quitter = fresh.players[0];
  assertEquals(isRageQuitUnlocked(fresh, quitter.id), false);
  assertThrows(() => rageQuitGame(fresh, quitter.id), 'Too soon');

  const withBoxes = (scorecard: Partial<GameState['players'][number]['scorecard']>): GameState => ({
    ...fresh,
    players: [{ ...quitter, scorecard: { ...quitter.scorecard, ...scorecard } }, fresh.players[1]],
  });
  assertEquals(isRageQuitUnlocked(withBoxes({ ones: 3, twos: 0 }), quitter.id), false);
  // Scratches fill boxes too.
  const unlocked = withBoxes({ ones: 3, twos: 0, sucker: 0 });
  assertEquals(isRageQuitUnlocked(unlocked, quitter.id), true);
  assertEquals(rageQuitGame(unlocked, quitter.id).rageQuit?.playerId, quitter.id);
  // Only the quitter's own card counts.
  assertEquals(isRageQuitUnlocked(unlocked, fresh.players[1].id), false);
});

Deno.test('The winner may finish their card alone, and the result stays settled', () => {
  const game = leadingGame();
  const [quitter, stayer] = game.players;
  const quit = rageQuitGame(game, quitter.id);

  assertEquals(canPlayOut(quit, stayer.id), true);
  assertEquals(canPlayOut(quit, quitter.id), false);
  assertThrows(() => startPlayOut(quit, quitter.id), 'no card left');
  assertEquals(canPlayOut(game, stayer.id), false);

  const playing = startPlayOut({ ...quit, dice: [6, 6, 6, 6, 2], rollNumber: 3 }, stayer.id);
  assertEquals(playing.phase, 'rolling');
  assertEquals(playing.currentPlayerIndex, 1);
  assertEquals(playing.rollNumber, 0);
  assertEquals(playing.dice.join(), '1,1,1,1,1');
  assertEquals(isPlayingOut(playing), true);
  assertEquals(getWinnerId(playing), stayer.id);
  assertEquals(canPlayOut(playing, stayer.id), false);
  assertEquals(toGameState(playing).rageQuit?.playOut, 'playing');

  // A full card has nothing left to finish.
  const fullCard = {
    ...quit,
    players: [
      quit.players[0],
      { ...stayer, scorecard: Object.fromEntries(Object.keys(stayer.scorecard).map((key) => [key, 1])) },
    ],
  } as GameState;
  assertEquals(canPlayOut(fullCard, stayer.id), false);
});

Deno.test('Stored rage quits survive parsing and reject impossible quitters', () => {
  const game = leadingGame();
  const quit = { ...rageQuitGame(game, game.players[0].id) };
  const replied = { ...quit, rageQuit: { ...quit.rageQuit!, replyId: 'bye-sucker' } };

  assertEquals(toGameState(quit).rageQuit?.playerId, game.players[0].id);
  assertEquals(toGameState(replied).rageQuit?.replyId, 'bye-sucker');
  assertEquals(toGameState(game).rageQuit, undefined);
  assertThrows(() => toGameState({ ...quit, rageQuit: { ...quit.rageQuit, playerId: 'stranger' } }), 'rage quit');
  assertThrows(() => toGameState({ ...quit, rageQuit: { ...quit.rageQuit, replyId: 5 } }), 'rage quit');
  assertThrows(() => toGameState({ ...quit, rageQuit: 'yes' }), 'rage quit');
  assertEquals(
    toGameState({ ...quit, rageQuit: { ...quit.rageQuit, playOut: 'finished' } }).rageQuit?.playOut,
    'finished',
  );
  assertThrows(() => toGameState({ ...quit, rageQuit: { ...quit.rageQuit, playOut: 'later' } }), 'play-out');
});

Deno.test('Replies are a fixed list with stable ids', () => {
  assertEquals(new Set(rageQuitReplies.map((reply) => reply.id)).size, rageQuitReplies.length);
  assertEquals(isRageQuitReplyId('bye-sucker'), true);
  assertEquals(isRageQuitReplyId('Bye, Sucker!'), false);
  // Newer releases may add replies; older clients still render something.
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
