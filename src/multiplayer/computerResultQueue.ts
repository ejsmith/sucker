import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Database } from '../../shared/database.types';
import { isMultiplayerConfigured, supabase } from './supabase';

export type ComputerResultPayload = Database['public']['Functions']['record_computer_game_result']['Args'];
type PendingResult = { gameId: string; payload: ComputerResultPayload };
type Stats = Database['public']['Tables']['computer_stats']['Row'];
let storageWrites: Promise<unknown> = Promise.resolve();
const deliveries = new Map<string, Promise<Stats | null>>();
const queueKey = (ownerId: string) => `sucker.computer-results.v1.${ownerId}`;
const resultPrefix = (ownerId: string) => `sucker.computer-result.v2.${encodeURIComponent(ownerId)}.`;
const resultKey = (ownerId: string, gameId: string) => `${resultPrefix(ownerId)}${encodeURIComponent(gameId)}`;

async function readQueue(ownerId: string): Promise<PendingResult[]> {
  // Convert old array saves before reading per-game records. Replayed uploads
  // remain safe if another tab migrates the same legacy snapshot concurrently.
  const raw = await AsyncStorage.getItem(queueKey(ownerId));
  if (raw !== null) {
    const legacy = JSON.parse(raw);
    if (!Array.isArray(legacy) || legacy.some((entry) => !entry || typeof entry.gameId !== 'string' || !entry.payload)) {
      throw new Error('The saved computer result queue could not be read.');
    }
    for (const entry of legacy) {
      await AsyncStorage.setItem(resultKey(ownerId, entry.gameId), JSON.stringify(entry));
    }
    await AsyncStorage.removeItem(queueKey(ownerId));
  }
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(resultPrefix(ownerId)));
  const records = await AsyncStorage.multiGet(keys);
  return records.flatMap(([key, serialized]) => {
    if (serialized === null) return []; // Another tab acknowledged it.
    const entry = JSON.parse(serialized);
    if (!entry || typeof entry.gameId !== 'string' || !entry.payload || resultKey(ownerId, entry.gameId) !== key) {
      throw new Error('The saved computer result could not be read.');
    }
    return [entry as PendingResult];
  });
}

export function enqueueComputerResult(ownerId: string, gameId: string, payload: ComputerResultPayload) {
  const write = () => AsyncStorage.setItem(resultKey(ownerId, gameId), JSON.stringify({ gameId, payload }));
  const result = storageWrites.then(write, write);
  storageWrites = result;
  return result;
}

export async function flushComputerResults(expectedOwnerId?: string): Promise<Stats | null> {
  if (!isMultiplayerConfigured) return null;
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session || (expectedOwnerId && expectedOwnerId !== session.user.id)) return null;
  const ownerId = session.user.id;
  const active = deliveries.get(ownerId);
  if (active) return active;
  const deliver = async () => {
    let latest: Stats | null = null;
    while (true) {
      await storageWrites.catch(() => undefined);
      const next = (await readQueue(ownerId))[0];
      if (!next) return latest;
      const { data, error: uploadError } = await supabase.rpc('record_computer_game_result_once', {
        p_owner_id: ownerId,
        p_game_id: next.gameId,
        p_result: next.payload,
      });
      // The RPC verifies the owner against auth.uid(), including an account
      // switch between reading the session and sending this request.
      if (uploadError) throw uploadError;
      if (!data) throw new Error('The computer result was not acknowledged.');
      latest = data;
      await AsyncStorage.removeItem(resultKey(ownerId, next.gameId));
    }
  };
  const pending = deliver().finally(() => deliveries.delete(ownerId));
  deliveries.set(ownerId, pending);
  return pending;
}
