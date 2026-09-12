import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const preferenceKey = 'sucker.computerTurnSpeed.v1';

export function useComputerTurnSpeed() {
  const [fast, setFast] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(preferenceKey)
      .then((value) => {
        if (active) setFast(value === 'fast');
      })
      .catch(() => {
        if (active) setError('Could not load computer pace. Normal pace is active.');
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function toggle() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    const next = !fast;
    try {
      await AsyncStorage.setItem(preferenceKey, next ? 'fast' : 'normal');
      setFast(next);
    } catch {
      setError('Could not save computer pace. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return { fast, ready, saving, error, toggle };
}
