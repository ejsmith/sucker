import { createGame, type Player } from './game.ts';
import { buildCompletedPlayerFeats, featCatalog, featKeys } from './feats.ts';
import { buildCompletedPlayerStats, type SuckerStatAction } from './stats.ts';

Deno.test('every feat key fits the database feat_key format', () => {
  for (const key of featKeys) {
    assertEquals(/^[a-z0-9_]{1,40}$/.test(key), true, key);
    assertEquals(featCatalog[key].name.length > 0, true, key);
  }
});

Deno.test('landed punch feats read chance, revenge, and counterpunch cost', () => {
  const feats = featsFor('player', [
    punch('player', { landed: true, chanceDie: 1, tokenCost: 3 }),
    punch('player', { landed: true, chanceDie: 4, isRevengePunch: true, tokenCost: 2 }),
    punch('player', { landed: true, chanceDie: 5, isCounterPunch: true, tokenCost: 1 }),
  ]);

  assertEquals(feats.includes('one_inch_punch'), true);
  assertEquals(feats.includes('revenge_is_sweet'), true);
  assertEquals(feats.includes('counter_culture'), true);
});

Deno.test('missed punches and opponent punches never award punch feats', () => {
  const feats = featsFor('player', [
    punch('player', { landed: false, chanceDie: 1, isRevengePunch: true }),
    punch('player', { landed: true, chanceDie: 5, isCounterPunch: true, tokenCost: 2 }),
    punch('opponent', { landed: true, chanceDie: 1, targetPlayerId: 'player' }),
  ]);

  assertEquals(feats.includes('one_inch_punch'), false);
  assertEquals(feats.includes('revenge_is_sweet'), false);
  assertEquals(feats.includes('counter_culture'), false);
});

Deno.test('Natural counts only the first roll since the last submission, Mulligan, or landed punch', () => {
  const sucker = [6, 6, 6, 6, 6];
  assertEquals(featsFor('player', [roll('player', sucker)]).includes('natural'), true);
  assertEquals(
    featsFor('player', [roll('player', [1, 2, 3, 4, 5]), roll('player', sucker)]).includes('natural'),
    false,
  );
  assertEquals(
    featsFor('player', [
      roll('player', [1, 2, 3, 4, 5]),
      { action_type: 'mulligan', actor_id: 'player' },
      roll('player', sucker),
    ]).includes('natural'),
    true,
  );
  assertEquals(
    featsFor('player', [
      roll('player', [1, 2, 3, 4, 5]),
      { action_type: 'score_category', actor_id: 'player' },
      punch('opponent', { landed: true, targetPlayerId: 'player' }),
      roll('player', sucker),
    ]).includes('natural'),
    true,
  );
  assertEquals(
    featsFor('player', [
      roll('opponent', [1, 1, 1, 1, 2]),
      roll('player', [1, 1, 1, 1, 2]),
      roll('opponent', sucker),
    ]).includes('natural'),
    false,
  );
});

Deno.test('Bought It requires five of a kind on a roll past the standard four', () => {
  const misses = [1, 2, 3, 4, 5].map(() => roll('player', [1, 2, 3, 4, 6]));
  const standard = misses.slice(0, 3);
  assertEquals(featsFor('player', [...standard, roll('player', [2, 2, 2, 2, 2])]).includes('bought_it'), false);
  assertEquals(
    featsFor('player', [
      ...misses.slice(0, 4),
      { action_type: 'extra_roll', actor_id: 'player' },
      roll('player', [2, 2, 2, 2, 2]),
    ]).includes('bought_it'),
    true,
  );
});

Deno.test('winning feats require a win and read the final scorecard and spending', () => {
  const winner = featsFor('player', [], { winnerId: 'player', scorecard: { sucker: 0 } });
  assertEquals(winner.includes('penny_pincher'), true);
  assertEquals(winner.includes('deal_with_the_devil'), true);

  const loser = featsFor('player', [], { winnerId: 'opponent', scorecard: { sucker: 0 } });
  assertEquals(loser.includes('penny_pincher'), false);
  assertEquals(loser.includes('deal_with_the_devil'), false);

  const extraRolls = Array.from({ length: 10 }, () => ({ action_type: 'extra_roll' as const, actor_id: 'player' }));
  const spender = featsFor('player', extraRolls, { winnerId: 'player' });
  assertEquals(spender.includes('high_roller'), true);
  assertEquals(spender.includes('penny_pincher'), false);

  const chin = featsFor(
    'player',
    [
      punch('opponent', { landed: true, targetPlayerId: 'player' }),
      punch('opponent', { landed: true, targetPlayerId: 'player' }),
    ],
    { winnerId: 'player' },
  );
  assertEquals(chin.includes('iron_chin'), true);
});

Deno.test('Upper Crust and Sucker Supreme read base upper scores and bonus categories', () => {
  const feats = featsFor('player', [], {
    scorecard: { ones: 3, twos: 6, threes: 9, fours: 12, fives: 65, sixes: 18 },
    suckerBonusCategories: ['fives', 'chance'],
  });
  assertEquals(feats.includes('upper_crust'), true);
  assertEquals(feats.includes('sucker_supreme'), true);

  const short = featsFor('player', [], {
    scorecard: { ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 },
    suckerBonusCategories: ['fives'],
  });
  assertEquals(short.includes('upper_crust'), false);
  assertEquals(short.includes('sucker_supreme'), false);
});

function featsFor(
  playerId: string,
  actions: SuckerStatAction[],
  {
    scorecard = {},
    suckerBonusCategories = [],
    winnerId = null,
  }: {
    scorecard?: Partial<Player['scorecard']>;
    suckerBonusCategories?: Player['suckerBonusCategories'];
    winnerId?: string | null;
  } = {},
) {
  const game = createGame(['Player', 'Opponent']);
  const players: Player[] = game.players.map((player, index) => ({
    ...player,
    id: index === 0 ? 'player' : 'opponent',
  }));
  const player = {
    ...players.find((candidate) => candidate.id === playerId)!,
    scorecard: { ...players[0].scorecard, ...scorecard },
    suckerBonusCategories,
  };
  const opponent = players.find((candidate) => candidate.id !== playerId)!;
  const result = buildCompletedPlayerStats({
    actions,
    gameId: 'game',
    opponent,
    player,
    players: [player, opponent],
    turns: [],
    winnerId,
  });
  return buildCompletedPlayerFeats({ actions, player, result });
}

function punch(actorId: string, payload: Record<string, unknown>): SuckerStatAction {
  return {
    action_type: 'sucker_punch',
    actor_id: actorId,
    payload: { targetPlayerId: actorId === 'player' ? 'opponent' : 'player', ...payload },
  };
}

function roll(actorId: string, dice: number[]): SuckerStatAction {
  return { action_type: 'roll', actor_id: actorId, payload: { dice } };
}

function assertEquals<T>(actual: T, expected: T, label = '') {
  if (actual !== expected) {
    throw new Error(`${label ? `${label}: ` : ''}Expected ${String(expected)}, received ${String(actual)}`);
  }
}
