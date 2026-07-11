export function formatRecord(wins: number, losses: number, gamesPlayed: number) {
  const ties = Math.max(0, gamesPlayed - wins - losses);
  const winLossRecord = `${wins}-${losses}`;
  return ties > 0 ? `${winLossRecord}-${ties}` : winLossRecord;
}
