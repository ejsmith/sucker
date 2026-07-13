import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { getComputerStats } from '../multiplayer/computerStats';
import type { getHeadToHeadStats } from '../multiplayer/stats';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';
import { formatRecord } from './statsFormat';

type ComputerStatsSnapshot = Awaited<ReturnType<typeof getComputerStats>>;
type HeadToHeadStatsSnapshot = Awaited<ReturnType<typeof getHeadToHeadStats>>;
type ComputerStatsRow = NonNullable<ComputerStatsSnapshot>;
type HeadToHeadStatsRow = NonNullable<HeadToHeadStatsSnapshot['mine']>;
type StatsKind = 'computer' | 'headToHead';
type StatsSnapshot = ComputerStatsRow | HeadToHeadStatsRow | null;
const statsMaxFontSizeMultiplier = 1.2;

export function StatsPage({
  currentOpponentName,
  currentScore,
  onClose,
  opponentScore,
  opponentStats,
  stats,
  statsKind,
}: {
  currentOpponentName: string;
  currentScore: number;
  onClose: () => void;
  opponentStats?: HeadToHeadStatsRow | null;
  opponentScore: number;
  stats: StatsSnapshot;
  statsKind: StatsKind;
}) {
  const hasStats = Boolean(stats && stats.games_played > 0);
  const emptyStatsTarget = statsKind === 'computer' ? 'the computer' : currentOpponentName;
  const closeButtonRef = useRef<AccessibilityTargetRef | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => focusAccessibilityTarget(closeButtonRef.current));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
      style={styles.statsOverlay}
      testID="stats-page-overlay"
    >
      <View style={styles.statsHeader}>
        <View style={styles.statsHeaderText}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsEyebrow}>
            Stats
          </Text>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} numberOfLines={1} style={styles.statsTitle}>
            Vs {currentOpponentName}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Close stats"
          accessibilityRole="button"
          onPress={onClose}
          ref={closeButtonRef}
          style={({ pressed }) => [styles.statsCloseButton, pressed && styles.pressed]}
          testID="stats-page-close-button"
        >
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsCloseText}>
            X
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.statsScrollContent}
        showsVerticalScrollIndicator={false}
        style={styles.statsScroll}
        testID="stats-page-scroll"
      >
        <View style={styles.currentGameStatsCard}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsSectionTitle}>
            Current Game
          </Text>
          <View style={styles.statsScoreRow}>
            <StatBox label="You" value={String(currentScore)} />
            <StatBox label="Them" value={String(opponentScore)} />
          </View>
        </View>

        {hasStats && stats ? (
          <>
            <View style={styles.statsGrid}>
              <StatBox label="Record" value={formatRecord(stats.wins, stats.losses, stats.games_played)} />
              <StatBox label="Games" value={String(stats.games_played)} />
              <StatBox label="Your Avg" value={String(stats.average_score)} />
              <StatBox
                label="Their Avg"
                value={formatStatNumber(getOpponentAverage(stats, statsKind, opponentStats))}
              />
              <StatBox label="Your High" value={String(stats.highest_score)} />
              <StatBox label="Their High" value={String(getOpponentHigh(stats, statsKind, opponentStats))} />
            </View>
            <View style={styles.statsDetailCard}>
              {statsKind === 'headToHead' ? (
                <>
                  <StatsComparisonHeader title="Sucker Skills" />
                  <StatsComparisonLine
                    label="Blowout wins"
                    opponentValue={formatSkillStat(opponentStats, 'blowout_wins')}
                    value={formatSkillStat(stats, 'blowout_wins')}
                  />
                  <StatsComparisonLine
                    label="Comeback wins"
                    opponentValue={formatSkillStat(opponentStats, 'comeback_wins')}
                    value={formatSkillStat(stats, 'comeback_wins')}
                  />
                  <StatsComparisonLine
                    label="Buzzer beaters"
                    opponentValue={formatSkillStat(opponentStats, 'buzzer_beater_wins')}
                    value={formatSkillStat(stats, 'buzzer_beater_wins')}
                  />
                  <StatsComparisonLine
                    label="Extra rolls"
                    opponentValue={formatSkillStat(opponentStats, 'extra_rolls_used')}
                    value={formatSkillStat(stats, 'extra_rolls_used')}
                  />
                  <StatsComparisonLine
                    label="Mulligans"
                    opponentValue={formatSkillStat(opponentStats, 'mulligans_used')}
                    value={formatSkillStat(stats, 'mulligans_used')}
                  />
                  <StatsComparisonLine
                    label="Sucker punches thrown"
                    opponentValue={formatSkillStat(opponentStats, 'sucker_punches_used')}
                    value={formatSkillStat(stats, 'sucker_punches_used')}
                  />
                  <StatsComparisonLine
                    label="Sucker punches landed"
                    opponentValue={formatSkillPct(opponentStats, 'sucker_punch_landed_pct')}
                    value={formatSkillPct(stats, 'sucker_punch_landed_pct')}
                  />
                  <StatsComparisonLine
                    label="Sucker hunts"
                    opponentValue={formatSkillStat(opponentStats, 'sucker_hunts')}
                    value={formatSkillStat(stats, 'sucker_hunts')}
                  />
                  <StatsComparisonLine
                    label="Hunt misses"
                    opponentValue={formatSkillStat(opponentStats, 'sucker_hunt_misses')}
                    value={formatSkillStat(stats, 'sucker_hunt_misses')}
                  />
                  <StatsComparisonLine
                    label="Avg tokens used"
                    opponentValue={formatSkillStat(opponentStats, 'average_sucker_tokens_spent')}
                    value={formatSkillStat(stats, 'average_sucker_tokens_spent')}
                  />
                  <StatsComparisonLine
                    label="Avg tokens left"
                    opponentValue={formatSkillStat(opponentStats, 'average_sucker_tokens_leftover')}
                    value={formatSkillStat(stats, 'average_sucker_tokens_leftover')}
                  />
                </>
              ) : (
                <>
                  <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsSectionTitle}>
                    Sucker Skills
                  </Text>
                  <StatsValueLine label="Blowout wins" value={String(stats.blowout_wins ?? 0)} />
                  <StatsValueLine label="Comeback wins" value={String(stats.comeback_wins ?? 0)} />
                  <StatsValueLine label="Buzzer beaters" value={String(stats.buzzer_beater_wins ?? 0)} />
                  <StatsValueLine label="Extra rolls" value={String(stats.extra_rolls_used ?? 0)} />
                  <StatsValueLine label="Mulligans" value={String(stats.mulligans_used ?? 0)} />
                  <StatsValueLine label="Sucker punches thrown" value={String(stats.sucker_punches_used ?? 0)} />
                  <StatsValueLine
                    label="Sucker punches landed"
                    value={formatStatsPct(stats.sucker_punches_landed ?? 0, stats.sucker_punches_used ?? 0)}
                  />
                  <StatsValueLine label="Sucker hunts" value={String(stats.sucker_hunts ?? 0)} />
                  <StatsValueLine label="Hunt misses" value={String(stats.sucker_hunt_misses ?? 0)} />
                  <StatsValueLine
                    label="Avg tokens used"
                    value={formatStatNumber(stats.average_sucker_tokens_spent ?? 0)}
                  />
                  <StatsValueLine
                    label="Avg tokens left"
                    value={formatStatNumber(stats.average_sucker_tokens_leftover ?? 0)}
                  />
                </>
              )}
            </View>
            <View style={styles.statsDetailCard}>
              <StatsComparisonHeader title="Category Rates" />
              <StatsComparisonLine
                label="Upper bonus"
                opponentValue={formatCategoryRate(stats, statsKind, opponentStats, 'upper_bonus')}
                value={formatCategoryRate(stats, statsKind, null, 'upper_bonus')}
              />
              <StatsComparisonLine
                label="Sucker"
                opponentValue={formatCategoryRate(stats, statsKind, opponentStats, 'sucker')}
                value={formatCategoryRate(stats, statsKind, null, 'sucker')}
              />
              <StatsComparisonLine
                label="3 of a kind"
                opponentValue={formatCategoryRate(stats, statsKind, opponentStats, 'three_of_a_kind')}
                value={formatCategoryRate(stats, statsKind, null, 'three_of_a_kind')}
              />
              <StatsComparisonLine
                label="4 of a kind"
                opponentValue={formatCategoryRate(stats, statsKind, opponentStats, 'four_of_a_kind')}
                value={formatCategoryRate(stats, statsKind, null, 'four_of_a_kind')}
              />
              <StatsComparisonLine
                label="Full house"
                opponentValue={formatCategoryRate(stats, statsKind, opponentStats, 'full_house')}
                value={formatCategoryRate(stats, statsKind, null, 'full_house')}
              />
              <StatsComparisonLine
                label="Small straight"
                opponentValue={formatCategoryRate(stats, statsKind, opponentStats, 'small_straight')}
                value={formatCategoryRate(stats, statsKind, null, 'small_straight')}
              />
              <StatsComparisonLine
                label="Large straight"
                opponentValue={formatCategoryRate(stats, statsKind, opponentStats, 'large_straight')}
                value={formatCategoryRate(stats, statsKind, null, 'large_straight')}
              />
            </View>
          </>
        ) : (
          <View style={styles.statsEmptyCard}>
            <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsEmptyTitle}>
              No saved stats yet
            </Text>
            <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsEmptyBody}>
              Finish games against {emptyStatsTarget} while signed in to build your history.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

type CategoryRateKey =
  | 'four_of_a_kind'
  | 'full_house'
  | 'large_straight'
  | 'small_straight'
  | 'sucker'
  | 'three_of_a_kind'
  | 'upper_bonus';

type SkillStatKey =
  | 'average_sucker_tokens_leftover'
  | 'average_sucker_tokens_spent'
  | 'blowout_wins'
  | 'buzzer_beater_wins'
  | 'comeback_wins'
  | 'extra_rolls_used'
  | 'mulligans_used'
  | 'sucker_hunt_misses'
  | 'sucker_hunts'
  | 'sucker_punches_used';

type SkillPctKey = 'sucker_punch_landed_pct';

function getOpponentAverage(
  stats: NonNullable<StatsSnapshot>,
  statsKind: StatsKind,
  opponentStats?: HeadToHeadStatsRow | null,
) {
  if (statsKind === 'headToHead') {
    return opponentStats?.average_score ?? 0;
  }

  return (stats as ComputerStatsRow).computer_average_score ?? 0;
}

function getOpponentHigh(
  stats: NonNullable<StatsSnapshot>,
  statsKind: StatsKind,
  opponentStats?: HeadToHeadStatsRow | null,
) {
  if (statsKind === 'headToHead') {
    return opponentStats?.highest_score ?? 0;
  }

  return (stats as ComputerStatsRow).computer_highest_score ?? 0;
}

function formatCategoryRate(
  stats: NonNullable<StatsSnapshot>,
  statsKind: StatsKind,
  opponentStats: HeadToHeadStatsRow | null | undefined,
  key: CategoryRateKey,
) {
  if (statsKind === 'headToHead') {
    const row = opponentStats ?? (stats as HeadToHeadStatsRow);
    return `${formatStatNumber(row[`${key}_pct`])}%`;
  }

  const computerStats = stats as ComputerStatsRow;
  const countKey = `${key}_games` as keyof ComputerStatsRow;
  const count = Number(computerStats[countKey] ?? 0);
  return formatStatsPct(count, computerStats.games_played);
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statBoxValue}>
        {value}
      </Text>
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statBoxLabel}>
        {label}
      </Text>
    </View>
  );
}

function StatsComparisonHeader({ title }: { title: string }) {
  return (
    <View style={styles.statsComparisonHeader}>
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsSectionTitle}>
        {title}
      </Text>
      <View style={styles.statsLine}>
        <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsLineLabel} />
        <View style={styles.statsComparisonValues}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsComparisonLabel}>
            You
          </Text>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsComparisonLabel}>
            Them
          </Text>
        </View>
      </View>
    </View>
  );
}

function StatsComparisonLine({ label, opponentValue, value }: { label: string; opponentValue: string; value: string }) {
  return (
    <View style={styles.statsLine}>
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsLineLabel}>
        {label}
      </Text>
      <View style={styles.statsComparisonValues}>
        <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} numberOfLines={1} style={styles.statsLineValue}>
          {value}
        </Text>
        <Text
          maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
          numberOfLines={1}
          style={styles.statsLineOpponentValue}
        >
          {opponentValue}
        </Text>
      </View>
    </View>
  );
}

function StatsValueLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statsLine}>
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsLineLabel}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsLineValue}>
        {value}
      </Text>
    </View>
  );
}

function formatStatsPct(count: number, gamesPlayed: number) {
  if (gamesPlayed === 0) {
    return '0%';
  }

  return `${Math.round((count / gamesPlayed) * 100)}%`;
}

function formatSkillStat(row: HeadToHeadStatsRow | null | undefined, key: SkillStatKey) {
  return formatStatNumber(Number(row?.[key] ?? 0));
}

function formatSkillPct(row: HeadToHeadStatsRow | null | undefined, key: SkillPctKey) {
  return `${formatStatNumber(Number(row?.[key] ?? 0))}%`;
}

function formatStatNumber(value: number) {
  return Number(value).toFixed(2).replace(/\.00$/, '');
}

const styles = StyleSheet.create({
  currentGameStatsCard: {
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    gap: 8,
    padding: 10,
    width: '100%',
  },
  pressed: {
    opacity: 0.72,
  },
  statBox: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    flex: 1,
    minWidth: '46%',
    paddingVertical: 8,
  },
  statBoxLabel: {
    color: '#8F3B10',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  statBoxValue: {
    color: '#210505',
    fontSize: 24,
    fontWeight: '900',
  },
  statsCloseButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFD329',
    borderRadius: 8,
    borderWidth: 2,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  statsCloseText: {
    color: '#FFF3C2',
    fontSize: 16,
    fontWeight: '900',
  },
  statsComparisonHeader: {
    gap: 4,
  },
  statsComparisonLabel: {
    color: '#FFF3C2',
    fontSize: 11,
    fontWeight: '900',
    opacity: 0.9,
    textAlign: 'right',
    textTransform: 'uppercase',
    width: 68,
  },
  statsComparisonValues: {
    flexDirection: 'row',
    gap: 8,
    width: 144,
  },
  statsDetailCard: {
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    gap: 6,
    padding: 10,
    width: '100%',
  },
  statsEmptyBody: {
    color: '#FFF3C2',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
    textAlign: 'center',
  },
  statsEmptyCard: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    gap: 5,
    padding: 14,
    width: '100%',
  },
  statsEmptyTitle: {
    color: '#FFD329',
    fontSize: 18,
    fontWeight: '900',
  },
  statsEyebrow: {
    color: '#FFD329',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
  },
  statsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  statsHeaderText: {
    flex: 1,
    paddingRight: 10,
  },
  statsLine: {
    alignItems: 'center',
    borderBottomColor: '#5A1308',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 5,
  },
  statsLineLabel: {
    color: '#FFF3C2',
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  statsLineOpponentValue: {
    color: '#FFF3C2',
    fontSize: 16,
    fontWeight: '900',
    opacity: 0.9,
    textAlign: 'right',
    width: 68,
  },
  statsLineValue: {
    color: '#FFD329',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'right',
    width: 68,
  },
  statsOverlay: {
    backgroundColor: '#8F0000',
    bottom: 0,
    gap: 10,
    left: 0,
    padding: 14,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 100,
  },
  statsScroll: {
    flex: 1,
    width: '100%',
  },
  statsScrollContent: {
    gap: 10,
    paddingBottom: 24,
  },
  statsScoreRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statsSectionTitle: {
    color: '#FFD329',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  statsTitle: {
    color: '#FFF3C2',
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 34,
  },
});
