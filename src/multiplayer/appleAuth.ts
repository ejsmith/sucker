import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { isMultiplayerConfigured, supabase } from './supabase';

export type AppleAuthAction = 'signIn' | 'link';

export async function authenticateWithApple(action: AppleAuthAction = 'signIn') {
  if (Platform.OS !== 'ios') {
    throw new Error('Apple sign-in is only available in the iOS app.');
  }

  if (!isMultiplayerConfigured) {
    throw new Error('Online sign-in is not configured.');
  }

  if (action === 'link') {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Sign in to your existing account before connecting Apple.');
  }

  if (!(await AppleAuthentication.isAvailableAsync())) {
    throw new Error('Sign in with Apple is not available on this device.');
  }

  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      nonce: hashedNonce,
      // Players choose their public display name in their Sucker profile.
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') {
      return null;
    }
    throw error;
  }

  if (!credential.identityToken) {
    throw new Error('Apple did not return a sign-in token. Please try again.');
  }

  const credentials = { provider: 'apple' as const, token: credential.identityToken, nonce };
  const { data, error } =
    action === 'link'
      ? await supabase.auth.linkIdentity({ provider: 'apple', token: credential.identityToken, nonce })
      : await supabase.auth.signInWithIdToken(credentials);
  if (error) throw error;
  if (!data.session) throw new Error('Unable to finish signing in with Apple. Please try again.');
  return data.session;
}
