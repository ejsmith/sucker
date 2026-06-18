import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { getMultiplayerConfig } from './env';

const config = getMultiplayerConfig();

export const supabase = createClient(config.supabaseUrl || 'http://localhost', config.supabaseAnonKey || 'anon', {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: AsyncStorage,
  },
});

export const isMultiplayerConfigured = config.enabled;
