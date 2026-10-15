export const hapticEvents = ['punchLanded', 'punchReceived', 'sucker'] as const;
export type HapticEvent = (typeof hapticEvents)[number];
export type CustomHapticPreset = 'crack' | 'bodyBlow' | 'rumble' | 'doubleHit' | 'buildPop' | 'victory' | 'doubleRev';
export type HapticPreset = CustomHapticPreset | 'original' | 'off';
export type HapticChoice = {
  preset: HapticPreset;
  strength: number;
  sharpness: number;
  durationMs: number;
  delayMs: number;
  hitStrength: number;
  rumbleStrength: number;
  repeatCount: number;
  repeatGapMs: number;
};
export type HapticPreferences = Record<HapticEvent, HapticChoice>;

// Pulsar times are milliseconds; amplitude and frequency (iOS sharpness) are 0–1.
// Keep this data platform-neutral so the native timeline can be validated in Node.
export type HapticPattern = {
  discretePattern: { time: number; amplitude: number; frequency: number }[];
  continuousPattern: {
    amplitude: { time: number; value: number }[];
    frequency: { time: number; value: number }[];
  };
};

export const hapticEventLabels: Record<HapticEvent, string> = {
  punchLanded: 'Landing a punch',
  punchReceived: 'Getting punched',
  sucker: 'Rolling a Sucker',
};

export const hapticPresets: Record<HapticPreset, { label: string; description: string; durationMs: number }> = {
  crack: { label: 'Crack', description: 'A sharp strike with a long fading burst behind it.', durationMs: 800 },
  bodyBlow: { label: 'Body blow', description: 'A low, heavy hit with a long fading tail.', durationMs: 300 },
  rumble: { label: 'Rumble', description: 'Three rolling waves of vibration, without a sharp tap.', durationMs: 450 },
  doubleHit: {
    label: 'Double hit',
    description: 'A sharp first hit, a pause, then a heavier second hit.',
    durationMs: 300,
  },
  buildPop: { label: 'Build & pop', description: 'An accelerating buildup that ends in a sharp pop.', durationMs: 450 },
  victory: { label: 'Victory', description: 'Three separated bursts that grow into a bright finish.', durationMs: 600 },
  doubleRev: {
    label: 'Double rev',
    description: 'Vrrroo… vrrrooom. A short rev, a pause, then a longer, stronger rev.',
    durationMs: 900,
  },
  original: { label: 'Original', description: 'The vibration from before the first Haptics Lab.', durationMs: 400 },
  off: { label: 'Off', description: 'No haptic feedback for this event.', durationMs: 0 },
};

// Each event can audition the full range; the first three emphasize its likely fits.
export const eventPresets: Record<HapticEvent, HapticPreset[]> = {
  punchLanded: ['crack', 'doubleHit', 'bodyBlow', 'rumble', 'buildPop', 'victory', 'doubleRev', 'original', 'off'],
  punchReceived: ['crack', 'bodyBlow', 'rumble', 'doubleHit', 'buildPop', 'victory', 'doubleRev', 'original', 'off'],
  sucker: ['doubleRev', 'buildPop', 'victory', 'rumble', 'crack', 'doubleHit', 'bodyBlow', 'original', 'off'],
};

export function createHapticChoice(preset: HapticPreset): HapticChoice {
  return {
    preset,
    strength: 100,
    sharpness: 50,
    durationMs: hapticPresets[preset].durationMs,
    delayMs: 0,
    hitStrength: 100,
    rumbleStrength: 100,
    repeatCount: 1,
    repeatGapMs: 100,
  };
}

export const defaultHapticPreferences: HapticPreferences = {
  punchLanded: createHapticChoice('crack'),
  punchReceived: createHapticChoice('crack'),
  sucker: createHapticChoice('doubleRev'),
};

export function isCustomHaptic(preset: HapticPreset): preset is CustomHapticPreset {
  return preset !== 'off' && preset !== 'original';
}

type Point = [time: number, value: number];
type Strike = [time: number, amplitude: number, sharpness: number];
function pattern(strikes: Strike[], amplitude: Point[], sharpness: Point[]): HapticPattern {
  return {
    discretePattern: strikes.map(([time, amplitude, frequency]) => ({ time, amplitude, frequency })),
    continuousPattern: {
      amplitude: amplitude.map(([time, value]) => ({ time, value })),
      frequency: sharpness.map(([time, value]) => ({ time, value })),
    },
  };
}

const patterns: Record<CustomHapticPreset, HapticPattern> = {
  crack: pattern(
    [[0, 1, 1]],
    [
      [0, 0.85],
      [120, 0.65],
      [360, 0.2],
      [800, 0],
    ],
    [
      [0, 0.8],
      [800, 0.45],
    ],
  ),
  bodyBlow: pattern(
    [[0, 1, 0.15]],
    [
      [0, 0.95],
      [35, 1],
      [100, 0.65],
      [210, 0.25],
      [300, 0],
    ],
    [
      [0, 0.15],
      [300, 0],
    ],
  ),
  rumble: pattern(
    [],
    [
      [0, 0],
      [35, 0.9],
      [100, 0.9],
      [140, 0.2],
      [200, 0.8],
      [255, 0.2],
      [315, 0.7],
      [450, 0],
    ],
    [
      [0, 0.02],
      [450, 0.02],
    ],
  ),
  doubleHit: pattern(
    [
      [0, 0.9, 0.95],
      [170, 1, 0.25],
    ],
    [
      [0, 0.6],
      [45, 0],
      [169, 0],
      [170, 1],
      [210, 0.75],
      [300, 0],
    ],
    [
      [0, 0.8],
      [169, 0.8],
      [170, 0.2],
      [300, 0],
    ],
  ),
  buildPop: pattern(
    [
      [0, 0.2, 0.3],
      [150, 0.35, 0.5],
      [260, 0.5, 0.65],
      [340, 0.7, 0.8],
      [400, 1, 1],
    ],
    [
      [0, 0],
      [120, 0.15],
      [260, 0.4],
      [375, 0.75],
      [390, 0],
      [450, 0],
    ],
    [
      [0, 0.15],
      [390, 0.9],
      [450, 0.9],
    ],
  ),
  victory: pattern(
    [
      [0, 0.45, 0.4],
      [200, 0.7, 0.65],
      [400, 1, 1],
    ],
    [
      [0, 0.4],
      [70, 0],
      [199, 0],
      [200, 0.65],
      [295, 0],
      [399, 0],
      [400, 1],
      [470, 0.65],
      [600, 0],
    ],
    [
      [0, 0.3],
      [200, 0.5],
      [400, 0.85],
      [600, 0.6],
    ],
  ),
  // Two continuous revs: a 330 ms warm-up, an 80 ms quiet gap, then a
  // stronger 490 ms swell. Sharpness rises with each rev and drops on release.
  doubleRev: pattern(
    [],
    [
      [0, 0],
      [40, 0.18],
      [110, 0.38],
      [210, 0.65],
      [280, 0.8],
      [330, 0],
      [410, 0],
      [450, 0.12],
      [530, 0.36],
      [650, 0.78],
      [750, 1],
      [810, 1],
      [900, 0],
    ],
    [
      [0, 0.05],
      [110, 0.15],
      [210, 0.4],
      [280, 0.7],
      [330, 0.1],
      [410, 0.05],
      [530, 0.2],
      [650, 0.5],
      [750, 0.8],
      [810, 0.9],
      [900, 0.1],
    ],
  ),
};

export function hasHapticHits(preset: HapticPreset) {
  return isCustomHaptic(preset) && patterns[preset].discretePattern.length > 0;
}

export function hapticDurationMs(choice: HapticChoice) {
  if (!isCustomHaptic(choice.preset)) return hapticPresets[choice.preset].durationMs;
  const duration = boundedNumber(choice.durationMs, 50, 900, hapticPresets[choice.preset].durationMs);
  const repeats = boundedNumber(choice.repeatCount, 1, 3, 1);
  const gap = boundedNumber(choice.repeatGapMs, 25, 400, 100);
  return duration * repeats + gap * (repeats - 1);
}

export function buildHapticPattern(choice: HapticChoice): HapticPattern | null {
  if (!isCustomHaptic(choice.preset)) return null;
  const source = patterns[choice.preset];
  const duration = boundedNumber(choice.durationMs, 50, 900, hapticPresets[choice.preset].durationMs);
  const scaleTime = (time: number) => (time / hapticPresets[choice.preset].durationMs) * duration;
  const strength = boundedNumber(choice.strength, 5, 100, 100) / 100;
  const hitStrength = boundedNumber(choice.hitStrength, 0, 100, 100) / 100;
  const rumbleStrength = boundedNumber(choice.rumbleStrength, 0, 100, 100) / 100;
  const repeats = boundedNumber(choice.repeatCount, 1, 3, 1);
  const gap = boundedNumber(choice.repeatGapMs, 25, 400, 100);
  if ((!source.discretePattern.length || hitStrength === 0) && rumbleStrength === 0) return null;
  const texture = (boundedNumber(choice.sharpness, 0, 100, 50) - 50) / 50;
  // 50 preserves the authored texture; 0 and 100 reach the soft/sharp extremes.
  const sharpen = (value: number) => (texture < 0 ? value * (1 + texture) : value + (1 - value) * texture);
  const single: HapticPattern = {
    discretePattern:
      hitStrength === 0
        ? []
        : source.discretePattern.map((point) => ({
            time: scaleTime(point.time),
            amplitude: point.amplitude * strength * hitStrength,
            frequency: sharpen(point.frequency),
          })),
    continuousPattern: {
      amplitude: source.continuousPattern.amplitude.map((point) => ({
        time: scaleTime(point.time),
        value: point.value * strength * rumbleStrength,
      })),
      frequency: source.continuousPattern.frequency.map((point) => ({
        time: scaleTime(point.time),
        value: sharpen(point.value),
      })),
    },
  };
  const repeated: HapticPattern = { discretePattern: [], continuousPattern: { amplitude: [], frequency: [] } };
  for (let index = 0; index < repeats; index++) {
    const offset = index * (duration + gap);
    repeated.discretePattern.push(...single.discretePattern.map((point) => ({ ...point, time: point.time + offset })));
    if (index > 0) {
      // Keep the entire gap silent, rather than letting Core Haptics interpolate
      // a rising vibration from the previous ending into the next attack.
      repeated.continuousPattern.amplitude.push({ time: offset - 1, value: 0 });
    }
    for (const key of ['amplitude', 'frequency'] as const) {
      repeated.continuousPattern[key].push(
        ...single.continuousPattern[key].map((point) => ({ ...point, time: point.time + offset })),
      );
    }
  }
  return repeated;
}

export function sameHapticChoice(a: HapticChoice, b: HapticChoice) {
  return (
    a.preset === b.preset &&
    (a.preset === 'off' ||
      (a.delayMs === b.delayMs &&
        (!isCustomHaptic(a.preset) ||
          (a.strength === b.strength &&
            a.sharpness === b.sharpness &&
            a.durationMs === b.durationMs &&
            (!hasHapticHits(a.preset) || a.hitStrength === b.hitStrength) &&
            a.rumbleStrength === b.rumbleStrength &&
            a.repeatCount === b.repeatCount &&
            (a.repeatCount === 1 || a.repeatGapMs === b.repeatGapMs)))))
  );
}

// Also accepts v1: keep explicit Off/Original choices, replace retired UI taps
// with the event's new default. Never carry the old gap setting into a waveform.
export function parseHapticPreferences(raw: string | null): HapticPreferences {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  return Object.fromEntries(
    hapticEvents.map((event) => {
      const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>)[event] : null;
      if (!candidate || typeof candidate !== 'object') return [event, { ...defaultHapticPreferences[event] }];
      const choice = candidate as Record<string, unknown>;
      const preset = eventPresets[event].includes(choice.preset as HapticPreset)
        ? (choice.preset as HapticPreset)
        : defaultHapticPreferences[event].preset;
      const fallback = createHapticChoice(preset);
      return [
        event,
        {
          preset,
          strength: boundedNumber(choice.strength, 5, 100, fallback.strength),
          sharpness: boundedNumber(choice.sharpness, 0, 100, fallback.sharpness),
          durationMs: isCustomHaptic(preset)
            ? boundedNumber(choice.durationMs, 50, 900, fallback.durationMs)
            : fallback.durationMs,
          delayMs: boundedNumber(choice.delayMs, 0, 250, fallback.delayMs),
          hitStrength: boundedNumber(choice.hitStrength, 0, 100, fallback.hitStrength),
          rumbleStrength: boundedNumber(choice.rumbleStrength, 0, 100, fallback.rumbleStrength),
          repeatCount: boundedNumber(choice.repeatCount, 1, 3, fallback.repeatCount),
          repeatGapMs: boundedNumber(choice.repeatGapMs, 25, 400, fallback.repeatGapMs),
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
