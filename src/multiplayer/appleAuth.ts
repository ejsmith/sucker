import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { isMultiplayerConfigured, supabase } from './supabase';
import { hasAppleIdentity } from './appleIdentity';

export type AppleAuthAction = 'signIn' | 'link';

export async function authenticateWithApple(action: AppleAuthAction = 'signIn') {
  if (Platform.OS !== 'ios') {
    throw new Error('Apple sign-in is only available in the iOS app.');
  }

  if (!isMultiplayerConfigured) {
    throw new Error('Online sign-in is not configured.');
  }

  let linkingUserId: string | undefined;
  if (action === 'link') {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Sign in to your existing account before connecting Apple.');
    linkingUserId = data.user.id;
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

  if (action === 'link') {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (data.user?.id !== linkingUserId) {
      throw new Error('Your signed-in account changed. Please connect Apple again from Profile.');
    }
  }

  const credentials = { provider: 'apple' as const, token: credential.identityToken, nonce };
  const { data, error } =
    action === 'link'
      ? await supabase.auth.linkIdentity({ provider: 'apple', token: credential.identityToken, nonce })
      : await supabase.auth.signInWithIdToken(credentials);
  if (error) throw error;
  if (!data.session) throw new Error('Unable to finish signing in with Apple. Please try again.');
  if (action === 'link') {
    async function rejectAccountMismatch() {
      // Supabase publishes auth updates before returning. Remove a mismatched
      // session locally as well, rather than leaving it active after throwing.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      throw new Error('Your signed-in account changed. Please sign in again before connecting Apple.');
    }
    if (data.session.user.id !== linkingUserId) return rejectAccountMismatch();
    // Linking has already succeeded. Updating its snapshot is best effort: a
    // network failure here must not send the player through linking a second time.
    const { data: refreshed } = await supabase.auth.refreshSession(data.session).catch(() => ({
      data: { session: null },
    }));
    if (refreshed.session && refreshed.session.user.id !== linkingUserId) return rejectAccountMismatch();
    if (refreshed.session && hasAppleIdentity(refreshed.session.user)) return refreshed.session;

    const linkedSession = refreshed.session ?? data.session;
    const { data: current } = await supabase.auth.getUser(linkedSession.access_token).catch(() => ({
      data: { user: null },
    }));
    if (current.user && current.user.id !== linkingUserId) return rejectAccountMismatch();
    // Do not restore an old account after a sign-out or switch during these reads.
    const { data: active, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!active.session || active.session.user.id !== linkingUserId) return rejectAccountMismatch();
    if (current.user) {
      return { ...active.session, user: current.user };
    }
    return active.session;
  }
  return data.session;
}
