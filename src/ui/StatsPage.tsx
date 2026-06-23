import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { getComputerStats } from '../multiplayer/computerStats';

type ComputerStatsSnapshot = Awaited<ReturnType<typeof getComputerStats>>;

export function StatsPage({
  currentOpponentName,
  currentScore,
  onClose,
  opponentScore,
  stats,
}: {
  currentOpponentName: string;
  currentScore: number;
  onClose: () => void;
  opponentScore: number;
  stats: ComputerStatsSnapshot;
}) {
  const hasStats = Boolean(stats && stats.games_played > 0);

  return (
    <View style={styles.statsOverlay}>
      <View style={styles.statsHeader}>
        <View>
          <Text style={styles.statsEyebrow}>Stats</Text>
          <Text style={styles.statsTitle}>Vs {currentOpponentName}</Text>
        </View>
        <Pressable onPress={onClose} style={({ pressed }) => [styles.statsCloseButton, pressed && styles.pressed]}>
          <Text style={styles.statsCloseText}>X</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.statsScrollContent}
        showsVerticalScrollIndicator={false}
        style={styles.statsScroll}
      >
        <View style={styles.currentGameStatsCard}>
          <Text style={styles.statsSectionTitle}>Current Game</Text>
          <View style={styles.statsScoreRow}>
            <StatBox label="You" value={String(currentScore)} />
            <StatBox label={currentOpponentName} value={String(opponentScore)} />
          </View>
        </View>

        {hasStats && stats ? (
          <>
            <View style={styles.statsGrid}>
              <StatBox label="Record" value={`${stats.wins}-${stats.losses}`} />
              <StatBox label="Games" value={String(stats.games_played)} />
              <StatBox label="Your Avg" value={String(stats.average_score)} />
              <StatBox label={`${currentOpponentName} Avg`} value={String(stats.computer_average_score ?? 0)} />
              <StatBox label="Your High" value={String(stats.highest_score)} />
              <StatBox label={`${currentOpponentName} High`} value={String(stats.computer_highest_score ?? 0)} />
            </View>
            <View style={styles.statsDetailCard}>
              <View style={styles.statsComparisonHeader}>
                <Text style={styles.statsSectionTitle}>Category Rates</Text>
                <View style={styles.statsComparisonLabels}>
                  <Text style={styles.statsComparisonLabel}>You</Text>
                  <Text numberOfLines={1} style={styles.statsComparisonLabel}>
                    {currentOpponentName}
                  </Text>
                </View>
              </View>
              <StatsComparisonLine
                label="Upper bonus"
                opponentValue={formatStatsPct(stats.computer_upper_bonus_games ?? 0, stats.games_played)}
                value={formatStatsPct(stats.upper_bonus_games, stats.games_played)}
              />
              <StatsComparisonLine
                label="Sucker"
                opponentValue={formatStatsPct(stats.computer_sucker_games ?? 0, stats.games_played)}
                value={formatStatsPct(stats.sucker_games, stats.games_played)}
              />
              <StatsComparisonLine
                label="3 of a kind"
                opponentValue={formatStatsPct(stats.computer_three_of_a_kind_games ?? 0, stats.games_played)}
                value={formatStatsPct(stats.three_of_a_kind_games, stats.games_played)}
              />
              <StatsComparisonLine
                label="4 of a kind"
                opponentValue={formatStatsPct(stats.computer_four_of_a_kind_games ?? 0, stats.games_played)}
                value={formatStatsPct(stats.four_of_a_kind_games, stats.games_played)}
              />
              <StatsComparisonLine
                label="Full house"
                opponentValue={formatStatsPct(stats.computer_full_house_games ?? 0, stats.games_played)}
                value={formatStatsPct(stats.full_house_games, stats.games_played)}
              />
              <StatsComparisonLine
                label="Small straight"
                opponentValue={formatStatsPct(stats.computer_small_straight_games ?? 0, stats.games_played)}
                value={formatStatsPct(stats.small_straight_games, stats.games_played)}
              />
              <StatsComparisonLine
                label="Large straight"
                opponentValue={formatStatsPct(stats.computer_large_straight_games ?? 0, stats.games_played)}
                value={formatStatsPct(stats.large_straight_games, stats.games_played)}
              />
            </View>
            <View style={styles.statsDetailCard}>
              <Text style={styles.statsSectionTitle}>Sucker Skills</Text>
              <StatsValueLine label="Blowout wins" value={String(stats.blowout_wins ?? 0)} />
              <StatsValueLine label="Comeback wins" value={String(stats.comeback_wins ?? 0)} />
              <StatsValueLine label="Extra rolls" value={String(stats.extra_rolls_used ?? 0)} />
              <StatsValueLine label="Mulligans" value={String(stats.mulligans_used ?? 0)} />
              <StatsValueLine label="Sucker punches" value={String(stats.sucker_punches_used ?? 0)} />
              <StatsValueLine label="Blocks" value={String(stats.sucker_blockers_used ?? 0)} />
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
            </View>
          </>
        ) : (
          <View style={styles.statsEmptyCard}>
            <Text style={styles.statsEmptyTitle}>No saved stats yet</Text>
            <Text style={styles.statsEmptyBody}>
              Finish games against the computer while signed in to build your history.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statBoxValue}>{value}</Text>
      <Text style={styles.statBoxLabel}>{label}</Text>
    </View>
  );
}

function StatsComparisonLine({ label, opponentValue, value }: { label: string; opponentValue: string; value: string }) {
  return (
    <View style={styles.statsLine}>
      <Text style={styles.statsLineLabel}>{label}</Text>
      <View style={styles.statsComparisonValues}>
        <Text style={styles.statsLineValue}>{value}</Text>
        <Text style={styles.statsLineOpponentValue}>{opponentValue}</Text>
      </View>
    </View>
  );
}

function StatsValueLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statsLine}>
      <Text style={styles.statsLineLabel}>{label}</Text>
      <Text style={styles.statsLineValue}>{value}</Text>
    </View>
  );
}

function formatStatsPct(count: number, gamesPlayed: number) {
  if (gamesPlayed === 0) {
    return '0%';
  }

  return `${Math.round((count / gamesPlayed) * 100)}%`;
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
    height: 36,
    justifyContent: 'center',
    width: 36,
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
    flex: 1,
    fontSize: 11,
    fontWeight: '900',
    opacity: 0.9,
    textAlign: 'right',
    textTransform: 'uppercase',
  },
  statsComparisonLabels: {
    flexDirection: 'row',
    gap: 10,
    marginLeft: 132,
  },
  statsComparisonValues: {
    flexDirection: 'row',
    gap: 10,
    minWidth: 116,
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
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
    opacity: 0.9,
    textAlign: 'right',
  },
  statsLineValue: {
    color: '#FFD329',
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'right',
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
