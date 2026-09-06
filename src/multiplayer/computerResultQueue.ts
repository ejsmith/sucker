import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Database } from '../../shared/database.types';
import { isMultiplayerConfigured, supabase } from './supabase';

export type ComputerResultPayload = Database['public']['Functions']['record_computer_game_result']['Args'];
type PendingResult = { gameId: string; payload: ComputerResultPayload };
type Stats = Database['public']['Tables']['computer_stats']['Row'];
let storageWrites: Promise<unknown> = Promise.resolve();
const deliveries = new Map<string, Promise<Stats | null>>();
const queueKey = (ownerId: string) => `sucker.computer-results.v1.${ownerId}`;

async function readQueue(ownerId: string): Promise<PendingResult[]> {
  const raw = await AsyncStorage.getItem(queueKey(ownerId));
  if (raw === null) return [];
  const queue = JSON.parse(raw);
  if (!Array.isArray(queue) || queue.some((entry) => !entry || typeof entry.gameId !== 'string' || !entry.payload)) {
    throw new Error('The saved computer result queue could not be read.');
  }
  return queue;
}

function updateQueue(ownerId: string, update: (queue: PendingResult[]) => PendingResult[]) {
  const write = async () => {
    const queue = update(await readQueue(ownerId));
    await AsyncStorage.setItem(queueKey(ownerId), JSON.stringify(queue));
  };
  const result = storageWrites.then(write, write);
  storageWrites = result;
  return result;
}

export function enqueueComputerResult(ownerId: string, gameId: string, payload: ComputerResultPayload) {
  return updateQueue(ownerId, (queue) =>
    queue.some((entry) => entry.gameId === gameId) ? queue : [...queue, { gameId, payload }],
  );
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
      await updateQueue(ownerId, (queue) => queue.filter((entry) => entry.gameId !== next.gameId));
    }
  };
  const pending = deliver().finally(() => deliveries.delete(ownerId));
  deliveries.set(ownerId, pending);
  return pending;
}
