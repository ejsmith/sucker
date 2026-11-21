import 'react-native-url-polyfill/auto';

import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { authStorage, authStorageKey } from './authStorage';
import { getMultiplayerConfig } from './env';
import { fetchWithAuthRecovery } from './authFetch';

const config = getMultiplayerConfig();

export const supabase = createClient(config.supabaseUrl || 'http://localhost', config.supabaseAnonKey || 'anon', {
  global: { fetch: fetchWithAuthRecovery },
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    lock: processLock,
    persistSession: true,
    storage: authStorage,
    storageKey: authStorageKey,
  },
});

export const isMultiplayerConfigured = config.enabled;

if (isMultiplayerConfigured && Platform.OS !== 'web') {
  if (AppState.currentState === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }

  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
