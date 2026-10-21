import { useEffect } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { MultiplayerLobby } from '../src/multiplayer/MultiplayerLobby';
import { isMultiplayerConfigured } from '../src/multiplayer';
import { useGameList } from '../src/navigation/GameListProvider';
import { isLeaderboardBoard } from '../src/multiplayer/community';

export default function LobbyRoute() {
  const router = useRouter();
  const { leaderboard, viewport, presets } = useLocalSearchParams<{
    leaderboard?: string;
    viewport?: string;
    presets?: string;
  }>();
  const localHref = { pathname: '/local' as const, params: __DEV__ ? { viewport, presets } : undefined };
  const gameList = useGameList();
  const requestedLeaderboard = leaderboard && isLeaderboardBoard(leaderboard) ? leaderboard : null;

  // A game screen opens a leaderboard by returning here with ?leaderboard=<board>.
  // The lobby reads it during render, so clear it once handled.
  useEffect(() => {
    if (leaderboard) router.setParams({ leaderboard: undefined });
  }, [leaderboard, router]);

  if (!isMultiplayerConfigured) {
    return <Redirect href={localHref} />;
  }

  return (
    <MultiplayerLobby
      games={gameList.games}
      gamesProfileId={gameList.gamesProfileId}
      onGamesChange={gameList.setGames}
      onOpenGame={(gameId) => router.push(`/game/${encodeURIComponent(gameId)}`)}
      onPlayLocalDemo={(profile) => {
        gameList.setLocalPlayerProfile(profile);
        router.push(localHref);
      }}
      onRefreshGames={gameList.refreshGames}
      requestedLeaderboard={requestedLeaderboard}
    />
  );
}
