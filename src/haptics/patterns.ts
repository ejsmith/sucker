export const hapticEvents = ['punchLanded', 'punchReceived', 'sucker'] as const;
export type HapticEvent = (typeof hapticEvents)[number];
export const impactStyles = ['light', 'medium', 'heavy', 'rigid', 'soft'] as const;
export type ImpactStyle = (typeof impactStyles)[number];
export type HapticPreset = ImpactStyle | 'windup' | 'aftershock' | 'success' | 'flourish' | 'original' | 'off';
export type HapticChoice = { preset: HapticPreset; gapMs: number; delayMs: number };
export type HapticPreferences = Record<HapticEvent, HapticChoice>;
export type HapticEffect = ImpactStyle | 'success' | 'original';
export type HapticStep = { atMs: number; effect: HapticEffect };

export const hapticEventLabels: Record<HapticEvent, string> = {
  punchLanded: 'Landing a punch',
  punchReceived: 'Getting punched',
  sucker: 'Rolling a Sucker',
};

export const hapticPresets: Record<HapticPreset, { label: string; description: string }> = {
  light: { label: 'Light', description: 'One light tap.' },
  medium: { label: 'Medium', description: 'One firm tap.' },
  heavy: { label: 'Heavy', description: 'One weighty thud.' },
  rigid: { label: 'Crisp', description: 'One sharp, rigid impact.' },
  soft: { label: 'Soft', description: 'One cushioned tap.' },
  windup: { label: 'Windup', description: 'A light tap followed by a heavy impact.' },
  aftershock: { label: 'Aftershock', description: 'A heavy impact followed by a soft tap.' },
  success: { label: 'Success', description: 'The phone’s built-in celebration.' },
  flourish: { label: 'Flourish', description: 'Two light taps and a firm finish.' },
  original: { label: 'Original', description: 'The vibration from the previous version.' },
  off: { label: 'Off', description: 'No haptic feedback for this event.' },
};

export const eventPresets: Record<HapticEvent, HapticPreset[]> = {
  punchLanded: ['rigid', 'heavy', 'windup', 'light', 'medium', 'soft', 'original', 'off'],
  punchReceived: ['heavy', 'aftershock', 'rigid', 'light', 'medium', 'soft', 'original', 'off'],
  sucker: ['success', 'flourish', 'light', 'medium', 'heavy', 'soft', 'original', 'off'],
};

export const defaultHapticPreferences: HapticPreferences = {
  punchLanded: { preset: 'rigid', gapMs: 100, delayMs: 0 },
  punchReceived: { preset: 'heavy', gapMs: 100, delayMs: 0 },
  sucker: { preset: 'success', gapMs: 100, delayMs: 0 },
};

export function hasAdjustableGap(preset: HapticPreset) {
  return preset === 'windup' || preset === 'aftershock' || preset === 'flourish';
}

export function hapticSteps(choice: HapticChoice): HapticStep[] {
  const effects: HapticEffect[] =
    choice.preset === 'off'
      ? []
      : choice.preset === 'windup'
        ? ['light', 'heavy']
        : choice.preset === 'aftershock'
          ? ['heavy', 'soft']
          : choice.preset === 'flourish'
            ? ['light', 'light', 'medium']
            : [choice.preset];
  return effects.map((effect, index) => ({ atMs: choice.delayMs + index * choice.gapMs, effect }));
}

export function sameHapticChoice(a: HapticChoice, b: HapticChoice) {
  return a.preset === b.preset && a.gapMs === b.gapMs && a.delayMs === b.delayMs;
}

export function parseHapticPreferences(raw: string | null): HapticPreferences {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  return Object.fromEntries(
    hapticEvents.map((event) => {
      const fallback = defaultHapticPreferences[event];
      const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>)[event] : null;
      if (!candidate || typeof candidate !== 'object') return [event, { ...fallback }];
      const choice = candidate as Record<string, unknown>;
      return [
        event,
        {
          preset: eventPresets[event].includes(choice.preset as HapticPreset) ? choice.preset : fallback.preset,
          gapMs: boundedNumber(choice.gapMs, 50, 250, fallback.gapMs),
          delayMs: boundedNumber(choice.delayMs, 0, 250, fallback.delayMs),
        },
      ];
    }),
  ) as HapticPreferences;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)))
    : fallback;
}
