import { type ReactNode, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: 'portrait') => Promise<void>;
};

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

export function WebPortraitGuard({ children }: { children: ReactNode }) {
  const [showLandscapeGuard, setShowLandscapeGuard] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)');
    const landscapeQuery = window.matchMedia('(orientation: landscape)');
    const isInstalledPwa = () =>
      standaloneQuery.matches ||
      fullscreenQuery.matches ||
      (window.navigator as StandaloneNavigator).standalone === true;
    const updateGuard = () => {
      const installed = isInstalledPwa();
      setShowLandscapeGuard(installed && landscapeQuery.matches);
      if (installed) {
        void lockPortraitOrientation();
      }
    };

    updateGuard();
    standaloneQuery.addEventListener('change', updateGuard);
    fullscreenQuery.addEventListener('change', updateGuard);
    landscapeQuery.addEventListener('change', updateGuard);
    window.addEventListener('resize', updateGuard);
    document.addEventListener('visibilitychange', updateGuard);

    return () => {
      standaloneQuery.removeEventListener('change', updateGuard);
      fullscreenQuery.removeEventListener('change', updateGuard);
      landscapeQuery.removeEventListener('change', updateGuard);
      window.removeEventListener('resize', updateGuard);
      document.removeEventListener('visibilitychange', updateGuard);
    };
  }, []);

  if (showLandscapeGuard) {
    return (
      <View style={styles.guard} testID="pwa-landscape-guard">
        <Text style={styles.icon}>↻</Text>
        <Text style={styles.title}>Rotate to portrait</Text>
        <Text style={styles.body}>Sucker! is designed to play upright.</Text>
      </View>
    );
  }

  return children;
}

async function lockPortraitOrientation() {
  const orientation = window.screen.orientation as LockableScreenOrientation | undefined;
  if (!orientation?.lock) {
    return;
  }

  try {
    await orientation.lock('portrait');
  } catch {
    // iOS and some browsers ignore the Screen Orientation API for installed PWAs.
  }
}

const styles = StyleSheet.create({
  body: {
    color: '#FFF3C2',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  guard: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    padding: 28,
  },
  icon: {
    color: '#FFD329',
    fontSize: 52,
    fontWeight: '900',
  },
  title: {
    color: '#FFD329',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
});
