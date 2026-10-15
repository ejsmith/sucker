import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Polyline } from 'react-native-svg';
import { CloseIcon } from '../ui/ControlIcon';
import { Pressable } from '../ui/Pressable';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from '../ui/accessibilityFocus';
import { useHaptics } from './HapticsProvider';
import {
  eventPresets,
  hapticEventLabels,
  hapticEvents,
  hapticPresets,
  buildHapticPattern,
  createHapticChoice,
  isCustomHaptic,
  hasHapticHits,
  hapticDurationMs,
  sameHapticChoice,
  type HapticChoice,
  type HapticEvent,
} from './patterns';

export function HapticsLab({
  onClose,
  renderMoment,
}: {
  onClose: () => void;
  renderMoment: (event: HapticEvent) => ReactNode;
}) {
  const { ready, loadError, reload, setPreviewActive } = useHaptics();
  const closeRef = useRef<AccessibilityTargetRef | null>(null);
  useEffect(() => {
    setPreviewActive(true);
    return () => setPreviewActive(false);
  }, [setPreviewActive]);

  return (
    <Modal
      accessibilityLabel="Haptics Lab"
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
        <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.panel} testID="haptics-lab">
          <View style={styles.header}>
            <View>
              <Text maxFontSizeMultiplier={1.2} accessibilityRole="header" style={styles.title}>
                HAPTICS LAB
              </Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.subtitle}>
                Impacts, rumbles, and celebrations.
              </Text>
            </View>
            <Pressable accessibilityLabel="Close Haptics Lab" ref={closeRef} onPress={onClose} style={styles.close}>
              <CloseIcon color="#FFF3CE" />
            </Pressable>
          </View>
          {!ready ? (
            <ActivityIndicator color="#FFD329" accessibilityLabel="Loading haptic choices" />
          ) : loadError ? (
            <View style={styles.errorPanel}>
              <Text maxFontSizeMultiplier={1.2} style={styles.body}>
                Your saved choices could not be loaded.
              </Text>
              <LabButton label="Retry" onPress={() => void reload()} />
            </View>
          ) : (
            <HapticsEditor renderMoment={renderMoment} />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function HapticsEditor({ renderMoment }: { renderMoment: (event: HapticEvent) => ReactNode }) {
  const { preferences, preview, cancel, save, support } = useHaptics();
  const [event, setEvent] = useState<HapticEvent>('punchLanded');
  const [drafts, setDrafts] = useState(preferences);
  const [withVisuals, setWithVisuals] = useState(true);
  const [moment, setMoment] = useState<HapticEvent | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [mode, setMode] = useState<'effects' | 'tune'>('tune');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewEdits, setPreviewEdits] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const choice = drafts[event];
  const saved = preferences[event];
  const matchesSaved = sameHapticChoice(choice, saved);
  const canTune = isCustomHaptic(choice.preset);

  const clearPlayback = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    timer.current = null;
    frame.current = null;
    cancel();
  }, [cancel]);

  const stop = useCallback(() => {
    clearPlayback();
    setMoment(null);
    setPlaying(null);
  }, [clearPlayback]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stop();
    });
    return () => {
      subscription.remove();
      clearPlayback();
    };
  }, [clearPlayback, stop]);

  function audition(candidate: HapticChoice, label: string, showMoment = withVisuals) {
    stop();
    setPlaying(label);
    // Mount the exact game result artwork/banner before firing its feedback.
    if (showMoment) setMoment(event);
    frame.current = requestAnimationFrame(() => {
      preview(event, candidate);
      timer.current = setTimeout(
        stop,
        Math.max(event === 'sucker' ? 1250 : 1700, candidate.delayMs + hapticDurationMs(candidate) + 250),
      );
    });
  }

  function update(change: Partial<HapticChoice>) {
    stop();
    setSaveError(false);
    const next = { ...choice, ...change };
    setDrafts((current) => ({ ...current, [event]: next }));
    // Audition edits by feel without covering the controls with the game artwork.
    if (previewEdits && next.preset !== 'off') audition(next, 'Edited choice', false);
  }

  async function saveChoice() {
    stop();
    setSaving(true);
    setSaveError(false);
    try {
      await save(event, choice);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <View accessibilityRole="tablist" accessibilityLabel="Game event" style={styles.tabs}>
        {hapticEvents.map((value, index) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityLabel={hapticEventLabels[value]}
            accessibilityState={{ selected: value === event }}
            aria-selected={value === event}
            disabled={saving}
            onPress={() => {
              stop();
              setEvent(value);
              setSaveError(false);
            }}
            style={[styles.tab, event === value && styles.selectedTab]}
          >
            <Text maxFontSizeMultiplier={1.2} style={[styles.tabText, value === event && styles.darkText]}>
              {['PUNCH', 'GET HIT', 'SUCKER'][index]}
            </Text>
          </Pressable>
        ))}
      </View>
      <View accessibilityRole="tablist" accessibilityLabel="Lab controls" style={styles.editorTabs}>
        {(['effects', 'tune'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityLabel={value === 'effects' ? 'Choose effect' : 'Tune effect'}
            accessibilityState={{ selected: mode === value }}
            aria-selected={mode === value}
            disabled={saving}
            onPress={() => {
              stop();
              setMode(value);
            }}
            style={[styles.editorTab, mode === value && styles.activeEditorTab]}
          >
            <Text maxFontSizeMultiplier={1.2} style={styles.label}>
              {value === 'effects' ? 'Choose effect' : 'Tune effect'}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text maxFontSizeMultiplier={1.2} accessibilityRole="header" style={styles.eventTitle}>
          {mode === 'effects' ? hapticEventLabels[event] : hapticPresets[choice.preset].label}
        </Text>
        {mode === 'effects' && (
          <View accessibilityRole="radiogroup" accessibilityLabel="Haptic effect" style={styles.presets}>
            {eventPresets[event].map((preset) => (
              <Pressable
                key={preset}
                accessibilityRole="radio"
                accessibilityLabel={`${hapticPresets[preset].label} effect`}
                accessibilityState={{ checked: choice.preset === preset }}
                aria-checked={choice.preset === preset}
                disabled={saving}
                onPress={() => {
                  if (preset !== choice.preset) update({ ...createHapticChoice(preset), delayMs: choice.delayMs });
                }}
                style={[styles.preset, choice.preset === preset && styles.selectedPreset]}
                testID={`haptic-preset-${preset}`}
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={[styles.presetText, choice.preset === preset && styles.darkText]}
                >
                  {hapticPresets[preset].label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text maxFontSizeMultiplier={1.2} style={styles.description}>
          {hapticPresets[choice.preset].description}
        </Text>
        {canTune && <PatternPreview choice={choice} />}
        {mode === 'tune' && choice.preset === 'off' && (
          <Text style={styles.body}>Choose an effect to start tuning.</Text>
        )}
        {mode === 'tune' && choice.preset !== 'off' && (
          <View style={styles.tuning}>
            {canTune && (
              <>
                <TuningControl
                  label="Strength"
                  value={choice.strength}
                  min={5}
                  max={100}
                  step={5}
                  unit="%"
                  disabled={saving}
                  hint="Overall intensity"
                  onChange={(strength) => update({ strength })}
                />
                <TuningControl
                  label="Sharpness"
                  value={choice.sharpness}
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                  disabled={saving}
                  hint="Soft ← 50% original → sharp"
                  onChange={(sharpness) => update({ sharpness })}
                />
                <TuningControl
                  label="Duration"
                  value={choice.durationMs}
                  min={50}
                  max={900}
                  step={10}
                  unit=" ms"
                  disabled={saving}
                  hint="Length of one pass"
                  onChange={(durationMs) => update({ durationMs })}
                />
              </>
            )}
            <TuningControl
              label="Start delay"
              value={choice.delayMs}
              min={0}
              max={250}
              step={10}
              unit=" ms"
              disabled={saving}
              hint="After the result appears"
              onChange={(delayMs) => update({ delayMs })}
            />
            {canTune && (
              <>
                <Pressable
                  accessibilityLabel="Hits, rumble, and repeats"
                  accessibilityState={{ expanded: showAdvanced }}
                  aria-expanded={showAdvanced}
                  disabled={saving}
                  onPress={() => setShowAdvanced((value) => !value)}
                  style={styles.tuneToggle}
                >
                  <Text maxFontSizeMultiplier={1.2} style={styles.label}>
                    {showAdvanced ? '−' : '+'} Hits, rumble & repeats
                  </Text>
                </Pressable>
                {showAdvanced && (
                  <>
                    {hasHapticHits(choice.preset) && (
                      <TuningControl
                        label="Hit strength"
                        value={choice.hitStrength}
                        min={0}
                        max={100}
                        step={5}
                        unit="%"
                        disabled={saving}
                        hint="0% removes the sharp strikes"
                        onChange={(hitStrength) => update({ hitStrength })}
                      />
                    )}
                    <TuningControl
                      label="Rumble strength"
                      value={choice.rumbleStrength}
                      min={0}
                      max={100}
                      step={5}
                      unit="%"
                      disabled={saving}
                      hint="0% removes the continuous vibration"
                      onChange={(rumbleStrength) => update({ rumbleStrength })}
                    />
                    <TuningControl
                      label="Repeat count"
                      value={choice.repeatCount}
                      min={1}
                      max={3}
                      step={1}
                      unit="×"
                      disabled={saving}
                      hint="Play the pattern one to three times"
                      onChange={(repeatCount) => update({ repeatCount })}
                    />
                    {choice.repeatCount > 1 && (
                      <TuningControl
                        label="Repeat spacing"
                        value={choice.repeatGapMs}
                        min={25}
                        max={400}
                        step={25}
                        unit=" ms"
                        disabled={saving}
                        hint="Quiet gap between passes"
                        onChange={(repeatGapMs) => update({ repeatGapMs })}
                      />
                    )}
                  </>
                )}
              </>
            )}
            <View style={styles.compare}>
              <LabButton
                label="Reset this effect"
                disabled={saving}
                onPress={() => update(createHapticChoice(choice.preset))}
              />
              <LabButton label="Restore saved" disabled={saving || matchesSaved} onPress={() => update(saved)} />
            </View>
          </View>
        )}
        <View style={styles.visualsRow}>
          <View style={styles.flex}>
            <Text maxFontSizeMultiplier={1.2} style={styles.label}>
              Preview changes
            </Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.hint}>
              Feel each edit while the controls stay open.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Preview changes"
            disabled={saving}
            value={previewEdits}
            onValueChange={(value) => {
              stop();
              setPreviewEdits(value);
            }}
            trackColor={{ false: '#735348', true: '#FFD329' }}
          />
        </View>
        <View style={styles.visualsRow}>
          <View style={styles.flex}>
            <Text maxFontSizeMultiplier={1.2} style={styles.label}>
              Replay game moment
            </Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.hint}>
              Turn off to compare by feel alone.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Replay game moment"
            disabled={saving}
            onValueChange={(value) => {
              stop();
              setWithVisuals(value);
            }}
            trackColor={{ false: '#735348', true: '#FFD329' }}
            value={withVisuals}
          />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.compare}>
          <LabButton label="Try choice" disabled={saving} onPress={() => audition(choice, 'Choice')} primary />
          <LabButton label="Try saved" disabled={saving} onPress={() => audition(saved, 'Saved')} />
          {playing && !moment ? (
            <LabButton label="Stop preview" onPress={stop} />
          ) : (
            <LabButton
              label="Try original"
              disabled={saving}
              onPress={() => audition(createHapticChoice('original'), 'Original')}
            />
          )}
        </View>
        <Text
          maxFontSizeMultiplier={1.2}
          accessibilityLiveRegion="polite"
          style={styles.savedDescription}
          testID="haptic-saved-choice"
        >
          {playing
            ? `Playing: ${playing}`
            : `Saved: ${hapticPresets[saved.preset].label}${isCustomHaptic(saved.preset) ? ` · ${hapticDurationMs(saved)} ms · ${saved.strength}% strength · ${saved.sharpness}% sharpness` : ''}${saved.preset !== 'off' && saved.delayMs ? ` · ${saved.delayMs} ms delay` : ''}`}
        </Text>
        <LabButton
          label={saving ? 'Saving…' : matchesSaved ? 'Saved for gameplay' : 'Use this in games'}
          disabled={saving || matchesSaved}
          onPress={() => void saveChoice()}
          primary
        />
        {saveError && (
          <Text maxFontSizeMultiplier={1.2} accessibilityRole="alert" style={styles.error}>
            Could not save. Your previous choice is still active. Try again.
          </Text>
        )}
        <Text maxFontSizeMultiplier={1.2} style={styles.footnote}>
          {support === 'web'
            ? 'Visual preview only. Compare the feel in the iPhone or Android app.'
            : support === 'missing'
              ? 'Custom effects need a newer app build. Original still uses system vibration.'
              : support === 'unavailable'
                ? 'This device does not support custom haptics.'
                : support === 'limited'
                  ? 'This phone approximates some textures. Choices stay on this phone.'
                  : 'Choices stay on this phone. Compare by feel, then try your favorite in a game.'}
        </Text>
      </View>
      {moment && (
        <View style={styles.moment} testID="haptic-moment-preview">
          <Text maxFontSizeMultiplier={1.2} style={styles.previewLabel}>
            {playing?.toUpperCase()} PREVIEW
          </Text>
          {renderMoment(moment)}
          <Pressable accessibilityLabel="Stop preview" onPress={stop} style={styles.stop}>
            <Text maxFontSizeMultiplier={1.2} style={styles.buttonText}>
              Back to lab
            </Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

function LabButton({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text maxFontSizeMultiplier={1.2} style={[styles.buttonText, primary && styles.darkText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PatternPreview({ choice }: { choice: HapticChoice }) {
  const pattern = buildHapticPattern(choice);
  if (!pattern)
    return <Text style={styles.hint}>This setting is silent. Raise the hit or rumble strength to feel it.</Text>;
  const duration = hapticDurationMs(choice);
  const x = (time: number) => 6 + (time / duration) * 288;
  const y = (amplitude: number) => 52 - amplitude * 44;
  return (
    <View
      style={styles.waveform}
      accessibilityLabel={`${duration} millisecond pattern, ${pattern.discretePattern.length} strikes`}
      testID="haptic-pattern-preview"
    >
      <Svg
        width="100%"
        height={52}
        viewBox="0 0 300 60"
        accessible={Platform.OS === 'web' ? undefined : false}
        aria-hidden
      >
        <Line x1={6} y1={52} x2={294} y2={52} stroke="#70392C" />
        <Polyline
          points={pattern.continuousPattern.amplitude.map((point) => `${x(point.time)},${y(point.value)}`).join(' ')}
          fill="none"
          stroke="#FFD329"
          strokeWidth={2.5}
        />
        {pattern.discretePattern.map((point, index) => (
          <Line
            key={index}
            x1={x(point.time)}
            y1={52}
            x2={x(point.time)}
            y2={y(point.amplitude)}
            stroke="#FFF3CE"
            strokeWidth={3}
          />
        ))}
      </Svg>
      <Text maxFontSizeMultiplier={1.2} style={styles.waveformCaption}>
        {duration} ms total · {choice.repeatCount}× · lines mark strikes
      </Text>
    </View>
  );
}

function TuningControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.timingRow}>
      <View style={styles.flex}>
        <Text maxFontSizeMultiplier={1.2} style={styles.label}>
          {label}
        </Text>
        {hint && (
          <Text maxFontSizeMultiplier={1.2} style={styles.hint}>
            {hint}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityLabel={`Decrease ${label.toLowerCase()}`}
        disabled={disabled || value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepper, (disabled || value <= min) && styles.disabled]}
      >
        <Text maxFontSizeMultiplier={1.2} style={styles.stepperText}>
          −
        </Text>
      </Pressable>
      <Text maxFontSizeMultiplier={1.2} style={[styles.value, disabled && styles.disabled]}>
        {value}
        {unit}
      </Text>
      <Pressable
        accessibilityLabel={`Increase ${label.toLowerCase()}`}
        disabled={disabled || value >= max}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepper, (disabled || value >= max) && styles.disabled]}
      >
        <Text maxFontSizeMultiplier={1.2} style={styles.stepperText}>
          +
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#180303E8', alignItems: 'center', justifyContent: 'center', padding: 12 },
  panel: {
    width: '100%',
    maxWidth: 430,
    maxHeight: '100%',
    flexShrink: 1,
    backgroundColor: '#330A07',
    borderColor: '#FFD329',
    borderWidth: 2,
    borderRadius: 20,
    overflow: 'hidden',
  },
  header: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#FFD329', fontSize: 24, fontFamily: 'Inter_900Black', fontWeight: '900' },
  subtitle: { color: '#FFF3CE', fontSize: 12, marginTop: 3 },
  close: { height: 44, width: 44, justifyContent: 'center', alignItems: 'center' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, gap: 6 },
  tab: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#5A2018',
    borderRadius: 10,
  },
  selectedTab: { backgroundColor: '#FFD329' },
  editorTabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, gap: 6 },
  editorTab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderColor: '#70392C',
  },
  activeEditorTab: {
    borderColor: '#FFD329',
    backgroundColor: '#5A2018',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  tabText: { fontSize: 13, fontWeight: '900', color: '#FFF3CE' },
  darkText: { color: '#351005' },
  scroll: { flexShrink: 1 },
  content: { padding: 16, gap: 10 },
  footer: { padding: 16, gap: 10, borderTopWidth: 1, borderColor: '#70392C' },
  waveform: { backgroundColor: '#230704', borderRadius: 10, padding: 6 },
  waveformCaption: { fontSize: 10, color: '#D8B29C', textAlign: 'center', paddingBottom: 3 },
  tuneToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 8 },
  eventTitle: { color: '#FFF3CE', fontSize: 21, fontWeight: '800' },
  body: { color: '#F4D5BC', fontSize: 14, lineHeight: 19 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  preset: {
    width: '31.5%',
    flexGrow: 1,
    minHeight: 44,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#A76540',
    borderRadius: 10,
    backgroundColor: '#5A2018',
  },
  selectedPreset: { backgroundColor: '#FFD329', borderColor: '#FFD329' },
  presetText: { color: '#FFF3CE', fontSize: 14, fontWeight: '700' },
  description: { color: '#F4D5BC', minHeight: 36, fontSize: 13, lineHeight: 18 },
  tuning: { gap: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#70392C', paddingVertical: 10 },
  timingRow: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44 },
  flex: { flex: 1 },
  label: { color: '#FFF3CE', fontSize: 14, fontWeight: '700' },
  hint: { color: '#D8B29C', fontSize: 11, marginTop: 3 },
  stepper: {
    height: 44,
    width: 44,
    borderRadius: 8,
    backgroundColor: '#5A2018',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: { fontSize: 24, color: '#FFD329' },
  value: { width: 58, color: '#FFF3CE', textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  visualsRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
  compare: { flexDirection: 'row', gap: 7 },
  button: {
    flexGrow: 1,
    minHeight: 46,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#713025',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primary: { backgroundColor: '#FFD329' },
  buttonText: { fontSize: 13, fontWeight: '800', color: '#FFF3CE', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  savedDescription: { color: '#F4D5BC', textAlign: 'center', fontSize: 12 },
  footnote: { color: '#D8B29C', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  error: { color: '#FFB8AA', fontSize: 14 },
  errorPanel: { padding: 20, gap: 16 },
  moment: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#180303F5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 24,
  },
  previewLabel: { color: '#FFF3CE', fontSize: 13, fontWeight: '800', letterSpacing: 2 },
  stop: { minHeight: 44, padding: 12, borderRadius: 10, backgroundColor: '#713025' },
});
