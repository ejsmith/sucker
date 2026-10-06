import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, Vibration } from 'react-native';
import { createHapticPlayer } from './player';
import {
  defaultHapticPreferences,
  parseHapticPreferences,
  type HapticChoice,
  type HapticEffect,
  type HapticEvent,
  type HapticPreferences,
  type ImpactStyle,
} from './patterns';

const storageKey = 'sucker.haptics.v1';
const impacts: Record<ImpactStyle, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
  soft: Haptics.ImpactFeedbackStyle.Soft,
};
const androidEffects: Record<Exclude<HapticEffect, 'original'>, Haptics.AndroidHaptics> = {
  light: Haptics.AndroidHaptics.Clock_Tick,
  medium: Haptics.AndroidHaptics.Virtual_Key,
  heavy: Haptics.AndroidHaptics.Long_Press,
  rigid: Haptics.AndroidHaptics.Context_Click,
  soft: Haptics.AndroidHaptics.Segment_Frequent_Tick,
  success: Haptics.AndroidHaptics.Confirm,
};

function trigger(effect: HapticEffect, event: HapticEvent) {
  // Browser vibration cannot reproduce native Taptic effects. The lab still previews visuals.
  if (Platform.OS === 'web') return;
  if (effect === 'original') {
    Vibration.vibrate(
      event === 'sucker'
        ? Platform.OS === 'ios'
          ? [0, 550]
          : [0, 120, 100, 180]
        : event === 'punchLanded'
          ? 120
          : 400,
    );
    return;
  }
  if (Platform.OS === 'android') return Haptics.performAndroidHapticsAsync(androidEffects[effect]);
  return effect === 'success'
    ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : Haptics.impactAsync(impacts[effect]);
}

type HapticsContextValue = {
  preferences: HapticPreferences;
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
  const [player] = useState(() =>
    createHapticPlayer({
      trigger,
      cancel: () => Vibration.cancel(),
      isActive: () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
    }),
  );

  const reload = useCallback(() => {
    return AsyncStorage.getItem(storageKey)
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
