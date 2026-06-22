import { Platform } from 'react-native';
import { supabase } from './supabase';
import type { ProfileInput } from './types';

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

export function getAuthRedirectUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }

  return 'sucker://auth/callback';
}

export function hasAuthCallbackParams(url: string | null) {
  if (!url) {
    return false;
  }

  const params = getAuthCallbackParams(url);
  return Boolean(params.get('code') || params.get('access_token') || params.get('error') || params.get('error_code'));
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

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    return null;
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    throw error;
  }

  clearAuthParamsFromBrowserUrl();
  return data.session;
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

  const { data, error } = await supabase
    .from('profiles')
    .update({
      avatar_url: input.avatarUrl ?? null,
      display_name: input.displayName,
      username: input.username ?? null,
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
