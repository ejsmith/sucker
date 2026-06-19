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
  duration: 880,
  fromX: -104,
  fromY: 28,
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
): RollingLaunch {
  const direction = side === 'left' ? 1 : -1;
  const spreadRank = index - 2;
  const fallbackSlotWidth = 64;
  const fallbackGap = 8;
  const fallbackToX = 8 + index * (fallbackSlotWidth + fallbackGap) + fallbackSlotWidth / 2 - rollingDieBaseSize / 2;
  const fallbackToY = 35 - rollingDieBaseSize / 2;
  const toX =
    rollZoneRect && slotRect ? slotRect.x - rollZoneRect.x + slotRect.width / 2 - rollingDieBaseSize / 2 : fallbackToX;
  const toY =
    rollZoneRect && slotRect ? slotRect.y - rollZoneRect.y + slotRect.height / 2 - rollingDieBaseSize / 2 : fallbackToY;
  const rollZoneWidth = rollZoneRect?.width ?? 393;
  const fromX =
    side === 'left' ? -rollingDieBaseSize - 18 - Math.random() * 34 : rollZoneWidth + 18 + Math.random() * 34;
  const fromY = toY + 18 + Math.random() * 22;
  const travelDistance = Math.abs(toX - fromX);
  const midApproachDistance = Math.min(120, Math.max(46, travelDistance * (0.24 + Math.random() * 0.1)));
  const laneOffset = spreadRank * (4 + Math.random() * 5);
  const midX = toX - direction * midApproachDistance + laneOffset;
  const midY = Math.max(-rollingDieBaseSize * 0.28, toY - (42 + Math.random() * 38));

  return {
    delay: Math.round(Math.random() * 90 + index * (8 + Math.random() * 12)),
    duration: Math.round(760 + Math.random() * 240),
    fromX,
    fromY,
    midX,
    midY,
    peakScale: 1.26 + Math.random() * 0.38,
    side,
    spin: direction * (88 + Math.random() * 58),
    toX,
    toY,
  };
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
