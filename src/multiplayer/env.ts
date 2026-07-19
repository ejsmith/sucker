import { isLocalBackendUrl } from './localDevelopment';

type BrowserMultiplayerConfig = {
  accessToken?: string;
  refreshToken?: string;
  supabaseAnonKey?: string;
  supabaseUrl?: string;
};

declare const process:
  | {
      env: Record<string, string | undefined>;
    }
  | undefined;

declare const window:
  | {
      __SUCKER_E2E_MULTIPLAYER_CONFIG__?: BrowserMultiplayerConfig;
    }
  | undefined;

export type MultiplayerConfig = {
  enabled: boolean;
  supabaseAnonKey: string;
  supabaseUrl: string;
};

export function getE2ESession() {
  if (typeof process === 'undefined' || process.env.EXPO_PUBLIC_E2E_DISABLE_ANIMATIONS !== '1') {
    return null;
  }
  const browserConfig = typeof window !== 'undefined' ? window.__SUCKER_E2E_MULTIPLAYER_CONFIG__ : undefined;
  return browserConfig?.accessToken && browserConfig.refreshToken
    ? { access_token: browserConfig.accessToken, refresh_token: browserConfig.refreshToken }
    : null;
}

export function getMultiplayerConfig(): MultiplayerConfig {
  const browserConfig = typeof window !== 'undefined' ? window.__SUCKER_E2E_MULTIPLAYER_CONFIG__ : undefined;
  const envSupabaseUrl = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_SUPABASE_URL : undefined;
  const envSupabaseAnonKey = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY : undefined;
  const supabaseUrl = envSupabaseUrl || browserConfig?.supabaseUrl || '';
  const supabaseAnonKey = envSupabaseAnonKey || browserConfig?.supabaseAnonKey || '';

  return {
    enabled: Boolean(supabaseUrl && supabaseAnonKey),
    supabaseAnonKey,
    supabaseUrl,
  };
}

export function isLocalMultiplayerDevelopment() {
  const config = getMultiplayerConfig();
  return __DEV__ && config.enabled && isLocalBackendUrl(config.supabaseUrl);
}
