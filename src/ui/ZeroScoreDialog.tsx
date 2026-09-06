import { useRef } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from './Pressable';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';

export function ZeroScoreDialog({
  category,
  onCancel,
  onScore,
  onScratch,
}: {
  category: string;
  onCancel: () => void;
  onScore: () => void;
  onScratch: () => void;
}) {
  const cancelRef = useRef<AccessibilityTargetRef | null>(null);
  return (
    <Modal
      transparent
      visible
      animationType="none"
      accessibilityLabel="Choose how to score zero"
      onRequestClose={onCancel}
      onShow={() => focusAccessibilityTarget(cancelRef.current)}
    >
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.panel}
          accessibilityViewIsModal
          onAccessibilityEscape={onCancel}
          testID="zero-score-dialog"
        >
          <Text style={styles.title}>{category}: 0 points</Text>
          <Text style={styles.body}>
            Both choices use this score box. A normal zero earns no token. A Sucker Deal scratches it for zero and earns
            1 token.
          </Text>
          <Pressable accessibilityRole="button" onPress={onScratch} style={styles.primary} testID="zero-score-scratch">
            <Text style={styles.primaryText}>Sucker Deal · +1 token</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onScore} style={styles.secondary} testID="zero-score-confirm">
            <Text style={styles.secondaryText}>Score 0 · no token</Text>
          </Pressable>
          <Pressable
            ref={cancelRef}
            accessibilityRole="button"
            onPress={onCancel}
            style={styles.secondary}
            testID="zero-score-cancel"
          >
            <Text style={styles.secondaryText}>Keep playing</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#0009' },
  scroll: {
    flexGrow: 0,
    maxHeight: '100%',
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    backgroundColor: '#FFF3CE',
  },
  panel: { padding: 22, gap: 14 },
  title: { fontSize: 25, fontWeight: '800', color: '#351005' },
  body: { fontSize: 17, lineHeight: 25, color: '#351005' },
  primary: { padding: 15, borderRadius: 12, backgroundColor: '#FFD329', alignItems: 'center' },
  primaryText: { fontSize: 17, fontWeight: '800', color: '#351005', textAlign: 'center' },
  secondary: { padding: 13, borderRadius: 12, borderWidth: 1, borderColor: '#A76526', alignItems: 'center' },
  secondaryText: { fontSize: 17, fontWeight: '600', color: '#351005', textAlign: 'center' },
});
