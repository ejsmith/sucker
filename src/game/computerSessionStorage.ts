import AsyncStorage from '@react-native-async-storage/async-storage';
import { computerSessionKey, parseComputerSession, type ComputerSession } from './computerSession';

let writes: Promise<unknown> = Promise.resolve();

export async function loadComputerSession(profileId: string | null) {
  await writes.catch(() => undefined);
  const raw = await AsyncStorage.getItem(computerSessionKey(profileId));
  return raw === null ? null : parseComputerSession(raw);
}

export function saveComputerSession(profileId: string | null, session: ComputerSession) {
  const serialized = JSON.stringify(session);
  const write = () => AsyncStorage.setItem(computerSessionKey(profileId), serialized);
  const result = writes.then(write, write);
  writes = result;
  return result;
}

export function clearComputerSession(profileId: string | null) {
  const remove = () => AsyncStorage.removeItem(computerSessionKey(profileId));
  const result = writes.then(remove, remove);
  writes = result;
  return result;
}
