import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PlayerAvatar } from '../ui/PlayerAvatar';
import { Pressable } from '../ui/Pressable';
import {
  formatFeatRarity,
  formatLeaderboardValue,
  leaderboardBoards,
  rankedGameMinimum,
  type LeaderboardBoard,
  type LeaderboardRow,
  type PlayerFeat,
  type PlayerRanking,
} from './community';

export function LeaderboardPanel({
  board,
  error,
  isLoading,
  onBoardChange,
  onOpenPlayer,
  rows,
}: {
  board: LeaderboardBoard;
  error: string | null;
  isLoading: boolean;
  onBoardChange: (board: LeaderboardBoard) => void;
  onOpenPlayer: (profileId: string) => void;
  rows: LeaderboardRow[];
}) {
  const boardInfo = leaderboardBoards.find((candidate) => candidate.board === board)!;

  return (
    <View style={styles.panel} testID="leaderboard-panel">
      <View accessibilityRole="tablist" style={styles.tabs}>
        {leaderboardBoards.map((candidate) => {
          const selected = candidate.board === board;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              key={candidate.board}
              onPress={() => onBoardChange(candidate.board)}
              style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}
              testID={`leaderboard-tab-${candidate.board}`}
            >
              <Text numberOfLines={1} style={[styles.tabText, selected && styles.tabTextSelected]}>
                {candidate.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>Player</Text>
        <Text style={styles.sectionTitle}>{boardInfo.valueLabel}</Text>
      </View>
      {isLoading && rows.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#FFD329" size="small" />
        </View>
      ) : error ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Leaderboard unavailable</Text>
          <Text style={styles.emptyBody}>{error}</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No one here yet</Text>
          <Text style={styles.emptyBody}>{getEmptyBoardHint(board)}</Text>
        </View>
      ) : (
        rows.map((row, index) => {
          const skipped = index > 0 && row.rank > rows[index - 1].rank + 1 && row.is_me && index === rows.length - 1;
          return (
            <View key={row.player_id}>
              {skipped && <Text style={styles.gap}>•••</Text>}
              <Pressable
                accessibilityLabel={`${row.display_name}, rank ${row.rank}`}
                onPress={() => onOpenPlayer(row.player_id)}
                style={({ pressed }) => [styles.row, row.is_me && styles.rowMine, pressed && styles.pressed]}
                testID={`leaderboard-row-${row.player_id}`}
              >
                <Text style={[styles.rank, row.rank <= 3 && styles.rankTop]}>{row.rank}</Text>
                <PlayerAvatar avatarUrl={row.avatar_url} name={row.display_name} size={32} />
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={styles.name}>
                    {row.display_name}
                    {row.is_me ? ' (you)' : ''}
                  </Text>
                  {row.username && (
                    <Text numberOfLines={1} style={styles.username}>
                      @{row.username}
                    </Text>
                  )}
                </View>
                <View style={styles.valueBlock}>
                  <Text style={styles.value}>{formatLeaderboardValue(board, row.value)}</Text>
                  <Text style={styles.sample}>{formatSampleSize(board, row.sample_size)}</Text>
                </View>
              </Pressable>
            </View>
          );
        })
      )}
    </View>
  );
}

export function PlayerRankingsCard({
  isHidden,
  onOpenLeaderboard,
  rankings,
}: {
  isHidden: boolean;
  onOpenLeaderboard?: (board: LeaderboardBoard) => void;
  rankings: PlayerRanking[];
}) {
  return (
    <View style={styles.panel} testID="player-rankings">
      <Text style={styles.sectionTitle}>Rankings</Text>
      {rankings.length === 0 ? (
        <Text style={styles.emptyBody}>{isHidden ? 'Hidden from leaderboards.' : 'Not on a leaderboard yet.'}</Text>
      ) : (
        rankings.map((ranking) => {
          const info = leaderboardBoards.find((candidate) => candidate.board === ranking.board)!;
          const content = (
            <>
              <Text style={[styles.rankingRank, ranking.rank <= 3 && styles.rankTop]}>#{ranking.rank}</Text>
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={styles.name}>
                  {info.label}
                </Text>
                <Text style={styles.sample}>of {ranking.rankedPlayers} players</Text>
              </View>
              <Text style={styles.value}>{formatLeaderboardValue(ranking.board, ranking.value)}</Text>
              {onOpenLeaderboard && <Text style={styles.chevron}>›</Text>}
            </>
          );
          return onOpenLeaderboard ? (
            <Pressable
              accessibilityLabel={`${info.label} rank ${ranking.rank}. Open leaderboard`}
              accessibilityRole="button"
              key={ranking.board}
              onPress={() => onOpenLeaderboard(ranking.board)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID={`player-ranking-${ranking.board}`}
            >
              {content}
            </Pressable>
          ) : (
            <View key={ranking.board} style={styles.row} testID={`player-ranking-${ranking.board}`}>
              {content}
            </View>
          );
        })
      )}
      {onOpenLeaderboard && (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenLeaderboard(rankings[0]?.board ?? 'rating')}
          style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
          testID="player-rankings-see-all"
        >
          <Text style={styles.seeAllText}>See all rankings</Text>
        </Pressable>
      )}
    </View>
  );
}

// Earned first; locked ones stay tucked away until asked for, so the card stays short.
export function PlayerFeatsCard({ feats, tone }: { feats: PlayerFeat[]; tone: 'feat' | 'defeat' }) {
  const [showLocked, setShowLocked] = useState(false);
  const shown = feats.filter((feat) => feat.tone === tone);
  const earned = shown.filter((feat) => feat.timesEarned > 0);
  const locked = shown.filter((feat) => feat.timesEarned === 0);
  const noun = tone === 'feat' ? 'feats' : 'defeats';

  return (
    <View style={styles.panel} testID={tone === 'feat' ? 'player-feats' : 'player-defeats'}>
      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>{tone === 'feat' ? 'Feats' : 'Defeats'}</Text>
        <Text style={styles.sectionTitle}>
          {earned.length} / {shown.length}
        </Text>
      </View>
      {earned.length === 0 && <Text style={styles.emptyBody}>No {noun} yet.</Text>}
      {earned.map((feat) => (
        <FeatRow feat={feat} key={feat.key} tone={tone} />
      ))}
      {locked.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showLocked }}
          onPress={() => setShowLocked((current) => !current)}
          style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
          testID={`player-${noun}-locked-toggle`}
        >
          <Text style={styles.seeAllText}>
            {showLocked ? `Hide locked ${noun}` : `Show ${locked.length} locked ${noun}`}
          </Text>
        </Pressable>
      )}
      {showLocked && locked.map((feat) => <FeatRow feat={feat} key={feat.key} tone={tone} />)}
    </View>
  );
}

function FeatRow({ feat, tone }: { feat: PlayerFeat; tone: 'feat' | 'defeat' }) {
  return (
    <View
      style={[styles.feat, tone === 'defeat' && styles.defeat, feat.timesEarned === 0 && styles.featLocked]}
      testID={`feat-${feat.key}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.featName}>
          {feat.name}
          {feat.timesEarned > 1 ? ` ×${feat.timesEarned}` : ''}
        </Text>
        <Text style={styles.featDescription}>{feat.description}</Text>
      </View>
      <Text style={styles.featRarity}>{formatFeatRarity(feat.earnedPct)}</Text>
    </View>
  );
}

function formatSampleSize(board: LeaderboardBoard, sampleSize: number) {
  const noun = board === 'sharpshooter' ? 'punch' : 'game';
  const plural = board === 'sharpshooter' ? 'punches' : 'games';
  return `${sampleSize} ${sampleSize === 1 ? noun : plural}`;
}

function getEmptyBoardHint(board: LeaderboardBoard) {
  switch (board) {
    case 'rating':
      return `Finish ${rankedGameMinimum} multiplayer games to get ranked.`;
    case 'weekly_high_score':
      return 'Finish a game this week to post a score.';
    case 'all_time_high_score':
      return 'Finish a multiplayer game to post a score.';
    case 'sharpshooter':
      return 'Throw 10 Sucker Punches to qualify.';
    case 'win_streak':
      return 'Win 3 games in a row to qualify.';
  }
}

const styles = StyleSheet.create({
  defeat: {
    borderColor: '#E0412F',
  },
  emptyBody: {
    color: '#FFF3C2',
    fontSize: 13,
    fontWeight: '800',
    opacity: 0.85,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    gap: 4,
    padding: 12,
  },
  emptyTitle: {
    color: '#FFD329',
    fontSize: 17,
    fontWeight: '900',
  },
  feat: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  featDescription: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '700',
  },
  featLocked: {
    borderColor: '#8F3B10',
    opacity: 0.6,
  },
  featName: {
    color: '#FFD329',
    fontSize: 14,
    fontWeight: '900',
  },
  featRarity: {
    color: '#FFD76B',
    fontSize: 11,
    fontWeight: '800',
    maxWidth: 82,
    textAlign: 'right',
  },
  gap: {
    color: '#FFD76B',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  listHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  name: {
    color: '#FFF3C2',
    fontSize: 14,
    fontWeight: '900',
  },
  panel: {
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    gap: 6,
    padding: 8,
    width: '100%',
  },
  pressed: {
    opacity: 0.72,
  },
  rank: {
    color: '#FFF3C2',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
    width: 28,
  },
  rankingRank: {
    color: '#FFF3C2',
    fontSize: 15,
    fontWeight: '900',
    minWidth: 40,
  },
  rankTop: {
    color: '#FFD329',
  },
  row: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  rowMine: {
    backgroundColor: '#3A0A05',
    borderColor: '#FFD329',
  },
  rowText: {
    flex: 1,
  },
  chevron: {
    color: '#FFD329',
    fontSize: 24,
    fontWeight: '900',
    marginLeft: 2,
  },
  sample: {
    color: '#FFD76B',
    fontSize: 10,
    fontWeight: '800',
  },
  seeAll: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 40,
  },
  seeAllText: {
    color: '#FFD329',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: '#FFD329',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  tab: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 6,
  },
  tabSelected: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  tabText: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '900',
  },
  tabTextSelected: {
    color: '#210505',
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  username: {
    color: '#FFD76B',
    fontSize: 11,
    fontWeight: '800',
  },
  value: {
    color: '#FFD329',
    fontSize: 17,
    fontWeight: '900',
  },
  valueBlock: {
    alignItems: 'flex-end',
  },
});
