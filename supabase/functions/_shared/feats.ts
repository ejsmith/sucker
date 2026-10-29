import {
  createEmptyScorecard,
  extraSuckerBonusPoints,
  isSuckerRoll,
  maxRollsPerTurn,
  scoreCategory,
  startingSuckerTokens,
  suckerTokenCosts,
  toScoreCategory,
  totalScore,
  upperSectionBaseScore,
  type Dice,
  type Player,
  type ScoreCategory,
} from './game.ts';
import {
  comebackPointMargin,
  getEffectiveStatTurns,
  type buildCompletedPlayerStats,
  type SuckerStatAction,
  type SuckerStatTurn,
} from './stats.ts';

export type GameFeatKey =
  | 'one_inch_punch'
  | 'iron_chin'
  | 'revenge_is_sweet'
  | 'counter_culture'
  | 'flurry'
  | 'rope_a_dope'
  | 'thanks_i_needed_that'
  | 'penny_pincher'
  | 'high_roller'
  | 'deal_with_the_devil'
  | 'natural'
  | 'bought_it'
  | 'worth_every_penny'
  | 'do_over'
  | 'sucker_supreme'
  | 'seeing_double'
  | 'hat_trick'
  | 'four_score'
  | 'high_five'
  | 'six_pack'
  | 'lucky_seven'
  | 'crazy_eights'
  | 'back_to_back'
  | 'anything_you_can_do'
  | 'lightning_strikes_twice'
  | 'straight_out_the_gate'
  | 'four_on_the_floor'
  | 'daylight_robbery'
  | 'upper_crust'
  | 'comeback_kid'
  | 'wire_to_wire'
  | 'buzzer_beater'
  | 'walk_off'
  | 'last_gasp'
  | 'photo_finish'
  | 'dead_heat'
  | 'blowout'
  | 'club_400'
  | 'club_500'
  | 'spotless'
  | 'glass_jaw'
  | 'choke_artist'
  | 'walked_off'
  | 'heartbreaker'
  | 'blown_out'
  | 'double_digits'
  | 'whiff_city'
  | 'cant_miss_missed'
  | 'boomerang'
  | 'backfire'
  | 'sucker_punched'
  | 'died_rich'
  | 'money_pit'
  | 'sucker_born_every_minute'
  | 'all_in_all_gone'
  | 'bought_a_goose_egg'
  | 'buyers_remorse'
  | 'shouldve_kept_it'
  | 'so_close'
  | 'scratch_fever';

// Per-game feats the database awards when a game completes, because they need
// ratings or the game's timing. A Rage Quit awards none of them.
export type DatabaseGameFeatKey = 'giant_killer' | 'banana_peel' | 'blitz' | 'the_long_game';

// Milestones are awarded once by the database when a game completes, because
// they depend on a player's whole multiplayer history.
export type MilestoneFeatKey =
  | 'globetrotter_10'
  | 'globetrotter_25'
  | 'globetrotter_100'
  | 'welcome_wagon'
  | 'nemesis'
  | 'got_your_number'
  | 'centurion'
  | 'hot_streak'
  | 'on_fire'
  | 'sucker_collector'
  | 'ice_cold'
  | 'deep_freeze'
  | 'pigeon'
  | 'welcome_mat'
  | 'table_flipper'
  | 'glutton_for_punishment';

export type FeatKey = GameFeatKey | DatabaseGameFeatKey | MilestoneFeatKey;

export type FeatDefinition = {
  description: string;
  kind: 'game' | 'milestone';
  name: string;
  tone: 'feat' | 'defeat';
};

function feat(name: string, description: string, kind: FeatDefinition['kind'] = 'game'): FeatDefinition {
  return { description, kind, name, tone: 'feat' };
}

function defeat(name: string, description: string, kind: FeatDefinition['kind'] = 'game'): FeatDefinition {
  return { description, kind, name, tone: 'defeat' };
}

const closeGameMargin = 5;
const bigSpendTokens = 10;
const suckerChaseExtraRolls = 3;
const goodMoneyTokens = 3;
const doOverPoints = 20;

export const featCatalog: Record<FeatKey, FeatDefinition> = {
  one_inch_punch: feat('One-Inch Punch', 'Land a Sucker Punch on a 1 (10% chance).'),
  iron_chin: feat('Iron Chin', 'Win after taking 2 or more landed punches.'),
  revenge_is_sweet: feat('Revenge Is Sweet', 'Land a punch at the revenge discount.'),
  counter_culture: feat('Counter Culture', 'Land a counterpunch that cost 1 token.'),
  flurry: feat('Flurry', 'Land 3 or more Sucker Punches in one game.'),
  rope_a_dope: feat('Rope-a-Dope', 'Win after your opponent missed 3 or more punches at you.'),
  thanks_i_needed_that: feat('Thanks, I Needed That', 'Get punched, then outscore the erased turn on the replay.'),
  penny_pincher: feat('Penny Pincher', 'Win without spending a token.'),
  high_roller: feat('High Roller', 'Spend 10 or more tokens and win.'),
  deal_with_the_devil: feat('Deal With the Devil', 'Win with a zero in the Sucker box.'),
  natural: feat('Natural', 'Roll five of a kind on the first roll of a turn.'),
  bought_it: feat('Bought It', 'Roll five of a kind on a purchased Extra Roll.'),
  worth_every_penny: feat('Worth Every Penny', 'Buy 3 or more Extra Rolls chasing a Sucker in one turn, and land it.'),
  do_over: feat('Do-Over', `Mulligan a submitted turn and score ${doOverPoints} or more points higher on the redo.`),
  sucker_supreme: feat('Sucker Supreme', 'Score 2 extra Sucker bonuses in one game.'),
  seeing_double: feat('Seeing Double', 'Roll 2 Suckers in one game.'),
  hat_trick: feat('Hat Trick', 'Roll 3 Suckers in one game.'),
  four_score: feat('Four Score', 'Roll 4 Suckers in one game.'),
  high_five: feat('High Five', 'Roll 5 Suckers in one game.'),
  six_pack: feat('Six Pack', 'Roll 6 Suckers in one game.'),
  lucky_seven: feat('Lucky Seven', 'Roll 7 Suckers in one game.'),
  crazy_eights: feat('Crazy Eights', 'Roll 8 Suckers in one game.'),
  back_to_back: feat('Back-to-Back', 'Roll a Sucker on two of your turns in a row.'),
  anything_you_can_do: feat('Anything You Can Do', 'Roll a Sucker on the turn right after your opponent rolled one.'),
  lightning_strikes_twice: feat(
    'Lightning Strikes Twice',
    'Have a Sucker you scored punched away, then roll another on the replay.',
  ),
  straight_out_the_gate: feat('Straight Out the Gate', 'Roll a large straight on the first roll of a turn.'),
  four_on_the_floor: feat('Four on the Floor', 'Roll four of a kind on the first roll of a turn.'),
  daylight_robbery: feat('Daylight Robbery', 'Land a punch on a turn that scored a Sucker.'),
  upper_crust: feat('Upper Crust', 'Score at least three of every number in the upper section.'),
  comeback_kid: feat('Comeback Kid', `Win after trailing by ${comebackPointMargin} or more.`),
  wire_to_wire: feat('Wire to Wire', 'Lead after every turn from your first one, and win.'),
  buzzer_beater: feat('Buzzer Beater', 'Take the lead on your final turn and win.'),
  walk_off: feat('Walk-Off', "Trail going into the game's last turn, then take it and win."),
  last_gasp: feat('Last Gasp', 'Win a Walk-Off on the last roll you had.'),
  photo_finish: feat('Photo Finish', `Win by ${closeGameMargin} points or less.`),
  dead_heat: feat('Dead Heat', 'Finish a game tied.'),
  blowout: feat('Blowout', 'Win by 75 or more.'),
  club_400: feat('400 Club', 'Score 400 or more in one game.'),
  club_500: feat('500 Club', 'Score 500 or more in one game.'),
  spotless: feat('Spotless', 'Finish a game with no zeros or scratches.'),
  giant_killer: feat('Giant Killer', 'Beat someone rated 200 or more above you.'),
  blitz: feat('Blitz', 'Finish a game within an hour of its first roll.'),
  the_long_game: feat('The Long Game', 'Finish a game 30 or more days after its first roll.'),
  globetrotter_10: feat('Globetrotter', 'Beat 10 different opponents.', 'milestone'),
  globetrotter_25: feat('Globetrotter II', 'Beat 25 different opponents.', 'milestone'),
  globetrotter_100: feat('Globetrotter III', 'Beat 100 different opponents.', 'milestone'),
  welcome_wagon: feat(
    'Welcome Wagon',
    'Finish a game against someone in their first game, after 5 of your own.',
    'milestone',
  ),
  nemesis: feat('Nemesis', 'Complete 10 games against the same opponent.', 'milestone'),
  got_your_number: feat('Got Your Number', 'Beat the same opponent 5 games in a row.', 'milestone'),
  centurion: feat('Centurion', 'Complete 100 games.', 'milestone'),
  hot_streak: feat('Hot Streak', 'Win 5 games in a row.', 'milestone'),
  on_fire: feat('On Fire', 'Win 10 games in a row.', 'milestone'),
  sucker_collector: feat(
    'Sucker Collector',
    'Roll a Sucker of every number, 1 through 6, across your games.',
    'milestone',
  ),
  glass_jaw: defeat('Glass Jaw', 'Lose after taking 2 or more landed punches.'),
  choke_artist: defeat('Choke Artist', `Lose after leading by ${comebackPointMargin} or more.`),
  walked_off: defeat('Walked Off', "Lead going into your opponent's last turn, then lose on it."),
  heartbreaker: defeat('Heartbreaker', `Lose by ${closeGameMargin} points or less.`),
  blown_out: defeat('Blown Out', 'Lose by 75 or more.'),
  double_digits: defeat('Double Digits', 'Finish a game with under 100 points.'),
  banana_peel: defeat('Banana Peel', 'Lose to someone rated 200 or more below you.'),
  whiff_city: defeat('Whiff City', 'Miss 3 or more Sucker Punches in one game.'),
  cant_miss_missed: defeat("Can't Miss, Missed", 'Miss a Sucker Punch at 75% odds.'),
  boomerang: defeat('Boomerang', 'Miss a punch, then get hit by the counterpunch it handed them.'),
  backfire: defeat('Backfire', 'Land a punch, then watch the replay outscore the turn you erased.'),
  sucker_punched: defeat('Sucker Punched', 'Have a Sucker you scored punched away.'),
  died_rich: defeat('Died Rich', 'Lose with 10 or more tokens unspent.'),
  money_pit: defeat('Money Pit', 'Spend 10 or more tokens and still lose.'),
  sucker_born_every_minute: defeat(
    'Sucker Born Every Minute',
    'Buy 3 or more Extra Rolls chasing a Sucker in one turn, and miss.',
  ),
  all_in_all_gone: defeat('All In, All Gone', 'Spend every token chasing a Sucker in one turn, and miss.'),
  bought_a_goose_egg: defeat(
    'Bought a Goose Egg',
    'Spend 3 or more tokens in one turn and still walk away with a zero.',
  ),
  buyers_remorse: defeat("Buyer's Remorse", 'Sucker Deal your Sucker box, then roll five of a kind later that game.'),
  shouldve_kept_it: defeat("Should've Kept It", 'Mulligan a submitted turn and score less on the redo.'),
  so_close: defeat('So Close', 'Finish the upper section 1 to 3 points short of the bonus.'),
  scratch_fever: defeat('Scratch Fever', 'Scratch 6 or more categories in one game.'),
  ice_cold: defeat('Ice Cold', 'Lose 5 games in a row.', 'milestone'),
  deep_freeze: defeat('Deep Freeze', 'Lose 10 games in a row.', 'milestone'),
  pigeon: defeat('Pigeon', 'Lose 5 games in a row to the same opponent.', 'milestone'),
  welcome_mat: defeat('Welcome Mat', 'Lose to someone in their first game, after 5 of your own.', 'milestone'),
  table_flipper: defeat('Table Flipper', 'Rage quit 5 games.', 'milestone'),
  glutton_for_punishment: defeat('Glutton for Punishment', 'Lose 100 games and keep playing.', 'milestone'),
};

export const featKeys = Object.keys(featCatalog) as FeatKey[];

export function isFeatKey(value: string): value is FeatKey {
  return Object.prototype.hasOwnProperty.call(featCatalog, value);
}

type UpperCategory = Extract<ScoreCategory, 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'>;

const upperCategoryFaces: [UpperCategory, number][] = [
  ['ones', 1],
  ['twos', 2],
  ['threes', 3],
  ['fours', 4],
  ['fives', 5],
  ['sixes', 6],
];

const upperBonusThreshold = 63;

// Each tier is its own feat, so a 6-Sucker game earns every tier from 2 to 6.
const suckerCountFeats: [number, GameFeatKey][] = [
  [2, 'seeing_double'],
  [3, 'hat_trick'],
  [4, 'four_score'],
  [5, 'high_five'],
  [6, 'six_pack'],
  [7, 'lucky_seven'],
  [8, 'crazy_eights'],
];

// Feats settled the moment they happen, whatever the final score. The
// game-action function awards these mid-game; the rest wait for completion.
// Each one only ever turns on as more actions are replayed, so a later move
// cannot take one back.
export const instantFeatKeys: ReadonlySet<GameFeatKey> = new Set<GameFeatKey>([
  'one_inch_punch',
  'revenge_is_sweet',
  'counter_culture',
  'flurry',
  'thanks_i_needed_that',
  'backfire',
  'do_over',
  'shouldve_kept_it',
  'natural',
  'bought_it',
  'worth_every_penny',
  'whiff_city',
  'cant_miss_missed',
  'boomerang',
  'sucker_punched',
  'seeing_double',
  'hat_trick',
  'four_score',
  'high_five',
  'six_pack',
  'lucky_seven',
  'crazy_eights',
  'back_to_back',
  'anything_you_can_do',
  'lightning_strikes_twice',
  'straight_out_the_gate',
  'four_on_the_floor',
  'daylight_robbery',
  'sucker_born_every_minute',
  'all_in_all_gone',
  'bought_a_goose_egg',
  'buyers_remorse',
  'scratch_fever',
]);

// Every instant feat needs a punch, a turn ending, five of a kind, or a large
// straight or four of a kind on the first roll, so other moves can skip
// replaying the game. rollNumber is the roll's number since the turn started
// or was Mulliganed.
export function mayEarnInstantFeat(action: SuckerStatAction, rollNumber: number) {
  if (action.action_type !== 'roll') return action.action_type !== 'extra_roll';
  const dice = rolledDice(action.payload);
  if (!dice) return false;
  return isSuckerRoll(dice) || (rollNumber === 1 && (isLargeStraight(dice) || isFourOfAKind(dice)));
}

export function buildInstantPlayerFeats({
  actions,
  opponentId,
  playerId,
}: {
  actions: SuckerStatAction[];
  opponentId: string;
  playerId: string;
}): GameFeatKey[] {
  const feats = new Set([
    ...scanPunches(actions, playerId, opponentId),
    ...scanPlayerTurns(actions, playerId).feats,
    ...scanTurnHistory(actions, playerId, opponentId),
  ]);
  return featKeys.filter(
    (key): key is GameFeatKey => instantFeatKeys.has(key as GameFeatKey) && feats.has(key as GameFeatKey),
  );
}

export function buildCompletedPlayerFeats({
  actions,
  opponent,
  player,
  result,
  turns,
  winnerId,
}: {
  actions: SuckerStatAction[];
  opponent: Player;
  player: Player;
  result: ReturnType<typeof buildCompletedPlayerStats>;
  turns: SuckerStatTurn[];
  winnerId: string | null;
}): GameFeatKey[] {
  const feats = new Set<GameFeatKey>();
  const won = winnerId === player.id;
  const lost = winnerId === opponent.id;
  const margin = totalScore(player.scorecard) - totalScore(opponent.scorecard);

  scanPunches(actions, player.id, opponent.id).forEach((key) => feats.add(key));
  scanTurnHistory(actions, player.id, opponent.id).forEach((key) => feats.add(key));
  const play = scanPlayerTurns(actions, player.id, finalTurnScore(turns, player.id));
  play.feats.forEach((key) => feats.add(key));

  scorecardFeats(player).forEach((key) => feats.add(key));
  if (winnerId === null) feats.add('dead_heat');

  const timeline = scoreTimeline(turns, player.id, opponent.id);
  const finalTurn = timeline.at(-1);

  if (won) {
    if (result.forced_rerolls >= 2) feats.add('iron_chin');
    if (result.sucker_tokens_spent === 0) feats.add('penny_pincher');
    if (result.sucker_tokens_spent >= bigSpendTokens) feats.add('high_roller');
    if (player.scorecard.sucker === 0) feats.add('deal_with_the_devil');
    if (result.comeback_win) feats.add('comeback_kid');
    if (result.buzzer_beater_win) feats.add('buzzer_beater');
    if (result.blowout_win) feats.add('blowout');
    if (margin <= closeGameMargin) feats.add('photo_finish');
    if (result.sucker_punches_received - result.forced_rerolls >= 3) feats.add('rope_a_dope');
    const firstTurn = timeline.findIndex((entry) => entry.playerId === player.id);
    if (firstTurn >= 0 && timeline.slice(firstTurn).every((entry) => entry.leadAfter > 0)) feats.add('wire_to_wire');
    if (finalTurn?.playerId === player.id && finalTurn.leadBefore < 0) {
      feats.add('walk_off');
      if (play.finalTurnUsedLastRoll) feats.add('last_gasp');
    }
  }

  if (lost) {
    if (result.forced_rerolls >= 2) feats.add('glass_jaw');
    if (timeline.some((entry) => entry.leadAfter >= comebackPointMargin)) feats.add('choke_artist');
    if (finalTurn?.playerId === opponent.id && finalTurn.leadBefore > 0) feats.add('walked_off');
    if (-margin <= closeGameMargin) feats.add('heartbreaker');
    if (result.blowout_loss) feats.add('blown_out');
    if (result.sucker_tokens_leftover >= bigSpendTokens) feats.add('died_rich');
    if (result.sucker_tokens_spent >= bigSpendTokens) feats.add('money_pit');
  }

  return featKeys.filter((key): key is GameFeatKey => feats.has(key as GameFeatKey));
}

// After a Rage Quit the winner may finish their card alone. That earns the
// instant feats and the ones their own final card decides, never the ones
// measured against the quitter's frozen card or the forfeited result.
export function buildPlayOutFeats({
  actions,
  opponentId,
  player,
}: {
  actions: SuckerStatAction[];
  opponentId: string;
  player: Player;
}): GameFeatKey[] {
  const feats = new Set([
    ...buildInstantPlayerFeats({ actions, opponentId, playerId: player.id }),
    ...scorecardFeats(player),
  ]);
  return featKeys.filter((key): key is GameFeatKey => feats.has(key as GameFeatKey));
}

// Feats a finished card earns on its own, whoever won.
function scorecardFeats(player: Player) {
  const feats = new Set<GameFeatKey>();
  if ((player.suckerBonusCategories ?? []).length >= 2) feats.add('sucker_supreme');
  if (
    upperCategoryFaces.every(([category, face]) => {
      const score = player.scorecard[category] ?? 0;
      const baseScore = score >= extraSuckerBonusPoints ? score - extraSuckerBonusPoints : score;
      return baseScore >= face * 3;
    })
  ) {
    feats.add('upper_crust');
  }
  const upperBase = upperSectionBaseScore(player.scorecard);
  if (upperBase < upperBonusThreshold && upperBase >= upperBonusThreshold - 3) feats.add('so_close');
  const finalScore = totalScore(player.scorecard);
  if (finalScore >= 400) feats.add('club_400');
  if (finalScore >= 500) feats.add('club_500');
  if (finalScore < 100) feats.add('double_digits');
  if (Object.values(player.scorecard).every((score) => score !== null && score > 0)) feats.add('spotless');
  return feats;
}

function scanPunches(actions: SuckerStatAction[], playerId: string, opponentId: string) {
  const feats = new Set<GameFeatKey>();
  let hits = 0;
  let misses = 0;
  let missAwaitingCounter = false;

  for (const action of actions) {
    if (action.action_type !== 'sucker_punch') continue;
    const landed = payloadValue(action.payload, 'landed') !== false;
    const isCounterPunch = payloadValue(action.payload, 'isCounterPunch') === true;

    if (action.actor_id === playerId) {
      if (landed) {
        hits += 1;
        if (payloadValue(action.payload, 'chanceDie') === 1) feats.add('one_inch_punch');
        if (payloadValue(action.payload, 'isRevengePunch') === true) feats.add('revenge_is_sweet');
        if (isCounterPunch && payloadValue(action.payload, 'tokenCost') === 1) feats.add('counter_culture');
      } else {
        misses += 1;
        missAwaitingCounter = true;
        if (payloadValue(action.payload, 'chanceDie') === 6) feats.add('cant_miss_missed');
      }
    } else if (action.actor_id === opponentId && isCounterPunch) {
      if (missAwaitingCounter && landed) feats.add('boomerang');
      missAwaitingCounter = false;
    }
  }

  if (hits >= 3) feats.add('flurry');
  if (misses >= 3) feats.add('whiff_city');
  return feats;
}

// Replays both players' turns. A Sucker counts once per run of rolls, and a run
// starts over at each submission and Mulligan, so rolling again with all five
// held does not count twice. A landed punch or a Mulligan of a submitted turn
// erases that turn; its replay is a new run, judged against the erased score.
function scanTurnHistory(actions: SuckerStatAction[], playerId: string, opponentId: string) {
  const feats = new Set<GameFeatKey>();
  const newSide = () => ({
    dice: null as Dice | null,
    erased: null as { by: 'punch' | 'mulligan'; score: number | null; scoredSucker: boolean } | null,
    rolls: 0,
    runSucker: false,
    turnSucker: false,
    turns: [] as { score: number | null; scoredSucker: boolean; sucker: boolean }[],
  });
  const player = newSide();
  const opponent = newSide();
  let suckers = 0;

  for (const action of actions) {
    const side = action.actor_id === playerId ? player : action.actor_id === opponentId ? opponent : null;
    if (!side) continue;

    switch (action.action_type) {
      case 'roll': {
        side.rolls += 1;
        side.dice = rolledDice(action.payload);
        if (!side.dice) break;
        const sucker = isSuckerRoll(side.dice);
        if (side === player) {
          if (side.rolls === 1 && isLargeStraight(side.dice)) feats.add('straight_out_the_gate');
          if (side.rolls === 1 && isFourOfAKind(side.dice)) feats.add('four_on_the_floor');
          if (sucker && !side.runSucker) {
            suckers += 1;
            for (const [count, key] of suckerCountFeats) if (suckers >= count) feats.add(key);
          }
          if (sucker && player.turns.at(-1)?.sucker) feats.add('back_to_back');
          if (sucker && opponent.turns.at(-1)?.sucker) feats.add('anything_you_can_do');
          if (sucker && player.erased?.by === 'punch' && player.erased.scoredSucker) {
            feats.add('lightning_strikes_twice');
          }
        }
        if (sucker) {
          side.runSucker = true;
          side.turnSucker = true;
        }
        break;
      }
      case 'mulligan': {
        // A Mulligan in the response window discards the turn just submitted.
        const discarded = payloadValue(action.payload, 'turnId') ? side.turns.pop() : undefined;
        if (discarded) side.erased = { ...discarded, by: 'mulligan' };
        // Its rolls are discarded too. The Sucker count keeps them; turn checks do not.
        side.dice = null;
        side.rolls = 0;
        side.runSucker = false;
        side.turnSucker = false;
        break;
      }
      case 'score_category':
      case 'scratch_category': {
        const submitted = payloadValue(action.payload, 'score');
        const score = typeof submitted === 'number' ? submitted : action.action_type === 'scratch_category' ? 0 : null;
        const erasedScore = side.erased?.score;
        if (typeof erasedScore === 'number' && score !== null) {
          const gain = score - erasedScore;
          if (side.erased?.by === 'mulligan') {
            if (side === player && gain >= doOverPoints) feats.add('do_over');
            if (side === player && gain < 0) feats.add('shouldve_kept_it');
          } else if (gain > 0) {
            feats.add(side === player ? 'thanks_i_needed_that' : 'backfire');
          }
        }
        side.turns.push({
          score,
          scoredSucker: action.action_type === 'score_category' && side.dice !== null && isSuckerRoll(side.dice),
          sucker: side.turnSucker,
        });
        side.dice = null;
        side.erased = null;
        side.rolls = 0;
        side.runSucker = false;
        side.turnSucker = false;
        break;
      }
      case 'sucker_punch': {
        if (payloadValue(action.payload, 'landed') === false) break;
        const targetId = payloadValue(action.payload, 'targetPlayerId');
        const target = targetId === playerId ? player : targetId === opponentId ? opponent : null;
        const punched = target && target !== side ? target.turns.pop() : undefined;
        if (!target || !punched) break;
        target.erased = { ...punched, by: 'punch' };
        if (punched.scoredSucker) feats.add(target === player ? 'sucker_punched' : 'daylight_robbery');
        break;
      }
      default:
        break;
    }
  }

  return feats;
}

// Replays a player's turns: rolls since the last score, scratch, Mulligan, or
// landed punch; Extra Rolls bought; Sucker chases; and the running token balance.
// Without a pending final score, the open turn is still being played, so its
// Sucker chase and spending stay unsettled.
function scanPlayerTurns(actions: SuckerStatAction[], playerId: string, pendingFinalScore?: number | null) {
  const feats = new Set<GameFeatKey>();
  const scratched = new Set<string>();
  let tokens = startingSuckerTokens;
  let rollsThisTurn = 0;
  let extraRollsThisTurn = 0;
  let spentThisTurn = 0;
  let turnOpen = false;
  let lastTurnUsedLastRoll = false;
  let suckerScratched = false;
  let chase = { emptied: false, extraRolls: 0, landed: false };

  // A Mulligan starts the dice over, so it settles any chase in progress.
  const settleChase = () => {
    if (chase.extraRolls >= suckerChaseExtraRolls) {
      if (chase.landed) feats.add('worth_every_penny');
      else feats.add('sucker_born_every_minute');
    }
    if (chase.extraRolls > 0 && chase.emptied && !chase.landed) feats.add('all_in_all_gone');
    chase = { emptied: false, extraRolls: 0, landed: false };
  };

  const endTurn = (score: number | null) => {
    if (spentThisTurn >= goodMoneyTokens && score === 0) feats.add('bought_a_goose_egg');
    lastTurnUsedLastRoll = rollsThisTurn > 0 && rollsThisTurn >= maxRollsPerTurn + extraRollsThisTurn;
    settleChase();
    spentThisTurn = 0;
    rollsThisTurn = 0;
    extraRollsThisTurn = 0;
    turnOpen = false;
  };

  for (const action of actions) {
    if (action.actor_id !== playerId) {
      if (
        action.action_type === 'sucker_punch' &&
        payloadValue(action.payload, 'targetPlayerId') === playerId &&
        payloadValue(action.payload, 'landed') !== false
      ) {
        rollsThisTurn = 0;
        extraRollsThisTurn = 0;
      }
      continue;
    }

    switch (action.action_type) {
      case 'roll': {
        turnOpen = true;
        rollsThisTurn += 1;
        const dice = payloadValue(action.payload, 'dice');
        if (Array.isArray(dice) && dice.length === 5 && dice.every((die) => die === dice[0])) {
          if (rollsThisTurn === 1) feats.add('natural');
          if (rollsThisTurn > maxRollsPerTurn) feats.add('bought_it');
          if (chase.extraRolls > 0) chase.landed = true;
          if (suckerScratched) feats.add('buyers_remorse');
        }
        break;
      }
      case 'extra_roll':
        turnOpen = true;
        tokens -= suckerTokenCosts.extraRoll;
        spentThisTurn += suckerTokenCosts.extraRoll;
        extraRollsThisTurn += 1;
        if (payloadValue(action.payload, 'suckerHunt') === true) {
          chase.extraRolls += 1;
          if (tokens <= 0) chase.emptied = true;
        }
        break;
      case 'mulligan':
        turnOpen = true;
        tokens -= suckerTokenCosts.mulligan;
        spentThisTurn += suckerTokenCosts.mulligan;
        settleChase();
        rollsThisTurn = 0;
        extraRollsThisTurn = 0;
        break;
      case 'sucker_punch':
        tokens -= punchTokenCost(action.payload);
        break;
      case 'sucker_blocker':
        tokens -= suckerTokenCosts.suckerPunch;
        break;
      case 'scratch_category': {
        tokens += 1;
        const category = payloadValue(action.payload, 'category');
        if (typeof category === 'string') {
          scratched.add(category);
          if (category === 'sucker') suckerScratched = true;
        }
        endTurn(0);
        break;
      }
      case 'score_category': {
        const score = payloadValue(action.payload, 'score');
        endTurn(typeof score === 'number' ? score : null);
        break;
      }
      default:
        break;
    }
  }

  // Callers normally include the game-ending submission. If it is missing,
  // finish the open turn with the score from its turn row.
  if (turnOpen && pendingFinalScore !== undefined) endTurn(pendingFinalScore);
  if (scratched.size >= 6) feats.add('scratch_fever');

  return { feats, finalTurnUsedLastRoll: lastTurnUsedLastRoll };
}

// The score of the game-ending turn when this player took it. That turn's
// submission is not among the loaded actions, but its turn row is.
function finalTurnScore(turns: SuckerStatTurn[], playerId: string) {
  const finalTurn = getEffectiveStatTurns(turns).at(-1);
  return finalTurn?.player_id === playerId ? finalTurn.score : null;
}

function punchTokenCost(payload: unknown) {
  const tokenCost = payloadValue(payload, 'tokenCost');
  if (tokenCost === 1 || tokenCost === 2 || tokenCost === 3) return tokenCost;
  return payloadValue(payload, 'isCounterPunch') === true
    ? suckerTokenCosts.counterPunch
    : suckerTokenCosts.suckerPunch;
}

// The player's lead before and after each scored turn, in turn order.
function scoreTimeline(turns: SuckerStatTurn[], playerId: string, opponentId: string) {
  const scorecards = { [playerId]: createEmptyScorecard(), [opponentId]: createEmptyScorecard() };
  const lead = () => totalScore(scorecards[playerId]) - totalScore(scorecards[opponentId]);

  return getEffectiveStatTurns(turns).flatMap((turn) => {
    const scorecard = scorecards[turn.player_id];
    if (!scorecard) return [];
    const leadBefore = lead();
    scorecard[toScoreCategory(turn.category)] = turn.score;
    return [{ leadAfter: lead(), leadBefore, playerId: turn.player_id }];
  });
}

function rolledDice(payload: unknown): Dice | null {
  const dice = payloadValue(payload, 'dice');
  return Array.isArray(dice) && dice.length === 5 && dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 6)
    ? (dice as Dice)
    : null;
}

function isLargeStraight(dice: Dice) {
  return scoreCategory(dice, 'largeStraight') > 0;
}

// Exactly four alike; five alike is a Sucker.
function isFourOfAKind(dice: Dice) {
  return !isSuckerRoll(dice) && scoreCategory(dice, 'fourOfAKind') > 0;
}

function payloadValue(payload: unknown, key: string) {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
}
