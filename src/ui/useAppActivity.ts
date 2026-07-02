import { useEffect, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

function isActiveState(state: AppStateStatus) {
  return state !== 'background' && state !== 'inactive';
}

export function useAppActivity() {
  const [isAppActive, setIsAppActive] = useState(getCurrentActivityState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(isActiveState(nextState));
    });

    if (Platform.OS !== 'web') {
      return () => subscription.remove();
    }

    const handleFocus = () => setIsAppActive(getCurrentActivityState());
    const handleBlur = () => setIsAppActive(false);
    const document = getWebDocument();
    const window = getWebWindow();
    document?.addEventListener('visibilitychange', handleFocus);
    window?.addEventListener('focus', handleFocus);
    window?.addEventListener('pageshow', handleFocus);
    window?.addEventListener('blur', handleBlur);

    return () => {
      subscription.remove();
      document?.removeEventListener('visibilitychange', handleFocus);
      window?.removeEventListener('focus', handleFocus);
      window?.removeEventListener('pageshow', handleFocus);
      window?.removeEventListener('blur', handleBlur);
    };
  }, []);

  return isAppActive;
}

function getCurrentActivityState() {
  if (Platform.OS === 'web') {
    return getWebDocument()?.visibilityState !== 'hidden';
  }

  return isActiveState(AppState.currentState);
}

function getWebDocument() {
  return (globalThis as typeof globalThis & { document?: Document }).document ?? null;
}

function getWebWindow() {
  return (globalThis as typeof globalThis & { window?: Window }).window ?? null;
}
