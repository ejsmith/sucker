import type { ComponentRef } from 'react';
import { View } from 'react-native';
import type { DieValue } from '../game';

export type ViewRef = ComponentRef<typeof View>;

export type MeasuredRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type RollingLaunch = {
  delay: number;
  duration: number;
  fromX: number;
  fromY: number;
  landingScale: number;
  midX: number;
  midY: number;
  peakScale: number;
  side: 'left' | 'right';
  spin: number;
  toX: number;
  toY: number;
};

const rollingDieBaseSize = 88;

export const defaultRollingLaunch: RollingLaunch = {
  delay: 0,
  duration: 1180,
  fromX: -104,
  fromY: 28,
  landingScale: 64 / rollingDieBaseSize,
  midX: 72,
  midY: -24,
  peakScale: 1.45,
  side: 'left',
  spin: 110,
  toX: 0,
  toY: 0,
};

export function rollDisplayDie(): DieValue {
  return (Math.floor(Math.random() * 6) + 1) as DieValue;
}

export function createRollingLaunch(
  index: number,
  side: RollingLaunch['side'],
  rollZoneRect: MeasuredRect | null,
  slotRect: MeasuredRect | null,
  renderedDieSize = rollingDieBaseSize,
  landingDieSize?: number,
): RollingLaunch {
  const dieSize = Number.isFinite(renderedDieSize) && renderedDieSize > 0 ? renderedDieSize : rollingDieBaseSize;
  const geometryScale = dieSize / rollingDieBaseSize;
  const direction = side === 'left' ? 1 : -1;
  const spreadRank = index - 2;
  const fallbackSlotWidth = 64 * geometryScale;
  const fallbackGap = 8 * geometryScale;
  const fallbackToX =
    8 * geometryScale + index * (fallbackSlotWidth + fallbackGap) + fallbackSlotWidth / 2 - dieSize / 2;
  const fallbackToY = 35 * geometryScale - dieSize / 2;
  const toX = rollZoneRect && slotRect ? slotRect.x - rollZoneRect.x + slotRect.width / 2 - dieSize / 2 : fallbackToX;
  const toY = rollZoneRect && slotRect ? slotRect.y - rollZoneRect.y + slotRect.height / 2 - dieSize / 2 : fallbackToY;
  const measuredLandingSize = slotRect ? Math.min(slotRect.width, slotRect.height) : fallbackSlotWidth;
  const landingSize =
    typeof landingDieSize === 'number' && Number.isFinite(landingDieSize) && landingDieSize > 0
      ? landingDieSize
      : measuredLandingSize;
  const rollZoneWidth = rollZoneRect?.width ?? 393 * geometryScale;
  const fromX =
    side === 'left'
      ? -dieSize - (18 + Math.random() * 34) * geometryScale
      : rollZoneWidth + (18 + Math.random() * 34) * geometryScale;
  const fromY = toY + (18 + Math.random() * 22) * geometryScale;
  const travelDistance = Math.abs(toX - fromX);
  const midApproachDistance = Math.min(
    120 * geometryScale,
    Math.max(46 * geometryScale, travelDistance * (0.24 + Math.random() * 0.1)),
  );
  const laneOffset = spreadRank * (4 + Math.random() * 5) * geometryScale;
  const midX = toX - direction * midApproachDistance + laneOffset;
  const midY = Math.max(-dieSize * 0.28, toY - (42 + Math.random() * 38) * geometryScale);

  return {
    delay: Math.round(Math.random() * 90 + index * (8 + Math.random() * 12)),
    duration: Math.round(1040 + Math.random() * 320),
    fromX,
    fromY,
    landingScale: landingSize / dieSize,
    midX,
    midY,
    peakScale: 1.26 + Math.random() * 0.38,
    side,
    spin: direction * (88 + Math.random() * 58),
    toX,
    toY,
  };
}

export function createRollingScaleOutputRange(index: number, launch: RollingLaunch) {
  const landingScale = launch.landingScale;

  return [
    0.86 + index * 0.02,
    1.18,
    launch.peakScale,
    Math.max(1.02, landingScale * 1.08),
    landingScale,
    landingScale,
  ];
}

export function measureInWindow(node: ViewRef | null): Promise<MeasuredRect | null> {
  return new Promise((resolve) => {
    if (!node) {
      resolve(null);
      return;
    }

    node.measureInWindow((x, y, width, height) => {
      if (width === 0 || height === 0) {
        resolve(null);
        return;
      }

      resolve({ height, width, x, y });
    });
  });
}

export function wait(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
