import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { RemoteGameScreen } from '../../App';
import { useGameList } from '../../src/navigation/GameListProvider';

export default function RemoteGameRoute() {
  const router = useRouter();
  const { gameId: gameIdParam } = useLocalSearchParams<{ gameId?: string | string[] }>();
  const gameId = Array.isArray(gameIdParam) ? gameIdParam[0] : gameIdParam;
  const gameList = useGameList();

  if (!gameId) {
    return <Redirect href="/" />;
  }

  return (
    <RemoteGameScreen
      key={gameId}
      gameId={gameId}
      games={gameList.games}
      gamesProfileId={gameList.gamesProfileId}
      onExit={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      onGameChange={gameList.rememberGame}
      onOpenGame={(nextGameId) => router.replace(`/game/${encodeURIComponent(nextGameId)}`)}
      onRefreshGames={gameList.refreshGames}
    />
  );
}
