import { buildHapticPattern, type HapticChoice, type HapticEvent, type HapticPattern } from './patterns';

export type HapticDriver = {
  playPattern: (pattern: HapticPattern) => void;
  playOriginal: (event: HapticEvent) => void;
  cancel: () => void;
};

export function createHapticPlayer(driver: HapticDriver & { isActive: () => boolean }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  function cancel() {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    try {
      driver.cancel();
    } catch {
      /* Optional hardware must never interrupt gameplay. */
    }
  }

  function play(event: HapticEvent, choice: HapticChoice) {
    cancel();
    if (!driver.isActive() || choice.preset === 'off') return;
    const current = generation;
    const trigger = () => {
      timer = undefined;
      if (current !== generation || !driver.isActive()) return;
      try {
        if (choice.preset === 'original') driver.playOriginal(event);
        else {
          const pattern = buildHapticPattern(choice);
          if (pattern) driver.playPattern(pattern);
        }
      } catch {
        /* Unsupported hardware is allowed to produce no feedback. */
      }
    };
    const delay = Number.isFinite(choice.delayMs) ? Math.max(0, Math.min(250, choice.delayMs)) : 0;
    // Only the optional reveal delay uses JS. All strikes/curves run as one native timeline.
    if (delay === 0) trigger();
    else timer = setTimeout(trigger, delay);
  }

  return { play, cancel };
}
