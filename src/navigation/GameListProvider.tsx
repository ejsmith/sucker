import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { clearCachedGameList, loadCachedGameList, saveCachedGameList } from '../multiplayer/gameListCache';
import { listMyGames } from '../multiplayer/games';
import { supabase } from '../multiplayer/supabase';
import type { RemoteGameRow } from '../multiplayer/types';

type LocalPlayerProfile = {
  avatarUrl: string | null;
  displayName: string;
};

type GameListContextValue = {
  games: RemoteGameRow[];
  gamesProfileId: string | null;
  localPlayerProfile: LocalPlayerProfile | null;
  refreshGames: (profileId: string) => Promise<RemoteGameRow[]>;
  rememberGame: (profileId: string, game: RemoteGameRow) => void;
  setGames: (profileId: string | null, games: RemoteGameRow[]) => void;
  setLocalPlayerProfile: (profile: LocalPlayerProfile) => void;
};

const GameListContext = createContext<GameListContextValue | null>(null);

export function GameListProvider({ children }: { children: ReactNode }) {
  const [gameList, setGameList] = useState<{ games: RemoteGameRow[]; profileId: string | null }>({
    games: [],
    profileId: null,
  });
  const [localPlayerProfile, setLocalPlayerProfile] = useState<LocalPlayerProfile | null>(null);
  const hasChangedGameList = useRef(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const sessionProfileId = useRef<string | null | undefined>(undefined);
  const sessionGeneration = useRef(0);

  const setGames = useCallback((profileId: string | null, games: RemoteGameRow[]) => {
    hasChangedGameList.current = true;
    setGameList({ games: profileId ? games : [], profileId });
  }, []);

  const refreshGames = useCallback(
    async (profileId: string) => {
      const generation = sessionGeneration.current;
      const games = await listMyGames();
      if (
        generation === sessionGeneration.current &&
        (sessionProfileId.current === undefined || sessionProfileId.current === profileId)
      ) {
        setGames(profileId, games);
      }
      return games;
    },
    [setGames],
  );

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION can be null when token refresh cannot reach Auth.
      // Only a confirmed sign-out may discard the saved lobby here.
      if (!session && event !== 'SIGNED_OUT') return;
      const nextId = session?.user.id ?? null;
      if (sessionProfileId.current !== undefined && sessionProfileId.current !== nextId) {
        sessionGeneration.current += 1;
        setGames(null, []);
      }
      sessionProfileId.current = nextId;
      if (!nextId) setGames(null, []);
    });
    return () => subscription.unsubscribe();
  }, [setGames]);

  const rememberGame = useCallback((profileId: string, game: RemoteGameRow) => {
    hasChangedGameList.current = true;
    setGameList((cache) => ({
      games: mergeGame(cache.profileId === profileId ? cache.games : [], game),
      profileId,
    }));
  }, []);

  useEffect(() => {
    let active = true;
    void loadCachedGameList()
      .then((cached) => {
        if (active && cached && !hasChangedGameList.current) {
          setGameList(cached);
        }
      })
      .catch((error: unknown) => console.warn('Unable to restore cached games', error))
      .finally(() => {
        if (active) setCacheHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!cacheHydrated) return;
    const update = gameList.profileId
      ? saveCachedGameList({ games: gameList.games, profileId: gameList.profileId })
      : clearCachedGameList();
    void update.catch((error: unknown) => console.warn('Unable to update cached games', error));
  }, [cacheHydrated, gameList]);

  return (
    <GameListContext.Provider
      value={{
        games: gameList.games,
        gamesProfileId: gameList.profileId,
        localPlayerProfile,
        refreshGames,
        rememberGame,
        setGames,
        setLocalPlayerProfile,
      }}
    >
      {children}
    </GameListContext.Provider>
  );
}

export function useGameList() {
  const value = useContext(GameListContext);
  if (!value) throw new Error('useGameList must be used inside GameListProvider.');
  return value;
}

function mergeGame(games: RemoteGameRow[], game: RemoteGameRow) {
  const nextGames = games.some((current) => current.id === game.id)
    ? games.map((current) => (current.id === game.id ? game : current))
    : [game, ...games];
  return nextGames.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
}
