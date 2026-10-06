import { useEffect, useSyncExternalStore } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useAppActivity } from '../ui/useAppActivity';
import { getCachedProfiles, hydrateProfileCache, subscribeToProfiles } from './profileCache';
import { getProfilesByIds, getSafeAvatarUrl } from './profiles';

export function useProfileAvatars(profileIds: string[], enabled = true, refreshKey?: unknown) {
  const profiles = useSyncExternalStore(subscribeToProfiles, getCachedProfiles, getCachedProfiles);
  const isAppActive = useAppActivity();
  const idsKey = [...new Set(profileIds)].filter(Boolean).sort().join(',');

  useEffect(() => {
    if (!enabled || !isAppActive || !idsKey) return;
    void hydrateProfileCache();
    let active = true;
    let inFlight = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!active || inFlight) return;
      clearTimeout(retry);
      inFlight = true;
      try {
        await getProfilesByIds(idsKey.split(','));
      } catch {
        // Keep known photos and retry while this screen is active.
        if (active) retry = setTimeout(() => void refresh(), 5_000);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void refresh();
    });
    return () => {
      active = false;
      clearTimeout(retry);
      unsubscribe();
    };
  }, [enabled, idsKey, isAppActive, refreshKey]);

  return Object.fromEntries(
    idsKey
      .split(',')
      .filter(Boolean)
      .map((id) => [id, getSafeAvatarUrl(profiles[id]?.avatar_url, id)]),
  );
}
