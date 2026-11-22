// A player who does not finish their turn within 30 days of it becoming theirs
// forfeits. Only a turn change restarts the clock, so rolling or punching
// mid-turn cannot stall a game forever.

export const turnTimeoutDays = 30;

// Push warnings at these many days left, most distant first. Each is sent once
// per turn, and a more urgent warning makes an unsent earlier one moot.
export const turnTimeoutWarningDays = [7, 1] as const;

const dayMs = 24 * 60 * 60 * 1_000;

export const turnTimeoutMs = turnTimeoutDays * dayMs;

// The lobby starts counting down with the first warning.
const countdownMs = turnTimeoutWarningDays[0] * dayMs;

export function getTurnTimeoutRemainingMs(turnStartedAt: string | null | undefined, now: number): number | null {
  if (!turnStartedAt) return null;
  const startedAt = new Date(turnStartedAt).getTime();
  return Number.isFinite(startedAt) ? startedAt + turnTimeoutMs - now : null;
}

export function hasTurnTimedOut(turnStartedAt: string | null | undefined, now: number): boolean {
  const remainingMs = getTurnTimeoutRemainingMs(turnStartedAt, now);
  return remainingMs !== null && remainingMs <= 0;
}

export function formatTurnTimeoutCountdown(turnStartedAt: string | null | undefined, now: number): string | null {
  const remainingMs = getTurnTimeoutRemainingMs(turnStartedAt, now);
  if (remainingMs === null || remainingMs > countdownMs) return null;
  const days = Math.ceil(remainingMs / dayMs);
  if (days <= 1) return 'Forfeits today';
  return `Forfeits in ${days} days`;
}
