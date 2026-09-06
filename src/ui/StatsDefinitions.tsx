import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { blowoutPointMargin, comebackPointMargin } from '../../shared/stats';
import { Pressable } from './Pressable';

const statsMaxFontSizeMultiplier = 1.2;

const definitions = [
  ['Blowout win', `Win by at least ${blowoutPointMargin} points.`],
  ['Comeback win', `Win after trailing by at least ${comebackPointMargin} points.`],
  ['Buzzer beater', 'Win after your final scoring turn takes you from tied or behind into the lead.'],
  [
    'Sucker hunt',
    'An extra roll purchased with at least four matching dice and an empty Sucker box. A hunt miss means the following roll did not make a Sucker.',
  ],
  ['Punches landed', 'Successful punches divided by punches thrown, shown as a percentage.'],
  [
    'Category rates',
    'The percentage of completed games with a positive final score in that category. Upper bonus counts games that earned the section bonus.',
  ],
  ['Average tokens', 'Tokens spent on actions, or left at the end, divided by completed games.'],
] as const;

export function StatsDefinitions() {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
        testID="stats-definitions-toggle"
      >
        <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.toggleText}>
          {expanded ? 'Hide metric explanations' : 'What do these stats mean?'}
        </Text>
      </Pressable>
      {expanded && (
        <View style={styles.definitions} testID="stats-definitions">
          {definitions.map(([title, body]) => (
            <View key={title} style={styles.row}>
              <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.label}>
                {title}
              </Text>
              <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.body}>
                {body}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { paddingVertical: 12 },
  toggleText: { color: '#FFD329', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
  definitions: {
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#8F3B10',
    borderRadius: 12,
    backgroundColor: '#2D0C05',
  },
  row: { gap: 4 },
  label: { color: '#FFD329', fontSize: 16, fontWeight: '700' },
  body: { color: '#FFF3C2', fontSize: 16, lineHeight: 23 },
});
