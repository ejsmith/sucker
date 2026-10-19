import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';
import { Pressable } from './Pressable';

// Every tap answers with an insult, and nothing says how many it takes.
const insults = [
  'Crybaby.',
  'Waaah.',
  'Sore loser.',
  'Quitter.',
  'Big baby.',
  'Bawk bawk bawk.',
  'Salty much?',
  'Go cry about it.',
  'Somebody needs a nap.',
  'Did the dice hurt you?',
  "The dice aren't rigged. You're just bad.",
  'Everyone is going to know.',
  'Are you crying?',
  'Wow. Really?',
  'Tap harder, crybaby.',
  'Pathetic.',
  'Go cry in the car.',
  'Need a juice box?',
];
// Slowing down is not rage. The streak starts over quietly, and the next tap
// answers with one of these instead of an insult.
const resetTaunts = ['Too slow.', "That's not rage.", 'Weak. Again.', 'Is that all you got?'];
const tapsToFlip = 10;
// Each tap must land this soon after the last one, or the streak resets.
// Screen reader double taps cannot go that fast, so they get longer. The web
// cannot detect a screen reader (react-native-web always says yes).
const rageWindowMs = 400;
const screenReaderRageWindowMs = 1_500;

export const rageQuitRematchCooldownMs = 5_000;

export function RageQuitDialog({
  isBusy,
  onCancel,
  onFlip,
  onTap,
  reduceMotion,
}: {
  isBusy: boolean;
  onCancel: () => void;
  onFlip: () => void;
  onTap?: () => void;
  reduceMotion: boolean;
}) {
  const [label, setLabel] = useState('RAGE QUIT');
  const [hasFlipped, setHasFlipped] = useState(false);
  const taps = useRef(0);
  const usedInsults = useRef<string[]>([]);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didStreakReset = useRef(false);
  const [isScreenReaderOn, setIsScreenReaderOn] = useState(false);
  const [shake] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(1));
  const cancelRef = useRef<AccessibilityTargetRef | null>(null);

  useEffect(() => {
    let isActive = true;
    const subscription =
      Platform.OS === 'web'
        ? null
        : AccessibilityInfo.addEventListener('screenReaderChanged', setIsScreenReaderOn);
    if (subscription) {
      void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
        if (isActive) setIsScreenReaderOn(enabled);
      });
    }
    return () => {
      isActive = false;
      subscription?.remove();
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  function nextInsult() {
    let fresh = insults.filter((insult) => !usedInsults.current.includes(insult));
    if (fresh.length === 0) {
      usedInsults.current = [];
      fresh = insults;
    }
    const insult = fresh[Math.floor(Math.random() * fresh.length)];
    usedInsults.current.push(insult);
    return insult;
  }

  function handleTap() {
    if (isBusy || taps.current >= tapsToFlip) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    taps.current += 1;
    onTap?.();
    if (taps.current >= tapsToFlip) {
      setHasFlipped(true);
      onFlip();
      return;
    }

    // The text only changes when they tap, so every line stays up until then.
    if (didStreakReset.current) {
      didStreakReset.current = false;
      const taunts = resetTaunts.filter((taunt) => taunt !== label);
      setLabel(taunts[Math.floor(Math.random() * taunts.length)]);
    } else {
      setLabel(nextInsult());
    }
    resetTimer.current = setTimeout(
      () => {
        resetTimer.current = null;
        taps.current = 0;
        didStreakReset.current = true;
      },
      isScreenReaderOn ? screenReaderRageWindowMs : rageWindowMs,
    );
    if (reduceMotion) return;
    const amplitude = 2 + taps.current * 1.8;
    shake.stopAnimation();
    pop.stopAnimation();
    Animated.parallel([
      Animated.sequence([
        Animated.timing(shake, { duration: 40, toValue: amplitude, useNativeDriver: true }),
        Animated.timing(shake, { duration: 60, toValue: -amplitude, useNativeDriver: true }),
        Animated.timing(shake, { duration: 50, toValue: amplitude * 0.5, useNativeDriver: true }),
        Animated.timing(shake, { duration: 40, toValue: 0, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(pop, { duration: 60, toValue: 1 + taps.current * 0.012, useNativeDriver: true }),
        Animated.spring(pop, { friction: 4, tension: 220, toValue: 1, useNativeDriver: true }),
      ]),
    ]).start();
  }

  const isFlipping = isBusy || hasFlipped;
  const isStart = label === 'RAGE QUIT';

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
            HAD ENOUGH?
          </Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.subtitle}>
            Your opponent wins and everyone sees the 🧂 next to your name for 24 hours.
          </Text>
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <Pressable
              accessibilityHint="Tap fast, over and over, to flip the table and forfeit."
              accessibilityLabel={isFlipping ? 'Flipping the table' : label}
              disabled={isFlipping}
              onPress={handleTap}
              style={({ pressed }) => [styles.rageButton, pressed && styles.rageButtonPressed]}
              testID="rage-quit-button"
            >
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={3}
                style={[styles.rageText, (isStart || isFlipping) && styles.rageTextBig]}
              >
                {isFlipping ? 'FLIPPING…' : label}
              </Text>
            </Pressable>
          </Animated.View>
          <Pressable
            accessibilityLabel="Never mind, keep playing"
            disabled={isFlipping}
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
  rageButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 12,
    borderWidth: 3,
    height: 128,
    justifyContent: 'center',
    marginTop: 4,
    paddingHorizontal: 14,
  },
  rageButtonPressed: {
    backgroundColor: '#B91510',
    transform: [{ scale: 0.96 }],
  },
  rageText: {
    color: '#FFD329',
    fontFamily: 'Inter_900Black',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  rageTextBig: {
    fontSize: 36,
    lineHeight: 42,
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
  saltBadge: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderWidth: 1.5,
    justifyContent: 'center',
  },
});
