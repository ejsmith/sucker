import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PlayerAvatar } from '../ui/PlayerAvatar';
import { Pressable } from '../ui/Pressable';
import {
  formatFeatRarity,
  formatLeaderboardValue,
  getLeaderboardInfo,
  leaderboardBoards,
  leaderboardHalls,
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
  const boardInfo = getLeaderboardInfo(board);
  const isShame = boardInfo.hall === 'shame';

  return (
    <View style={[styles.panel, isShame && styles.panelShame]} testID="leaderboard-panel">
      <View accessibilityRole="tablist" style={styles.tabs}>
        {leaderboardHalls.map((candidate) => {
          const selected = candidate.hall === boardInfo.hall;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              key={candidate.hall}
              onPress={() => {
                if (selected) return;
                onBoardChange(leaderboardBoards.find((entry) => entry.hall === candidate.hall)!.board);
              }}
              style={({ pressed }) => [
                styles.hallTab,
                selected && (candidate.hall === 'shame' ? styles.tabSelectedShame : styles.tabSelected),
                pressed && styles.pressed,
              ]}
              testID={`leaderboard-hall-${candidate.hall}`}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.hallTabText,
                  selected && (candidate.hall === 'shame' ? styles.tabTextSelectedShame : styles.tabTextSelected),
                ]}
              >
                {candidate.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {leaderboardBoards
          .filter((candidate) => candidate.hall === boardInfo.hall)
          .map((candidate) => {
            const selected = candidate.board === board;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                aria-selected={selected}
                key={candidate.board}
                onPress={() => onBoardChange(candidate.board)}
                style={({ pressed }) => [
                  styles.tab,
                  selected && (isShame ? styles.tabSelectedShame : styles.tabSelected),
                  pressed && styles.pressed,
                ]}
                testID={`leaderboard-tab-${candidate.board}`}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.tabText, selected && (isShame ? styles.tabTextSelectedShame : styles.tabTextSelected)]}
                >
                  {candidate.label}
                </Text>
              </Pressable>
            );
          })}
      </View>
      {boardInfo.blurb && (
        <View style={styles.boardIntro}>
          <Text style={styles.boardTitle}>{boardInfo.title}</Text>
          <Text style={styles.boardBlurb}>{boardInfo.blurb}</Text>
        </View>
      )}
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
                accessibilityHint="Opens their profile"
                accessibilityRole="button"
                onPress={() => onOpenPlayer(row.player_id)}
                style={({ pressed }) => [
                  styles.row,
                  row.is_me && (isShame ? styles.rowMineShame : styles.rowMine),
                  pressed && styles.pressed,
                ]}
                testID={`leaderboard-row-${row.player_id}`}
              >
                <Text style={[styles.rank, row.rank <= 3 && (isShame ? styles.rankTopShame : styles.rankTop)]}>
                  {row.rank}
                </Text>
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
                  <Text style={[styles.value, isShame && styles.valueShame]}>
                    {formatLeaderboardValue(board, row.value)}
                  </Text>
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
  onOpenLeaderboard,
  rankings,
}: {
  onOpenLeaderboard?: (board: LeaderboardBoard) => void;
  rankings: PlayerRanking[];
}) {
  const glory = rankings.filter((ranking) => getLeaderboardInfo(ranking.board).hall === 'glory');
  const shame = rankings.filter((ranking) => getLeaderboardInfo(ranking.board).hall === 'shame');

  return (
    <View style={styles.panel} testID="player-rankings">
      <Text style={styles.sectionTitle}>Rankings</Text>
      {glory.length === 0 ? (
        <Text style={styles.emptyBody}>Not on a leaderboard yet.</Text>
      ) : (
        glory.map((ranking) => (
          <PlayerRankingRow key={ranking.board} onOpenLeaderboard={onOpenLeaderboard} ranking={ranking} />
        ))
      )}
      {shame.length > 0 && (
        <View style={styles.shameRankings} testID="player-shame-rankings">
          <Text style={[styles.sectionTitle, styles.sectionTitleShame]}>Hall of Shame</Text>
          {shame.map((ranking) => (
            <PlayerRankingRow key={ranking.board} onOpenLeaderboard={onOpenLeaderboard} ranking={ranking} />
          ))}
        </View>
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

function PlayerRankingRow({
  onOpenLeaderboard,
  ranking,
}: {
  onOpenLeaderboard?: (board: LeaderboardBoard) => void;
  ranking: PlayerRanking;
}) {
  const info = getLeaderboardInfo(ranking.board);
  const isShame = info.hall === 'shame';
  const content = (
    <>
      <Text style={[styles.rankingRank, ranking.rank <= 3 && (isShame ? styles.rankTopShame : styles.rankTop)]}>
        #{ranking.rank}
      </Text>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.name}>
          {info.title}
        </Text>
        <Text style={styles.sample}>
          of {ranking.rankedPlayers} {ranking.rankedPlayers === 1 ? 'player' : 'players'}
        </Text>
      </View>
      <Text style={[styles.value, isShame && styles.valueShame]}>
        {formatLeaderboardValue(ranking.board, ranking.value)}
      </Text>
      {onOpenLeaderboard && (
        <Text aria-hidden style={[styles.chevron, isShame && styles.valueShame]}>
          ›
        </Text>
      )}
    </>
  );
  return onOpenLeaderboard ? (
    <Pressable
      accessibilityHint="Opens the leaderboard"
      accessibilityRole="button"
      onPress={() => onOpenLeaderboard(ranking.board)}
      style={({ pressed }) => [styles.row, isShame && styles.rowShame, pressed && styles.pressed]}
      testID={`player-ranking-${ranking.board}`}
    >
      {content}
    </Pressable>
  ) : (
    <View style={[styles.row, isShame && styles.rowShame]} testID={`player-ranking-${ranking.board}`}>
      {content}
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
  const plural = (noun: string, nouns: string) => `${sampleSize} ${sampleSize === 1 ? noun : nouns}`;
  switch (board) {
    case 'sharpshooter':
      return plural('punch', 'punches');
    case 'whiff_champion':
      return `of ${plural('punch', 'punches')}`;
    case 'saltiest':
    case 'weekly_salt':
      return `of ${plural('game', 'games')}`;
    case 'biggest_loser':
      return plural('loss', 'losses');
    default:
      return plural('game', 'games');
  }
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
    case 'saltiest':
      return 'Nobody has rage quit. Yet.';
    case 'weekly_salt':
      return 'Nobody has rage quit this week. Yet.';
    case 'most_punchable':
      return 'Nobody has taken a punch yet.';
    case 'whiff_champion':
      return 'Nobody has missed a punch yet.';
    case 'biggest_loser':
      return 'Nobody has lost a game yet.';
  }
}

const shameRed = '#E0412F';

const styles = StyleSheet.create({
  boardBlurb: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  boardIntro: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 2,
  },
  boardTitle: {
    color: '#FF8A6B',
    fontSize: 17,
    fontWeight: '900',
  },
  defeat: {
    borderColor: shameRed,
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
  hallTab: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 6,
  },
  hallTabText: {
    color: '#FFF3C2',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
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
  panelShame: {
    borderColor: shameRed,
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
  rankTopShame: {
    color: '#FF8A6B',
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
  rowMineShame: {
    backgroundColor: '#3A0A05',
    borderColor: shameRed,
  },
  rowShame: {
    backgroundColor: '#3A0A05',
    borderColor: shameRed,
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
  sectionTitleShame: {
    color: '#FF8A6B',
  },
  shameRankings: {
    gap: 6,
    marginTop: 4,
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
  tabSelectedShame: {
    backgroundColor: '#A8251A',
    borderColor: '#FFF3C2',
  },
  tabTextSelected: {
    color: '#210505',
  },
  tabTextSelectedShame: {
    color: '#FFF3C2',
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
  valueShame: {
    color: '#FF8A6B',
  },
  valueBlock: {
    alignItems: 'flex-end',
  },
});
