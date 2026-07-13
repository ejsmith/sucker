import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RemoteGameRow } from './types';

const gameListCacheKey = 'sucker.multiplayerGameList.v1';

export type CachedGameList = {
  games: RemoteGameRow[];
  profileId: string;
};

let cacheWriteQueue: Promise<void> = Promise.resolve();

export async function loadCachedGameList(): Promise<CachedGameList | null> {
  const serialized = await AsyncStorage.getItem(gameListCacheKey);
  if (!serialized) {
    return null;
  }

  try {
    const cached: unknown = JSON.parse(serialized);
    return isCachedGameList(cached) ? cached : null;
  } catch {
    return null;
  }
}

export function saveCachedGameList(cache: CachedGameList): Promise<void> {
  return enqueueCacheWrite(() => AsyncStorage.setItem(gameListCacheKey, JSON.stringify(cache)));
}

export function clearCachedGameList(): Promise<void> {
  return enqueueCacheWrite(() => AsyncStorage.removeItem(gameListCacheKey));
}

function enqueueCacheWrite(write: () => Promise<void>) {
  cacheWriteQueue = cacheWriteQueue.catch(() => undefined).then(write);
  return cacheWriteQueue;
}

function isCachedGameList(value: unknown): value is CachedGameList {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const cached = value as Partial<CachedGameList>;
  return typeof cached.profileId === 'string' && Array.isArray(cached.games) && cached.games.every(isCachedGame);
}

function isCachedGame(value: unknown): value is RemoteGameRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const game = value as Partial<RemoteGameRow>;
  return (
    typeof game.id === 'string' &&
    typeof game.status === 'string' &&
    typeof game.updated_at === 'string' &&
    Boolean(game.state) &&
    typeof game.state === 'object' &&
    Array.isArray(game.state.players)
  );
}
