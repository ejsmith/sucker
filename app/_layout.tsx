import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { Inter_900Black } from '@expo-google-fonts/inter/900Black';
import { useFonts } from '@expo-google-fonts/inter/useFonts';
import { Stack, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameListProvider } from '../src/navigation/GameListProvider';
import { useNotificationClicks } from '../src/multiplayer/notificationNavigation';
import { AppErrorBoundary } from '../src/ui/AppErrorBoundary';
import { WebPortraitGuard } from '../src/ui/WebPortraitGuard';
import { MonitoringRoute } from '../src/monitoring/MonitoringRoute';
import { NetworkProvider, NetworkStatusBanner } from '../src/network/NetworkProvider';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_800ExtraBold, Inter_900Black });

  useEffect(() => {
    if (fontError) {
      console.warn('Unable to load Inter fonts; continuing with platform font fallback.', fontError);
    }
  }, [fontError]);

  if (!fontsLoaded && !fontError) {
    return <View style={styles.fontLoadingScreen} />;
  }

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <WebPortraitGuard>
          <NetworkProvider>
            <NetworkStatusBanner />
            <GameListProvider>
              <MonitoringRoute />
              <NotificationRouter />
              <Stack screenOptions={{ animation: 'fade', headerShown: false }} />
            </GameListProvider>
          </NetworkProvider>
        </WebPortraitGuard>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  fontLoadingScreen: {
    backgroundColor: '#8F0000',
    flex: 1,
  },
});

function NotificationRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const openGame = useCallback(
    (gameId: string, source: 'foreground' | 'initial') => {
      const path = `/game/${encodeURIComponent(gameId)}` as const;
      if (pathnameRef.current === path) {
        return;
      }
      if (source === 'initial') {
        router.replace(path);
      } else {
        router.push(path);
      }
    },
    [router],
  );
  useNotificationClicks(openGame);
  return null;
}
