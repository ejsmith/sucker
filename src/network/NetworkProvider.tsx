import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { getCurrentSession } from '../multiplayer/auth';
import { recoverPendingMultiplayerActions } from '../multiplayer/games';
import { reportError } from '../monitoring/exceptionless';

type NetworkContextValue = {
  isOffline: boolean;
  isRecovering: boolean;
  refresh: () => Promise<void>;
};

const NetworkContext = createContext<NetworkContextValue>({
  isOffline: false,
  isRecovering: false,
  refresh: async () => undefined,
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkState, setNetworkState] = useState<NetInfoState | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const isMounted = useRef(true);
  const isOffline = networkState?.isConnected === false || networkState?.isInternetReachable === false;

  const recover = useCallback(async () => {
    try {
      const session = await getCurrentSession();
      if (!session) {
        return;
      }
      setIsRecovering(true);
      await recoverPendingMultiplayerActions();
    } catch (error) {
      await reportError(error, { Operation: 'RecoverPendingMultiplayerActions' });
    } finally {
      if (isMounted.current) {
        setIsRecovering(false);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    const state = await NetInfo.fetch();
    setNetworkState(state);
    if (state.isConnected !== false && state.isInternetReachable !== false) {
      await recover();
    }
  }, [recover]);

  useEffect(() => {
    isMounted.current = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      setNetworkState(state);
      if (state.isConnected !== false && state.isInternetReachable !== false) {
        void recover();
      }
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
      }
    });
    return () => {
      isMounted.current = false;
      unsubscribe();
      appStateSubscription.remove();
    };
  }, [recover, refresh]);

  const value = useMemo(() => ({ isOffline, isRecovering, refresh }), [isOffline, isRecovering, refresh]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function NetworkStatusBanner() {
  const { isOffline, isRecovering } = useNetworkStatus();
  if (!isOffline && !isRecovering) {
    return null;
  }

  return (
    <View accessibilityLiveRegion="polite" role="status" style={[styles.banner, isOffline && styles.offline]}>
      <Text style={styles.text}>
        {isOffline ? 'Offline — showing saved games. Actions resume when connected.' : 'Synchronizing game actions…'}
      </Text>
    </View>
  );
}

export function useNetworkStatus() {
  return useContext(NetworkContext);
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#684D00',
    left: 0,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 100,
  },
  offline: {
    backgroundColor: '#3F3030',
  },
  text: {
    color: '#FFF8DC',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
});
