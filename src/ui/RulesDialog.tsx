import { useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { suckerPunchChanceByDie, suckerTokenCosts } from '../game';
import { Pressable } from './Pressable';
import { CloseIcon } from './ControlIcon';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';

const sections = ['Basics', 'Scoring', 'Tokens'] as const;
type Section = (typeof sections)[number];
type Rule = { title: string; body: string; value?: string };

const basics: Rule[] = [
  { title: 'Your turn', body: 'Roll five dice up to 4 times. You can score after any roll.' },
  { title: 'Hold dice', body: 'Tap a die to hold it. Tap again to release it. Only unheld dice roll again.' },
  {
    title: 'Submit a score',
    body: 'Choose an empty score box to preview its score, then tap PLAY to submit. Each category can be filled once.',
  },
  {
    title: 'Finish the game',
    body: 'The game ends when both scorecards are filled or scratched. The higher total wins; equal totals are a tie.',
  },
];

const scoring: Rule[] = [
  { title: 'Ones through Sixes', body: 'Add the matching dice. Three fours score 12 in Fours.' },
  {
    title: 'Section bonus',
    value: '+35',
    body: 'Reach 63 base points across Ones through Sixes. Extra Sucker bonuses do not count toward 63.',
  },
  { title: '3 / 4 of a kind', body: 'At least three / four matching dice: add all five dice.' },
  { title: 'Full house', value: '25', body: 'Three of one number and two of another.' },
  { title: 'Small / Large straight', value: '30 / 40', body: 'Four / five consecutive numbers.' },
  { title: 'Chance', body: 'Add all five dice, with no required pattern.' },
  { title: 'Sucker', value: '50', body: 'All five dice match.' },
  {
    title: 'Extra Sucker bonus',
    value: '+50',
    body: 'Once Sucker is filled, even with zero or a scratch, a five-of-a-kind scored in another category adds 50 to its normal score.',
  },
];

const tokens: Rule[] = [
  {
    title: 'Extra Roll',
    value: `${suckerTokenCosts.extraRoll} token`,
    body: 'Add one roll. Repeat while you have tokens.',
  },
  {
    title: 'Mulligan',
    value: `${suckerTokenCosts.mulligan} tokens`,
    body: 'Restart your current turn with 4 rolls. Purchased extra rolls are lost without a refund.',
  },
  {
    title: 'Sucker Deal',
    value: '+1 token',
    body: 'Scratch any empty category for zero, even before your first roll. Scoring a normal zero earns no token.',
  },
  {
    title: 'Sucker Punch',
    value: `${suckerTokenCosts.suckerPunch} tokens`,
    body: 'Before starting your turn, target the opponent’s immediately previous submitted turn. A hit removes its score and forces a replay. A miss leaves it intact. Pay the token cost either way.',
  },
  {
    title: 'Counterpunch',
    value: '2 → 1 tokens',
    body: 'After a miss, the opponent can punch the attacker’s next submitted turn before starting their own. Further misses lower the cost to 1. Starting your turn or passing ends the opportunity; a hit or an unused opportunity ends the discount chain. All opportunities expire when the game ends.',
  },
];

export function RulesDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>('Basics');
  const closeRef = useRef<AccessibilityTargetRef | null>(null);
  const rules = section === 'Basics' ? basics : section === 'Scoring' ? scoring : tokens;

  return (
    <Modal
      accessibilityLabel="Game rules"
      animationType="none"
      navigationBarTranslucent
      onRequestClose={onClose}
      onShow={() => focusAccessibilityTarget(closeRef.current)}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      <SafeAreaView style={styles.backdrop}>
        <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.panel} testID="rules-panel">
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              RULES
            </Text>
            <Pressable
              accessibilityLabel="Close rules"
              onPress={onClose}
              ref={closeRef}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              testID="rules-close"
            >
              <CloseIcon />
            </Pressable>
          </View>
          <View style={styles.sections}>
            {sections.map((name) => (
              <Pressable
                accessibilityState={{ selected: section === name }}
                key={name}
                onPress={() => setSection(name)}
                style={({ pressed }) => [
                  styles.section,
                  section === name && styles.selectedSection,
                  pressed && styles.pressed,
                ]}
                testID={`rules-section-${name.toLowerCase()}`}
              >
                <Text style={[styles.sectionText, section === name && styles.selectedSectionText]}>{name}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView
            key={section}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            testID="rules-content"
          >
            {section === 'Tokens' && (
              <Text style={styles.intro}>Start with 10 tokens. Suckers do not award tokens.</Text>
            )}
            {rules.map(({ title, body, value }) => (
              <View key={title} style={styles.rule}>
                <View style={styles.ruleHeading}>
                  <Text accessibilityRole="header" style={styles.label}>
                    {title}
                  </Text>
                  {value && <Text style={styles.value}>{value}</Text>}
                </View>
                <Text style={styles.body}>{body}</Text>
              </View>
            ))}
            {section === 'Scoring' && (
              <Text style={styles.note}>A category scores zero when its pattern is not met.</Text>
            )}
            {section === 'Tokens' && (
              <View style={styles.oddsSection}>
                <Text accessibilityRole="header" style={styles.label}>
                  Punch hit chance
                </Text>
                <Text style={styles.body}>The chance die sets the odds.</Text>
                <View style={styles.odds}>
                  {Object.entries(suckerPunchChanceByDie).map(([die, chance]) => (
                    <View key={die} style={styles.chance}>
                      <Text style={styles.die}>{die}</Text>
                      <Text style={styles.percent}>{chance}%</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: '#0009' },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FFD329',
    backgroundColor: '#210505',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 12,
  },
  title: { color: '#FFD329', fontFamily: 'Inter_900Black', fontSize: 22, fontWeight: '900' },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B3281C',
    borderWidth: 1,
    borderColor: '#E99837',
    borderRadius: 8,
  },
  pressed: { opacity: 0.75 },
  sections: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 4,
    padding: 3,
    backgroundColor: '#100303',
    borderRadius: 10,
    gap: 3,
  },
  section: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 7 },
  selectedSection: { backgroundColor: '#FFD329' },
  sectionText: { color: '#FFF3C2', fontSize: 14, fontWeight: '700' },
  selectedSectionText: { color: '#210505' },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 20 },
  intro: { color: '#FFF3C2', fontSize: 14, lineHeight: 21, paddingTop: 16 },
  rule: { paddingVertical: 14, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#673222' },
  ruleHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  label: { color: '#FFF3C2', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  value: { color: '#FFD329', fontSize: 14, fontWeight: '700', lineHeight: 22 },
  body: { color: '#E4C8AF', fontSize: 14, lineHeight: 21 },
  note: { color: '#E4C8AF', fontSize: 13, lineHeight: 20, marginTop: 14 },
  oddsSection: { gap: 8, paddingTop: 16 },
  odds: { flexDirection: 'row', gap: 5 },
  chance: { flex: 1, alignItems: 'center', gap: 5, borderRadius: 6, backgroundColor: '#3C160E', paddingVertical: 9 },
  die: { color: '#FFF3C2', fontSize: 16, fontWeight: '800' },
  percent: { color: '#FFD329', fontSize: 12, fontWeight: '700' },
});
