import { Redirect, useRouter } from 'expo-router';
import { MultiplayerLobby } from '../src/multiplayer/MultiplayerLobby';
import { isMultiplayerConfigured } from '../src/multiplayer';
import { useGameList } from '../src/navigation/GameListProvider';

export default function LobbyRoute() {
  const router = useRouter();
  const gameList = useGameList();

  if (!isMultiplayerConfigured) {
    return <Redirect href="/local" />;
  }

  return (
    <MultiplayerLobby
      games={gameList.games}
      gamesProfileId={gameList.gamesProfileId}
      onGamesChange={gameList.setGames}
      onOpenGame={(gameId) => router.push(`/game/${encodeURIComponent(gameId)}`)}
      onPlayLocalDemo={(profile) => {
        gameList.setLocalPlayerProfile(profile);
        router.push('/local');
      }}
      onRefreshGames={gameList.refreshGames}
    />
  );
}
