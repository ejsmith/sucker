import { useEffect, useMemo, useState } from 'react';
import { Platform, useWindowDimensions, type ScaledSize } from 'react-native';

const mobileWebWidthBreakpoint = 700;
const widthChangeTolerance = 2;

export function useKeyboardStableWindowDimensions() {
  const dimensions = useWindowDimensions();
  const shouldStabilizeHeight = useMemo(() => shouldUseStableWebHeight(dimensions.width), [dimensions.width]);
  const [stableDimensions, setStableDimensions] = useState<ScaledSize>(dimensions);

  useEffect(() => {
    if (!shouldStabilizeHeight) {
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
  }, [dimensions.fontScale, dimensions.height, dimensions.scale, dimensions.width, shouldStabilizeHeight]);

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
