import { useMemo, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { DieValue } from '../game';
import { DieFace } from './DieFace';
import { Pressable } from './Pressable';

const suckerTokenImage = require('../../assets/sucker-token.png');
const maxTokenDebris = 15;
const easedSteps = 8;

// Rough centers of the scorecard and dice tray, as fractions of the stage
// height from its middle. Pieces that aim at a spot on screen use these.
const boardCenterY = -0.01;
const trayCenterY = 0.41;
// Where Yeet throws everything, from the middle of the stage.
const vanish = { x: 0.3, y: -0.4 };

type AnimatedStyle = Animated.WithAnimatedValue<ViewStyle>;
type Ease = (t: number) => number;
// [progress, value, easing used to arrive here from the previous key]
type Key = readonly [number, number, Ease?];
type Stage = { height: number; progress: Animated.Value; width: number };
type Piece = { count: number; index: number };
type Shout = { from: number; text: string; tilt: number; to: number };

type FlipSpec = {
  board: (stage: Stage) => AnimatedStyle;
  durationMs: number;
  flash?: { at: number; color: string; peak: number };
  label: string;
  piece: (stage: Stage, piece: Piece) => AnimatedStyle;
  shouts: readonly Shout[];
  sparkles?: readonly number[];
  tray: (stage: Stage) => AnimatedStyle;
};

const easeIn = Easing.in(Easing.quad);
const easeOut = Easing.out(Easing.quad);
const easeOutCubic = Easing.out(Easing.cubic);

function sample(keys: readonly Key[]) {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  keys.forEach(([at, value, ease], index) => {
    const previous = keys[index - 1];
    if (previous && ease) {
      for (let step = 1; step < easedSteps; step += 1) {
        const t = step / easedSteps;
        inputRange.push(previous[0] + (at - previous[0]) * t);
        outputRange.push(previous[1] + (value - previous[1]) * ease(t));
      }
    }
    inputRange.push(at);
    outputRange.push(value);
  });
  return { inputRange, outputRange };
}

// Easing is baked into extra keys because the native driver only interpolates
// linearly.
function track(progress: Animated.Value, keys: readonly Key[]) {
  return progress.interpolate({ ...sample(keys), extrapolate: 'clamp' });
}

function turn(progress: Animated.Value, keys: readonly Key[]) {
  const { inputRange, outputRange } = sample(keys);
  return progress.interpolate({
    extrapolate: 'clamp',
    inputRange,
    outputRange: outputRange.map((degrees) => `${degrees}deg`),
  });
}

// Alternating jolts that ramp between two amplitudes and settle back to zero.
function jolts(from: number, to: number, startAmplitude: number, endAmplitude: number, count: number): Key[] {
  const keys: Key[] = [[from, 0]];
  for (let jolt = 1; jolt <= count; jolt += 1) {
    const t = jolt / (count + 1);
    const amplitude = startAmplitude + (endAmplitude - startAmplitude) * t;
    keys.push([from + (to - from) * t, jolt % 2 === 0 ? -amplitude : amplitude]);
  }
  keys.push([to, 0]);
  return keys;
}

// Deterministic noise in [0, 1) so replays and screenshots match.
function noise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

// Each piece starts on a different spot of the tabletop.
function scatter(index: number) {
  return {
    delay: 0.12 + noise(index + 1) * 0.22,
    dx: (noise(index + 11) * 2 - 1) * 175,
    peak: -(120 + noise(index + 23) * 240),
    spin: (noise(index + 37) > 0.5 ? 1 : -1) * (300 + noise(index + 51) * 600),
    x0: (noise(index + 67) * 2 - 1) * 130,
    y0: -60 - noise(index + 79) * 220,
  };
}

function appear(progress: Animated.Value, from: number, until = 0.92) {
  return track(progress, [
    [0, 0],
    [from, 0],
    [from + 0.01, 1],
    [until, 1],
    [Math.min(1, until + 0.08), 0],
  ]);
}

// Launched off the tabletop on an arc, then gravity wins.
function arcPiece({ height, progress }: Stage, { index }: Piece): AnimatedStyle {
  const { delay, dx, peak, spin, x0, y0 } = scatter(index);
  const start = Math.min(delay, 0.4);
  return {
    opacity: appear(progress, start),
    transform: [
      { translateX: track(progress, [[0, x0], [start, x0], [1, x0 + dx]]) },
      {
        translateY: track(progress, [
          [0, y0],
          [start, y0],
          [start + (1 - start) * 0.4, y0 + peak, easeOut],
          [1, height * 0.75, easeIn],
        ]),
      },
      { rotate: turn(progress, [[0, 0], [start, 0], [1, spin]]) },
    ],
  };
}

// Slides off the tipping table and over the right edge.
function slidePiece({ height, progress, width }: Stage, { index }: Piece): AnimatedStyle {
  const { spin, x0, y0 } = scatter(index);
  const start = 0.2 + noise(index + 91) * 0.15;
  const offEdge = start + 0.3;
  const reach = noise(index + 3) * 0.2;
  return {
    opacity: appear(progress, start),
    transform: [
      {
        translateX: track(progress, [
          [0, x0],
          [start, x0],
          [offEdge, width * (0.55 + reach), easeIn],
          [1, width * (0.8 + reach)],
        ]),
      },
      {
        translateY: track(progress, [
          [0, y0],
          [start, y0],
          [start + 0.08, y0 - 24, easeOut],
          [offEdge, y0 + 40, easeIn],
          [1, height * 0.8, easeIn],
        ]),
      },
      { rotate: turn(progress, [[0, 0], [start, 0], [1, spin]]) },
    ],
  };
}

// Jolted straight up by the slam, then rains down.
function popPiece({ height, progress }: Stage, { index }: Piece): AnimatedStyle {
  const { spin, x0, y0 } = scatter(index);
  const lift = 0.16 + noise(index + 29) * 0.04;
  const apex = lift + 0.16 + noise(index + 41) * 0.1;
  const hop = 140 + noise(index + 5) * 220;
  const drift = (noise(index + 13) * 2 - 1) * 120;
  return {
    opacity: appear(progress, lift),
    transform: [
      { translateX: track(progress, [[0, x0], [lift, x0], [1, x0 + drift]]) },
      {
        translateY: track(progress, [
          [0, y0],
          [lift, y0],
          [apex, y0 - hop, easeOut],
          [1, height * 0.8, easeIn],
        ]),
      },
      { rotate: turn(progress, [[0, 0], [lift, 0], [1, spin]]) },
    ],
  };
}

// Thrown into the distance after the board.
function yeetPiece({ height, progress, width }: Stage, { index }: Piece): AnimatedStyle {
  const { spin, x0, y0 } = scatter(index);
  const start = 0.16 + noise(index + 3) * 0.3;
  const end = start + 0.36;
  return {
    opacity: appear(progress, start, end - 0.04),
    transform: [
      { translateX: track(progress, [[0, x0], [start, x0], [end, width * vanish.x, easeOutCubic]]) },
      { translateY: track(progress, [[0, y0], [start, y0], [end, height * vanish.y, easeOutCubic]]) },
      { rotate: turn(progress, [[0, 0], [start, 0], [end, spin * 2]]) },
      { scale: track(progress, [[0, 1], [start, 1], [end, 0.05, easeOutCubic]]) },
    ],
  };
}

// Blown outward from the middle of the board in every direction.
function burstPiece({ height, progress, width }: Stage, { count, index }: Piece): AnimatedStyle {
  const { spin, x0 } = scatter(index);
  const angle = (index / count) * Math.PI * 2 + noise(index + 7) * 0.6;
  const reach = (0.4 + noise(index + 19) * 0.35) * Math.max(width, height) * 0.8;
  const startX = x0 * 0.3;
  const startY = height * boardCenterY;
  const endX = startX + Math.cos(angle) * reach;
  const endY = startY + Math.sin(angle) * reach;
  return {
    opacity: appear(progress, 0.32, 0.86),
    transform: [
      { translateX: track(progress, [[0, startX], [0.32, startX], [0.75, endX, easeOutCubic]]) },
      {
        translateY: track(progress, [
          [0, startY],
          [0.32, startY],
          [0.75, endY, easeOutCubic],
          [1, endY + height * 0.25, easeIn],
        ]),
      },
      { rotate: turn(progress, [[0, 0], [0.32, 0], [1, spin * 1.5]]) },
      { scale: track(progress, [[0, 0.4], [0.32, 0.4], [0.42, 1.3, easeOut], [1, 1]]) },
    ],
  };
}

const stomps = [
  [0.08, 6],
  [0.2, 10],
  [0.32, 18],
] as const;

function stompKeys(scale: number): Key[] {
  return stomps.flatMap(([at, depth]): Key[] => [
    [at - 0.03, -depth * 0.5 * scale, easeOut],
    [at, depth * scale, easeIn],
    [at + 0.05, 0, easeOut],
  ]);
}

function stompShake(): Key[] {
  return [...jolts(0.08, 0.15, 4, 1, 4), ...jolts(0.2, 0.27, 7, 1, 4), ...jolts(0.32, 0.42, 12, 2, 6)];
}

// Hops with every stomp, then flies when the table goes.
function tantrumPiece({ height, progress }: Stage, { index }: Piece): AnimatedStyle {
  const { delay, dx, peak, spin, x0, y0 } = scatter(index);
  const bounce = 0.7 + noise(index + 61) * 0.6;
  const start = 0.46 + (delay - 0.12) * 0.5;
  const hops = stomps.flatMap(([at, depth]): Key[] => [
    [at, y0],
    [at + 0.05, y0 - depth * 5 * bounce, easeOut],
    [at + 0.1, y0, easeIn],
  ]);
  return {
    opacity: appear(progress, 0.07),
    transform: [
      { translateX: track(progress, [[0, x0], [start, x0], [1, x0 + dx]]) },
      {
        translateY: track(progress, [
          [0, y0],
          ...hops,
          [start, y0],
          [start + (1 - start) * 0.4, y0 + peak, easeOut],
          [1, height * 0.75, easeIn],
        ]),
      },
      { rotate: turn(progress, [[0, 0], [start, 0], [1, spin]]) },
    ],
  };
}

const tableFlipSpecs = {
  // The scorecard heaves up and over; the tray tumbles off the bottom.
  classic: {
    label: 'Classic',
    durationMs: 1_350,
    shouts: [{ from: 0.18, text: 'TABLE FLIP!', tilt: 0, to: 1 }],
    board: ({ height, progress }) => ({
      opacity: track(progress, [[0, 1], [0.7, 1], [0.9, 0]]),
      transform: [
        { perspective: 900 },
        { translateY: track(progress, [[0, 0], [0.14, 10], [0.3, -height * 0.08], [0.9, -height * 1.05]]) },
        { rotateX: turn(progress, [[0, 0], [0.14, 6], [0.9, -118]]) },
        { rotateZ: turn(progress, [[0, 0], [0.14, 2], [0.9, -19]]) },
      ],
    }),
    tray: ({ height, progress }) => ({
      opacity: track(progress, [[0, 1], [0.75, 1], [0.95, 0]]),
      transform: [
        { translateY: track(progress, [[0, 0], [0.2, -14], [0.95, height * 0.65]]) },
        { rotateZ: turn(progress, [[0, 0], [0.2, -3], [0.95, 24]]) },
      ],
    }),
    piece: arcPiece,
  },
  // Lifted by one edge and tipped over sideways. Everything slides off.
  tip: {
    label: 'Tip Over',
    durationMs: 1_500,
    shouts: [{ from: 0.2, text: 'NOPE.', tilt: -6, to: 0.95 }],
    board: ({ height, progress, width }) => ({
      opacity: track(progress, [[0, 1], [0.8, 1], [0.9, 0]]),
      transform: [
        { translateX: track(progress, [[0, 0], [0.4, 0], [0.88, width * 0.2, easeIn]]) },
        { translateY: track(progress, [[0, 0], [0.42, 0], [0.88, height, easeIn]]) },
        {
          rotate: turn(progress, [
            [0, 0],
            [0.1, 5, easeOut],
            [0.18, 0, easeIn],
            [0.2, 1],
            [0.7, 100, easeIn],
            [0.88, 130],
          ]),
        },
      ],
      transformOrigin: 'right bottom',
    }),
    tray: ({ height, progress, width }) => ({
      opacity: track(progress, [[0, 1], [0.72, 1], [0.8, 0]]),
      transform: [
        {
          translateX: track(progress, [
            [0, 0],
            [0.1, -6, easeOut],
            [0.18, 0],
            [0.28, 0],
            [0.75, width * 1.1, easeIn],
          ]),
        },
        { translateY: track(progress, [[0, 0], [0.45, 0], [0.78, height * 0.3, easeIn]]) },
        { rotate: turn(progress, [[0, 0], [0.28, 0], [0.75, 35, easeIn]]) },
      ],
    }),
    piece: slidePiece,
  },
  // One fist on the table. Everything jumps, then the whole thing collapses.
  slam: {
    label: 'Slam',
    durationMs: 1_500,
    flash: { at: 0.16, color: '#F12D22', peak: 0.4 },
    shouts: [{ from: 0.16, text: 'SLAM!', tilt: -4, to: 0.95 }],
    board: ({ height, progress }) => ({
      opacity: track(progress, [[0, 1], [0.84, 1], [0.92, 0]]),
      transform: [
        { translateX: track(progress, jolts(0.16, 0.46, 14, 2, 9)) },
        {
          translateY: track(progress, [
            [0, 0],
            [0.12, -14, easeOut],
            [0.16, 10, easeIn],
            [0.24, 0, easeOut],
            [0.5, 0],
            [0.92, height * 1.05, easeIn],
          ]),
        },
        { rotate: turn(progress, [[0, 0], [0.5, 0], [0.92, -14, easeIn]]) },
        {
          scale: track(progress, [
            [0, 1],
            [0.12, 1.03, easeOut],
            [0.16, 0.95, easeIn],
            [0.24, 1, easeOut],
          ]),
        },
      ],
    }),
    tray: ({ height, progress }) => ({
      opacity: track(progress, [[0, 1], [0.88, 1], [0.95, 0]]),
      transform: [
        { translateX: track(progress, jolts(0.16, 0.46, 14, 2, 9)) },
        {
          translateY: track(progress, [
            [0, 0],
            [0.16, 0],
            [0.18, 8],
            [0.24, 0],
            [0.56, 0],
            [0.95, height * 0.7, easeIn],
          ]),
        },
        { rotate: turn(progress, [[0, 0], [0.56, 0], [0.95, 18, easeIn]]) },
      ],
    }),
    piece: popPiece,
  },
  // Wound up and hurled into the distance until it twinkles out.
  yeet: {
    label: 'Yeet',
    durationMs: 1_700,
    shouts: [{ from: 0.14, text: 'YEET!', tilt: 8, to: 0.9 }],
    sparkles: [0.7, 0.86],
    board: ({ height, progress, width }) => ({
      opacity: track(progress, [[0, 1], [0.66, 1], [0.72, 0]]),
      transform: [
        { translateX: track(progress, [[0, 0], [0.14, -12, easeOut], [0.7, width * vanish.x, easeOutCubic]]) },
        {
          translateY: track(progress, [
            [0, 0],
            [0.14, 24, easeOut],
            [0.7, height * (vanish.y - boardCenterY), easeOutCubic],
          ]),
        },
        { rotate: turn(progress, [[0, 0], [0.14, -10, easeOut], [0.7, 1_080, easeOut]]) },
        { scale: track(progress, [[0, 1], [0.14, 1.05, easeOut], [0.7, 0.02, easeOutCubic]]) },
      ],
    }),
    tray: ({ height, progress, width }) => ({
      opacity: track(progress, [[0, 1], [0.82, 1], [0.88, 0]]),
      transform: [
        {
          translateX: track(progress, [
            [0, 0],
            [0.3, 0],
            [0.4, 10, easeOut],
            [0.86, width * vanish.x, easeOutCubic],
          ]),
        },
        {
          translateY: track(progress, [
            [0, 0],
            [0.3, 0],
            [0.4, 18, easeOut],
            [0.86, height * (vanish.y - trayCenterY), easeOutCubic],
          ]),
        },
        { rotate: turn(progress, [[0, 0], [0.3, 0], [0.4, 10, easeOut], [0.86, -900, easeOut]]) },
        { scale: track(progress, [[0, 1], [0.3, 1], [0.4, 1.04, easeOut], [0.86, 0.02, easeOutCubic]]) },
      ],
    }),
    piece: yeetPiece,
  },
  // Rage builds into a tremble, then the board blows apart.
  kaboom: {
    label: 'Kaboom',
    durationMs: 1_400,
    flash: { at: 0.32, color: '#FFF3C2', peak: 0.95 },
    shouts: [{ from: 0.32, text: 'KABOOM!', tilt: -5, to: 0.97 }],
    board: ({ progress }) => ({
      opacity: track(progress, [[0, 1], [0.32, 1], [0.44, 0]]),
      transform: [
        { translateX: track(progress, jolts(0, 0.32, 1, 9, 14)) },
        { rotate: turn(progress, [[0, 0], [0.32, 0], [0.44, 8]]) },
        { scale: track(progress, [[0, 1], [0.32, 1.05, easeIn], [0.44, 1.8, easeOut]]) },
      ],
    }),
    tray: ({ height, progress }) => ({
      opacity: track(progress, [[0, 1], [0.5, 1], [0.6, 0]]),
      transform: [
        { translateX: track(progress, jolts(0, 0.32, 1, 9, 14)) },
        { translateY: track(progress, [[0, 0], [0.32, 0], [0.6, height * 0.6, easeOut]]) },
        { rotate: turn(progress, [[0, 0], [0.32, 0], [0.6, -28, easeOut]]) },
      ],
    }),
    piece: burstPiece,
  },
  // Stomp, stomp, STOMP, then the classic flip.
  tantrum: {
    label: 'Tantrum',
    durationMs: 2_400,
    shouts: [
      { from: 0.06, text: 'STOMP', tilt: -8, to: 0.19 },
      { from: 0.19, text: 'STOMP', tilt: 7, to: 0.31 },
      { from: 0.31, text: 'WAAAH!', tilt: -3, to: 0.97 },
    ],
    board: ({ height, progress }) => ({
      opacity: track(progress, [[0, 1], [0.86, 1], [0.95, 0]]),
      transform: [
        { perspective: 900 },
        { translateX: track(progress, stompShake()) },
        {
          translateY: track(progress, [
            [0, 0],
            ...stompKeys(1),
            [0.44, 0],
            [0.48, 10],
            [0.58, -height * 0.08, easeOut],
            [0.95, -height * 1.05, easeIn],
          ]),
        },
        { rotateX: turn(progress, [[0, 0], [0.44, 0], [0.48, 6], [0.95, -118, easeIn]]) },
        { rotateZ: turn(progress, [[0, 0], [0.44, 0], [0.48, 2], [0.95, -19, easeIn]]) },
      ],
    }),
    tray: ({ height, progress }) => ({
      opacity: track(progress, [[0, 1], [0.9, 1], [0.97, 0]]),
      transform: [
        { translateX: track(progress, stompShake()) },
        {
          translateY: track(progress, [
            [0, 0],
            ...stompKeys(0.6),
            [0.48, 0],
            [0.52, -14, easeOut],
            [0.97, height * 0.65, easeIn],
          ]),
        },
        { rotate: turn(progress, [[0, 0], [0.52, 0], [0.97, 24, easeIn]]) },
      ],
    }),
    piece: tantrumPiece,
  },
} satisfies Record<string, FlipSpec>;

export type TableFlipStyleId = keyof typeof tableFlipSpecs;

export const defaultTableFlipStyleId: TableFlipStyleId = 'classic';
export const tableFlipStyleIds = Object.keys(tableFlipSpecs) as TableFlipStyleId[];

function isTableFlipStyleId(value: unknown): value is TableFlipStyleId {
  return typeof value === 'string' && value in tableFlipSpecs;
}

export function runTableFlip(progress: Animated.Value, reduceMotion: boolean, styleId: TableFlipStyleId) {
  return new Promise<void>((resolve) => {
    if (reduceMotion) {
      progress.setValue(1);
      resolve();
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      duration: tableFlipSpecs[styleId].durationMs,
      easing: Easing.linear,
      toValue: 1,
      useNativeDriver: true,
    }).start(() => resolve());
  });
}

// The scorecard is the tabletop.
export function getTableFlipBoardStyle(
  styleId: TableFlipStyleId,
  progress: Animated.Value,
  width: number,
  height: number,
) {
  return tableFlipSpecs[styleId].board({ height, progress, width });
}

// The dice tray and buttons.
export function getTableFlipTrayStyle(
  styleId: TableFlipStyleId,
  progress: Animated.Value,
  width: number,
  height: number,
) {
  return tableFlipSpecs[styleId].tray({ height, progress, width });
}

type Debris = { kind: 'die'; face: DieValue } | { kind: 'token' };

export function TableFlipDebris({
  dice,
  progress,
  stageHeight,
  stageWidth,
  style,
  styleId,
  tokensLeft,
}: {
  dice: readonly DieValue[];
  progress: Animated.Value;
  stageHeight: number;
  stageWidth: number;
  style?: StyleProp<ViewStyle>;
  styleId: TableFlipStyleId;
  tokensLeft: number;
}) {
  const spec: FlipSpec = tableFlipSpecs[styleId];
  const tokenCount = Math.min(maxTokenDebris, Math.max(0, tokensLeft));
  // Hoarded tokens make the mess bigger. That is the joke.
  const pieces = useMemo(() => {
    const debris: Debris[] = [
      ...dice.map((face) => ({ face, kind: 'die' as const })),
      ...Array.from({ length: tokenCount }, () => ({ kind: 'token' as const })),
    ];
    const stage = { height: stageHeight, progress, width: stageWidth };
    return debris.map((piece, index) => ({ piece, style: spec.piece(stage, { count: debris.length, index }) }));
  }, [dice, progress, spec, stageHeight, stageWidth, tokenCount]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.debrisLayer, style]}
      testID="table-flip-debris"
    >
      {spec.flash && (
        <Animated.View
          style={[
            styles.flash,
            {
              backgroundColor: spec.flash.color,
              opacity: track(progress, [
                [0, 0],
                [spec.flash.at, 0],
                [spec.flash.at + 0.02, spec.flash.peak],
                [spec.flash.at + 0.2, 0, easeOut],
              ]),
            },
          ]}
        />
      )}
      {pieces.map(({ piece, style: pieceStyle }, index) => (
        <Animated.View key={index} style={[styles.debrisPiece, pieceStyle]}>
          {piece.kind === 'die' ? (
            <DieFace face={piece.face} style={styles.debrisDie} />
          ) : (
            <Image source={suckerTokenImage} style={styles.debrisToken} />
          )}
        </Animated.View>
      ))}
      {spec.sparkles?.map((at) => (
        <Animated.Text
          allowFontScaling={false}
          key={at}
          style={[
            styles.sparkle,
            {
              opacity: track(progress, [
                [0, 0],
                [at, 0],
                [at + 0.01, 1],
                [at + 0.12, 1],
                [at + 0.14, 0],
              ]),
              transform: [
                { translateX: stageWidth * vanish.x },
                { translateY: stageHeight * vanish.y },
                { rotate: turn(progress, [[0, 0], [at, 0], [at + 0.14, 120]]) },
                {
                  scale: track(progress, [
                    [0, 0],
                    [at, 0],
                    [at + 0.04, 1.6, easeOut],
                    [at + 0.14, 0, easeIn],
                  ]),
                },
              ],
            },
          ]}
        >
          ✨
        </Animated.Text>
      ))}
      {spec.shouts.map((shout) => (
        <Animated.Text
          key={`${shout.from}-${shout.text}`}
          maxFontSizeMultiplier={1.2}
          style={[
            styles.flipShout,
            {
              opacity: track(progress, [
                [0, 0],
                [shout.from, 0],
                [shout.from + 0.04, 1],
                [shout.to - 0.06, 1],
                [shout.to, 0],
              ]),
              transform: [
                { rotate: `${shout.tilt}deg` },
                {
                  scale: track(progress, [
                    [0, 0.4],
                    [shout.from, 0.4],
                    [shout.from + 0.06, 1.3, easeOut],
                    [shout.from + 0.12, 1, easeIn],
                    [shout.to, 1.06],
                  ]),
                },
              ],
            },
          ]}
        >
          {shout.text}
        </Animated.Text>
      ))}
    </View>
  );
}

const labStorageKey = 'sucker.tableFlipLab';
const styleStorageKey = 'sucker.tableFlipStyle';

function getWebStorage() {
  if (Platform.OS !== 'web') return null;
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

// Dev-only comparison tool. Open the web app with ?flips=1 to turn it on and
// ?flips=0 to turn it off. The flag is read once at startup, before navigation
// rewrites the URL, and sticks across reloads.
const labFlag = __DEV__
  ? new URLSearchParams((globalThis as { location?: Location }).location?.search ?? '').get('flips')
  : null;
if (labFlag === '1') getWebStorage()?.setItem(labStorageKey, '1');
if (labFlag === '0') getWebStorage()?.removeItem(labStorageKey);

export function isTableFlipLabEnabled() {
  return __DEV__ && getWebStorage()?.getItem(labStorageKey) === '1';
}

export function getTableFlipStyleId(): TableFlipStyleId {
  const stored = isTableFlipLabEnabled() ? getWebStorage()?.getItem(styleStorageKey) : null;
  return isTableFlipStyleId(stored) ? stored : defaultTableFlipStyleId;
}

export function storeTableFlipStyleId(styleId: TableFlipStyleId) {
  getWebStorage()?.setItem(styleStorageKey, styleId);
}

export function TableFlipLab({
  activeStyleId,
  onPlay,
}: {
  activeStyleId: TableFlipStyleId;
  onPlay: (styleId: TableFlipStyleId) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <View pointerEvents="box-none" style={styles.lab} testID="table-flip-lab">
      <Pressable
        accessibilityLabel="Table flip lab"
        accessibilityRole="button"
        onPress={() => setIsOpen((current) => !current)}
        style={({ pressed }) => [styles.labToggle, pressed && styles.labPressed]}
      >
        <Text maxFontSizeMultiplier={1.2} style={styles.labToggleText}>
          FLIP LAB: {tableFlipSpecs[activeStyleId].label.toUpperCase()}
        </Text>
      </Pressable>
      {isOpen && (
        <View style={styles.labMenu}>
          {tableFlipStyleIds.map((styleId) => (
            <Pressable
              accessibilityLabel={`Play ${tableFlipSpecs[styleId].label}`}
              accessibilityRole="button"
              accessibilityState={{ selected: styleId === activeStyleId }}
              key={styleId}
              onPress={() => {
                setIsOpen(false);
                onPlay(styleId);
              }}
              style={({ pressed }) => [
                styles.labChip,
                styleId === activeStyleId && styles.labChipActive,
                pressed && styles.labPressed,
              ]}
            >
              <Text maxFontSizeMultiplier={1.2} style={styles.labChipText}>
                {tableFlipSpecs[styleId].label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  debrisLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 95,
  },
  flash: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  debrisPiece: {
    position: 'absolute',
  },
  debrisDie: {
    height: 52,
    width: 52,
  },
  debrisToken: {
    height: 40,
    width: 40,
  },
  sparkle: {
    fontSize: 40,
    position: 'absolute',
  },
  flipShout: {
    color: '#FFD329',
    fontFamily: 'Inter_900Black',
    fontSize: 44,
    fontWeight: '900',
    position: 'absolute',
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
    top: '18%',
  },
  lab: {
    alignItems: 'center',
    left: 60,
    position: 'absolute',
    right: 60,
    top: 6,
    zIndex: 130,
  },
  labToggle: {
    backgroundColor: 'rgba(33, 5, 5, 0.9)',
    borderColor: '#FFD329',
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  labToggleText: {
    color: '#FFD329',
    fontFamily: 'Inter_900Black',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  labMenu: {
    backgroundColor: 'rgba(33, 5, 5, 0.94)',
    borderColor: '#FFD329',
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 6,
    marginTop: 6,
    padding: 8,
    width: 180,
  },
  labChip: {
    backgroundColor: '#FFF3C2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  labChipActive: {
    backgroundColor: '#FFD329',
  },
  labChipText: {
    color: '#210505',
    fontFamily: 'Inter_900Black',
    fontSize: 15,
    fontWeight: '900',
  },
  labPressed: {
    opacity: 0.75,
  },
});
