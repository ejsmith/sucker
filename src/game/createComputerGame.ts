import { getRandomBytes } from 'expo-crypto';
import { createGame } from '../../shared/game';

export function createComputerGame(playerNames: string[]) {
  const identity = Array.from(getRandomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { ...createGame(playerNames), id: `local-${identity}` };
}
