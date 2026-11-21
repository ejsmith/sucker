import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getMultiplayerConfig } from './env';

// Match Supabase's existing default so installed sessions need no migration.
export const authStorageKey = `sb-${new URL(getMultiplayerConfig().supabaseUrl || 'http://localhost').hostname.split('.')[0]}-auth-token`;

// iOS wakes the app in the background (push, resume before unlock) while the
// device can still be locked. The default WHEN_UNLOCKED items are unreadable
// then ("User interaction is not allowed"), which failed session restores and
// pending-action recovery.
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const authStorage =
  Platform.OS === 'web'
    ? AsyncStorage
    : {
        async getItem(key: string) {
          const securedValue = await SecureStore.getItemAsync(key, secureStoreOptions);
          if (securedValue !== null) {
            return securedValue;
          }

          const legacyValue = await AsyncStorage.getItem(key);
          if (legacyValue !== null) {
            await writeSecureItem(key, legacyValue);
            await AsyncStorage.removeItem(key);
          }
          return legacyValue;
        },
        removeItem(key: string) {
          return Promise.all([SecureStore.deleteItemAsync(key, secureStoreOptions), AsyncStorage.removeItem(key)]).then(
            () => undefined,
          );
        },
        setItem: writeSecureItem,
      };

// Updating an existing keychain item keeps its original accessibility, so
// items written before AFTER_FIRST_UNLOCK are replaced once.
async function writeSecureItem(key: string, value: string) {
  const migrationKey = `sucker:secure-store-after-first-unlock:${key}`;
  const isMigrated = await AsyncStorage.getItem(migrationKey).then(
    (flag) => flag === '1',
    () => false,
  );
  if (isMigrated) {
    await SecureStore.setItemAsync(key, value, secureStoreOptions);
    return;
  }

  await SecureStore.deleteItemAsync(key, secureStoreOptions);
  try {
    await SecureStore.setItemAsync(key, value, secureStoreOptions);
  } catch (writeError) {
    // Never leave the player without a saved session: put the value back with
    // the default accessibility and try the migration again on the next write.
    await SecureStore.setItemAsync(key, value).catch(() => undefined);
    throw writeError;
  }
  // A lost flag only repeats the migration, which is safe.
  await AsyncStorage.setItem(migrationKey, '1').catch(() => undefined);
}
