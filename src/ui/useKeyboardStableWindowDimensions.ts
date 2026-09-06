import { useEffect, useMemo, useState } from 'react';
import { Platform, useWindowDimensions, type ScaledSize } from 'react-native';

const mobileWebWidthBreakpoint = 700;
const widthChangeTolerance = 2;
const keyboardDismissalDelayMs = 500;

// Shared sizing policy for every app screen, not just authentication. Native
// iOS overlays by default; Android uses softwareKeyboardLayoutMode: pan in
// app.json. Mobile web needs a stable frame for every focused text field.
export function useKeyboardStableWindowDimensions() {
  const dimensions = useWindowDimensions();
  const shouldStabilizeHeight = useMemo(() => shouldUseStableWebHeight(dimensions.width), [dimensions.width]);
  const [stableDimensions, setStableDimensions] = useState<ScaledSize>(dimensions);
  const [editingDimensions, setEditingDimensions] = useState<ScaledSize | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }

    const navigator = getWebNavigator();
    const userAgent = navigator?.userAgent ?? '';
    const isMobileDevice =
      /Android|iPhone|iPad|iPod/i.test(userAgent) ||
      (/Macintosh/i.test(userAgent) && (navigator?.maxTouchPoints ?? 0) > 1);
    if (!isMobileDevice) {
      return;
    }

    const isTextInput = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const handleFocus = (event: FocusEvent) => {
      if (isTextInput(event.target)) {
        // Capture before the software keyboard changes the viewport. Keep the
        // same frame when moving between fields with the keyboard still open.
        setEditingDimensions((current) => current ?? dimensions);
        setIsEditing(true);
      }
    };
    const handleBlur = (event: FocusEvent) => {
      if (!isTextInput(event.relatedTarget)) {
        setIsEditing(false);
      }
    };
    document.addEventListener('focusin', handleFocus);
    document.addEventListener('focusout', handleBlur);
    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('focusout', handleBlur);
    };
  }, [dimensions]);

  useEffect(() => {
    if (isEditing || !editingDimensions) return;
    // Blur precedes the keyboard's closing animation. Releasing the frame
    // immediately would briefly shrink every screen during dismissal. A new
    // focus cancels this release, including transitions through a button.
    const timeout = setTimeout(() => setEditingDimensions(null), keyboardDismissalDelayMs);
    return () => clearTimeout(timeout);
  }, [editingDimensions, isEditing]);

  useEffect(() => {
    if (!shouldStabilizeHeight) {
      // The state mirrors an external viewport measurement and must update after the committed resize.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStableDimensions((currentDimensions) =>
        areSameDimensions(currentDimensions, dimensions) ? currentDimensions : dimensions,
      );
      return;
    }

    setStableDimensions((currentDimensions) => {
      if (didWidthChange(currentDimensions.width, dimensions.width)) {
        return dimensions;
      }

      const nextDimensions = {
        ...dimensions,
        height: Math.max(currentDimensions.height, dimensions.height),
      };
      return areSameDimensions(currentDimensions, nextDimensions) ? currentDimensions : nextDimensions;
    });
  }, [dimensions, shouldStabilizeHeight]);

  // Safari ignores interactive-widget=overlays-content. Preserve the app's
  // frame while editing so its keyboard covers the app instead of scaling it.
  // Real width changes still update measurements; WebPortraitGuard separately
  // blocks mobile landscape rather than allowing a landscape app layout.
  if (editingDimensions && !didWidthChange(editingDimensions.width, dimensions.width)) {
    return { ...dimensions, height: Math.max(editingDimensions.height, dimensions.height) };
  }

  if (!shouldStabilizeHeight || didWidthChange(stableDimensions.width, dimensions.width)) {
    return dimensions;
  }

  return {
    ...dimensions,
    height: Math.max(stableDimensions.height, dimensions.height),
  };
}

function shouldUseStableWebHeight(width: number) {
  if (Platform.OS !== 'web' || width > mobileWebWidthBreakpoint) {
    return false;
  }

  const navigator = getWebNavigator();
  const matchMedia = getWebMatchMedia();
  const standaloneNavigator = navigator as (Navigator & { standalone?: boolean }) | null;
  const isInstalledWebApp = Boolean(
    standaloneNavigator?.standalone === true ||
    matchMedia?.('(display-mode: standalone)').matches ||
    matchMedia?.('(display-mode: fullscreen)').matches,
  );

  if (isInstalledWebApp) {
    // Installed PWAs have no collapsible browser toolbar. Respect every real
    // viewport-height update so iOS cannot retain its larger launch height and
    // clip the bottom of the game after the status-bar viewport settles.
    return false;
  }

  return Boolean(
    (typeof navigator?.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) ||
    matchMedia?.('(hover: none) and (pointer: coarse)').matches,
  );
}

function didWidthChange(previousWidth: number, nextWidth: number) {
  return Math.abs(previousWidth - nextWidth) > widthChangeTolerance;
}

function areSameDimensions(left: ScaledSize, right: ScaledSize) {
  return (
    left.fontScale === right.fontScale &&
    left.height === right.height &&
    left.scale === right.scale &&
    left.width === right.width
  );
}

function getWebNavigator() {
  return (globalThis as typeof globalThis & { navigator?: Navigator }).navigator ?? null;
}

function getWebMatchMedia() {
  return (globalThis as typeof globalThis & { matchMedia?: Window['matchMedia'] }).matchMedia ?? null;
}
