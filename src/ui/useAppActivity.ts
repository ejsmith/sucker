import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

function isActiveState(state: AppStateStatus) {
  return state !== 'background' && state !== 'inactive';
}

export function useAppActivity() {
  const [isAppActive, setIsAppActive] = useState(() => isActiveState(AppState.currentState));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(isActiveState(nextState));
    });

    return () => subscription.remove();
  }, []);

  return isAppActive;
}
