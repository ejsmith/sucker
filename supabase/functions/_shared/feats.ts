import { extraSuckerBonusPoints, maxRollsPerTurn, type Player, type ScoreCategory } from './game.ts';
import type { buildCompletedPlayerStats, SuckerStatAction } from './stats.ts';

export type GameFeatKey =
  | 'one_inch_punch'
  | 'iron_chin'
  | 'revenge_is_sweet'
  | 'counter_culture'
  | 'penny_pincher'
  | 'high_roller'
  | 'deal_with_the_devil'
  | 'natural'
  | 'bought_it'
  | 'sucker_supreme'
  | 'upper_crust'
  | 'comeback_kid'
  | 'buzzer_beater'
  | 'blowout';

// Milestone feats are awarded once by the database when a game completes,
// because they depend on a player's whole multiplayer history.
export type MilestoneFeatKey =
  'globetrotter_10' | 'globetrotter_25' | 'globetrotter_100' | 'welcome_wagon' | 'nemesis' | 'centurion';

export type FeatKey = GameFeatKey | MilestoneFeatKey;

export type FeatDefinition = {
  description: string;
  kind: 'game' | 'milestone';
  name: string;
};

export const featCatalog: Record<FeatKey, FeatDefinition> = {
  one_inch_punch: { kind: 'game', name: 'One-Inch Punch', description: 'Land a Sucker Punch on a 1 (10% chance).' },
  iron_chin: { kind: 'game', name: 'Iron Chin', description: 'Win after taking 2 or more landed punches.' },
  revenge_is_sweet: { kind: 'game', name: 'Revenge Is Sweet', description: 'Land a punch at the revenge discount.' },
  counter_culture: { kind: 'game', name: 'Counter Culture', description: 'Land a counterpunch that cost 1 token.' },
  penny_pincher: { kind: 'game', name: 'Penny Pincher', description: 'Win without spending a token.' },
  high_roller: { kind: 'game', name: 'High Roller', description: 'Spend 10 or more tokens and win.' },
  deal_with_the_devil: { kind: 'game', name: 'Deal With the Devil', description: 'Win with a zero in the Sucker box.' },
  natural: { kind: 'game', name: 'Natural', description: 'Roll five of a kind on the first roll of a turn.' },
  bought_it: { kind: 'game', name: 'Bought It', description: 'Roll five of a kind on a purchased Extra Roll.' },
  sucker_supreme: { kind: 'game', name: 'Sucker Supreme', description: 'Score 2 extra Sucker bonuses in one game.' },
  upper_crust: {
    kind: 'game',
    name: 'Upper Crust',
    description: 'Score at least three of every number in the upper section.',
  },
  comeback_kid: { kind: 'game', name: 'Comeback Kid', description: 'Win after trailing by 50 or more.' },
  buzzer_beater: { kind: 'game', name: 'Buzzer Beater', description: 'Take the lead on your final turn and win.' },
  blowout: { kind: 'game', name: 'Blowout', description: 'Win by 75 or more.' },
  globetrotter_10: { kind: 'milestone', name: 'Globetrotter', description: 'Beat 10 different opponents.' },
  globetrotter_25: { kind: 'milestone', name: 'Globetrotter II', description: 'Beat 25 different opponents.' },
  globetrotter_100: { kind: 'milestone', name: 'Globetrotter III', description: 'Beat 100 different opponents.' },
  welcome_wagon: {
    kind: 'milestone',
    name: 'Welcome Wagon',
    description: 'Finish a game against someone in their first game, after 5 of your own.',
  },
  nemesis: { kind: 'milestone', name: 'Nemesis', description: 'Complete 10 games against the same opponent.' },
  centurion: { kind: 'milestone', name: 'Centurion', description: 'Complete 100 games.' },
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

export function buildCompletedPlayerFeats({
  actions,
  player,
  result,
}: {
  actions: SuckerStatAction[];
  player: Player;
  result: ReturnType<typeof buildCompletedPlayerStats>;
}): GameFeatKey[] {
  const feats = new Set<GameFeatKey>();
  const { won } = result;

  for (const action of actions) {
    if (action.actor_id !== player.id || action.action_type !== 'sucker_punch') continue;
    if (payloadValue(action.payload, 'landed') !== true) continue;
    if (payloadValue(action.payload, 'chanceDie') === 1) feats.add('one_inch_punch');
    if (payloadValue(action.payload, 'isRevengePunch') === true) feats.add('revenge_is_sweet');
    if (payloadValue(action.payload, 'isCounterPunch') === true && payloadValue(action.payload, 'tokenCost') === 1) {
      feats.add('counter_culture');
    }
  }

  const rolls = scanSuckerRolls(actions, player.id);
  if (rolls.natural) feats.add('natural');
  if (rolls.boughtIt) feats.add('bought_it');

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

  if (won) {
    if (result.forced_rerolls >= 2) feats.add('iron_chin');
    if (result.sucker_tokens_spent === 0) feats.add('penny_pincher');
    if (result.sucker_tokens_spent >= 10) feats.add('high_roller');
    if (player.scorecard.sucker === 0) feats.add('deal_with_the_devil');
    if (result.comeback_win) feats.add('comeback_kid');
    if (result.buzzer_beater_win) feats.add('buzzer_beater');
    if (result.blowout_win) feats.add('blowout');
  }

  return featKeys.filter((key): key is GameFeatKey => feats.has(key as GameFeatKey));
}

// A turn's roll count restarts after the player scores, scratches, takes a
// Mulligan, or has a turn punched away. Rolls past the standard limit were bought.
function scanSuckerRolls(actions: SuckerStatAction[], playerId: string) {
  let rollsThisTurn = 0;
  let natural = false;
  let boughtIt = false;

  for (const action of actions) {
    if (action.actor_id === playerId) {
      switch (action.action_type) {
        case 'roll': {
          rollsThisTurn += 1;
          const dice = payloadValue(action.payload, 'dice');
          if (Array.isArray(dice) && dice.length === 5 && dice.every((die) => die === dice[0])) {
            if (rollsThisTurn === 1) natural = true;
            if (rollsThisTurn > maxRollsPerTurn) boughtIt = true;
          }
          break;
        }
        case 'score_category':
        case 'scratch_category':
        case 'mulligan':
          rollsThisTurn = 0;
          break;
        default:
          break;
      }
    } else if (
      action.action_type === 'sucker_punch' &&
      payloadValue(action.payload, 'targetPlayerId') === playerId &&
      payloadValue(action.payload, 'landed') !== false
    ) {
      rollsThisTurn = 0;
    }
  }

  return { boughtIt, natural };
}

function payloadValue(payload: unknown, key: string) {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
}
