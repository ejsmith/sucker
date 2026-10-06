import type { HapticDriver } from './player';

export type HapticSupport = 'full' | 'limited' | 'unavailable' | 'missing' | 'web';

// Web is deliberately silent. Browser vibration cannot reproduce these textures.
export function createHapticDriver(): HapticDriver & { support: HapticSupport } {
  return { support: 'web', playPattern: () => {}, playOriginal: () => {}, cancel: () => {} };
}
