import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DieValue } from '../game';
import { getRageQuitConfessionText, rageQuitMeterTaps, type RageQuitConfessionId } from '../../shared/rageQuit';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';
import { DieFace } from './DieFace';
import { Pressable } from './Pressable';

const suckerTokenImage = require('../../assets/sucker-token.png');

// Each tap escalates the button. The last entry is shown once the meter is full.
const mashLabels = [
  'MASH TO FLIP',
  "I'm fine.",
  "I'm FINE.",
  'Totally fine.',
  'This game is RIGGED',
  'ARGH!!',
  'WHO MADE THESE DICE',
  'NOPE NOPE NOPE',
  'FLIP IT!',
];
const drainDelayMs = 700;
const drainStepMs = 260;
const flipDurationMs = 1_350;
const maxTokenDebris = 15;

export const rageQuitRematchCooldownMs = 5_000;

export function RageQuitDialog({
  confessionId,
  isBusy,
  onCancel,
  onFlip,
  onTap,
  quitterName,
  reduceMotion,
}: {
  confessionId: RageQuitConfessionId;
  isBusy: boolean;
  onCancel: () => void;
  onFlip: () => void;
  onTap?: () => void;
  quitterName: string;
  reduceMotion: boolean;
}) {
  const [hasAdmitted, setHasAdmitted] = useState(false);
  const [level, setLevel] = useState(0);
  const hasFlipped = useRef(false);
  const lastTapAt = useRef(0);
  const [shake] = useState(() => new Animated.Value(0));
  const [fill] = useState(() => new Animated.Value(0));
  const cancelRef = useRef<AccessibilityTargetRef | null>(null);
  const isFull = level >= rageQuitMeterTaps;

  useEffect(() => {
    Animated.timing(fill, {
      duration: reduceMotion ? 0 : 120,
      easing: Easing.out(Easing.quad),
      toValue: level / rageQuitMeterTaps,
      useNativeDriver: false,
    }).start();
  }, [fill, level, reduceMotion]);

  // Stop mashing and the rage drains away. That is the cancel path.
  useEffect(() => {
    if (level === 0 || isFull) return;
    const sinceTap = Date.now() - lastTapAt.current;
    const timer = setTimeout(
      () => setLevel((current) => (current >= rageQuitMeterTaps ? current : Math.max(0, current - 1))),
      sinceTap < drainDelayMs ? drainDelayMs - sinceTap : drainStepMs,
    );
    return () => clearTimeout(timer);
  }, [isFull, level]);

  useEffect(() => {
    if (!isFull || hasFlipped.current) return;
    hasFlipped.current = true;
    onFlip();
  }, [isFull, onFlip]);

  function handleMash() {
    if (!hasAdmitted || isFull || isBusy) return;
    lastTapAt.current = Date.now();
    const next = Math.min(rageQuitMeterTaps, level + 1);
    setLevel(next);
    onTap?.();
    if (reduceMotion) return;
    const amplitude = 2 + next * 1.6;
    shake.stopAnimation();
    Animated.sequence([
      Animated.timing(shake, { duration: 40, toValue: amplitude, useNativeDriver: true }),
      Animated.timing(shake, { duration: 60, toValue: -amplitude, useNativeDriver: true }),
      Animated.timing(shake, { duration: 50, toValue: amplitude * 0.5, useNativeDriver: true }),
      Animated.timing(shake, { duration: 40, toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  const fillWidth = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const fillColor = fill.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['#FFD329', '#FF7A1A', '#F12D22'],
  });
  const label =
    isBusy || isFull
      ? 'FLIPPING…'
      : hasAdmitted
        ? mashLabels[Math.min(level, mashLabels.length - 2)]
        : 'ADMIT IT FIRST';

  return (
    <Modal
      accessibilityLabel="Rage quit"
      animationType="none"
      navigationBarTranslucent
      onRequestClose={onCancel}
      onShow={() => focusAccessibilityTarget(cancelRef.current)}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      <SafeAreaView style={styles.backdrop} testID="rage-quit-dialog">
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={onCancel}
          style={[styles.panel, { transform: [{ translateX: shake }, { rotate: shake.interpolate(shakeRotate) }] }]}
          testID="rage-quit-panel"
        >
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} style={styles.title}>
            RAGE QUIT?
          </Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.subtitle}>
            Your opponent wins and everyone sees the 🧂 next to your name for 24 hours.
          </Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.sectionLabel}>
            ADMIT IT TO UNLOCK THE FLIP
          </Text>
          <Pressable
            accessibilityHint={hasAdmitted ? undefined : 'Admits this publicly and unlocks the flip.'}
            accessibilityLabel={getRageQuitConfessionText(confessionId)}
            accessibilityState={{ selected: hasAdmitted }}
            disabled={hasAdmitted || isBusy || isFull}
            onPress={() => setHasAdmitted(true)}
            style={({ pressed }) => [
              styles.admitButton,
              hasAdmitted && styles.admitButtonAdmitted,
              pressed && styles.pressed,
            ]}
            testID="rage-quit-admit"
          >
            <Text maxFontSizeMultiplier={1.2} style={styles.admitText}>
              {getRageQuitConfessionText(confessionId)}
            </Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.admitCaption}>
              {hasAdmitted ? `ADMITTED — ${quitterName}` : 'TAP TO ADMIT IT'}
            </Text>
          </Pressable>
          <View style={styles.meterTrack} testID="rage-quit-meter">
            <Animated.View style={[styles.meterFill, { backgroundColor: fillColor, width: fillWidth }]} />
            <Text maxFontSizeMultiplier={1.2} style={styles.meterText}>
              RAGE {level}/{rageQuitMeterTaps}
            </Text>
          </View>
          <Pressable
            accessibilityHint={`Tap ${rageQuitMeterTaps} times quickly to flip the table and forfeit.`}
            accessibilityLabel="Flip the table"
            accessibilityValue={{ max: rageQuitMeterTaps, min: 0, now: level }}
            disabled={!hasAdmitted || isBusy || isFull}
            onPress={handleMash}
            style={({ pressed }) => [
              styles.mashButton,
              !hasAdmitted && styles.mashButtonLocked,
              pressed && styles.mashButtonPressed,
            ]}
            testID="rage-quit-mash-button"
          >
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.2}
              minimumFontScale={0.6}
              numberOfLines={1}
              style={styles.mashText}
            >
              {label}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Never mind, keep playing"
            disabled={isBusy || isFull}
            onPress={onCancel}
            ref={cancelRef}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
            testID="rage-quit-cancel-button"
          >
            <Text maxFontSizeMultiplier={1.2} style={styles.cancelText}>
              Nah, I&apos;m good
            </Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

const shakeRotate = { inputRange: [-20, 20], outputRange: ['-1.5deg', '1.5deg'] };

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

// The scorecard is the tabletop: a short wind-up, then it heaves up and over.
export function getTableFlipBoardStyle(progress: Animated.Value, stageHeight: number) {
  return {
    opacity: progress.interpolate({ inputRange: [0, 0.7, 0.9], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
    transform: [
      { perspective: 900 },
      {
        translateY: progress.interpolate({
          inputRange: [0, 0.14, 0.3, 0.9],
          outputRange: [0, 10, -stageHeight * 0.08, -stageHeight * 1.05],
          extrapolate: 'clamp',
        }),
      },
      {
        rotateX: progress.interpolate({
          inputRange: [0, 0.14, 0.9],
          outputRange: ['0deg', '6deg', '-118deg'],
          extrapolate: 'clamp',
        }),
      },
      {
        rotateZ: progress.interpolate({
          inputRange: [0, 0.14, 0.9],
          outputRange: ['0deg', '2deg', '-19deg'],
          extrapolate: 'clamp',
        }),
      },
    ],
  } as Animated.WithAnimatedValue<ViewStyle>;
}

// The dice tray and buttons tumble off the bottom of the screen.
export function getTableFlipTrayStyle(progress: Animated.Value, stageHeight: number) {
  return {
    opacity: progress.interpolate({ inputRange: [0, 0.75, 0.95], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 0.2, 0.95],
          outputRange: [0, -14, stageHeight * 0.65],
          extrapolate: 'clamp',
        }),
      },
      {
        rotateZ: progress.interpolate({
          inputRange: [0, 0.2, 0.95],
          outputRange: ['0deg', '-3deg', '24deg'],
          extrapolate: 'clamp',
        }),
      },
    ],
  } as Animated.WithAnimatedValue<ViewStyle>;
}

type Debris = { kind: 'die'; face: DieValue } | { kind: 'token' };

// Deterministic noise in [0, 1) so replays and screenshots match.
function noise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

// Each piece launches from a different spot on the tabletop on its own arc.
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

export function TableFlipDebris({
  dice,
  progress,
  stageHeight,
  style,
  tokensLeft,
}: {
  dice: readonly DieValue[];
  progress: Animated.Value;
  stageHeight: number;
  style?: StyleProp<ViewStyle>;
  tokensLeft: number;
}) {
  // Hoarded tokens make the mess bigger. That is the joke.
  const pieces: Debris[] = [
    ...dice.map((face) => ({ face, kind: 'die' as const })),
    ...Array.from({ length: Math.min(maxTokenDebris, Math.max(0, tokensLeft)) }, () => ({ kind: 'token' as const })),
  ];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.debrisLayer, style]}
      testID="table-flip-debris"
    >
      {pieces.map((piece, index) => {
        const { delay, dx, peak, spin, x0, y0 } = scatter(index);
        const start = Math.min(delay, 0.4);
        const transform = [
          {
            translateX: progress.interpolate({
              inputRange: [0, start, 1],
              outputRange: [x0, x0, x0 + dx],
              extrapolate: 'clamp',
            }),
          },
          {
            translateY: progress.interpolate({
              inputRange: [0, start, start + (1 - start) * 0.4, 1],
              outputRange: [y0, y0, y0 + peak, stageHeight * 0.75],
              extrapolate: 'clamp',
            }),
          },
          {
            rotate: progress.interpolate({
              inputRange: [0, start, 1],
              outputRange: ['0deg', '0deg', `${spin}deg`],
              extrapolate: 'clamp',
            }),
          },
        ];
        const opacity = progress.interpolate({
          inputRange: [0, start, start + 0.01, 0.92, 1],
          outputRange: [0, 0, 1, 1, 0],
          extrapolate: 'clamp',
        });

        return (
          <Animated.View key={index} style={[styles.debrisPiece, { opacity, transform }]}>
            {piece.kind === 'die' ? (
              <DieFace face={piece.face} style={styles.debrisDie} />
            ) : (
              <Image source={suckerTokenImage} style={styles.debrisToken} />
            )}
          </Animated.View>
        );
      })}
      <Animated.Text
        maxFontSizeMultiplier={1.2}
        style={[
          styles.flipShout,
          {
            opacity: progress.interpolate({
              inputRange: [0, 0.1, 0.3, 0.85, 1],
              outputRange: [0, 0, 1, 1, 0],
              extrapolate: 'clamp',
            }),
            transform: [
              {
                scale: progress.interpolate({
                  inputRange: [0, 0.3, 0.4, 1],
                  outputRange: [0.6, 1.25, 1, 1.05],
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
        ]}
      >
        TABLE FLIP!
      </Animated.Text>
    </View>
  );
}

// Public shame: shown beside a name for 24 hours after a rage quit.
export function SaltBadge({ size = 14, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      accessibilityLabel="Rage quit in the last 24 hours"
      accessibilityRole="image"
      accessible
      style={[
        styles.saltBadge,
        { borderRadius: size, height: size * 1.6, minWidth: size * 1.6, paddingHorizontal: size * 0.2 },
        style,
      ]}
      testID="salt-badge"
    >
      <Text allowFontScaling={false} style={{ fontSize: size, lineHeight: size * 1.25 }}>
        🧂
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(40, 0, 0, 0.78)',
    flex: 1,
    justifyContent: 'center',
    padding: 14,
  },
  panel: {
    alignItems: 'stretch',
    backgroundColor: '#210505',
    borderColor: '#F12D22',
    borderRadius: 14,
    borderWidth: 4,
    gap: 10,
    maxWidth: 420,
    padding: 14,
    width: '100%',
  },
  title: {
    color: '#FFD329',
    fontFamily: 'Inter_900Black',
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 36,
    textAlign: 'center',
    textShadowColor: '#F12D22',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  subtitle: {
    color: '#FFF3C2',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  sectionLabel: {
    color: '#FFB000',
    fontFamily: 'Inter_900Black',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 2,
  },
  admitButton: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#FFD329',
    borderRadius: 12,
    borderWidth: 3,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  admitButtonAdmitted: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  admitText: {
    color: '#210505',
    fontFamily: 'Inter_900Black',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 28,
    textAlign: 'center',
  },
  admitCaption: {
    color: '#8F3B10',
    fontFamily: 'Inter_900Black',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  meterTrack: {
    backgroundColor: '#3A0C06',
    borderColor: '#FFD329',
    borderRadius: 10,
    borderWidth: 2,
    height: 26,
    justifyContent: 'center',
    marginTop: 4,
    overflow: 'hidden',
  },
  meterFill: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  meterText: {
    color: '#FFF3C2',
    fontFamily: 'Inter_900Black',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  mashButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 12,
    borderWidth: 3,
    justifyContent: 'center',
    minHeight: 72,
    paddingHorizontal: 12,
  },
  mashButtonLocked: {
    opacity: 0.45,
  },
  mashButtonPressed: {
    backgroundColor: '#B91510',
    transform: [{ scale: 0.96 }],
  },
  mashText: {
    color: '#FFD329',
    fontFamily: 'Inter_900Black',
    fontSize: 26,
    fontWeight: '900',
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  cancelButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
  },
  cancelText: {
    color: '#FFF3C2',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.75,
  },
  debrisLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 95,
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
  saltBadge: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderWidth: 1.5,
    justifyContent: 'center',
  },
});
