import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { MultiplayerLobby } from '../src/multiplayer/MultiplayerLobby';
import { isMultiplayerConfigured } from '../src/multiplayer';
import { useGameList } from '../src/navigation/GameListProvider';

export default function LobbyRoute() {
  const router = useRouter();
  const { viewport, presets } = useLocalSearchParams<{ viewport?: string; presets?: string }>();
  const localHref = { pathname: '/local' as const, params: __DEV__ ? { viewport, presets } : undefined };
  const gameList = useGameList();

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
    />
  );
}
