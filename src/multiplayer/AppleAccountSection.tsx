import type { User } from '@supabase/supabase-js';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { hasAppleIdentity } from './appleIdentity';
import { AppleSignInButton } from './AppleSignInButton';

export function AppleAccountSection({
  user,
  disabled,
  onConnect,
  connected = hasAppleIdentity(user),
}: {
  user: User;
  disabled: boolean;
  onConnect: () => void;
  connected?: boolean;
}) {
  if (Platform.OS !== 'ios') return null;

  return (
    <View style={styles.section} testID="account-apple-section">
      {connected ? (
        <View accessibilityLiveRegion="polite" style={styles.connected} testID="apple-connected-status">
          <Text style={styles.heading}>✓ Apple connected</Text>
          <Text style={styles.help}>You can sign in with Apple to return to this account and your games.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.help}>
            Connect Apple to sign in to this account and keep your games, even with Hide My Email.
          </Text>
          <AppleSignInButton compact disabled={disabled} onPress={onConnect} testID="connect-apple-button" />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, width: '100%' },
  connected: {
    backgroundColor: '#3B2608',
    borderColor: '#DDAA22',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  heading: { color: '#FFD329', fontSize: 16, fontWeight: '800' },
  help: { color: '#FFF3C2', fontSize: 13, lineHeight: 18, opacity: 0.88 },
});
