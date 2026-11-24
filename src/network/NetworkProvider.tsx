import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState, Platform, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCurrentSession, getStoredSessionSnapshot } from '../multiplayer/auth';
import {
  mergeRecoveredActions,
  type ActionRequest,
  type RecoveredMultiplayerAction,
} from '../multiplayer/actionRecovery';
import { listPendingMultiplayerActions, recoverPendingMultiplayerActions } from '../multiplayer/games';
import { isTemporarySessionError } from '../multiplayer/sessionRecovery';
import { reportError } from '../monitoring/exceptionless';
import { runWithCleanup } from '../ui/runWithCleanup';
import { actionRequestStatus } from './actionRequestStatus';

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

const recoveryRetryDelaysMs = [5_000, 15_000, 45_000];

async function loadStoredPendingActions() {
  // Reading local pending actions must not require an online token refresh.
  const session = await getStoredSessionSnapshot();
  return session ? listPendingMultiplayerActions(session.user.id) : [];
}

type RecoveryPass = { kind: 'signed-out' } | { kind: 'reported' } | { kind: 'finished'; failure: unknown };

async function runRecoveryPass(
  onStart: () => void,
  onPending: (pending: ActionRequest[], recovered: RecoveredMultiplayerAction[]) => void,
): Promise<RecoveryPass> {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return { kind: 'signed-out' };
    }
    onStart();
    const { recovered, retryableError } = await recoverPendingMultiplayerActions(session.user.id);
    const pending = await listPendingMultiplayerActions(session.user.id);
    onPending(pending, recovered);
    return { kind: 'finished', failure: pending.length > 0 ? retryableError : null };
  } catch (error) {
    if (!isTemporarySessionError(error)) {
      await reportError(error, { Operation: 'RecoverPendingMultiplayerActions' });
      return { kind: 'reported' };
    }
    return { kind: 'finished', failure: error };
  }
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkState, setNetworkState] = useState<NetInfoState | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [pendingActions, setPendingActions] = useState<ActionRequest[]>([]);
  const [recoveredActions, setRecoveredActions] = useState<RecoveredMultiplayerAction[]>([]);
  const isMounted = useRef(true);
  const recoveryRetry = useRef<{ attempt: number; timer?: ReturnType<typeof setTimeout> }>({ attempt: 0 });
  const recoverRef = useRef<() => Promise<void>>(async () => undefined);
  const recoveryInFlight = useRef<Promise<void> | null>(null);
  const isOffline = networkState?.isConnected === false || networkState?.isInternetReachable === false;

  const loadPending = useCallback(async () => {
    await loadStoredPendingActions().then(
      (pending) => {
        if (isMounted.current) setPendingActions(pending);
      },
      (error: unknown) => {
        void reportError(error, { Operation: 'LoadPendingMultiplayerActions' });
      },
    );
  }, []);

  const runRecovery = useCallback(async () => {
    clearTimeout(recoveryRetry.current.timer);
    const pass = await runWithCleanup(
      () =>
        runRecoveryPass(
          () => setIsRecovering(true),
          (pending, recovered) => {
            if (!isMounted.current) return;
            setPendingActions(pending);
            if (recovered.length > 0) {
              setRecoveredActions((current) => mergeRecoveredActions(current, recovered));
            }
          },
        ),
      () => {
        if (isMounted.current) {
          setIsRecovering(false);
        }
      },
    );
    if (pass.kind === 'signed-out') {
      recoveryRetry.current.attempt = 0;
      if (isMounted.current) {
        setPendingActions([]);
      }
      return;
    }
    if (pass.kind === 'reported') {
      recoveryRetry.current.attempt = 0;
      return;
    }
    const failure = pass.failure;

    if (failure === null) {
      recoveryRetry.current.attempt = 0;
      return;
    }

    // Resuming often runs before the network is back, and connectivity events
    // may not follow. Retry moves that are still pending with backoff, and
    // report only once retrying has not helped.
    const attempt = recoveryRetry.current.attempt;
    if (attempt < recoveryRetryDelaysMs.length) {
      recoveryRetry.current.attempt = attempt + 1;
      if (isMounted.current) {
        recoveryRetry.current.timer = setTimeout(() => void recoverRef.current(), recoveryRetryDelaysMs[attempt]);
      }
      return;
    }
    recoveryRetry.current.attempt = 0;
    await reportError(failure, { Operation: 'RecoverPendingMultiplayerActions', RecoveryAttempts: attempt + 1 });
  }, []);

  // App resume and connectivity changes often both trigger recovery. Share one
  // pass so they don't consume two retry attempts or orphan a retry timer.
  const recover = useCallback(() => {
    if (!recoveryInFlight.current) {
      recoveryInFlight.current = runRecovery().finally(() => {
        recoveryInFlight.current = null;
      });
    }
    return recoveryInFlight.current;
  }, [runRecovery]);

  useEffect(() => {
    recoverRef.current = recover;
  }, [recover]);

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
    const retry = recoveryRetry.current;
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
      clearTimeout(retry.timer);
      unsubscribe();
      appStateSubscription.remove();
    };
  }, [loadPending, recover, refresh]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    // Chromium's Network Information API can omit a change event when the
    // browser goes offline. Refresh NetInfo on the browser events too, so all
    // subscribers (including session recovery) see the new connectivity.
    const updateConnection = () => {
      void NetInfo.refresh().catch(() => undefined);
    };
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  const value = useMemo(
    () => ({ consumeRecoveredActions, isOffline, isRecovering, pendingActions, recoveredActions, refresh }),
    [consumeRecoveredActions, isOffline, isRecovering, pendingActions, recoveredActions, refresh],
  );
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function NetworkStatusBanner() {
  const isWaitingForServer = useSyncExternalStore(
    actionRequestStatus.subscribe,
    actionRequestStatus.getSnapshot,
    () => false,
  );
  if (!isWaitingForServer) {
    return null;
  }

  return (
    <SafeAreaView
      accessibilityLiveRegion="polite"
      edges={['top']}
      role="status"
      style={styles.banner}
      testID="network-status-banner"
    >
      <Text style={styles.text}>Server is taking longer than usual…</Text>
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
  text: {
    color: '#FFF8DC',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
});
