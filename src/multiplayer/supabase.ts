import 'react-native-url-polyfill/auto';

import * as AsyncStorageModule from '@react-native-async-storage/async-storage';
import type { AsyncStorageStatic } from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { getMultiplayerConfig } from './env';

const config = getMultiplayerConfig();
const asyncStorageModule = AsyncStorageModule.default as unknown as
  | AsyncStorageStatic
  | { default: AsyncStorageStatic };
const AsyncStorage = (
  'getItem' in asyncStorageModule ? asyncStorageModule : asyncStorageModule.default
) as AsyncStorageStatic;

export const supabase = createClient(config.supabaseUrl || 'http://localhost', config.supabaseAnonKey || 'anon', {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: AsyncStorage,
  },
});

export const isMultiplayerConfigured = config.enabled;
