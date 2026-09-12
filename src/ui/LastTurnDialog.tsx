import { useRef } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable } from './Pressable';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';

export function LastTurnDialog({
  currentTurn,
  summary,
  onClose,
}: {
  currentTurn: string;
  summary: string;
  onClose: () => void;
}) {
  const closeRef = useRef<AccessibilityTargetRef | null>(null);
  return (
    <Modal
      transparent
      visible
      animationType="none"
      accessibilityLabel="Last turn"
      onRequestClose={onClose}
      onShow={() => focusAccessibilityTarget(closeRef.current)}
    >
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.panel} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Last turn</Text>
            <Text style={styles.summary} testID="last-turn-summary">
              {summary}
            </Text>
            <Text style={styles.current} testID="current-turn-summary">
              {currentTurn}
            </Text>
          </ScrollView>
          <Pressable ref={closeRef} onPress={onClose} style={styles.close} testID="last-turn-close">
            <Text style={styles.closeText}>Back to game</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, padding: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000A' },
  panel: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '100%',
    borderRadius: 18,
    backgroundColor: '#FFF3CE',
    padding: 20,
    gap: 20,
  },
  content: { gap: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#351005' },
  summary: { fontSize: 20, lineHeight: 29, color: '#351005' },
  current: { fontSize: 17, lineHeight: 25, color: '#8C2112', fontWeight: '700' },
  close: { backgroundColor: '#FFD329', padding: 14, borderRadius: 10, alignItems: 'center' },
  closeText: { color: '#351005', fontSize: 17, fontWeight: '800' },
});
