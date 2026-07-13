import { forwardRef } from 'react';
import { Pressable as NativePressable, type PressableProps, type View } from 'react-native';

export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  { accessibilityRole, accessibilityState, accessible, disabled, ...props },
  ref,
) {
  const resolvedAccessibilityRole = accessibilityRole ?? (accessible === false ? undefined : 'button');

  return (
    <NativePressable
      accessibilityRole={resolvedAccessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: disabled || accessibilityState?.disabled }}
      accessible={accessible}
      disabled={disabled}
      ref={ref}
      {...props}
    />
  );
});
