import { useRouter } from 'expo-router';
import { LocalGameScreen } from '../App';
import { isMultiplayerConfigured } from '../src/multiplayer';
import { useGameList } from '../src/navigation/GameListProvider';

export default function LocalGameRoute() {
  const router = useRouter();
  const { localPlayerProfile } = useGameList();
  return (
    <LocalGameScreen
      localPlayerAvatarUrl={localPlayerProfile?.avatarUrl}
      localPlayerName={localPlayerProfile?.displayName}
      onExit={isMultiplayerConfigured ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined}
    />
  );
}
