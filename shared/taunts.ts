export const taunts = [
  { id: 'sucker', text: 'SUCKER!' },
  { id: 'who-is-sucker', text: "Who's the Sucker now?" },
  { id: 'beat-that', text: 'Beat that, Sucker.' },
  { id: 'all-that', text: 'All that for THAT?' },
  { id: 'start-scratching', text: 'Better start scratching.' },
  { id: 'punch-me', text: 'Punch me. I dare you.' },
  { id: 'roll-better', text: 'Roll better, Sucker.' },
  { id: 'reroll-talent', text: "You can't reroll talent." },
] as const;

export type TauntId = (typeof taunts)[number]['id'];

export function isTauntId(value: unknown): value is TauntId {
  return typeof value === 'string' && taunts.some((taunt) => taunt.id === value);
}

export function getTauntText(tauntId: TauntId) {
  return taunts.find((taunt) => taunt.id === tauntId)?.text ?? '';
}
