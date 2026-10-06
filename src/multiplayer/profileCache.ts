import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMultiplayerConfig } from './env';

export type CachedProfile = {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  needs_profile_setup?: boolean;
};

const cacheKey = `sucker.profiles.v1:${getMultiplayerConfig().supabaseUrl}`;
let profiles: Readonly<Record<string, CachedProfile>> = {};
let generation = 0;
let hydration: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

export const getCachedProfiles = () => profiles;
export const getProfileCacheGeneration = () => generation;

export function subscribeToProfiles(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish() {
  listeners.forEach((listener) => listener());
}

function persist(value: string | null) {
  writes = writes
    .catch(() => undefined)
    .then(() => (value === null ? AsyncStorage.removeItem(cacheKey) : AsyncStorage.setItem(cacheKey, value)))
    .catch(() => undefined);
}

export function hydrateProfileCache() {
  if (!hydration) {
    const startedGeneration = generation;
    hydration = AsyncStorage.getItem(cacheKey)
      .then((serialized) => {
        if (!serialized || generation !== startedGeneration) return;
        const stored: unknown = JSON.parse(serialized);
        if (!Array.isArray(stored)) return;
        const cached = stored.filter(
          (value): value is CachedProfile =>
            Boolean(value) &&
            typeof value.id === 'string' &&
            typeof value.display_name === 'string' &&
            (value.username === null || typeof value.username === 'string') &&
            (value.avatar_url === null || typeof value.avatar_url === 'string') &&
            (value.needs_profile_setup === undefined || typeof value.needs_profile_setup === 'boolean'),
        );
        // A slow storage read must never replace a fresher server response.
        profiles = { ...Object.fromEntries(cached.map((profile) => [profile.id, profile])), ...profiles };
        publish();
      })
      .catch(() => undefined);
  }
  return hydration;
}

export function rememberProfiles(nextProfiles: CachedProfile[], startedGeneration = generation) {
  if (generation !== startedGeneration) return;
  const next = { ...profiles };
  for (const profile of nextProfiles) {
    // Avatar-only lookups must preserve the account's last known setup state.
    const needsProfileSetup = profile.needs_profile_setup ?? next[profile.id]?.needs_profile_setup;
    // Store display/setup data only, never auth tokens or unrelated fields.
    next[profile.id] = {
      id: profile.id,
      display_name: profile.display_name,
      username: profile.username,
      avatar_url: profile.avatar_url,
      ...(needsProfileSetup === undefined ? {} : { needs_profile_setup: needsProfileSetup }),
    };
  }
  profiles = next;
  publish();
  persist(JSON.stringify(Object.values(next)));
}

export function clearProfileCache() {
  generation += 1;
  profiles = {};
  publish();
  persist(null);
}
