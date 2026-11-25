import { Platform, type ViewStyle } from 'react-native';

export const usesLegacyAndroidShadowFallback = Platform.OS === 'android' && Platform.Version < 28;

export function createBoxShadowStyle(offsetX: number, offsetY: number, blurRadius: number, color: string): ViewStyle {
  if (usesLegacyAndroidShadowFallback) {
    const extent = Math.max(Math.abs(offsetX), Math.abs(offsetY), blurRadius);
    return extent === 0 ? {} : { elevation: Math.max(1, Math.ceil(extent)) };
  }

  return {
    boxShadow: [{ blurRadius, color, offsetX, offsetY }],
  };
}
