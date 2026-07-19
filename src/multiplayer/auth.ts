import { Platform } from 'react-native';
import { isLocalMultiplayerDevelopment } from './env';
import { supabase } from './supabase';
import type { ProfileInput } from './types';

export type LocalTestPlayer = 1 | 2;

const localTestPlayers = {
  1: {
    displayName: 'Test Player 1',
    email: 'test1@sucker.local',
    password: 'sucker-local-test-1',
    username: 'test1',
  },
  2: {
    displayName: 'Test Player 2',
    email: 'test2@sucker.local',
    password: 'sucker-local-test-2',
    username: 'test2',
  },
} as const;

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  return data.session;
}

export async function signInWithEmail(email: string) {
  const emailRedirectTo = getAuthRedirectUrl();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw error;
  }

  return emailRedirectTo;
}

export async function verifyEmailCode(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });

  if (error) {
    throw error;
  }

  return data.session;
}

export async function signInAsLocalTestPlayer(player: LocalTestPlayer) {
  if (!isLocalMultiplayerDevelopment()) {
    throw new Error('Test player login is only available with a local development backend.');
  }

  const testPlayer = localTestPlayers[player];
  const signInResult = await supabase.auth.signInWithPassword({
    email: testPlayer.email,
    password: testPlayer.password,
  });
  let session = signInResult.data.session;

  if (
    signInResult.error &&
    signInResult.error.status === 400 &&
    signInResult.error.message.toLowerCase().includes('invalid login credentials')
  ) {
    const signUpResult = await supabase.auth.signUp({
      email: testPlayer.email,
      options: { data: { display_name: testPlayer.displayName } },
      password: testPlayer.password,
    });
    if (signUpResult.error) {
      throw signUpResult.error;
    }
    session = signUpResult.data.session;
  } else if (signInResult.error) {
    throw signInResult.error;
  }

  if (!session) {
    throw new Error('Local email confirmations must be disabled to use test player login.');
  }

  await upsertProfile({ displayName: testPlayer.displayName, username: testPlayer.username });
  return session;
}

export function getAuthRedirectUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }

  return __DEV__ ? 'sucker://auth/callback' : 'https://sucker.games/auth/callback';
}

export function hasAuthCallbackParams(url: string | null) {
  if (!url) {
    return false;
  }

  const params = getAuthCallbackParams(url);
  return Boolean(params.get('code') || params.get('error') || params.get('error_code'));
}

export async function createSessionFromAuthUrl(url: string) {
  const params = getAuthCallbackParams(url);
  const errorCode = params.get('error_code') ?? params.get('error');
  if (errorCode) {
    clearAuthParamsFromBrowserUrl();
    throw new Error(params.get('error_description') ?? errorCode);
  }

  const code = params.get('code');
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      throw error;
    }

    clearAuthParamsFromBrowserUrl();
    return data.session;
  }

  return null;
}

function getAuthCallbackParams(url: string) {
  const parsedUrl = new URL(url);
  const params = new URLSearchParams(parsedUrl.search);
  const hash = parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash;
  const hashParams = new URLSearchParams(hash);

  hashParams.forEach((value, key) => {
    params.set(key, value);
  });

  return params;
}

function clearAuthParamsFromBrowserUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function upsertProfile(input: ProfileInput) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }
  if (!user) {
    throw new Error('You must be signed in to update your profile.');
  }

  const updates = {
    display_name: input.displayName,
    username: input.username ?? null,
    ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
  };
  const { data, error } = await supabase.from('profiles').update(updates).eq('id', user.id).select().single();

  if (error) {
    throw error;
  }

  return data;
}
