import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { Session } from '@supabase/supabase-js';
import {
  createSessionFromAuthUrl,
  getCurrentSession,
  getStoredSessionSnapshot,
  hasAuthCallbackParams,
  signInAsLocalTestPlayer,
  signInWithEmail,
  signInWithPassword as signInWithPasswordCredentials,
  signOut,
  updateAccountPassword,
  upsertProfile,
  verifyEmailCode,
  type LocalTestPlayer,
} from './auth';
import { registerPushToken } from './notifications';
import { getMyProfile, getSafeAvatarUrl } from './profiles';
import {
  clearProfileCache,
  getCachedProfiles,
  hydrateProfileCache,
  rememberProfiles,
  type CachedProfile,
} from './profileCache';
import { getE2ESession } from './env';
import { isMultiplayerConfigured, supabase } from './supabase';
import type { ProfileInput } from './types';
import { reportError, setMonitoringUser } from '../monitoring/exceptionless';
import { isTemporarySessionError, sessionConnectionMessage, withSessionTimeout } from './sessionRecovery';
import { useAppActivity } from '../ui/useAppActivity';

type Profile = CachedProfile | null;

export function useMultiplayerSession() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(isMultiplayerConfigured);
  const [isRestoringSession, setIsRestoringSession] = useState(isMultiplayerConfigured);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isSessionUnavailable, setIsSessionUnavailable] = useState(false);
  const [profile, setProfile] = useState<Profile>(null);
  const [session, setSession] = useState<Session | null>(null);
  const lastHandledAuthUrl = useRef<string | null>(null);
  const pushRegisteredProfileId = useRef<string | null>(null);
  const isMounted = useRef(true);
  const sessionProfileId = useRef<string | null>(null);
  const profileRefresh = useRef<{ id: string; promise: Promise<Profile> } | null>(null);
  const reconnectInFlight = useRef<Promise<void> | null>(null);
  const authRevision = useRef(0);
  const isAppActive = useAppActivity();

  const acceptSession = useCallback((nextSession: Session | null) => {
    const nextId = nextSession?.user.id ?? null;
    if (sessionProfileId.current && sessionProfileId.current !== nextId) {
      clearProfileCache();
      pushRegisteredProfileId.current = null;
    }
    sessionProfileId.current = nextId;
    setSession(nextSession);
    setProfile((current) => (current?.id === nextId ? current : null));
    setMonitoringUser(nextId);
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const refreshProfile = useCallback(async (): Promise<Profile> => {
    const id = sessionProfileId.current;
    if (!isMultiplayerConfigured || !id) {
      return null;
    }
    if (profileRefresh.current?.id === id) return profileRefresh.current.promise;
    const promise = (async () => {
      const nextProfile = await getMyProfile();
      if (!isMounted.current || sessionProfileId.current !== id || nextProfile?.id !== id) {
        return nextProfile;
      }
      setProfile(nextProfile);
      setIsSessionUnavailable(false);
      setMonitoringUser(nextProfile?.id ?? null);
      if (nextProfile && pushRegisteredProfileId.current !== nextProfile.id) {
        pushRegisteredProfileId.current = nextProfile.id;
        void registerPushToken(nextProfile.id).catch((pushError) => {
          console.warn('Unable to register push token', pushError);
          void reportError(pushError, { Operation: 'RegisterPushToken' });
          pushRegisteredProfileId.current = null;
        });
      }
      return nextProfile;
    })();
    profileRefresh.current = { id, promise };
    try {
      return await promise;
    } finally {
      if (profileRefresh.current?.promise === promise) profileRefresh.current = null;
    }
  }, []);

  const restoreProfile = useCallback(async (id: string) => {
    await hydrateProfileCache();
    if (isMounted.current && sessionProfileId.current === id) {
      const cached = getCachedProfiles()[id];
      setProfile(
        (current) => current ?? (cached ? { ...cached, avatar_url: getSafeAvatarUrl(cached.avatar_url, id) } : null),
      );
    }
  }, []);

  const reconnectSession = useCallback(() => {
    if (reconnectInFlight.current) return reconnectInFlight.current;
    const revision = authRevision.current;
    const isCurrent = () => isMounted.current && revision === authRevision.current;
    setIsReconnecting(true);
    const slowRequest = setTimeout(() => {
      if (isCurrent()) setIsSessionUnavailable(true);
    }, 3_000);
    const reconnect = (async () => {
      let hasSessionResult = false;
      try {
        const currentSession = await getCurrentSession();
        hasSessionResult = true;
        if (!isCurrent()) return;
        acceptSession(currentSession);
        if (currentSession) {
          await restoreProfile(currentSession.user.id);
          await withSessionTimeout(refreshProfile());
        }
        if (isCurrent()) setIsSessionUnavailable(false);
      } catch (reconnectError) {
        if (isCurrent()) {
          // An unsuccessful session lookup is not evidence of sign-out.
          setIsSessionUnavailable(!hasSessionResult || isTemporarySessionError(reconnectError));
          if (!isTemporarySessionError(reconnectError)) setError(toErrorMessage(reconnectError));
        }
      } finally {
        clearTimeout(slowRequest);
        reconnectInFlight.current = null;
        if (isMounted.current) {
          setIsReconnecting(false);
          setIsRestoringSession(false);
        }
      }
    })();
    reconnectInFlight.current = reconnect;
    return reconnect;
  }, [acceptSession, refreshProfile, restoreProfile]);

  useEffect(() => {
    if (!isSessionUnavailable || !isAppActive) return;
    const retry = () => {
      void reconnectSession();
    };
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) retry();
    });
    const timer = setInterval(retry, 5_000);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [isAppActive, isSessionUnavailable, reconnectSession]);

  useEffect(() => {
    if (!session || isReconnecting || isSessionUnavailable) return;
    const retryRegistration = () => {
      if (pushRegisteredProfileId.current !== session.user.id) {
        void refreshProfile().catch(() => undefined);
      }
    };
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) retryRegistration();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retryRegistration();
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [isReconnecting, isSessionUnavailable, refreshProfile, session]);

  useEffect(() => {
    if (!isMultiplayerConfigured) {
      return;
    }

    let isMounted = true;

    async function handleAuthUrl(url: string | null) {
      if (!url || !hasAuthCallbackParams(url) || lastHandledAuthUrl.current === url) {
        return false;
      }

      lastHandledAuthUrl.current = url;
      setIsLoading(true);

      try {
        const nextSession = await createSessionFromAuthUrl(url);
        if (!isMounted) {
          return true;
        }

        if (nextSession) {
          acceptSession(nextSession);
          await refreshProfile();
        }

        return true;
      } catch (authUrlError) {
        if (isMounted) {
          setError(toErrorMessage(authUrlError));
        }
        return true;
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    async function loadSession() {
      const revision = authRevision.current;
      try {
        const didHandleAuthUrl = await handleAuthUrl(await Linking.getInitialURL());
        if (didHandleAuthUrl) {
          return;
        }

        const storedSession = await getStoredSessionSnapshot();
        if (!isMounted || revision !== authRevision.current) return;
        if (storedSession) {
          acceptSession(storedSession);
          await restoreProfile(storedSession.user.id);
          if (!isMounted || revision !== authRevision.current) return;
          setIsRestoringSession(false);
          setIsLoading(false);
        }
        const testSession = getE2ESession();
        if (testSession) {
          const { error } = await supabase.auth.setSession(testSession);
          if (error) throw error;
        }
        if (isMounted) await reconnectSession();
      } catch (loadError) {
        if (isMounted && revision === authRevision.current) {
          setIsSessionUnavailable(true);
          if (!isTemporarySessionError(loadError)) setError(toErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsRestoringSession(false);
        }
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) {
        return;
      }
      if (!nextSession && event !== 'SIGNED_OUT') return;
      if (event === 'SIGNED_OUT' || (sessionProfileId.current && nextSession?.user.id !== sessionProfileId.current)) {
        authRevision.current += 1;
      }
      acceptSession(nextSession);
      if (event === 'SIGNED_OUT') {
        clearProfileCache();
        setIsSessionUnavailable(false);
        setIsRestoringSession(false);
        setError(null);
      }
      if (nextSession && event !== 'INITIAL_SESSION') {
        // Leave Supabase's auth lock before making authenticated requests.
        setTimeout(() => {
          if (!isMounted || sessionProfileId.current !== nextSession.user.id) return;
          void restoreProfile(nextSession.user.id)
            .then(refreshProfile)
            .catch((profileError) => {
              if (isMounted && sessionProfileId.current === nextSession.user.id) {
                if (isTemporarySessionError(profileError)) setIsSessionUnavailable(true);
                else setError(toErrorMessage(profileError));
              }
            });
        }, 0);
      }
    });

    void loadSession();
    const linkSubscription = Linking.addEventListener('url', (event) => {
      void handleAuthUrl(event.url);
    });

    return () => {
      isMounted = false;
      linkSubscription.remove();
      subscription.unsubscribe();
    };
  }, [acceptSession, reconnectSession, refreshProfile, restoreProfile]);

  async function sendSignInCode(email: string) {
    setError(null);
    setIsLoading(true);
    try {
      return await signInWithEmail(email);
    } catch (signInError) {
      const message = toErrorMessage(signInError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function verifySignInCode(email: string, code: string) {
    setError(null);
    setIsLoading(true);
    try {
      const nextSession = await verifyEmailCode(email, code);
      acceptSession(nextSession);
      if (nextSession) {
        await refreshProfile();
      }
      return nextSession;
    } catch (verifyError) {
      const message = toErrorMessage(verifyError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function signInAsLocalTestUser(player: LocalTestPlayer) {
    setError(null);
    setIsLoading(true);
    try {
      const nextSession = await signInAsLocalTestPlayer(player);
      acceptSession(nextSession);
      await refreshProfile();
      return nextSession;
    } catch (signInError) {
      const message = toErrorMessage(signInError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function signInWithPassword(email: string, password: string) {
    setError(null);
    setIsLoading(true);
    try {
      const nextSession = await signInWithPasswordCredentials(email, password);
      acceptSession(nextSession);
      if (nextSession) await refreshProfile();
      return nextSession;
    } catch (signInError) {
      const message = toErrorMessage(signInError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveProfile(input: ProfileInput) {
    setError(null);
    setIsLoading(true);
    try {
      const nextProfile = await upsertProfile(input);
      setProfile(nextProfile);
      rememberProfiles([nextProfile]);
      return nextProfile;
    } catch (profileError) {
      setError(toErrorMessage(profileError));
      throw profileError;
    } finally {
      setIsLoading(false);
    }
  }

  async function updatePassword(password: string) {
    setError(null);
    setIsLoading(true);
    try {
      return await updateAccountPassword(password);
    } catch (passwordError) {
      const message = toErrorMessage(passwordError);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function endSession() {
    setError(null);
    setIsLoading(true);
    try {
      await signOut();
      pushRegisteredProfileId.current = null;
      acceptSession(null);
      clearProfileCache();
    } catch (signOutError) {
      pushRegisteredProfileId.current = null;
      setError(toErrorMessage(signOutError));
    } finally {
      setIsLoading(false);
    }
  }

  return {
    endSession,
    error,
    isConfigured: isMultiplayerConfigured,
    isLoading,
    isRestoringSession,
    isReconnecting,
    isSessionUnavailable,
    profile,
    refreshProfile,
    reconnectSession,
    saveProfile,
    sendSignInCode,
    signInAsLocalTestUser,
    signInWithPassword,
    session,
    updatePassword,
    verifySignInCode,
  };
}

function toErrorMessage(error: unknown) {
  if (isTemporarySessionError(error)) return sessionConnectionMessage;
  if (error instanceof Error) {
    if (error.message === 'Failed to fetch') {
      return 'Unable to reach Sucker! services. Check your connection and try again.';
    }

    if (error.message === '{}') {
      return 'Unable to complete the login request. Please try again.';
    }

    return error.message;
  }

  return 'Something went wrong.';
}
