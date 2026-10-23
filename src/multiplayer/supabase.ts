import 'react-native-url-polyfill/auto';

import { createClient, FunctionRegion, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { authStorage, authStorageKey } from './authStorage';
import { getMultiplayerConfig } from './env';
import { fetchWithAuthRecovery } from './authFetch';
import { isLocalBackendUrl } from './localDevelopment';

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

// A game action makes several sequential database calls, so run it near the
// hosted database (us-east-2) rather than in the edge region nearest the player.
// us-east-2 cannot be forced, and us-east-1 is the closest region that can.
export const gameActionRegion = isLocalBackendUrl(config.supabaseUrl) ? undefined : FunctionRegion.UsEast1;

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
