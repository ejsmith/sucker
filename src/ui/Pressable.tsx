import { forwardRef } from 'react';
import { Pressable as NativePressable, type PressableProps, type View } from 'react-native';

export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  { accessibilityRole = 'button', accessibilityState, disabled, ...props },
  ref,
) {
  return (
    <NativePressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: disabled || accessibilityState?.disabled }}
      disabled={disabled}
      ref={ref}
      {...props}
    />
  );
});
