import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import {
  createSessionFromAuthUrl,
  getCurrentSession,
  hasAuthCallbackParams,
  signInWithEmail,
  signOut,
  upsertProfile,
  verifyEmailCode,
} from './auth';
import { getMyProfile } from './profiles';
import { isMultiplayerConfigured, supabase } from './supabase';
import type { ProfileInput } from './types';

type Profile = Awaited<ReturnType<typeof getMyProfile>>;

export function useMultiplayerSession() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(isMultiplayerConfigured);
  const [profile, setProfile] = useState<Profile>(null);
  const [session, setSession] = useState<Session | null>(null);
  const lastHandledAuthUrl = useRef<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!isMultiplayerConfigured) {
      return null;
    }

    const nextProfile = await getMyProfile();
    setProfile(nextProfile);
    return nextProfile;
  }, []);

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
          setSession(nextSession);
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
      try {
        const didHandleAuthUrl = await handleAuthUrl(await Linking.getInitialURL());
        if (didHandleAuthUrl) {
          return;
        }

        const currentSession = await getCurrentSession();
        if (!isMounted) {
          return;
        }

        setSession(currentSession);
        if (currentSession) {
          await refreshProfile();
        }
      } catch (loadError) {
        if (isMounted) {
          setError(toErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setProfile(null);
      if (nextSession) {
        void refreshProfile();
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
  }, [refreshProfile]);

  async function sendSignInLink(email: string) {
    setError(null);
    setIsLoading(true);
    try {
      return await signInWithEmail(email);
    } catch (signInError) {
      setError(toErrorMessage(signInError));
      throw signInError;
    } finally {
      setIsLoading(false);
    }
  }

  async function verifySignInCode(email: string, code: string) {
    setError(null);
    setIsLoading(true);
    try {
      const nextSession = await verifyEmailCode(email, code);
      setSession(nextSession);
      if (nextSession) {
        await refreshProfile();
      }
      return nextSession;
    } catch (verifyError) {
      setError(toErrorMessage(verifyError));
      throw verifyError;
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
      return nextProfile;
    } catch (profileError) {
      setError(toErrorMessage(profileError));
      throw profileError;
    } finally {
      setIsLoading(false);
    }
  }

  async function endSession() {
    setError(null);
    await signOut();
    setSession(null);
    setProfile(null);
  }

  return {
    endSession,
    error,
    isConfigured: isMultiplayerConfigured,
    isLoading,
    profile,
    refreshProfile,
    saveProfile,
    sendSignInLink,
    session,
    verifySignInCode,
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
