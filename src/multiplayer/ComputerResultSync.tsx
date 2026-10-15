import NetInfo from '@react-native-community/netinfo';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { flushComputerResults } from './computerResultQueue';
import { isMultiplayerConfigured, supabase } from './supabase';

export function ComputerResultSync() {
  useEffect(() => {
    if (!isMultiplayerConfigured) return;
    let active = true;
    const recover = () => {
      if (!active || AppState.currentState === 'background') return;
      void flushComputerResults().catch((error: unknown) => console.warn('Computer results remain queued', error));
    };
    recover();
    const auth = supabase.auth.onAuthStateChange(() => {
      setTimeout(recover, 0);
    });
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) recover();
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') recover();
    });
    const retry = setInterval(recover, 60_000);
    return () => {
      active = false;
      auth.data.subscription.unsubscribe();
      network();
      app.remove();
      clearInterval(retry);
    };
  }, []);
  return null;
}
