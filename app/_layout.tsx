import { Stack, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameListProvider } from '../src/navigation/GameListProvider';
import { useNotificationClicks } from '../src/multiplayer/notificationNavigation';
import { AppErrorBoundary } from '../src/ui/AppErrorBoundary';
import { WebPortraitGuard } from '../src/ui/WebPortraitGuard';

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <WebPortraitGuard>
          <GameListProvider>
            <NotificationRouter />
            <Stack screenOptions={{ animation: 'fade', headerShown: false }} />
          </GameListProvider>
        </WebPortraitGuard>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

function NotificationRouter() {
  const router = useRouter();
  const openGame = useCallback((gameId: string) => router.push(`/game/${encodeURIComponent(gameId)}`), [router]);
  useNotificationClicks(openGame);
  return null;
}
