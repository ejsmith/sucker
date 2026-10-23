// Shapes a slow player action for monitoring. The client total minus the
// server's own totals is time spent on the network, the gateway, booting
// workers, and waiting between retries.
export type ActionAttempt = {
  durationMs: number;
  edgeRegion: string | null;
  serverTiming: string | null;
  // `network` means no response arrived, so the function never answered.
  status: number | 'network';
};

export type ActionConnection = {
  cellularGeneration: string | null;
  isInternetReachable: boolean | null;
  type: string;
};

export function toActionAttempt(durationMs: number, response: Response | null | undefined): ActionAttempt {
  return {
    durationMs,
    edgeRegion: response?.headers.get('x-sb-edge-region') ?? null,
    serverTiming: response?.headers.get('server-timing') ?? null,
    status: response?.status ?? 'network',
  };
}

export function parseServerTiming(header: string | null): Record<string, number> {
  const timings: Record<string, number> = {};
  for (const entry of header?.split(',') ?? []) {
    const [name, ...params] = entry.trim().split(';');
    const duration = params.map((param) => param.trim()).find((param) => param.startsWith('dur='));
    const value = Number(duration?.slice(4));
    if (name && duration && Number.isFinite(value)) timings[name] = value;
  }
  return timings;
}

export function buildSlowActionReport(
  actionType: string,
  totalMs: number,
  attempts: ActionAttempt[],
  connection: ActionConnection | null,
) {
  const details = attempts.map((attempt) => ({
    durationMs: Math.round(attempt.durationMs),
    edgeRegion: attempt.edgeRegion,
    server: parseServerTiming(attempt.serverTiming),
    status: attempt.status,
  }));
  const serverMs = details.reduce((sum, attempt) => sum + (attempt.server.total ?? 0), 0);

  return {
    message: `Slow ${actionType}`,
    properties: {
      ActionType: actionType,
      AttemptCount: attempts.length,
      Attempts: details,
      Connection: connection,
      OutsideServerMs: Math.round(totalMs - serverMs),
      ServerMs: Math.round(serverMs),
      TotalMs: Math.round(totalMs),
    },
  };
}
