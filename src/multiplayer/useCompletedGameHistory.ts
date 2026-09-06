import { useEffect, useMemo, useRef, useState } from 'react';
import { compareCompletedGames, completedGamesPageSize } from './completedGameHistory';
import { listOlderCompletedGames } from './games';
import type { RemoteGameRow } from './types';

type PageState = { owner: string | null; games: RemoteGameRow[]; hasMore: boolean };

export function useCompletedGameHistory(initialGames: RemoteGameRow[], profileId: string | null) {
  const [pages, setPages] = useState<PageState>({ owner: profileId, games: [], hasMore: true });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);

  if (pages.owner !== profileId) {
    setPages({ owner: profileId, games: [], hasMore: true });
    setIsLoading(false);
    setError(null);
  }

  function reset() {
    generation.current += 1;
    inFlight.current = false;
    setPages({ owner: profileId, games: [], hasMore: true });
    setIsLoading(false);
    setError(null);
  }

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    return () => {
      generation.current += 1;
    };
  }, [profileId]);

  const games = useMemo(() => {
    const byId = new Map((pages.owner === profileId ? pages.games : []).map((game) => [game.id, game]));
    for (const game of initialGames) if (game.status === 'complete') byId.set(game.id, game);
    return [...byId.values()].sort(compareCompletedGames);
  }, [initialGames, pages, profileId]);
  const hasMore = games.length >= completedGamesPageSize && (pages.owner !== profileId || pages.hasMore);

  async function loadMore() {
    const cursor = games.at(-1);
    if (!profileId || !cursor || !hasMore || inFlight.current) return;
    const version = generation.current;
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const next = await listOlderCompletedGames(cursor);
      if (version !== generation.current) return;
      setPages({ owner: profileId, games: [...games, ...next.games], hasMore: next.hasMore });
    } catch {
      if (version === generation.current) setError('Could not load older games. Try again.');
    } finally {
      if (version === generation.current) {
        inFlight.current = false;
        setIsLoading(false);
      }
    }
  }

  return { games, hasMore, isLoading, error, loadMore, reset };
}
