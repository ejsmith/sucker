import { Platform, TurboModuleRegistry, Vibration, type TurboModule } from 'react-native';
import { createNativePatternPlayer, type NativePatternBridge } from './nativePatternPlayer';
import type { HapticDriver } from './player';
import type { HapticSupport } from './driver';

interface PulsarBridge extends TurboModule, NativePatternBridge {
  Pulsar_hapticSupport: () => number;
}

export function createHapticDriver(): HapticDriver & { support: HapticSupport } {
  let bridge: PulsarBridge | null = null;
  let support: HapticSupport = 'missing';
  try {
    bridge = TurboModuleRegistry.get<PulsarBridge>('RNPulsar');
    if (bridge) {
      const level = bridge.Pulsar_hapticSupport();
      support = level >= 3 ? 'full' : level > 0 ? 'limited' : 'unavailable';
    }
  } catch {
    /* Expo Go and older app binaries don't contain Pulsar. */
  }
  const native =
    bridge && support !== 'unavailable' && support !== 'missing' ? createNativePatternPlayer(bridge) : null;
  return {
    support,
    playPattern: (pattern) => native?.playPattern(pattern),
    playOriginal: (event) =>
      Vibration.vibrate(
        event === 'sucker'
          ? Platform.OS === 'ios'
            ? [0, 550]
            : [0, 120, 100, 180]
          : event === 'punchLanded'
            ? 120
            : 400,
      ),
    cancel: () => {
      try {
        native?.cancel();
      } finally {
        Vibration.cancel();
      }
    },
  };
}
