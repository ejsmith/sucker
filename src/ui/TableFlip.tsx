import { useMemo } from 'react';
import { Animated, Easing, Image, StyleSheet, View, type ViewStyle } from 'react-native';
import type { DieValue } from '../game';
import { DieFace } from './DieFace';

const suckerTokenImage = require('../../assets/sucker-token.png');
const flipDurationMs = 1_400;
const maxTokenDebris = 15;
const easedSteps = 8;
// The board trembles until this point in the flip, then blows apart.
const blast = 0.32;
// Rough center of the scorecard, as a fraction of the stage height from its middle.
const boardCenterY = -0.01;

type AnimatedStyle = Animated.WithAnimatedValue<ViewStyle>;
type Ease = (t: number) => number;
// [progress, value, easing used to arrive here from the previous key]
type Key = readonly [number, number, Ease?];

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

// Alternating jolts that grow until the blast.
function tremble(progress: Animated.Value) {
  const count = 14;
  const keys: Key[] = [[0, 0]];
  for (let jolt = 1; jolt <= count; jolt += 1) {
    const t = jolt / (count + 1);
    const amplitude = 1 + 8 * t;
    keys.push([blast * t, jolt % 2 === 0 ? -amplitude : amplitude]);
  }
  keys.push([blast, 0]);
  return track(progress, keys);
}

// Deterministic noise in [0, 1) so replays and screenshots match.
function noise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export function runTableFlip(progress: Animated.Value, reduceMotion: boolean) {
  return new Promise<void>((resolve) => {
    if (reduceMotion) {
      progress.setValue(1);
      resolve();
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      duration: flipDurationMs,
      easing: Easing.linear,
      toValue: 1,
      useNativeDriver: true,
    }).start(() => resolve());
  });
}

// The scorecard swells as it trembles, then blows apart.
export function getTableFlipBoardStyle(progress: Animated.Value): AnimatedStyle {
  return {
    opacity: track(progress, [[0, 1], [blast, 1], [0.44, 0]]),
    transform: [
      { translateX: tremble(progress) },
      { rotate: turn(progress, [[0, 0], [blast, 0], [0.44, 8]]) },
      { scale: track(progress, [[0, 1], [blast, 1.05, easeIn], [0.44, 1.8, easeOut]]) },
    ],
  };
}

// The dice tray and buttons get blown off the bottom of the screen.
export function getTableFlipTrayStyle(progress: Animated.Value, stageHeight: number): AnimatedStyle {
  return {
    opacity: track(progress, [[0, 1], [0.5, 1], [0.6, 0]]),
    transform: [
      { translateX: tremble(progress) },
      { translateY: track(progress, [[0, 0], [blast, 0], [0.6, stageHeight * 0.6, easeOut]]) },
      { rotate: turn(progress, [[0, 0], [blast, 0], [0.6, -28, easeOut]]) },
    ],
  };
}

// Blown outward from the middle of the board in every direction.
function burst(progress: Animated.Value, index: number, count: number, width: number, height: number): AnimatedStyle {
  const spin = (noise(index + 37) > 0.5 ? 1 : -1) * (300 + noise(index + 51) * 600);
  const angle = (index / count) * Math.PI * 2 + noise(index + 7) * 0.6;
  const reach = (0.4 + noise(index + 19) * 0.35) * Math.max(width, height) * 0.8;
  const startX = (noise(index + 67) * 2 - 1) * 40;
  const startY = height * boardCenterY;
  const endX = startX + Math.cos(angle) * reach;
  const endY = startY + Math.sin(angle) * reach;
  return {
    opacity: track(progress, [[0, 0], [blast, 0], [blast + 0.01, 1], [0.86, 1], [0.94, 0]]),
    transform: [
      { translateX: track(progress, [[0, startX], [blast, startX], [0.75, endX, easeOutCubic]]) },
      {
        translateY: track(progress, [
          [0, startY],
          [blast, startY],
          [0.75, endY, easeOutCubic],
          [1, endY + height * 0.25, easeIn],
        ]),
      },
      { rotate: turn(progress, [[0, 0], [blast, 0], [1, spin * 1.5]]) },
      { scale: track(progress, [[0, 0.4], [blast, 0.4], [0.42, 1.3, easeOut], [1, 1]]) },
    ],
  };
}

type Debris = { kind: 'die'; face: DieValue } | { kind: 'token' };

export function TableFlipDebris({
  dice,
  progress,
  stageHeight,
  stageWidth,
  tokensLeft,
}: {
  dice: readonly DieValue[];
  progress: Animated.Value;
  stageHeight: number;
  stageWidth: number;
  tokensLeft: number;
}) {
  const tokenCount = Math.min(maxTokenDebris, Math.max(0, tokensLeft));
  // Hoarded tokens make the mess bigger. That is the joke.
  const pieces = useMemo(() => {
    const debris: Debris[] = [
      ...dice.map((face) => ({ face, kind: 'die' as const })),
      ...Array.from({ length: tokenCount }, () => ({ kind: 'token' as const })),
    ];
    return debris.map((piece, index) => ({
      piece,
      style: burst(progress, index, debris.length, stageWidth, stageHeight),
    }));
  }, [dice, progress, stageHeight, stageWidth, tokenCount]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.debrisLayer}
      testID="table-flip-debris"
    >
      <Animated.View
        style={[
          styles.flash,
          {
            opacity: track(progress, [
              [0, 0],
              [blast, 0],
              [blast + 0.02, 0.95],
              [blast + 0.2, 0, easeOut],
            ]),
          },
        ]}
      />
      {pieces.map(({ piece, style: pieceStyle }, index) => (
        <Animated.View key={index} style={[styles.debrisPiece, pieceStyle]}>
          {piece.kind === 'die' ? (
            <DieFace face={piece.face} style={styles.debrisDie} />
          ) : (
            <Image source={suckerTokenImage} style={styles.debrisToken} />
          )}
        </Animated.View>
      ))}
      <Animated.Text
        maxFontSizeMultiplier={1.2}
        style={[
          styles.flipShout,
          {
            opacity: track(progress, [
              [0, 0],
              [blast, 0],
              [blast + 0.04, 1],
              [0.91, 1],
              [0.97, 0],
            ]),
            transform: [
              { rotate: '-5deg' },
              {
                scale: track(progress, [
                  [0, 0.4],
                  [blast, 0.4],
                  [blast + 0.06, 1.3, easeOut],
                  [blast + 0.12, 1, easeIn],
                  [0.97, 1.06],
                ]),
              },
            ],
          },
        ]}
      >
        KABOOM!
      </Animated.Text>
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
    backgroundColor: '#FFF3C2',
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
});
