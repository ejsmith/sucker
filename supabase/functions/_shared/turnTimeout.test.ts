import { createGame, getForfeiterId, getWinnerId, timeOutGame, toGameState, type GameState } from './game.ts';
import {
  buildTurnTimeoutNotification,
  buildTurnTimeoutWarning,
  hasTurnTimedOut,
  isInactivitySweepAuthorized,
  turnTimeoutMs,
  turnTimeoutRequestId,
} from './turnTimeout.ts';

function leadingGame(): GameState {
  const game = createGame(['Sleeper', 'Waiter']);
  return {
    ...game,
    counterPunchCost: 2,
    counterPunchPlayerId: game.players[1].id,
    players: [
      { ...game.players[0], revengePunchDiscount: 1, scorecard: { ...game.players[0].scorecard, chance: 30 } },
      game.players[1],
    ],
  };
}

Deno.test('A timeout hands the win to the opponent and is not a rage quit', () => {
  const game = leadingGame();
  const timedOut = timeOutGame(game, game.players[0].id);

  assertEquals(timedOut.phase, 'complete');
  assertEquals(timedOut.timedOut?.playerId, game.players[0].id);
  assertEquals(timedOut.rageQuit, undefined);
  assertEquals(getForfeiterId(timedOut), game.players[0].id);
  assertEquals(getWinnerId(timedOut), game.players[1].id);
  assertEquals(timedOut.counterPunchPlayerId, undefined);
  assertEquals(timedOut.players[0].revengePunchDiscount, undefined);
  assertEquals(timedOut.players[0].scorecard.chance, 30);
  assertThrows(() => timeOutGame(timedOut, game.players[1].id), 'already over');
  assertThrows(() => timeOutGame(game, 'stranger'), 'not in this game');
});

Deno.test('Stored timeouts survive parsing and reject impossible players', () => {
  const game = leadingGame();
  const timedOut = timeOutGame(game, game.players[0].id);

  assertEquals(toGameState(timedOut).timedOut?.playerId, game.players[0].id);
  assertEquals(toGameState(game).timedOut, undefined);
  assertThrows(() => toGameState({ ...timedOut, timedOut: { playerId: 'stranger' } }), 'timeout');
  assertThrows(() => toGameState({ ...timedOut, timedOut: 'yes' }), 'timeout');
});

Deno.test('A turn times out exactly 30 days after it began', () => {
  const startedAt = '2026-10-01T12:00:00.000Z';
  const deadline = Date.parse(startedAt) + turnTimeoutMs;

  assertEquals(turnTimeoutMs, 30 * 24 * 60 * 60 * 1_000);
  assertEquals(hasTurnTimedOut(startedAt, deadline - 1), false);
  assertEquals(hasTurnTimedOut(startedAt, deadline), true);
  assertEquals(hasTurnTimedOut(null, deadline), false);
  assertEquals(hasTurnTimedOut('not a date', deadline), false);
});

Deno.test('Each turn has one stable forfeit request id', async () => {
  const gameId = crypto.randomUUID();
  const first = await turnTimeoutRequestId(gameId, '2026-10-01T12:00:00+00:00');

  assertEquals(first, await turnTimeoutRequestId(gameId, '2026-10-01T12:00:00+00:00'));
  assertEquals(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(first), true);
  assertEquals(first === (await turnTimeoutRequestId(gameId, '2026-10-02T12:00:00+00:00')), false);
  assertEquals(first === (await turnTimeoutRequestId(crypto.randomUUID(), '2026-10-01T12:00:00+00:00')), false);
});

Deno.test('The sweep accepts only the configured secret', async () => {
  assertEquals(await isInactivitySweepAuthorized('s3cret', 's3cret'), true);
  assertEquals(await isInactivitySweepAuthorized('s3cre', 's3cret'), false);
  assertEquals(await isInactivitySweepAuthorized(null, 's3cret'), false);
  assertEquals(await isInactivitySweepAuthorized('', ''), false);
});

Deno.test('Timeout pushes name who ran out of time', () => {
  assertEquals(buildTurnTimeoutNotification('Bob', 'Alice', false).body, 'Bob ran out of time — you win.');
  assertEquals(buildTurnTimeoutNotification('Bob', 'Alice', true).body, 'You ran out of time against Alice.');
  assertEquals(buildTurnTimeoutWarning('Alice', 7).body, 'Play your turn against Alice within 7 days, or you forfeit.');
  assertEquals(buildTurnTimeoutWarning('Alice', 1).body, 'Play your turn against Alice within a day, or you forfeit.');
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
