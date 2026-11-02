import { useEffect, useState } from 'react';
import { isSaltyAt } from '../../shared/rageQuit';
import { reportError } from '../monitoring/exceptionless';
import { useAppActivity } from '../ui/useAppActivity';
import { getRecentRageQuits } from './games';

const recheckMs = 5 * 60_000;

// Players who rage quit in the last 24 hours. Shame is public, so this reads
// the same server-written records for every profile shown on screen.
export function useSaltyProfileIds(profileIds: string[], enabled = true, refreshKey?: unknown) {
  const [rageQuitTimes, setRageQuitTimes] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const isAppActive = useAppActivity();
  const idsKey = [...new Set(profileIds)].filter(Boolean).sort().join(',');

  useEffect(() => {
    if (!enabled || !isAppActive || !idsKey) return;
    let active = true;
    const refresh = () => {
      const checkedAt = Date.now();
      getRecentRageQuits(idsKey.split(','), checkedAt)
        .then((times) => {
          if (!active) return;
          setRageQuitTimes(times);
          setNow(checkedAt);
        })
        .catch((error: unknown) => {
          // Keep the last known badges; the next refresh will try again.
          void reportError(error, { Operation: 'Load recent rage quits' });
        });
    };
    refresh();
    const timer = setInterval(refresh, recheckMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, idsKey, isAppActive, refreshKey]);

  return new Set(Object.keys(rageQuitTimes).filter((id) => isSaltyAt(rageQuitTimes[id], now)));
}
