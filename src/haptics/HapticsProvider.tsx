import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { createHapticDriver, type HapticSupport } from './driver';
import { createHapticPlayer } from './player';
import {
  defaultHapticPreferences,
  parseHapticPreferences,
  type HapticChoice,
  type HapticEvent,
  type HapticPreferences,
} from './patterns';

const storageKey = 'sucker.haptics.v2';
const previousStorageKey = 'sucker.haptics.v1';

type HapticsContextValue = {
  preferences: HapticPreferences;
  support: HapticSupport;
  ready: boolean;
  loadError: boolean;
  reload: () => Promise<void>;
  save: (event: HapticEvent, choice: HapticChoice) => Promise<void>;
  play: (event: HapticEvent) => void;
  preview: (event: HapticEvent, choice: HapticChoice) => void;
  setPreviewActive: (active: boolean) => void;
  cancel: () => void;
};
const HapticsContext = createContext<HapticsContextValue | null>(null);

export function HapticsProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaultHapticPreferences);
  const preferencesRef = useRef(preferences);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const previewActive = useRef(false);
  const [driver] = useState(createHapticDriver);
  const [player] = useState(() =>
    createHapticPlayer({
      ...driver,
      isActive: () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
    }),
  );

  const reload = useCallback(() => {
    return AsyncStorage.getItem(storageKey)
      .then((raw) => raw ?? AsyncStorage.getItem(previousStorageKey))
      .then((raw) => {
        const loaded = parseHapticPreferences(raw);
        preferencesRef.current = loaded;
        setPreferences(loaded);
        setLoadError(false);
        readyRef.current = true;
        setReady(true);
      })
      .catch(() => {
        setLoadError(true);
        readyRef.current = true;
        setReady(true);
      });
  }, []);

  useEffect(() => {
    void reload();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') player.cancel();
    });
    return () => {
      subscription.remove();
      player.cancel();
    };
  }, [player, reload]);

  const save = useCallback(async (event: HapticEvent, choice: HapticChoice) => {
    const next = parseHapticPreferences(JSON.stringify({ ...preferencesRef.current, [event]: choice }));
    await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    preferencesRef.current = next;
    setPreferences(next);
  }, []);

  const play = useCallback(
    (event: HapticEvent) => {
      if (readyRef.current && !previewActive.current) player.play(event, preferencesRef.current[event]);
    },
    [player],
  );
  const setPreviewActive = useCallback(
    (active: boolean) => {
      previewActive.current = active;
      player.cancel();
    },
    [player],
  );

  return (
    <HapticsContext.Provider
      value={{
        preferences,
        support: driver.support,
        ready,
        loadError,
        reload,
        save,
        play,
        preview: player.play,
        cancel: player.cancel,
        setPreviewActive,
      }}
    >
      {children}
    </HapticsContext.Provider>
  );
}

export function useHaptics() {
  const context = useContext(HapticsContext);
  if (!context) throw new Error('HapticsProvider is required.');
  return context;
}
