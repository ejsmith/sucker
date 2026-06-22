declare const process: {
  env: Record<string, string | undefined>;
};

export type MultiplayerConfig = {
  enabled: boolean;
  supabaseAnonKey: string;
  supabaseUrl: string;
};

export function getMultiplayerConfig(): MultiplayerConfig {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

  return {
    enabled: Boolean(supabaseUrl && supabaseAnonKey),
    supabaseAnonKey,
    supabaseUrl,
  };
}
