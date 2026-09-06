import { useRef, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { suckerTokenCosts } from '../game';
import { Pressable } from './Pressable';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';

const steps = [
  {
    title: 'Roll five dice',
    body: 'Tap ROLL to begin. You have up to 4 standard rolls each turn. You can score after any roll; you do not have to use them all.',
  },
  {
    title: 'Keep the dice you want',
    body: 'Tap a die to hold it for the next roll. Tap it again to release it. Only the dice you leave unheld will roll again.',
  },
  {
    title: 'Preview a score',
    body: 'Tap an empty category icon or your score box. The number shown is a preview. Try another category to compare; nothing is committed yet.',
  },
  {
    title: 'Play your chosen score',
    body: 'Tap PLAY to fill that category and finish your turn. The other player goes next. Each category can be used once. A normal zero earns no token; Sucker Deal scratches a category for zero and earns 1 token.',
  },
  {
    title: 'Spend tokens when they help',
    body: `You start with 10 tokens. Extra Roll costs ${suckerTokenCosts.extraRoll} and adds one roll. In computer games, Mulligan costs ${suckerTokenCosts.mulligan} and restarts your turn; it is currently unavailable in multiplayer. Sucker Punch costs ${suckerTokenCosts.suckerPunch} for a chance to make the opponent replay an eligible turn. Open the token menu to see available actions. Suckers do not award tokens.`,
  },
] as const;

const scoring = [
  ['Ones through Sixes', 'Add only the matching dice. Three fours score 12 in Fours.'],
  [
    'Section bonus',
    'Reach 63 base points across Ones through Sixes for +35. Extra Sucker bonuses do not count toward 63.',
  ],
  ['3 / 4 of a kind', 'At least three / four matching dice: add all five dice. Otherwise 0.'],
  ['Full house', 'Three of one number plus two of another: 25 points.'],
  ['Small / Large straight', 'Four consecutive numbers: 30. Five consecutive numbers: 40.'],
  ['Sucker', 'All five dice match: 50 points.'],
  ['Chance', 'Add all five dice, with no required pattern.'],
  [
    'Extra Sucker bonus',
    'Once your Sucker box is filled, even with zero or a scratch, a five-of-a-kind scored in a different category adds 50 to that category’s normal score.',
  ],
] as const;

export function HowToPlayDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [reference, setReference] = useState(false);
  const closeRef = useRef<AccessibilityTargetRef | null>(null);
  return (
    <Modal
      transparent
      visible
      animationType="none"
      accessibilityLabel="How to Play Sucker"
      onRequestClose={onClose}
      onShow={() => focusAccessibilityTarget(closeRef.current)}
    >
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.panel} accessibilityViewIsModal onAccessibilityEscape={onClose} testID="how-to-play-panel">
          <View style={styles.header}>
            <Text style={styles.eyebrow}>HOW TO PLAY</Text>
            <Pressable
              ref={closeRef}
              accessibilityLabel="Close How to Play"
              onPress={onClose}
              style={styles.close}
              testID="how-to-play-close"
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            key={reference ? 'reference' : step}
            contentContainerStyle={styles.content}
            testID="how-to-play-content"
          >
            {!reference && (
              <Image
                accessible={false}
                source={require('../../assets/sucker-lobby-header.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            )}
            <Text accessibilityLiveRegion="polite" style={styles.title}>
              {reference ? 'Scoring reference' : steps[step].title}
            </Text>
            {reference ? (
              scoring.map(([title, body]) => (
                <View key={title} style={styles.referenceRow}>
                  <Text style={styles.label}>{title}</Text>
                  <Text style={styles.body}>{body}</Text>
                </View>
              ))
            ) : (
              <>
                <Text style={styles.progress}>
                  Step {step + 1} of {steps.length}
                </Text>
                <Text style={styles.body}>{steps[step].body}</Text>
                <Text style={styles.goal}>Fill the scorecard. Finish with the higher total.</Text>
              </>
            )}
          </ScrollView>
          <View style={styles.actions}>
            {reference ? (
              <Pressable onPress={() => setReference(false)} style={styles.primary}>
                <Text style={styles.primaryText}>Back to guide</Text>
              </Pressable>
            ) : (
              <>
                <Pressable onPress={() => setReference(true)} style={styles.secondary} testID="how-to-play-reference">
                  <Text style={styles.secondaryText}>Scoring reference</Text>
                </Pressable>
                <View style={styles.navigation}>
                  <Pressable
                    disabled={step === 0}
                    onPress={() => setStep((value) => value - 1)}
                    style={[styles.secondary, styles.flex, step === 0 && styles.disabled]}
                  >
                    <Text style={styles.secondaryText}>Previous</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => (step === steps.length - 1 ? onClose() : setStep((value) => value + 1))}
                    style={[styles.primary, styles.flex]}
                    testID="how-to-play-next"
                  >
                    <Text style={styles.primaryText}>{step === steps.length - 1 ? 'Done' : 'Next'}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 18, backgroundColor: '#000A' },
  panel: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '100%',
    backgroundColor: '#FFF3CE',
    borderRadius: 22,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  eyebrow: { color: '#8C2112', fontSize: 14, fontWeight: '800' },
  close: { padding: 10, borderRadius: 8, backgroundColor: '#351005' },
  closeText: { color: '#FFF3CE', fontSize: 15, fontWeight: '700' },
  content: { padding: 22, gap: 14 },
  logo: { width: '100%', height: 100 },
  title: { color: '#351005', fontSize: 28, fontWeight: '800' },
  progress: { color: '#8C2112', fontSize: 14, fontWeight: '700' },
  body: { color: '#351005', fontSize: 18, lineHeight: 27 },
  goal: { color: '#744323', fontSize: 15, lineHeight: 22 },
  referenceRow: { gap: 4 },
  label: { color: '#351005', fontSize: 18, fontWeight: '700' },
  actions: { padding: 18, gap: 10 },
  navigation: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  primary: { backgroundColor: '#FFD329', padding: 14, borderRadius: 10, alignItems: 'center' },
  primaryText: { color: '#351005', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  secondary: { borderWidth: 1, borderColor: '#A76526', padding: 13, borderRadius: 10, alignItems: 'center' },
  secondaryText: { color: '#351005', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.4 },
});
