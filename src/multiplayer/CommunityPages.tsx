import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PlayerAvatar } from '../ui/PlayerAvatar';
import { Pressable } from '../ui/Pressable';
import {
  formatFeatRarity,
  formatLeaderboardValue,
  leaderboardBoards,
  type LeaderboardBoard,
  type LeaderboardRow,
  type PlayerCard,
  type PlayerFeat,
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

export function PlayerCardPanel({
  card,
  challengeDisabled,
  error,
  feats,
  isLoading,
  isMe,
  onChallenge,
}: {
  card: PlayerCard | null;
  challengeDisabled: boolean;
  error: string | null;
  feats: PlayerFeat[];
  isLoading: boolean;
  isMe: boolean;
  onChallenge: () => void;
}) {
  if (!card) {
    return (
      <View style={styles.panel}>
        <View style={styles.emptyState}>
          {isLoading ? (
            <ActivityIndicator color="#FFD329" size="small" />
          ) : (
            <>
              <Text style={styles.emptyTitle}>Player unavailable</Text>
              <Text style={styles.emptyBody}>{error ?? 'Go back and try again.'}</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  const earned = feats.filter((feat) => feat.timesEarned > 0);
  const ties = Math.max(0, card.games_played - card.wins - card.losses);

  return (
    <>
      <View style={styles.panel} testID="player-card">
        <View style={styles.cardHeader}>
          <PlayerAvatar avatarUrl={card.avatar_url} name={card.display_name} size={68} />
          <View style={styles.rowText}>
            <Text numberOfLines={1} style={styles.cardName}>
              {card.display_name}
            </Text>
            {card.username && (
              <Text numberOfLines={1} style={styles.username}>
                @{card.username}
              </Text>
            )}
            <Text style={styles.cardRank}>
              {card.rating_rank
                ? `#${card.rating_rank} in the world`
                : card.rated_games < 5
                  ? `${Math.max(0, 5 - card.rated_games)} more ${card.rated_games === 4 ? 'game' : 'games'} to get ranked`
                  : 'Unranked'}
            </Text>
          </View>
        </View>
        <View style={styles.tiles}>
          <StatTile label="Rating" value={card.rating === null ? '—' : String(Math.round(Number(card.rating)))} />
          <StatTile label="Record" value={`${card.wins}-${card.losses}${ties ? `-${ties}` : ''}`} />
          <StatTile label="Best score" value={String(card.highest_score)} />
          <StatTile label="Best streak" value={String(card.best_win_streak)} />
        </View>
        {isMe ? (
          !card.show_on_leaderboards && (
            <Text style={styles.note}>You are hidden from leaderboards. Change this on your Profile.</Text>
          )
        ) : (
          <Pressable
            disabled={challengeDisabled}
            onPress={onChallenge}
            style={({ pressed }) => [
              styles.challengeButton,
              challengeDisabled && styles.disabled,
              pressed && styles.pressed,
            ]}
            testID="player-card-challenge-button"
          >
            <Text style={styles.challengeText}>Challenge {card.display_name}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.panel} testID="player-feats">
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Feats</Text>
          <Text style={styles.sectionTitle}>
            {earned.length} / {feats.length}
          </Text>
        </View>
        {feats.map((feat) => (
          <View
            key={feat.key}
            style={[styles.feat, feat.timesEarned === 0 && styles.featLocked]}
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
        ))}
      </View>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text numberOfLines={1} style={styles.tileValue}>
        {value}
      </Text>
      <Text numberOfLines={1} style={styles.tileLabel}>
        {label}
      </Text>
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
      return 'Finish 5 multiplayer games to get ranked.';
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
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  cardName: {
    color: '#FFF3C2',
    fontSize: 20,
    fontWeight: '900',
  },
  cardRank: {
    color: '#FFD329',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },
  challengeButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 10,
    borderWidth: 3,
    height: 54,
    justifyContent: 'center',
    paddingHorizontal: 12,
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
  },
  challengeText: {
    color: '#210505',
    fontSize: 17,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.55,
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
  note: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
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
  sample: {
    color: '#FFD76B',
    fontSize: 10,
    fontWeight: '800',
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
  tile: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    flexBasis: '47%',
    flexGrow: 1,
    paddingVertical: 6,
  },
  tileLabel: {
    color: '#8A4B12',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  tileValue: {
    color: '#210505',
    fontSize: 22,
    fontWeight: '900',
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
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
