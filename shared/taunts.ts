export type TauntScenario =
  | 'base'
  | 'four-kind'
  | 'full-house'
  | 'punch-landed'
  | 'punch-missed'
  | 'scratch'
  | 'straight'
  | 'sucker-roll';

export const baseTaunts = [
  { id: 'who-is-sucker', scenario: 'base', text: "Who's the Sucker now?" },
  { id: 'beat-that', scenario: 'base', text: 'Beat that, Sucker.' },
  { id: 'all-that', scenario: 'base', text: 'All that for THAT?' },
  { id: 'roll-better', scenario: 'base', text: 'Roll better, Sucker.' },
  { id: 'reroll-talent', scenario: 'base', text: "You can't reroll talent." },
  { id: 'your-move', scenario: 'base', text: 'Your move, Sucker.' },
] as const;

export const suckerRollTaunts = [
  { id: 'sucker', scenario: 'sucker-roll', text: 'SUCKER!' },
  { id: 'punch-me', scenario: 'sucker-roll', text: 'Punch me. I dare you.' },
  { id: 'five-dice-sucker', scenario: 'sucker-roll', text: 'Five dice. One Sucker.' },
  { id: 'name-of-game', scenario: 'sucker-roll', text: "Even the dice know you're a Sucker." },
] as const;

export const scratchTaunts = [
  { id: 'start-scratching', scenario: 'scratch', text: 'Better start scratching.' },
  { id: 'spotted-one', scenario: 'scratch', text: "I spotted you one. Don't waste it." },
  { id: 'zero-swagger', scenario: 'scratch', text: 'Even my zero has swagger.' },
  { id: 'keeping-interesting', scenario: 'scratch', text: 'Just keeping it interesting, Sucker.' },
] as const;

export const straightTaunts = [
  { id: 'straight-to-top', scenario: 'straight', text: 'Straight to the top, Sucker.' },
  { id: 'straight-face', scenario: 'straight', text: 'Try to keep a straight face.' },
  { id: 'nothing-crooked', scenario: 'straight', text: 'Nothing crooked about that beatdown.' },
  { id: 'line-em-up', scenario: 'straight', text: "Line 'em up. Knock you down." },
] as const;

export const fullHouseTaunts = [
  { id: 'not-invited', scenario: 'full-house', text: "Full house. You're not invited." },
  { id: 'no-vacancy', scenario: 'full-house', text: 'No vacancy for Suckers.' },
  { id: 'my-house', scenario: 'full-house', text: 'House always wins. My house.' },
  { id: 'second-place-home', scenario: 'full-house', text: 'Make yourself at home in second place.' },
] as const;

export const fourKindTaunts = [
  { id: 'four-warned', scenario: 'four-kind', text: 'Consider yourself four-warned.' },
  { id: 'four-matched', scenario: 'four-kind', text: "Four matched. You didn't." },
  { id: 'one-die-short', scenario: 'four-kind', text: 'One die short. Still miles ahead.' },
  { id: 'zero-sympathy', scenario: 'four-kind', text: 'Four of a kind. Zero sympathy.' },
] as const;

export const landedPunchTaunts = [
  { id: 'sucker-punched', scenario: 'punch-landed', text: 'You just got Sucker Punched.' },
  { id: 'score-deleted', scenario: 'punch-landed', text: 'Score deleted. Sucker detected.' },
  { id: 'back-to-dice', scenario: 'punch-landed', text: 'Back to the dice, Sucker.' },
  {
    id: 'better-before-punch',
    scenario: 'punch-landed',
    text: 'That score looked better before I punched it.',
  },
] as const;

export const missedPunchTaunts = [
  { id: 'disrespect-didnt', scenario: 'punch-missed', text: "The punch missed. The disrespect didn't." },
  { id: 'warning-punch', scenario: 'punch-missed', text: 'That was a warning punch.' },
  { id: 'checking-reflexes', scenario: 'punch-missed', text: 'I was checking your reflexes.' },
  { id: 'beat-without-it', scenario: 'punch-missed', text: "Fine. I'll beat you without it." },
] as const;

export const taunts = [
  ...baseTaunts,
  ...suckerRollTaunts,
  ...scratchTaunts,
  ...straightTaunts,
  ...fullHouseTaunts,
  ...fourKindTaunts,
  ...landedPunchTaunts,
  ...missedPunchTaunts,
] as const;

export type TauntId = (typeof taunts)[number]['id'];
export type Taunt = (typeof taunts)[number];

const scenarioTaunts: Record<Exclude<TauntScenario, 'base'>, readonly Taunt[]> = {
  'four-kind': fourKindTaunts,
  'full-house': fullHouseTaunts,
  'punch-landed': landedPunchTaunts,
  'punch-missed': missedPunchTaunts,
  scratch: scratchTaunts,
  straight: straightTaunts,
  'sucker-roll': suckerRollTaunts,
};

export const tauntScenarioLabels: Record<TauntScenario, string> = {
  base: 'ANY PLAY',
  'four-kind': 'FOUR OF A KIND',
  'full-house': 'FULL HOUSE',
  'punch-landed': 'LANDED SUCKER PUNCH',
  'punch-missed': 'MISSED SUCKER PUNCH',
  scratch: 'SCRATCH',
  straight: 'LARGE STRAIGHT',
  'sucker-roll': 'SUCKER ROLL',
};

export function getTauntsForScenario(scenario: TauntScenario): readonly Taunt[] {
  return scenario === 'base' ? baseTaunts : [...scenarioTaunts[scenario], ...baseTaunts];
}

export function isTauntAvailableForScenario(tauntId: TauntId, scenario: TauntScenario) {
  return getTauntsForScenario(scenario).some((taunt) => taunt.id === tauntId);
}

export function getTurnTauntScenario({
  category,
  dice,
  scratched,
}: {
  category: string;
  dice: readonly number[];
  score: number;
  scratched: boolean;
}): TauntScenario {
  if (scratched) {
    return 'scratch';
  }
  if (dice.length === 5 && dice.every((die) => die === dice[0])) {
    return 'sucker-roll';
  }
  if (category === 'largeStraight') {
    return 'straight';
  }
  if (category === 'smallStraight') {
    return 'base';
  }
  if (category === 'fullHouse') {
    return 'full-house';
  }
  if (category === 'fourOfAKind') {
    return 'four-kind';
  }
  return 'base';
}

export function isTauntId(value: unknown): value is TauntId {
  return typeof value === 'string' && taunts.some((taunt) => taunt.id === value);
}

export function getTauntText(tauntId: TauntId) {
  return taunts.find((taunt) => taunt.id === tauntId)?.text ?? '';
}
