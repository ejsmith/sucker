export * from '../../../shared/turnTimeout.ts';

type NotificationContent = { body: string; title: string };

// One forfeit per turn: retries and overlapping sweeps of the same turn share
// a request id, so the forfeit commits at most once.
export async function turnTimeoutRequestId(gameId: string, turnStartedAt: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`turn_timeout:${gameId}:${turnStartedAt}`)),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // Version 8: custom.
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant.
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Compares digests so the check takes the same time however much matches.
export async function isInactivitySweepAuthorized(provided: string | null, secret: string): Promise<boolean> {
  if (!provided || !secret) return false;
  const [left, right] = await Promise.all(
    [provided, secret].map(
      async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    ),
  );
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function buildTurnTimeoutWarning(opponentName: string, daysLeft: number): NotificationContent {
  const deadline = daysLeft === 1 ? 'a day' : `${daysLeft} days`;
  return {
    body: `Play your turn against ${opponentName} within ${deadline}, or you forfeit.`,
    title: 'Your turn is waiting',
  };
}

export function buildTurnTimeoutNotification(
  timedOutName: string,
  opponentName: string,
  recipientTimedOut: boolean,
): NotificationContent {
  return recipientTimedOut
    ? { body: `You ran out of time against ${opponentName}.`, title: 'Out of time' }
    : { body: `${timedOutName} ran out of time — you win.`, title: 'Out of time' };
}
