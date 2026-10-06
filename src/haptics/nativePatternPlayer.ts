import type { HapticPattern } from './patterns';

// Pulsar 1.7's imperative hook parse() retains previous native pattern handles.
// Use its pinned bridge contract to own and release exactly one handle, including
// when the lab auditions many variations. No JS timers drive individual strikes.
export type NativePatternBridge = {
  PatternComposer_parsePattern: (pattern: HapticPattern) => number;
  PatternComposer_play: (id: number) => void;
  PatternComposer_stop: (id: number) => void;
  PatternComposer_release: (id: number) => void;
};

export function createNativePatternPlayer(bridge: NativePatternBridge) {
  let handle: number | undefined;
  function cancel() {
    const previous = handle;
    handle = undefined;
    if (previous === undefined) return;
    try {
      bridge.PatternComposer_stop(previous);
    } finally {
      bridge.PatternComposer_release(previous);
    }
  }
  function playPattern(pattern: HapticPattern) {
    cancel();
    handle = bridge.PatternComposer_parsePattern(pattern);
    try {
      bridge.PatternComposer_play(handle);
    } catch (error) {
      cancel();
      throw error;
    }
  }
  return { playPattern, cancel };
}
