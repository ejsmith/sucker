import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const authStorage =
  Platform.OS === 'web'
    ? AsyncStorage
    : {
        async getItem(key: string) {
          const securedValue = await SecureStore.getItemAsync(key);
          if (securedValue !== null) {
            return securedValue;
          }

          const legacyValue = await AsyncStorage.getItem(key);
          if (legacyValue !== null) {
            await SecureStore.setItemAsync(key, legacyValue);
            await AsyncStorage.removeItem(key);
          }
          return legacyValue;
        },
        removeItem(key: string) {
          return Promise.all([SecureStore.deleteItemAsync(key), AsyncStorage.removeItem(key)]).then(() => undefined);
        },
        setItem(key: string, value: string) {
          return SecureStore.setItemAsync(key, value);
        },
      };
