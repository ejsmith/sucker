import { useEffect, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, StyleSheet, View } from 'react-native';

export function AppleSignInButton({
  compact = false,
  disabled,
  onPress,
  testID = 'apple-sign-in-button',
}: {
  compact?: boolean;
  disabled: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    void AppleAuthentication.isAvailableAsync()
      .then((value) => {
        if (active) setAvailable(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (Platform.OS !== 'ios' || !available) return null;

  return (
    <View pointerEvents={disabled ? 'none' : 'auto'} style={[styles.shadow, disabled && styles.disabled]}>
      <AppleAuthentication.AppleAuthenticationButton
        accessibilityState={{ disabled }}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        cornerRadius={compact ? 8 : 10}
        onPress={() => {
          if (!disabled) onPress();
        }}
        style={[styles.button, compact && styles.compactButton]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { height: 60, width: '100%' },
  compactButton: { height: 44 },
  disabled: { opacity: 0.62 },
  shadow: {
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
  },
});
