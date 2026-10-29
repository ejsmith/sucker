import { createGame, type Player } from './game.ts';
import {
  buildCompletedPlayerFeats,
  buildInstantPlayerFeats,
  featCatalog,
  featKeys,
  instantFeatKeys,
  mayEarnInstantFeat,
} from './feats.ts';
import { buildCompletedPlayerStats, type SuckerStatAction, type SuckerStatTurn } from './stats.ts';

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

Deno.test('Walk-Off and Last Gasp need the game-ending turn to turn a deficit into a win', () => {
  const turns = [turn(1, 'player', 'ones', 3), turn(2, 'opponent', 'chance', 30), turn(3, 'player', 'chance', 28)];
  const board = { opponentScorecard: { chance: 30 }, scorecard: { ones: 3, chance: 28 }, turns };
  const fourRolls = [1, 2, 3, 4].map(() => roll('player', [1, 2, 3, 4, 6]));
  const rolledOut = featsFor('player', [roll('player', [1, 1, 1, 2, 3]), scored('player', 'ones'), ...fourRolls], {
    ...board,
    winnerId: 'player',
  });
  assertEquals(rolledOut.includes('walk_off'), true);
  assertEquals(rolledOut.includes('last_gasp'), true);
  assertEquals(rolledOut.includes('photo_finish'), true);

  // The same, with the game-ending submission included as the Edge Function now loads it.
  const submitted = featsFor(
    'player',
    [roll('player', [1, 1, 1, 2, 3]), scored('player', 'ones'), ...fourRolls, scored('player', 'chance')],
    { ...board, winnerId: 'player' },
  );
  assertEquals(submitted.includes('last_gasp'), true);

  const early = featsFor('player', [roll('player', [1, 2, 3, 4, 6]), roll('player', [1, 2, 3, 4, 6])], {
    ...board,
    winnerId: 'player',
  });
  assertEquals(early.includes('walk_off'), true);
  assertEquals(early.includes('last_gasp'), false);

  // The mirror image for the player who was walked off.
  const victim = featsFor('opponent', [], {
    opponentScorecard: { ones: 3, chance: 28 },
    scorecard: { chance: 30 },
    turns,
    winnerId: 'player',
  });
  assertEquals(victim.includes('walked_off'), true);
  assertEquals(victim.includes('heartbreaker'), true);
});

Deno.test('Comeback Kid and Choke Artist need a 100-point swing, more than one Sucker', () => {
  const turns = [
    turn(1, 'opponent', 'sucker', 50),
    turn(2, 'player', 'ones', 0),
    turn(3, 'opponent', 'fourOfAKind', 30),
    turn(4, 'player', 'twos', 0),
    turn(5, 'opponent', 'chance', 25),
    turn(6, 'player', 'largeStraight', 40),
    turn(7, 'player', 'smallStraight', 30),
    turn(8, 'player', 'fullHouse', 25),
    turn(9, 'player', 'sucker', 50),
  ];
  const playerCard = { ones: 0, twos: 0, largeStraight: 40, smallStraight: 30, fullHouse: 25, sucker: 50 };
  const opponentCard = { sucker: 50, fourOfAKind: 30, chance: 25 };
  const winner = featsFor('player', [], {
    opponentScorecard: opponentCard,
    scorecard: playerCard,
    turns,
    winnerId: 'player',
  });
  assertEquals(winner.includes('comeback_kid'), true);
  const choker = featsFor('opponent', [], {
    opponentScorecard: playerCard,
    scorecard: opponentCard,
    turns,
    winnerId: 'player',
  });
  assertEquals(choker.includes('choke_artist'), true);

  // Trailing by one Sucker and change is not a comeback.
  const smallTurns = [
    turn(1, 'opponent', 'sucker', 50),
    turn(2, 'player', 'chance', 25),
    turn(3, 'player', 'sucker', 50),
  ];
  const small = featsFor('player', [], {
    opponentScorecard: { sucker: 50 },
    scorecard: { chance: 25, sucker: 50 },
    turns: smallTurns,
    winnerId: 'player',
  });
  assertEquals(small.includes('comeback_kid'), false);
});

Deno.test('Sucker chases reward landing it and shame missing, especially when it empties the bank', () => {
  const miss = [1, 2, 3, 4, 5].map(() => roll('player', [6, 6, 6, 6, 1]));
  const chase = [hunt('player'), miss[0], hunt('player'), miss[1], hunt('player'), miss[2]];
  const missed = featsFor('player', [...chase, scored('player', 'fourOfAKind')]);
  assertEquals(missed.includes('sucker_born_every_minute'), true);
  assertEquals(missed.includes('all_in_all_gone'), false);

  const landed = featsFor('player', [
    ...chase,
    hunt('player'),
    roll('player', [6, 6, 6, 6, 6]),
    scored('player', 'sucker'),
  ]);
  assertEquals(landed.includes('worth_every_penny'), true);
  assertEquals(landed.includes('sucker_born_every_minute'), false);

  // Two Mulligans leave 4 tokens; four hunts spend the rest.
  const mulligan: SuckerStatAction = { action_type: 'mulligan', actor_id: 'player' };
  const broke = featsFor('player', [mulligan, mulligan, ...chase, hunt('player'), miss[3], scored('player', 'chance')]);
  assertEquals(broke.includes('all_in_all_gone'), true);
  assertEquals(broke.includes('sucker_born_every_minute'), true);

  // A Mulligan starts the dice over, so a later Sucker does not rescue the earlier chase.
  const restarted = featsFor('player', [
    ...chase,
    mulligan,
    roll('player', [6, 6, 6, 6, 6]),
    scored('player', 'sucker'),
  ]);
  assertEquals(restarted.includes('sucker_born_every_minute'), true);
  assertEquals(restarted.includes('worth_every_penny'), false);

  // Two hunts are a normal gamble, not a defeat.
  const modest = featsFor('player', [hunt('player'), miss[0], hunt('player'), miss[1], scored('player')]);
  assertEquals(modest.includes('sucker_born_every_minute'), false);
});

Deno.test('Bought a Goose Egg needs 3+ tokens spent in one turn and a zero to show for it', () => {
  const extraRoll: SuckerStatAction = { action_type: 'extra_roll', actor_id: 'player' };
  const mulligan: SuckerStatAction = { action_type: 'mulligan', actor_id: 'player' };
  const zero: SuckerStatAction = {
    action_type: 'score_category',
    actor_id: 'player',
    payload: { category: 'sucker', score: 0 },
  };
  const paid: SuckerStatAction = {
    action_type: 'score_category',
    actor_id: 'player',
    payload: { category: 'chance', score: 22 },
  };

  assertEquals(featsFor('player', [extraRoll, extraRoll, extraRoll, zero]).includes('bought_a_goose_egg'), true);
  assertEquals(featsFor('player', [mulligan, scratched('player', 'ones')]).includes('bought_a_goose_egg'), true);
  assertEquals(featsFor('player', [extraRoll, extraRoll, extraRoll, paid]).includes('bought_a_goose_egg'), false);
  assertEquals(featsFor('player', [extraRoll, extraRoll, zero]).includes('bought_a_goose_egg'), false);
  // Spending in an earlier turn does not carry over.
  assertEquals(featsFor('player', [extraRoll, extraRoll, paid, extraRoll, zero]).includes('bought_a_goose_egg'), false);

  // The game-ending turn's zero comes from its turn row.
  const finalZero = featsFor('player', [mulligan], {
    turns: [turn(1, 'opponent', 'chance', 20), turn(2, 'player', 'sucker', 0)],
  });
  assertEquals(finalZero.includes('bought_a_goose_egg'), true);
});

Deno.test('punch defeats cover whiffs, sure-thing misses, and counterpunch boomerangs', () => {
  const whiffs = featsFor('player', [
    punch('player', { landed: false, chanceDie: 2 }),
    punch('player', { landed: false, chanceDie: 6 }),
    punch('player', { landed: false, chanceDie: 3 }),
  ]);
  assertEquals(whiffs.includes('whiff_city'), true);
  assertEquals(whiffs.includes('cant_miss_missed'), true);

  const boomerang = featsFor('player', [
    punch('player', { landed: false, chanceDie: 4 }),
    punch('opponent', { landed: true, isCounterPunch: true, targetPlayerId: 'player' }),
  ]);
  assertEquals(boomerang.includes('boomerang'), true);
  assertEquals(boomerang.includes('whiff_city'), false);

  const dodged = featsFor('player', [
    punch('player', { landed: false, chanceDie: 4 }),
    punch('opponent', { landed: false, isCounterPunch: true, targetPlayerId: 'player' }),
  ]);
  assertEquals(dodged.includes('boomerang'), false);
});

Deno.test('scorecard defeats read the final card and the Sucker Deal history', () => {
  const remorse = featsFor('player', [scratched('player', 'sucker'), roll('player', [3, 3, 3, 3, 3])]);
  assertEquals(remorse.includes('buyers_remorse'), true);
  const luckyFirst = featsFor('player', [roll('player', [3, 3, 3, 3, 3]), scratched('player', 'sucker')]);
  assertEquals(luckyFirst.includes('buyers_remorse'), false);

  const close = featsFor('player', [], { scorecard: { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 16 } });
  assertEquals(close.includes('so_close'), true);

  const scratches = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].map((category) =>
    scratched('player', category),
  );
  assertEquals(featsFor('player', scratches).includes('scratch_fever'), true);
  assertEquals(featsFor('player', scratches.slice(1)).includes('scratch_fever'), false);
});

Deno.test('losing defeats need a loss, and ties award neither feats nor defeats for the result', () => {
  const blowout = { opponentScorecard: { chance: 30, sucker: 50 }, scorecard: { ones: 1 } };
  const loser = featsFor('player', [], { ...blowout, winnerId: 'opponent' });
  assertEquals(loser.includes('blown_out'), true);
  assertEquals(loser.includes('died_rich'), true);

  const tie = featsFor('player', [], { winnerId: null });
  assertEquals(tie.includes('heartbreaker'), false);
  assertEquals(tie.includes('photo_finish'), false);
  assertEquals(tie.includes('died_rich'), false);
});

Deno.test('instant feats are awarded mid-game, before anyone wins', () => {
  const instant = buildInstantPlayerFeats({
    actions: [punch('player', { landed: true, chanceDie: 1, tokenCost: 3 }), roll('player', [4, 4, 4, 4, 4])],
    opponentId: 'opponent',
    playerId: 'player',
  });
  assertEquals(instant.join(), 'one_inch_punch,natural');
  assertEquals(
    buildInstantPlayerFeats({
      actions: [punch('player', { landed: false, chanceDie: 4 })],
      opponentId: 'player',
      playerId: 'opponent',
    }).length,
    0,
  );
});

Deno.test('instant feats leave a turn in progress unsettled until it is submitted', () => {
  const miss = roll('player', [6, 6, 6, 6, 1]);
  const chase = [hunt('player'), miss, hunt('player'), miss, hunt('player'), miss];
  const instantFor = (actions: SuckerStatAction[]) =>
    buildInstantPlayerFeats({ actions, opponentId: 'opponent', playerId: 'player' });

  assertEquals(instantFor(chase).includes('sucker_born_every_minute'), false);
  assertEquals(instantFor([...chase, roll('player', [6, 6, 6, 6, 6])]).includes('worth_every_penny'), false);
  assertEquals(instantFor([...chase, scored('player', 'fourOfAKind')]).includes('sucker_born_every_minute'), true);
  assertEquals(
    instantFor([...chase, roll('player', [6, 6, 6, 6, 6]), scored('player', 'sucker')]).includes('worth_every_penny'),
    true,
  );
});

Deno.test('instant feats match what completion awards for the same history', () => {
  const miss = roll('player', [6, 6, 6, 6, 1]);
  const actions = [
    ...['ones', 'twos', 'threes', 'fours', 'fives', 'sucker'].map((category) => scratched('player', category)),
    roll('player', [2, 2, 2, 2, 2]),
    hunt('player'),
    miss,
    hunt('player'),
    miss,
    hunt('player'),
    miss,
    scored('player', 'chance'),
    punch('player', { landed: false, chanceDie: 6 }),
    punch('opponent', { landed: true, isCounterPunch: true, tokenCost: 1, targetPlayerId: 'player' }),
    punch('player', { landed: true, chanceDie: 1, isRevengePunch: true, tokenCost: 2 }),
  ];
  const instant = buildInstantPlayerFeats({ actions, opponentId: 'opponent', playerId: 'player' });
  const completed = featsFor('player', actions, { winnerId: 'player' }).filter((key) => instantFeatKeys.has(key));

  assertEquals(instant.join(), completed.join());
  assertEquals(instant.length >= 6, true, instant.join());
});

Deno.test('only punches, submissions, Mulligans, five of a kind, and first-roll patterns replay the game', () => {
  assertEquals(mayEarnInstantFeat(roll('player', [5, 5, 5, 5, 5]), 3), true);
  assertEquals(mayEarnInstantFeat(roll('player', [5, 5, 5, 5, 1]), 3), false);
  assertEquals(mayEarnInstantFeat(roll('player', [5, 5, 5, 5, 1]), 1), true);
  assertEquals(mayEarnInstantFeat(roll('player', [2, 3, 4, 5, 6]), 1), true);
  assertEquals(mayEarnInstantFeat(roll('player', [2, 3, 4, 5, 6]), 2), false);
  assertEquals(mayEarnInstantFeat(roll('player', [1, 2, 3, 4, 6]), 1), false);
  assertEquals(mayEarnInstantFeat(hunt('player'), 1), false);
  assertEquals(mayEarnInstantFeat(punch('player', { landed: false }), 0), true);
  assertEquals(mayEarnInstantFeat(scored('player'), 0), true);
  assertEquals(mayEarnInstantFeat(scratched('player', 'ones'), 0), true);
  assertEquals(mayEarnInstantFeat({ action_type: 'mulligan', actor_id: 'player' }, 0), true);
});

Deno.test('Sucker tiers count each run of rolls once, so a 6-Sucker game earns every tier up to Six Pack', () => {
  const sucker = (face: number) => roll('player', [face, face, face, face, face]);
  const sixSuckers = [1, 2, 3, 4, 5, 6].flatMap((face) => [sucker(face), scored('player')]);
  const six = featsFor('player', sixSuckers);
  for (const key of ['seeing_double', 'hat_trick', 'four_score', 'high_five', 'six_pack'] as const) {
    assertEquals(six.includes(key), true, key);
  }
  assertEquals(six.includes('lucky_seven'), false);

  // Rolling again with all five held, or buying another roll, is the same Sucker.
  const heldReroll = featsFor('player', [
    sucker(6),
    sucker(6),
    { action_type: 'extra_roll', actor_id: 'player' },
    sucker(6),
    scored('player'),
  ]);
  assertEquals(heldReroll.includes('seeing_double'), false);

  // A Mulligan starts the dice over, so a second Sucker after it counts.
  const mulligan: SuckerStatAction = { action_type: 'mulligan', actor_id: 'player' };
  assertEquals(featsFor('player', [sucker(6), mulligan, sucker(3)]).includes('seeing_double'), true);

  // The opponent's Suckers are theirs.
  const shared = featsFor('player', [sucker(6), scored('player'), roll('opponent', [2, 2, 2, 2, 2])]);
  assertEquals(shared.includes('seeing_double'), false);

  // The tiers are awarded mid-game, the moment the Sucker lands.
  const eight = buildInstantPlayerFeats({
    actions: [1, 2, 3, 4, 5, 6, 1, 2].flatMap((face) => [sucker(face), scored('player')]).slice(0, -1),
    opponentId: 'opponent',
    playerId: 'player',
  });
  assertEquals(eight.includes('crazy_eights'), true);
});

Deno.test('Back-to-Back and Anything You Can Do read the turn before', () => {
  const sucker = (actorId: string) => roll(actorId, [4, 4, 4, 4, 4]);
  const miss = (actorId: string) => roll(actorId, [4, 4, 4, 4, 1]);

  const streak = featsFor('player', [
    sucker('player'),
    scored('player'),
    miss('opponent'),
    scored('opponent'),
    sucker('player'),
  ]);
  assertEquals(streak.includes('back_to_back'), true);
  assertEquals(streak.includes('anything_you_can_do'), false);

  const gap = featsFor('player', [
    sucker('player'),
    scored('player'),
    miss('player'),
    scored('player'),
    sucker('player'),
  ]);
  assertEquals(gap.includes('back_to_back'), false);

  const answered = featsFor('player', [sucker('opponent'), scored('opponent'), miss('player'), sucker('player')]);
  assertEquals(answered.includes('anything_you_can_do'), true);
  assertEquals(answered.includes('back_to_back'), false);

  // Punching away the opponent's Sucker turn leaves their replay as the turn before.
  const erased = featsFor('player', [
    sucker('opponent'),
    scored('opponent', 'sucker'),
    punch('player', { landed: true }),
    miss('opponent'),
    scored('opponent'),
    sucker('player'),
  ]);
  assertEquals(erased.includes('anything_you_can_do'), false);

  // Mulliganing a submitted turn discards it, so its replay is the same turn again.
  const redone = buildInstantPlayerFeats({
    actions: [
      sucker('player'),
      scored('player', 'sucker'),
      { action_type: 'mulligan', actor_id: 'player', payload: { turnId: 'turn' } },
      sucker('player'),
    ],
    opponentId: 'opponent',
    playerId: 'player',
  });
  assertEquals(redone.includes('back_to_back'), false);
  assertEquals(redone.includes('seeing_double'), true);
  const theirs = featsFor('player', [
    sucker('opponent'),
    scored('opponent', 'sucker'),
    { action_type: 'mulligan', actor_id: 'opponent', payload: { turnId: 'turn' } },
    miss('opponent'),
    scored('opponent'),
    sucker('player'),
  ]);
  assertEquals(theirs.includes('anything_you_can_do'), false);
});

Deno.test('punching away a scored Sucker robs it, and a Sucker on the replay strikes twice', () => {
  const sucker = (actorId: string) => roll(actorId, [6, 6, 6, 6, 6]);
  const robbery = [
    sucker('opponent'),
    scored('opponent', 'sucker'),
    punch('player', { landed: true, chanceDie: 3 }),
    sucker('opponent'),
    scored('opponent', 'sucker'),
  ];
  assertEquals(featsFor('player', robbery).includes('daylight_robbery'), true);
  const victim = featsFor('opponent', robbery);
  assertEquals(victim.includes('sucker_punched'), true);
  assertEquals(victim.includes('lightning_strikes_twice'), true);
  // The replay is the same turn again, not a second turn in a row.
  assertEquals(victim.includes('back_to_back'), false);
  assertEquals(victim.includes('seeing_double'), true);

  // A missed punch, a scratched Sucker, or a later turn's Sucker does not count.
  const missed = [sucker('opponent'), scored('opponent', 'sucker'), punch('player', { landed: false })];
  assertEquals(featsFor('player', missed).includes('daylight_robbery'), false);
  assertEquals(featsFor('opponent', missed).includes('sucker_punched'), false);
  const scratchedSucker = [sucker('opponent'), scratched('opponent', 'sucker'), punch('player', { landed: true })];
  assertEquals(featsFor('player', scratchedSucker).includes('daylight_robbery'), false);
  const later = featsFor('opponent', [
    sucker('opponent'),
    scored('opponent', 'sucker'),
    punch('player', { landed: true }),
    roll('opponent', [1, 2, 3, 4, 6]),
    scored('opponent'),
    sucker('opponent'),
  ]);
  assertEquals(later.includes('sucker_punched'), true);
  assertEquals(later.includes('lightning_strikes_twice'), false);
});

Deno.test('Straight Out the Gate and Four on the Floor need the first roll of a turn', () => {
  assertEquals(featsFor('player', [roll('player', [3, 5, 2, 6, 4])]).includes('straight_out_the_gate'), true);
  assertEquals(featsFor('player', [roll('player', [1, 2, 3, 4, 5])]).includes('straight_out_the_gate'), true);
  assertEquals(
    featsFor('player', [roll('player', [1, 2, 3, 4, 4]), roll('player', [1, 2, 3, 4, 5])]).includes(
      'straight_out_the_gate',
    ),
    false,
  );
  assertEquals(featsFor('player', [roll('player', [2, 2, 5, 2, 2])]).includes('four_on_the_floor'), true);
  assertEquals(featsFor('player', [roll('player', [2, 2, 2, 2, 2])]).includes('four_on_the_floor'), false);
  assertEquals(
    featsFor('player', [roll('player', [2, 2, 5, 3, 2]), roll('player', [2, 2, 5, 2, 2])]).includes(
      'four_on_the_floor',
    ),
    false,
  );
  // A Mulligan or a new turn starts the count over.
  assertEquals(
    featsFor('player', [
      roll('player', [2, 2, 5, 3, 2]),
      { action_type: 'mulligan', actor_id: 'player' },
      roll('player', [2, 3, 4, 5, 6]),
    ]).includes('straight_out_the_gate'),
    true,
  );
  assertEquals(featsFor('opponent', [roll('player', [2, 3, 4, 5, 6])]).includes('straight_out_the_gate'), false);
});

Deno.test('every feat and defeat has a name, a tone, and a database-safe key', () => {
  for (const key of featKeys) {
    assertEquals(/^[a-z0-9_]{1,40}$/.test(key), true, key);
    assertEquals(featCatalog[key].name.length > 0, true, key);
    assertEquals(['feat', 'defeat'].includes(featCatalog[key].tone), true, key);
  }
});

function featsFor(
  playerId: string,
  actions: SuckerStatAction[],
  {
    opponentScorecard = {},
    scorecard = {},
    suckerBonusCategories = [],
    turns = [],
    winnerId = null,
  }: {
    opponentScorecard?: Partial<Player['scorecard']>;
    scorecard?: Partial<Player['scorecard']>;
    suckerBonusCategories?: Player['suckerBonusCategories'];
    turns?: SuckerStatTurn[];
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
  const opponentBase = players.find((candidate) => candidate.id !== playerId)!;
  const opponent = { ...opponentBase, scorecard: { ...opponentBase.scorecard, ...opponentScorecard } };
  const result = buildCompletedPlayerStats({
    actions,
    gameId: 'game',
    opponent,
    player,
    players: [player, opponent],
    turns,
    winnerId,
  });
  return buildCompletedPlayerFeats({ actions, opponent, player, result, turns, winnerId });
}

function turn(turnIndex: number, playerId: string, category: string, score: number): SuckerStatTurn {
  return { category, player_id: playerId, score, status: 'submitted', turn_index: turnIndex };
}

function scored(actorId: string, category = 'chance'): SuckerStatAction {
  return { action_type: 'score_category', actor_id: actorId, payload: { category, scratched: false } };
}

function scratched(actorId: string, category: string): SuckerStatAction {
  return { action_type: 'scratch_category', actor_id: actorId, payload: { category, scratched: true } };
}

function hunt(actorId: string): SuckerStatAction {
  return { action_type: 'extra_roll', actor_id: actorId, payload: { suckerHunt: true } };
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
