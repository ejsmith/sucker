import { createGame, type Player } from './game.ts';
import { calculateSuckerActionStats, didPlayerPullAheadOnFinalTurn, type SuckerStatTurn } from './stats.ts';

Deno.test('Sucker Punch stats separate throws from landed punches', () => {
  const stats = calculateSuckerActionStats(
    [
      { action_type: 'sucker_punch', actor_id: 'player', payload: { landed: true } },
      { action_type: 'sucker_punch', actor_id: 'player', payload: { landed: false } },
      { action_type: 'sucker_punch', actor_id: 'player', payload: {} },
    ],
    'player',
  );

  assertEquals(stats.sucker_punches_used, 3);
  assertEquals(stats.sucker_punches_landed, 2);
});

Deno.test('Buzzer Beater requires the player to take the lead on their final valid turn', () => {
  const players = createPlayers();
  const turns: SuckerStatTurn[] = [
    turn(1, 'player', 'ones', 3),
    turn(2, 'opponent', 'ones', 6),
    turn(3, 'player', 'chance', 10),
  ];

  assertEquals(didPlayerPullAheadOnFinalTurn(turns, players, 'player'), true);
});

Deno.test('Buzzer Beater does not count when the player was already ahead before their final turn', () => {
  const players = createPlayers();
  const turns: SuckerStatTurn[] = [
    turn(1, 'player', 'ones', 3),
    turn(2, 'opponent', 'ones', 1),
    turn(3, 'player', 'chance', 10),
  ];

  assertEquals(didPlayerPullAheadOnFinalTurn(turns, players, 'player'), false);
});

Deno.test('Buzzer Beater ignores a punched score and uses the replayed final turn', () => {
  const players = createPlayers();
  const turns: SuckerStatTurn[] = [
    turn(1, 'player', 'ones', 1),
    turn(2, 'opponent', 'ones', 6),
    { ...turn(3, 'player', 'chance', 20), status: 'punched' },
    turn(4, 'player', 'chance', 10),
  ];

  assertEquals(didPlayerPullAheadOnFinalTurn(turns, players, 'player'), true);
});

function createPlayers(): Player[] {
  return createGame(['Player', 'Opponent']).players.map((player, index) => ({
    ...player,
    id: index === 0 ? 'player' : 'opponent',
  }));
}

function turn(
  turn_index: number,
  player_id: string,
  category: SuckerStatTurn['category'],
  score: number,
): SuckerStatTurn {
  return { category, player_id, score, status: 'finalized', turn_index };
}

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
