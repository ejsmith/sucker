import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  categoryLabels,
  getForfeiterId,
  getWinnerId,
  scoreCategories,
  totalScore,
  upperBonus,
  upperSectionBaseScore,
  type GameState,
  type Player,
  type ScoreCategory,
} from '../../shared/game';
import { buildTrashTalk } from '../game/trashTalk';
import { reportError } from '../monitoring/exceptionless';
import { loadGameRecap, type RecapProfile, type RemoteGameRecap } from '../multiplayer/gameRecap';
import { CategoryTileFace, upperCategories } from './CategoryTile';
import { RatingChange, RecapTape, TrashTalkLog } from './GameRecap';
import { createGameLayout, gameDesignWidth, gameMinimumContentHeight } from './gameLayout';
import { GameLayoutContext } from './gameLayoutContext';
import { PlayerAvatar } from './PlayerAvatar';
import { Pressable } from './Pressable';

const maxFontSizeMultiplier = 1.2;
const black = 'Inter_900Black';
const extraBold = 'Inter_800ExtraBold';
const unit = (value: number) => value;
const lowerCategories = scoreCategories.filter((category) => !upperCategories.includes(category));
// The scorecard's tiles at the game screen's smallest scale.
const scorecardLayout = createGameLayout(gameDesignWidth * 0.75, gameMinimumContentHeight * 0.75);

type PastGameTab = 'scorecard' | 'recap' | 'talk';

// A finished game, opened from game history, a leaderboard score, or a
// player's recent games: who won, the final scorecard, the recap numbers, and
// everything the players said. The viewer's side is on the left when they
// played; otherwise the subject's (the player whose list or score led here).
export function PastGameView({
  footer,
  gameId,
  onOpenPlayer,
  subjectId,
  viewerId,
}: {
  footer?: ReactNode;
  gameId: string;
  onOpenPlayer?: (profile: RecapProfile) => void;
  subjectId?: string | null;
  viewerId: string | null;
}) {
  const [loaded, setLoaded] = useState<{ failed: boolean; gameId: string; recap: RemoteGameRecap | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<PastGameTab>('scorecard');

  useEffect(() => {
    let active = true;
    loadGameRecap(gameId).then(
      (recap) => {
        if (active) setLoaded({ failed: false, gameId, recap });
      },
      (error: unknown) => {
        void reportError(error, { GameId: gameId, Operation: 'Load past game' });
        if (active) setLoaded({ failed: true, gameId, recap: null });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, gameId]);

  const current = loaded?.gameId === gameId ? loaded : null;
  if (!current?.recap) {
    return (
      <View style={[styles.card, styles.loading]} testID="past-game-loading">
        {current?.failed ? (
          <>
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.emptyTitle}>
              This game got lost in the mail.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLoaded(null);
                setAttempt((value) => value + 1);
              }}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              testID="past-game-retry"
            >
              <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.retryText}>
                Try again
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color="#FFD329" />
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.quiet}>
              Pulling the tape…
            </Text>
          </>
        )}
      </View>
    );
  }

  const recap = current.recap;
  const { game } = recap;
  const [first, second] = game.players;
  const homeId = [viewerId, subjectId].find((id) => game.players.some((player) => player.id === id)) ?? first.id;
  const home = game.players.find((player) => player.id === homeId) ?? first;
  const opponent = game.players.find((player) => player.id !== home.id) ?? second;
  const viewerPlayed = home.id === viewerId;
  const homeName = viewerPlayed ? 'You' : (recap.profiles[home.id]?.name ?? home.name);
  const opponentName = recap.profiles[opponent.id]?.name ?? opponent.name;
  const trashTalk = buildTrashTalk({ game, taunts: recap.taunts, turns: recap.turns });

  return (
    <View style={styles.view} testID="past-game">
      <Matchup
        completedAt={recap.completedAt}
        game={game}
        home={home}
        onOpenPlayer={onOpenPlayer}
        opponent={opponent}
        recap={recap}
        viewerPlayed={viewerPlayed}
      />
      <View accessibilityRole="tablist" style={styles.tabs}>
        {(
          [
            { key: 'scorecard', label: 'Scorecard' },
            { key: 'recap', label: 'Recap' },
            { key: 'talk', label: 'Trash Talk' },
          ] as const
        ).map((candidate) => {
          const selected = candidate.key === tab;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              key={candidate.key}
              onPress={() => setTab(candidate.key)}
              style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}
              testID={`past-game-tab-${candidate.key}`}
            >
              <Text
                maxFontSizeMultiplier={maxFontSizeMultiplier}
                numberOfLines={1}
                style={[styles.tabText, selected && styles.tabTextSelected]}
              >
                {candidate.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'scorecard' && (
        <PastScorecard
          home={home}
          homeName={homeName}
          opponent={opponent}
          opponentName={opponentName}
          profiles={recap.profiles}
        />
      )}
      {tab === 'recap' && (
        <View style={styles.tape} testID="past-game-recap">
          <RecapTape home={home} homeName={homeName} opponent={opponent} recap={recap} unit={unit} />
        </View>
      )}
      {tab === 'talk' && (
        <View style={[styles.card, styles.talk]} testID="past-game-talk">
          <TrashTalkLog entries={trashTalk} home={home} homeName={homeName} opponentName={opponentName} unit={unit} />
        </View>
      )}
      {footer}
    </View>
  );
}

function Matchup({
  completedAt,
  game,
  home,
  onOpenPlayer,
  opponent,
  recap,
  viewerPlayed,
}: {
  completedAt: string | null;
  game: GameState;
  home: Player;
  onOpenPlayer?: (profile: RecapProfile) => void;
  opponent: Player;
  recap: RemoteGameRecap;
  viewerPlayed: boolean;
}) {
  const winnerId = getWinnerId(game);
  const nameOf = (player: Player) =>
    viewerPlayed && player.id === home.id ? 'You' : (recap.profiles[player.id]?.name ?? player.name);

  return (
    <View style={[styles.card, styles.matchup]} testID="past-game-matchup">
      <View style={styles.sides}>
        {[home, opponent].map((player) => {
          const profile = recap.profiles[player.id];
          const name = profile?.name ?? player.name;
          const won = winnerId === player.id;
          const content = (
            <>
              <PlayerAvatar avatarUrl={profile?.avatarUrl ?? null} name={name} size={56} />
              <Text maxFontSizeMultiplier={maxFontSizeMultiplier} numberOfLines={2} style={styles.sideName}>
                {name}
              </Text>
              <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.sideScore, won && styles.winnerText]}>
                {totalScore(player.scorecard)}
              </Text>
              <RatingChange result={recap.results[player.id]} unit={unit} />
            </>
          );
          return onOpenPlayer && profile ? (
            <Pressable
              accessibilityHint="Opens their profile"
              accessibilityLabel={`${name}, ${totalScore(player.scorecard)} points`}
              accessibilityRole="button"
              key={player.id}
              onPress={() => onOpenPlayer(profile)}
              style={({ pressed }) => [styles.side, pressed && styles.pressed]}
              testID={`past-game-player-${player.id}`}
            >
              {content}
            </Pressable>
          ) : (
            <View key={player.id} style={styles.side}>
              {content}
            </View>
          );
        })}
      </View>
      <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.result} testID="past-game-result">
        {describeResult(game, home, opponent, nameOf)}
      </Text>
      {completedAt ? (
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.date}>
          {formatDate(completedAt)}
        </Text>
      ) : null}
    </View>
  );
}

function describeResult(game: GameState, home: Player, opponent: Player, nameOf: (player: Player) => string) {
  const forfeiterId = getForfeiterId(game);
  const forfeiter = game.players.find((player) => player.id === forfeiterId);
  if (forfeiter) return `${nameOf(forfeiter)} ${game.rageQuit ? 'rage quit' : 'ran out of time'}.`;

  const winnerId = getWinnerId(game);
  if (!winnerId) return 'Tie game!';
  const [winner, loser] = winnerId === home.id ? [home, opponent] : [opponent, home];
  const margin = totalScore(winner.scorecard) - totalScore(loser.scorecard);
  const winnerName = nameOf(winner);
  if (winnerName === 'You') return `You won by ${margin}!`;
  if (nameOf(loser) === 'You') return `You lost by ${margin}.`;
  return `${winnerName} won by ${margin}.`;
}

function PastScorecard({
  home,
  homeName,
  opponent,
  opponentName,
  profiles,
}: {
  home: Player;
  homeName: string;
  opponent: Player;
  opponentName: string;
  profiles: RemoteGameRecap['profiles'];
}) {
  const row = (category: ScoreCategory) => (
    <ScoreRow
      category={category}
      home={home}
      homeName={homeName}
      key={category}
      opponent={opponent}
      opponentName={opponentName}
    />
  );
  const [homeTotal, opponentTotal] = [totalScore(home.scorecard), totalScore(opponent.scorecard)];

  return (
    <GameLayoutContext.Provider value={scorecardLayout}>
      <View style={[styles.card, styles.scorecard]} testID="past-game-scorecard">
        <View style={styles.scoreHeader}>
          <View style={styles.scoreHeaderSpacer} />
          {/* Same order as the matchup above; names would not fit. */}
          {[
            { label: homeName, player: home },
            { label: opponentName, player: opponent },
          ].map(({ label, player }) => (
            <View accessibilityLabel={label} key={player.id} style={[styles.columnHead, styles.cellWidth]}>
              <PlayerAvatar
                avatarUrl={profiles[player.id]?.avatarUrl ?? null}
                decorative
                name={profiles[player.id]?.name ?? player.name}
                size={28}
              />
            </View>
          ))}
        </View>
        {upperCategories.map(row)}
        <View
          accessibilityLabel={`Upper bonus: ${homeName} ${upperBonus(home.scorecard)}, ${opponentName} ${upperBonus(opponent.scorecard)}`}
          accessible
          style={[styles.scoreRow, styles.bonusRow]}
        >
          <View style={styles.rowLabelWide}>
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.rowLabel}>
              Upper bonus
            </Text>
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.rowSubLabel}>
              63 in the top six earns 35
            </Text>
          </View>
          {[home, opponent].map((player) => {
            const bonus = upperBonus(player.scorecard);
            return (
              <View key={player.id} style={[styles.cell, styles.cellWidth, bonus > 0 && styles.cellBest]}>
                <Text
                  maxFontSizeMultiplier={maxFontSizeMultiplier}
                  style={[styles.cellText, bonus === 0 && styles.small]}
                >
                  {bonus > 0 ? `+${bonus}` : `${upperSectionBaseScore(player.scorecard)}/63`}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.divider} />
        {lowerCategories.map(row)}
        <View
          accessibilityLabel={`Total: ${homeName} ${homeTotal}, ${opponentName} ${opponentTotal}`}
          accessible
          style={[styles.scoreRow, styles.totalRow]}
        >
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.rowLabelWide, styles.totalLabel]}>
            TOTAL
          </Text>
          {[homeTotal, opponentTotal].map((total, index) => (
            <View
              key={index}
              style={[
                styles.cell,
                styles.cellWidth,
                styles.totalCell,
                total > (index === 0 ? opponentTotal : homeTotal) && styles.cellBest,
              ]}
            >
              <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.cellText, styles.totalText]}>
                {total}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </GameLayoutContext.Provider>
  );
}

function ScoreRow({
  category,
  home,
  homeName,
  opponent,
  opponentName,
}: {
  category: ScoreCategory;
  home: Player;
  homeName: string;
  opponent: Player;
  opponentName: string;
}) {
  const [homeScore, opponentScore] = [home.scorecard[category], opponent.scorecard[category]];
  const format = (value: number | null) => (value === null ? '—' : String(value));

  return (
    <View
      accessibilityLabel={`${categoryLabels[category]}: ${homeName} ${format(homeScore)}, ${opponentName} ${format(opponentScore)}`}
      accessible
      style={styles.scoreRow}
      testID={`past-game-row-${category}`}
    >
      <View style={styles.tileWrap}>
        <CategoryTileFace category={category} />
      </View>
      <Text
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        numberOfLines={1}
        style={[styles.rowLabel, styles.rowLabelFill]}
      >
        {categoryLabels[category]}
      </Text>
      {[
        { player: home, score: homeScore, other: opponentScore },
        { player: opponent, score: opponentScore, other: homeScore },
      ].map(({ other, player, score }) => (
        <View
          key={player.id}
          style={[
            styles.cell,
            styles.cellWidth,
            score !== null && score > 0 && score > (other ?? 0) && styles.cellBest,
          ]}
        >
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.cellText, !score && styles.cellZero]}>
            {format(score)}
          </Text>
          {player.suckerBonusCategories.includes(category) ? (
            <View style={styles.bonusBadge}>
              <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.bonusBadgeText}>
                +50
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(value),
  );
}

const styles = StyleSheet.create({
  bonusBadge: {
    backgroundColor: '#F12D22',
    borderColor: '#FFF3C2',
    borderRadius: 7,
    borderWidth: 1.5,
    paddingHorizontal: 3,
    position: 'absolute',
    right: -6,
    top: -7,
  },
  bonusBadgeText: {
    color: '#FFFFFF',
    fontFamily: black,
    fontSize: 9,
    lineHeight: 11,
  },
  bonusRow: {
    minHeight: 46,
  },
  card: {
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    width: '100%',
  },
  cell: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
  },
  cellBest: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  cellText: {
    color: '#210505',
    fontFamily: black,
    fontSize: 17,
  },
  cellWidth: {
    width: 62,
  },
  cellZero: {
    color: '#8F3B10',
  },
  columnHead: {
    alignItems: 'center',
  },
  date: {
    color: '#FFF3C2',
    fontFamily: extraBold,
    fontSize: 12,
    opacity: 0.75,
    textAlign: 'center',
  },
  divider: {
    backgroundColor: '#8F3B10',
    height: 2,
    marginVertical: 4,
  },
  emptyTitle: {
    color: '#FFF3C2',
    fontFamily: black,
    fontSize: 15,
    textAlign: 'center',
  },
  loading: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 28,
  },
  matchup: {
    gap: 6,
    paddingBottom: 12,
    paddingHorizontal: 10,
    paddingTop: 14,
  },
  pressed: {
    opacity: 0.72,
  },
  quiet: {
    color: '#FFF3C2',
    fontFamily: extraBold,
    fontSize: 13,
    opacity: 0.8,
  },
  result: {
    color: '#FFD329',
    fontFamily: black,
    fontSize: 20,
    marginTop: 4,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  retryText: {
    color: '#210505',
    fontFamily: black,
    fontSize: 15,
  },
  rowLabel: {
    color: '#FFF3C2',
    fontFamily: extraBold,
    fontSize: 13,
  },
  rowLabelFill: {
    flex: 1,
  },
  rowLabelWide: {
    flex: 1,
    paddingLeft: 4,
  },
  rowSubLabel: {
    color: '#FFF3C2',
    fontFamily: extraBold,
    fontSize: 10,
    opacity: 0.7,
  },
  scoreHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 2,
  },
  scoreHeaderSpacer: {
    flex: 1,
  },
  scoreRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
  },
  scorecard: {
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  side: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    minHeight: 44,
  },
  sideName: {
    color: '#FFF3C2',
    fontFamily: black,
    fontSize: 15,
    textAlign: 'center',
  },
  sideScore: {
    color: '#FFF3C2',
    fontFamily: black,
    fontSize: 34,
    lineHeight: 38,
  },
  sides: {
    flexDirection: 'row',
    gap: 10,
  },
  small: {
    fontSize: 12,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 6,
  },
  tabSelected: {
    backgroundColor: '#FFD329',
  },
  tabText: {
    color: '#FFD329',
    fontFamily: black,
    fontSize: 14,
  },
  tabTextSelected: {
    color: '#210505',
  },
  tabs: {
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    width: '100%',
  },
  talk: {
    padding: 12,
  },
  tape: {
    gap: 10,
    width: '100%',
  },
  tileWrap: {
    width: 46,
  },
  totalCell: {
    height: 42,
  },
  totalLabel: {
    color: '#FFD329',
    fontFamily: black,
    fontSize: 15,
  },
  totalRow: {
    borderTopColor: '#8F3B10',
    borderTopWidth: 2,
    marginTop: 4,
    paddingTop: 6,
  },
  totalText: {
    fontSize: 20,
  },
  view: {
    gap: 10,
    width: '100%',
  },
  winnerText: {
    color: '#FFD329',
  },
});
