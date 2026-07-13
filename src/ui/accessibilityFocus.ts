import type { ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, View } from 'react-native';

export type AccessibilityTargetRef = ComponentRef<typeof View>;

export function focusAccessibilityTarget(target: AccessibilityTargetRef | null) {
  if (!target) {
    return;
  }

  if (Platform.OS === 'web') {
    (target as unknown as { focus?: () => void }).focus?.();
    return;
  }

  const reactTag = findNodeHandle(target);
  if (reactTag !== null) {
    AccessibilityInfo.setAccessibilityFocus(reactTag);
  }
}
