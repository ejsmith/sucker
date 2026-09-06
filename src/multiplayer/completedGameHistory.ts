import type { RemoteGameRow } from './types';

export const completedGamesPageSize = 25;

function compareTimestamps(left: string, right: string) {
  const milliseconds = Date.parse(left) - Date.parse(right);
  if (milliseconds) return milliseconds;
  const remainder = (value: string) => Number((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
  return remainder(left) - remainder(right);
}

export function compareCompletedGames(left: RemoteGameRow, right: RemoteGameRow) {
  return (
    compareTimestamps(right.completed_at ?? right.updated_at, left.completed_at ?? left.updated_at) ||
    right.id.localeCompare(left.id)
  );
}
