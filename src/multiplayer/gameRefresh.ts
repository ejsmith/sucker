// Realtime does not replay changes missed while disconnected. Fetch a current
// snapshot on subscription/recovery, but let a later realtime event win.
export function createGameRefresh<T>(load: () => Promise<T>, apply: (game: T) => void) {
  let revision = 0;
  let disposed = false;
  return {
    invalidate() {
      revision += 1;
    },
    dispose() {
      disposed = true;
      revision += 1;
    },
    async refresh() {
      const startedAt = ++revision;
      const game = await load();
      if (!disposed && revision === startedAt) apply(game);
    },
  };
}
