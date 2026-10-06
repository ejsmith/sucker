import { hapticSteps, type HapticChoice, type HapticEffect, type HapticEvent } from './patterns';

export function createHapticPlayer(driver: {
  trigger: (effect: HapticEffect, event: HapticEvent) => void | Promise<void>;
  cancel: () => void;
  isActive: () => boolean;
}) {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let generation = 0;

  function cancel() {
    generation++;
    timers.forEach(clearTimeout);
    timers = [];
    driver.cancel();
  }

  function play(event: HapticEvent, choice: HapticChoice) {
    cancel();
    if (!driver.isActive()) return;
    const current = generation;
    for (const { atMs, effect } of hapticSteps(choice)) {
      const trigger = () => {
        if (current !== generation || !driver.isActive()) return;
        // Haptics are optional hardware feedback and must never interrupt gameplay.
        try {
          void Promise.resolve(driver.trigger(effect, event)).catch(() => undefined);
        } catch {
          // Unsupported devices can throw before returning a promise.
        }
      };
      if (atMs === 0) trigger();
      else timers.push(setTimeout(trigger, atMs));
    }
  }

  return { play, cancel };
}
