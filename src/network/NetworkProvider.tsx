import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCurrentSession } from '../multiplayer/auth';
import {
  mergeRecoveredActions,
  type ActionRequest,
  type RecoveredMultiplayerAction,
} from '../multiplayer/actionRecovery';
import { listPendingMultiplayerActions, recoverPendingMultiplayerActions } from '../multiplayer/games';
import { reportError } from '../monitoring/exceptionless';

type NetworkContextValue = {
  isOffline: boolean;
  isRecovering: boolean;
  pendingActions: ActionRequest[];
  recoveredActions: RecoveredMultiplayerAction[];
  consumeRecoveredActions: (requestIds: string[]) => void;
  refresh: () => Promise<void>;
};

const NetworkContext = createContext<NetworkContextValue>({
  isOffline: false,
  isRecovering: false,
  pendingActions: [],
  recoveredActions: [],
  consumeRecoveredActions: () => undefined,
  refresh: async () => undefined,
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkState, setNetworkState] = useState<NetInfoState | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [pendingActions, setPendingActions] = useState<ActionRequest[]>([]);
  const [recoveredActions, setRecoveredActions] = useState<RecoveredMultiplayerAction[]>([]);
  const isMounted = useRef(true);
  const isOffline = networkState?.isConnected === false || networkState?.isInternetReachable === false;

  const loadPending = useCallback(async () => {
    const session = await getCurrentSession();
    const pending = session ? await listPendingMultiplayerActions(session.user.id) : [];
    if (isMounted.current) {
      setPendingActions(pending);
    }
  }, []);

  const recover = useCallback(async () => {
    try {
      const session = await getCurrentSession();
      if (!session) {
        if (isMounted.current) {
          setPendingActions([]);
        }
        return;
      }
      setIsRecovering(true);
      const recovered = await recoverPendingMultiplayerActions(session.user.id);
      const pending = await listPendingMultiplayerActions(session.user.id);
      if (isMounted.current) {
        setPendingActions(pending);
        if (recovered.length > 0) {
          setRecoveredActions((current) => mergeRecoveredActions(current, recovered));
        }
      }
    } catch (error) {
      await reportError(error, { Operation: 'RecoverPendingMultiplayerActions' });
    } finally {
      if (isMounted.current) {
        setIsRecovering(false);
      }
    }
  }, []);

  const consumeRecoveredActions = useCallback((requestIds: string[]) => {
    const consumed = new Set(requestIds);
    setRecoveredActions((current) => current.filter((item) => !consumed.has(item.requestId)));
  }, []);

  const refresh = useCallback(async () => {
    const state = await NetInfo.fetch();
    setNetworkState(state);
    if (state.isConnected !== false && state.isInternetReachable !== false) {
      await recover();
    } else {
      await loadPending();
    }
  }, [loadPending, recover]);

  useEffect(() => {
    isMounted.current = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      setNetworkState(state);
      if (state.isConnected !== false && state.isInternetReachable !== false) {
        void recover();
      } else {
        void loadPending();
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
  }, [loadPending, recover, refresh]);

  const value = useMemo(
    () => ({ consumeRecoveredActions, isOffline, isRecovering, pendingActions, recoveredActions, refresh }),
    [consumeRecoveredActions, isOffline, isRecovering, pendingActions, recoveredActions, refresh],
  );
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function NetworkStatusBanner() {
  const { isOffline, isRecovering } = useNetworkStatus();
  if (!isOffline && !isRecovering) {
    return null;
  }

  return (
    <SafeAreaView
      accessibilityLiveRegion="polite"
      edges={['top']}
      role="status"
      style={[styles.banner, isOffline && styles.offline]}
    >
      <Text style={styles.text}>
        {isOffline ? 'Offline — showing saved games. Actions resume when connected.' : 'Synchronizing game actions…'}
      </Text>
    </SafeAreaView>
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
