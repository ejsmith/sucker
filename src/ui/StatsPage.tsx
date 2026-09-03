import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { getComputerStats } from '../multiplayer/computerStats';
import {
  getHeadToHeadStats,
  getProfileRecentGames,
  getProfileStats,
  type ProfileRecentGame,
  type ProfileRecentGamePlayer,
  type ProfileStats,
} from '../multiplayer/stats';
import { categoryLabels, scoreCategories, upperBonus } from '../game';
import { getProfilesByIds } from '../multiplayer/profiles';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';
import { BackChevronIcon, CloseIcon } from './ControlIcon';
import { PlayerAvatar } from './PlayerAvatar';
import { formatRecord } from './statsFormat';
import { Pressable } from './Pressable';

type ComputerStatsSnapshot = Awaited<ReturnType<typeof getComputerStats>>;
type HeadToHeadStatsSnapshot = Awaited<ReturnType<typeof getHeadToHeadStats>>;
type ComputerStatsRow = NonNullable<ComputerStatsSnapshot>;
type HeadToHeadStatsRow = NonNullable<HeadToHeadStatsSnapshot['mine']>;
type StatsKind = 'computer' | 'headToHead';
type StatsSnapshot = ComputerStatsRow | HeadToHeadStatsRow | null;
const statsMaxFontSizeMultiplier = 1.2;

export function StatsPage({
  currentOpponentAvatarUrl,
  currentOpponentName,
  currentOpponentProfileId,
  currentPlayerAvatarUrl,
  currentPlayerName = 'You',
  currentPlayerOverallStats,
  currentPlayerProfileId,
  currentScore,
  nestedBackHandlerRef,
  onClose,
  onStartGameAgainst,
  opponentOverallStats,
  opponentScore,
  opponentStats,
  playerStatsTarget,
  stats,
  statsKind,
}: {
  currentOpponentAvatarUrl?: string | null;
  currentOpponentName: string;
  currentOpponentProfileId?: string;
  currentPlayerAvatarUrl?: string | null;
  currentPlayerName?: string;
  currentPlayerOverallStats?: ProfileStats | null;
  currentPlayerProfileId?: string;
  currentScore?: number;
  nestedBackHandlerRef?: MutableRefObject<(() => void) | null>;
  onClose: () => void;
  onStartGameAgainst?: (profileId: string) => Promise<void>;
  opponentOverallStats?: ProfileStats | null;
  opponentScore?: number;
  opponentStats?: HeadToHeadStatsRow | null;
  playerStatsTarget?: 'me' | 'opponent' | null;
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

  if (statsKind === 'headToHead' && playerStatsTarget) {
    const isMe = playerStatsTarget === 'me';
    const profileId = isMe ? currentPlayerProfileId : currentOpponentProfileId;
    if (profileId) {
      return (
        <PlayerStatsPage
          currentUserProfileId={currentPlayerProfileId}
          initialProfile={{
            avatarUrl: isMe ? currentPlayerAvatarUrl : currentOpponentAvatarUrl,
            currentUserHeadToHeadStats: isMe ? null : (stats as HeadToHeadStatsRow | null),
            headToHeadStats: isMe ? null : opponentStats,
            id: profileId,
            name: isMe ? currentPlayerName : currentOpponentName,
            stats: isMe ? currentPlayerOverallStats : opponentOverallStats,
          }}
          key={profileId}
          nestedBackHandlerRef={nestedBackHandlerRef}
          onClose={onClose}
          onStartGameAgainst={onStartGameAgainst}
        />
      );
    }
  }

  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
      role="dialog"
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
          <CloseIcon />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.statsScrollContent}
        showsVerticalScrollIndicator={false}
        style={styles.statsScroll}
        testID="stats-page-scroll"
      >
        {statsKind === 'computer' && currentScore !== undefined && opponentScore !== undefined && (
          <View style={styles.currentGameStatsCard}>
            <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsSectionTitle}>
              Current Game
            </Text>
            <View style={styles.statsScoreRow}>
              <StatBox label="You" value={String(currentScore)} />
              <StatBox label="Them" value={String(opponentScore)} />
            </View>
          </View>
        )}

        {hasStats && stats ? (
          statsKind === 'headToHead' ? (
            <HeadToHeadStatsComparison mine={stats as HeadToHeadStatsRow} opponent={opponentStats} />
          ) : (
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
          )
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

type PlayerStatsProfile = {
  avatarUrl?: string | null;
  currentUserHeadToHeadStats?: HeadToHeadStatsRow | null;
  headToHeadStats?: HeadToHeadStatsRow | null;
  id: string;
  name: string;
  stats?: ProfileStats | null;
  username?: string | null;
};

type PlayerStatsPageName = 'detail' | 'games' | 'stats';
type PlayerStatsView = 'headToHead' | 'overall';

type PlayerStatsRoute = {
  games: ProfileRecentGame[];
  page: PlayerStatsPageName;
  profile: PlayerStatsProfile;
  selectedGame: ProfileRecentGame | null;
  statsView: PlayerStatsView;
};

function PlayerStatsPage({
  currentUserProfileId,
  initialProfile,
  nestedBackHandlerRef,
  onClose,
  onStartGameAgainst,
}: {
  currentUserProfileId?: string;
  initialProfile: PlayerStatsProfile;
  nestedBackHandlerRef?: MutableRefObject<(() => void) | null>;
  onClose: () => void;
  onStartGameAgainst?: (profileId: string) => Promise<void>;
}) {
  const [activeProfile, setActiveProfile] = useState(initialProfile);
  const [games, setGames] = useState<ProfileRecentGame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [page, setPage] = useState<PlayerStatsPageName>('stats');
  const [routeStack, setRouteStack] = useState<PlayerStatsRoute[]>([]);
  const [selectedGame, setSelectedGame] = useState<ProfileRecentGame | null>(null);
  const [statsView, setStatsView] = useState<PlayerStatsView>('overall');
  const backButtonRef = useRef<AccessibilityTargetRef | null>(null);
  const playerNavigationPendingRef = useRef(false);
  const visibleProfile =
    activeProfile.id === initialProfile.id ? { ...activeProfile, ...initialProfile } : activeProfile;

  useEffect(() => {
    const frame = requestAnimationFrame(() => focusAccessibilityTarget(backButtonRef.current));
    return () => cancelAnimationFrame(frame);
  }, [page, visibleProfile.id]);

  useEffect(() => {
    let isMounted = true;
    void getProfilesByIds([visibleProfile.id])
      .then(([profile]) => {
        if (!isMounted || !profile) return;
        setActiveProfile((currentProfile) =>
          currentProfile.id === profile.id
            ? {
                ...currentProfile,
                avatarUrl: profile.avatar_url ?? currentProfile.avatarUrl,
                name: profile.display_name,
                username: profile.username,
              }
            : currentProfile,
        );
      })
      .catch(() => {
        // The game snapshot still provides a display name and avatar if profile metadata cannot be refreshed.
      });
    return () => {
      isMounted = false;
    };
  }, [visibleProfile.id]);

  async function openGames() {
    setIsLoading(true);
    setMessage(null);
    try {
      setGames(await getProfileRecentGames(visibleProfile.id));
      setPage('games');
    } catch (historyError) {
      setMessage(historyError instanceof Error ? historyError.message : 'Unable to load completed games.');
    } finally {
      setIsLoading(false);
    }
  }

  async function openPlayer(player: ProfileRecentGamePlayer) {
    if (playerNavigationPendingRef.current) return;
    playerNavigationPendingRef.current = true;

    setIsLoading(true);
    setMessage(null);
    try {
      const canLoadHeadToHead = Boolean(currentUserProfileId && player.id !== currentUserProfileId);
      const [profiles, matchup, overallStats] = await Promise.all([
        getProfilesByIds([player.id]),
        canLoadHeadToHead ? getHeadToHeadStats(player.id) : Promise.resolve(null),
        canLoadHeadToHead ? Promise.resolve(null) : getProfileStats(player.id),
      ]);
      const profile = profiles[0];
      const nextProfile = {
        avatarUrl: profile?.avatar_url ?? player.avatarUrl,
        currentUserHeadToHeadStats: matchup?.mine ?? null,
        headToHeadStats: matchup?.opponent ?? null,
        id: player.id,
        name: profile?.display_name ?? player.name,
        stats: matchup?.opponentOverall ?? overallStats,
        username: profile?.username ?? null,
      };
      setRouteStack((stack) => [...stack, { games, page, profile: visibleProfile, selectedGame, statsView }]);
      setActiveProfile(nextProfile);
      setGames([]);
      setSelectedGame(null);
      setPage('stats');
      setStatsView('overall');
    } catch (profileError) {
      setMessage(profileError instanceof Error ? profileError.message : 'Unable to load player stats.');
    } finally {
      setIsLoading(false);
      requestAnimationFrame(() => {
        playerNavigationPendingRef.current = false;
      });
    }
  }

  const goBack = useCallback(() => {
    if (page === 'detail') {
      setSelectedGame(null);
      setPage('games');
      return;
    }
    if (page === 'games') {
      setPage('stats');
      return;
    }
    const previousRoute = routeStack.at(-1);
    if (previousRoute) {
      setRouteStack((stack) => stack.slice(0, -1));
      setActiveProfile(previousRoute.profile);
      setGames(previousRoute.games);
      setPage(previousRoute.page);
      setSelectedGame(previousRoute.selectedGame);
      setStatsView(previousRoute.statsView);
      return;
    }
    onClose();
  }, [onClose, page, routeStack]);

  useEffect(() => {
    if (!nestedBackHandlerRef) return;
    nestedBackHandlerRef.current = goBack;
    return () => {
      if (nestedBackHandlerRef.current === goBack) nestedBackHandlerRef.current = null;
    };
  }, [goBack, nestedBackHandlerRef]);

  async function startGame() {
    if (!onStartGameAgainst) return;
    setIsLoading(true);
    setMessage(null);
    try {
      await onStartGameAgainst(visibleProfile.id);
    } catch (startError) {
      setMessage(startError instanceof Error ? startError.message : 'Unable to start the game.');
    } finally {
      setIsLoading(false);
    }
  }

  const title = page === 'detail' ? 'Game Card' : page === 'games' ? 'Recent Games' : 'Player Stats';
  const showStatsToggle = Boolean(currentUserProfileId && visibleProfile.id !== currentUserProfileId);

  return (
    <View
      accessibilityLabel={`${visibleProfile.name} ${title}`}
      accessibilityViewIsModal
      onAccessibilityEscape={goBack}
      role="dialog"
      style={styles.statsOverlay}
      testID="player-stats-page-overlay"
    >
      <View style={styles.playerStatsHeader}>
        <Pressable
          accessibilityLabel={`Back from ${title}`}
          accessibilityRole="button"
          onPress={goBack}
          ref={backButtonRef}
          style={({ pressed }) => [styles.statsBackButton, pressed && styles.pressed]}
          testID="player-stats-back-button"
        >
          <BackChevronIcon size={28} strokeWidth={4.5} />
        </Pressable>
        {page === 'stats' && showStatsToggle ? (
          <PlayerStatsViewToggle onChange={setStatsView} value={statsView} />
        ) : (
          <Text
            maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
            numberOfLines={1}
            style={styles.playerStatsHeaderTitle}
          >
            {title}
          </Text>
        )}
        <Pressable
          accessibilityLabel="Close player stats"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.statsCloseButton, pressed && styles.pressed]}
          testID="player-stats-close-button"
        >
          <CloseIcon />
        </Pressable>
      </View>

      {page === 'stats' && (
        <PlayerStatsSummary
          isLoading={isLoading}
          message={message}
          onOpenGames={() => void openGames()}
          onStartGame={() => void startGame()}
          profile={visibleProfile}
          showStartGame={Boolean(onStartGameAgainst && visibleProfile.id !== currentUserProfileId)}
          statsView={statsView}
        />
      )}
      {page === 'games' && (
        <PlayerGameHistory
          games={games}
          isCurrentUser={visibleProfile.id === currentUserProfileId}
          isLoading={isLoading}
          message={message}
          onOpenGame={(game) => {
            setSelectedGame(game);
            setPage('detail');
          }}
          profile={visibleProfile}
        />
      )}
      {page === 'detail' && selectedGame && (
        <PlayerGameCard game={selectedGame} isLoading={isLoading} onOpenPlayer={(player) => void openPlayer(player)} />
      )}
    </View>
  );
}

function PlayerStatsViewToggle({
  onChange,
  value,
}: {
  onChange: (view: PlayerStatsView) => void;
  value: PlayerStatsView;
}) {
  return (
    <View accessibilityLabel="Player stats view" style={styles.playerStatsHeaderToggle} testID="player-stats-toggle">
      {(['overall', 'headToHead'] as const).map((view) => {
        const selected = value === view;
        const label = view === 'overall' ? 'Overall' : 'Vs You';
        return (
          <Pressable
            accessibilityLabel={`${label} stats`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            key={view}
            onPress={() => onChange(view)}
            style={({ pressed }) => [
              styles.playerStatsToggleButton,
              selected && styles.playerStatsToggleButtonSelected,
              pressed && styles.pressed,
            ]}
            testID={`player-stats-toggle-${view}`}
          >
            <Text
              maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
              style={[styles.playerStatsToggleText, selected && styles.playerStatsToggleTextSelected]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PlayerStatsSummary({
  isLoading,
  message,
  onOpenGames,
  onStartGame,
  profile,
  showStartGame,
  statsView,
}: {
  isLoading: boolean;
  message: string | null;
  onOpenGames: () => void;
  onStartGame: () => void;
  profile: PlayerStatsProfile;
  showStartGame: boolean;
  statsView: PlayerStatsView;
}) {
  const stats = statsView === 'headToHead' ? profile.currentUserHeadToHeadStats : profile.stats;
  const hasStats = Boolean(stats && stats.games_played > 0);

  return (
    <ScrollView
      contentContainerStyle={styles.statsScrollContent}
      showsVerticalScrollIndicator={false}
      style={styles.statsScroll}
    >
      <View style={styles.playerIdentityCard}>
        <PlayerAvatar avatarUrl={profile.avatarUrl} name={profile.name} size={76} testID="player-stats-avatar" />
        <View style={styles.playerIdentityText}>
          <Text
            maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
            numberOfLines={2}
            style={styles.playerIdentityName}
            testID="player-stats-name"
          >
            {profile.name}
          </Text>
          {profile.username && (
            <Text
              maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
              numberOfLines={1}
              style={styles.playerIdentityUsername}
              testID="player-stats-username"
            >
              @{profile.username}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.playerStatsActions}>
        {showStartGame && (
          <Pressable
            disabled={isLoading}
            onPress={onStartGame}
            style={({ pressed }) => [
              styles.playerPrimaryButton,
              isLoading && styles.disabled,
              pressed && styles.pressed,
            ]}
            testID="player-stats-start-game-button"
          >
            <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.playerPrimaryButtonText}>
              Start Game
            </Text>
          </Pressable>
        )}
        <Pressable
          disabled={isLoading}
          onPress={onOpenGames}
          style={({ pressed }) => [
            styles.playerSecondaryButton,
            isLoading && styles.disabled,
            pressed && styles.pressed,
          ]}
          testID="player-stats-games-button"
        >
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.playerSecondaryButtonText}>
            Recent Games
          </Text>
        </Pressable>
      </View>

      {isLoading && <ActivityIndicator color="#FFD329" />}
      {message && (
        <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsMessage}>
          {message}
        </Text>
      )}

      {hasStats && stats ? (
        statsView === 'headToHead' ? (
          <HeadToHeadStatsComparison
            formatNumber={formatPlayerStatNumber}
            mine={stats as HeadToHeadStatsRow}
            opponent={profile.headToHeadStats}
          />
        ) : (
          <>
            <View style={styles.playerStatsMetrics}>
              <View style={styles.playerStatsMetricRow}>
                <StatBox compact label="Record" value={formatRecord(stats.wins, stats.losses, stats.games_played)} />
                <StatBox compact label="Win %" value={formatPlayerWinningPct(stats.wins, stats.games_played)} />
              </View>
              <View style={styles.playerStatsMetricRow}>
                <StatBox compact label="Avg Score" value={formatPlayerStatNumber(stats.average_score)} />
                <StatBox compact label="High Score" value={String(stats.highest_score)} />
              </View>
            </View>
            <View style={styles.statsDetailCard}>
              <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsSectionTitle}>
                Sucker Skills
              </Text>
              <StatsValueLine label="Blowout wins" value={formatPlayerSkillStat(stats, 'blowout_wins')} />
              <StatsValueLine label="Comeback wins" value={formatPlayerSkillStat(stats, 'comeback_wins')} />
              <StatsValueLine label="Buzzer beaters" value={formatPlayerSkillStat(stats, 'buzzer_beater_wins')} />
              <StatsValueLine label="Extra rolls" value={formatPlayerSkillStat(stats, 'extra_rolls_used')} />
              <StatsValueLine label="Mulligans" value={formatPlayerSkillStat(stats, 'mulligans_used')} />
              <StatsValueLine
                label="Sucker punches thrown"
                value={formatPlayerSkillStat(stats, 'sucker_punches_used')}
              />
              <StatsValueLine
                label="Sucker punches landed"
                value={formatPlayerSkillPct(stats, 'sucker_punch_landed_pct')}
              />
              <StatsValueLine label="Sucker hunts" value={formatPlayerSkillStat(stats, 'sucker_hunts')} />
              <StatsValueLine label="Hunt misses" value={formatPlayerSkillStat(stats, 'sucker_hunt_misses')} />
              <StatsValueLine
                label="Avg tokens used"
                value={formatPlayerSkillStat(stats, 'average_sucker_tokens_spent')}
              />
              <StatsValueLine
                label="Avg tokens left"
                value={formatPlayerSkillStat(stats, 'average_sucker_tokens_leftover')}
              />
            </View>
            <View style={styles.statsDetailCard}>
              <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsSectionTitle}>
                Category Rates
              </Text>
              <StatsValueLine label="Upper bonus" value={formatProfileCategoryRate(stats, 'upper_bonus')} />
              <StatsValueLine label="Sucker" value={formatProfileCategoryRate(stats, 'sucker')} />
              <StatsValueLine label="3 of a kind" value={formatProfileCategoryRate(stats, 'three_of_a_kind')} />
              <StatsValueLine label="4 of a kind" value={formatProfileCategoryRate(stats, 'four_of_a_kind')} />
              <StatsValueLine label="Full house" value={formatProfileCategoryRate(stats, 'full_house')} />
              <StatsValueLine label="Small straight" value={formatProfileCategoryRate(stats, 'small_straight')} />
              <StatsValueLine label="Large straight" value={formatProfileCategoryRate(stats, 'large_straight')} />
            </View>
          </>
        )
      ) : (
        <View style={styles.statsEmptyCard}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsEmptyTitle}>
            No saved stats yet
          </Text>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsEmptyBody}>
            {statsView === 'headToHead'
              ? `${profile.name} has not finished a game against you yet.`
              : `${profile.name} has not finished a signed-in multiplayer game yet.`}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function HeadToHeadStatsComparison({
  formatNumber = formatStatNumber,
  mine,
  opponent,
}: {
  formatNumber?: (value: number) => string;
  mine: HeadToHeadStatsRow;
  opponent?: HeadToHeadStatsRow | null;
}) {
  return (
    <View style={styles.headToHeadComparison} testID="head-to-head-stats-comparison">
      <View style={styles.statsGrid}>
        <StatBox label="Your Record" value={`${mine.wins}-${mine.losses}`} />
        <StatBox label="Your Win %" value={formatWinningPct(mine.wins, mine.games_played, formatNumber)} />
        <StatBox label="Your Avg" value={formatNumber(mine.average_score)} />
        <StatBox label="Their Avg" value={formatNumber(opponent?.average_score ?? 0)} />
        <StatBox label="Your High" value={String(mine.highest_score)} />
        <StatBox label="Their High" value={String(opponent?.highest_score ?? 0)} />
      </View>
      <View style={styles.statsDetailCard}>
        <StatsComparisonHeader title="Sucker Skills" />
        <StatsComparisonLine
          label="Blowout wins"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'blowout_wins', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'blowout_wins', formatNumber)}
        />
        <StatsComparisonLine
          label="Comeback wins"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'comeback_wins', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'comeback_wins', formatNumber)}
        />
        <StatsComparisonLine
          label="Buzzer beaters"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'buzzer_beater_wins', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'buzzer_beater_wins', formatNumber)}
        />
        <StatsComparisonLine
          label="Extra rolls"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'extra_rolls_used', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'extra_rolls_used', formatNumber)}
        />
        <StatsComparisonLine
          label="Mulligans"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'mulligans_used', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'mulligans_used', formatNumber)}
        />
        <StatsComparisonLine
          label="Sucker punches thrown"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'sucker_punches_used', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'sucker_punches_used', formatNumber)}
        />
        <StatsComparisonLine
          label="Sucker punches landed"
          opponentValue={formatHeadToHeadSkillPct(opponent, 'sucker_punch_landed_pct', formatNumber)}
          value={formatHeadToHeadSkillPct(mine, 'sucker_punch_landed_pct', formatNumber)}
        />
        <StatsComparisonLine
          label="Sucker hunts"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'sucker_hunts', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'sucker_hunts', formatNumber)}
        />
        <StatsComparisonLine
          label="Hunt misses"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'sucker_hunt_misses', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'sucker_hunt_misses', formatNumber)}
        />
        <StatsComparisonLine
          label="Avg tokens used"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'average_sucker_tokens_spent', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'average_sucker_tokens_spent', formatNumber)}
        />
        <StatsComparisonLine
          label="Avg tokens left"
          opponentValue={formatHeadToHeadSkillStat(opponent, 'average_sucker_tokens_leftover', formatNumber)}
          value={formatHeadToHeadSkillStat(mine, 'average_sucker_tokens_leftover', formatNumber)}
        />
      </View>
      <View style={styles.statsDetailCard}>
        <StatsComparisonHeader title="Category Rates" />
        {(
          [
            ['Upper bonus', 'upper_bonus'],
            ['Sucker', 'sucker'],
            ['3 of a kind', 'three_of_a_kind'],
            ['4 of a kind', 'four_of_a_kind'],
            ['Full house', 'full_house'],
            ['Small straight', 'small_straight'],
            ['Large straight', 'large_straight'],
          ] as const
        ).map(([label, key]) => (
          <StatsComparisonLine
            key={key}
            label={label}
            opponentValue={formatHeadToHeadCategoryRate(opponent, key, formatNumber)}
            value={formatHeadToHeadCategoryRate(mine, key, formatNumber)}
          />
        ))}
      </View>
    </View>
  );
}

function PlayerGameHistory({
  games,
  isCurrentUser,
  isLoading,
  message,
  onOpenGame,
  profile,
}: {
  games: ProfileRecentGame[];
  isCurrentUser: boolean;
  isLoading: boolean;
  message: string | null;
  onOpenGame: (game: ProfileRecentGame) => void;
  profile: PlayerStatsProfile;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.statsScrollContent}
      showsVerticalScrollIndicator={false}
      style={styles.statsScroll}
    >
      <View style={styles.historyIdentityRow}>
        <PlayerAvatar avatarUrl={profile.avatarUrl} name={profile.name} size={50} />
        <View style={styles.historyIdentityText}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} numberOfLines={1} style={styles.historyIdentityName}>
            {profile.name}
          </Text>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.historyIdentityLabel}>
            Most recent completed games
          </Text>
        </View>
      </View>
      {isLoading && <ActivityIndicator color="#FFD329" />}
      {message && (
        <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsMessage}>
          {message}
        </Text>
      )}
      {!isLoading && games.length === 0 && (
        <View style={styles.statsEmptyCard}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsEmptyTitle}>
            No completed games
          </Text>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.statsEmptyBody}>
            This player does not have any completed multiplayer games yet.
          </Text>
        </View>
      )}
      {games.length > 0 && (
        <View style={styles.historyListPanel}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.historyListTitle}>
            Recent Games
          </Text>
          {games.map((game) => {
            const result = getPlayerGameResult(game);
            const resultTone = result === 'Won' ? 'win' : result === 'Lost' ? 'loss' : 'tie';
            const resultLabel = getPlayerGameResultLabel(result, isCurrentUser);
            return (
              <Pressable
                key={game.gameId}
                onPress={() => onOpenGame(game)}
                style={({ pressed }) => [
                  styles.historyGameRow,
                  resultTone === 'win' && styles.historyGameWin,
                  resultTone === 'loss' && styles.historyGameLoss,
                  resultTone === 'tie' && styles.historyGameTie,
                  pressed && styles.pressed,
                ]}
                testID={`player-history-game-${game.gameId}`}
              >
                <View style={styles.historyGameTop}>
                  <PlayerAvatar avatarUrl={game.opponent.avatarUrl} name={game.opponent.name} size={50} />
                  <View style={styles.historyGameText}>
                    <Text
                      maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
                      numberOfLines={1}
                      style={styles.historyOpponentName}
                    >
                      {game.opponent.name}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
                      style={[
                        styles.historyResult,
                        resultTone === 'win' && styles.historyResultWin,
                        resultTone === 'loss' && styles.historyResultLoss,
                        resultTone === 'tie' && styles.historyResultTie,
                      ]}
                    >
                      {resultLabel}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.historyScorePill,
                      resultTone === 'win' && styles.historyScorePillWin,
                      resultTone === 'loss' && styles.historyScorePillLoss,
                      resultTone === 'tie' && styles.historyScorePillTie,
                    ]}
                  >
                    <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.historyScore}>
                      {game.player.score}
                    </Text>
                    <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.historyScoreDivider}>
                      -
                    </Text>
                    <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.historyScore}>
                      {game.opponent.score}
                    </Text>
                  </View>
                </View>
                <Text
                  maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
                  numberOfLines={1}
                  style={styles.historyGameDate}
                >
                  {formatPlayerGameDate(game.completedAt)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function PlayerGameCard({
  game,
  isLoading,
  onOpenPlayer,
}: {
  game: ProfileRecentGame;
  isLoading: boolean;
  onOpenPlayer: (player: ProfileRecentGamePlayer) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.statsScrollContent}
      showsVerticalScrollIndicator={false}
      style={styles.statsScroll}
    >
      <View style={styles.gamePlayersCard}>
        <GameCardPlayer disabled={isLoading} player={game.player} onPress={() => onOpenPlayer(game.player)} />
        <View style={styles.gameCardResult}>
          <Text
            maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            numberOfLines={1}
            style={styles.gameCardScore}
          >
            {game.player.score}–{game.opponent.score}
          </Text>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.gameCardDate}>
            {formatPlayerGameDate(game.completedAt)}
          </Text>
        </View>
        <GameCardPlayer disabled={isLoading} player={game.opponent} onPress={() => onOpenPlayer(game.opponent)} />
      </View>
      <View style={styles.gameScorecard}>
        <View style={[styles.gameScoreRow, styles.gameScoreHeader]}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={[styles.gameCategory, styles.gameHeaderText]}>
            Category
          </Text>
          <Text
            maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
            numberOfLines={1}
            style={[styles.gameValue, styles.gameHeaderText]}
          >
            Player
          </Text>
          <Text
            maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
            numberOfLines={1}
            style={[styles.gameValue, styles.gameHeaderText]}
          >
            Opponent
          </Text>
        </View>
        {scoreCategories.map((category) => (
          <GameScoreRow
            key={category}
            label={categoryLabels[category]}
            opponentValue={formatScore(game.opponent.scorecard[category])}
            playerValue={formatScore(game.player.scorecard[category])}
          />
        ))}
        <GameScoreRow
          label="Upper bonus"
          opponentValue={String(upperBonus(game.opponent.scorecard))}
          playerValue={String(upperBonus(game.player.scorecard))}
        />
        <GameScoreRow
          emphasized
          label="Total"
          opponentValue={String(game.opponent.score)}
          playerValue={String(game.player.score)}
        />
      </View>
      <View style={styles.gameScorecard}>
        <View style={[styles.gameScoreRow, styles.gameScoreHeader]}>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={[styles.gameCategory, styles.gameHeaderText]}>
            Sucker tokens
          </Text>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={[styles.gameValue, styles.gameHeaderText]}>
            Used
          </Text>
          <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={[styles.gameValue, styles.gameHeaderText]}>
            Left
          </Text>
        </View>
        <GameScoreRow
          label={game.player.name}
          opponentValue={String(game.player.suckerTokens)}
          playerValue={String(game.player.suckerTokensSpent)}
          wrapLabel
        />
        <GameScoreRow
          label={game.opponent.name}
          opponentValue={String(game.opponent.suckerTokens)}
          playerValue={String(game.opponent.suckerTokensSpent)}
          wrapLabel
        />
      </View>
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.gameAvatarHint}>
        Tap either player’s avatar to view their stats.
      </Text>
    </ScrollView>
  );
}

function GameCardPlayer({
  disabled,
  player,
  onPress,
}: {
  disabled: boolean;
  player: ProfileRecentGamePlayer;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`View ${player.name}'s stats`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.gameCardPlayer, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <PlayerAvatar avatarUrl={player.avatarUrl} name={player.name} size={58} />
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} style={styles.gameCardPlayerName}>
        {player.name}
      </Text>
    </Pressable>
  );
}

function GameScoreRow({
  emphasized = false,
  label,
  opponentValue,
  playerValue,
  wrapLabel = false,
}: {
  emphasized?: boolean;
  label: string;
  opponentValue: string;
  playerValue: string;
  wrapLabel?: boolean;
}) {
  return (
    <View style={[styles.gameScoreRow, emphasized && styles.gameScoreTotal]}>
      <Text
        maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
        numberOfLines={wrapLabel ? undefined : 1}
        style={[styles.gameCategory, emphasized && styles.gameScoreTotalText]}
      >
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
        style={[styles.gameValue, emphasized && styles.gameScoreTotalText]}
      >
        {playerValue}
      </Text>
      <Text
        maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
        style={[styles.gameValue, emphasized && styles.gameScoreTotalText]}
      >
        {opponentValue}
      </Text>
    </View>
  );
}

function getPlayerGameResult(game: ProfileRecentGame) {
  if (game.player.score === game.opponent.score) return 'Tied';
  return game.player.score > game.opponent.score ? 'Won' : 'Lost';
}

function getPlayerGameResultLabel(result: ReturnType<typeof getPlayerGameResult>, isCurrentUser: boolean) {
  if (result === 'Tied') return 'Tie';
  return isCurrentUser ? `You ${result.toLowerCase()}` : result;
}

function formatPlayerGameDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(value),
  );
}

function formatScore(value: number | null) {
  return value === null ? '—' : String(value);
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

function formatProfileCategoryRate(stats: ProfileStats | HeadToHeadStatsRow, key: CategoryRateKey) {
  return `${formatPlayerStatNumber(stats[`${key}_pct`])}%`;
}

function StatBox({ compact = false, label, value }: { compact?: boolean; label: string; value: string }) {
  return (
    <View style={[styles.statBox, compact && styles.playerStatBox]}>
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
      <Text maxFontSizeMultiplier={statsMaxFontSizeMultiplier} numberOfLines={2} style={styles.statsLineLabel}>
        {label}
      </Text>
      <Text
        adjustsFontSizeToFit
        maxFontSizeMultiplier={statsMaxFontSizeMultiplier}
        minimumFontScale={0.85}
        numberOfLines={1}
        style={styles.statsSingleLineValue}
      >
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

function formatHeadToHeadSkillStat(
  row: HeadToHeadStatsRow | null | undefined,
  key: SkillStatKey,
  formatNumber: (value: number) => string,
) {
  return formatNumber(Number(row?.[key] ?? 0));
}

function formatHeadToHeadSkillPct(
  row: HeadToHeadStatsRow | null | undefined,
  key: SkillPctKey,
  formatNumber: (value: number) => string,
) {
  return `${formatNumber(Number(row?.[key] ?? 0))}%`;
}

function formatHeadToHeadCategoryRate(
  row: HeadToHeadStatsRow | null | undefined,
  key: CategoryRateKey,
  formatNumber: (value: number) => string,
) {
  return `${formatNumber(Number(row?.[`${key}_pct`] ?? 0))}%`;
}

function formatWinningPct(wins: number, gamesPlayed: number, formatNumber: (value: number) => string) {
  return gamesPlayed === 0 ? '0%' : `${formatNumber((wins / gamesPlayed) * 100)}%`;
}

function formatPlayerSkillStat(row: HeadToHeadStatsRow | ProfileStats, key: SkillStatKey) {
  return formatPlayerStatNumber(Number(row[key] ?? 0));
}

function formatPlayerSkillPct(row: HeadToHeadStatsRow | ProfileStats, key: SkillPctKey) {
  return `${formatPlayerStatNumber(Number(row[key] ?? 0))}%`;
}

function formatPlayerWinningPct(wins: number, gamesPlayed: number) {
  return formatWinningPct(wins, gamesPlayed, formatPlayerStatNumber);
}

function formatPlayerStatNumber(value: number) {
  return Number(value).toFixed(1).replace(/\.0$/, '');
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
  disabled: {
    opacity: 0.55,
  },
  gameAvatarHint: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  gameCardDate: {
    color: '#FFD76B',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  gameCardPlayer: {
    alignItems: 'center',
    flex: 1,
    gap: 5,
  },
  gameCardPlayerName: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 14,
    textAlign: 'center',
  },
  gameCardResult: {
    alignItems: 'center',
    gap: 3,
    justifyContent: 'center',
    width: 112,
  },
  gameCardScore: {
    color: '#FFD329',
    fontSize: 26,
    fontWeight: '900',
  },
  gameCategory: {
    color: '#FFF3C2',
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
  },
  gameHeaderText: {
    color: '#FFD329',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  gamePlayersCard: {
    alignItems: 'flex-start',
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    padding: 12,
    width: '100%',
  },
  gameScoreHeader: {
    backgroundColor: '#8F3B10',
    borderBottomWidth: 0,
  },
  gameScoreRow: {
    alignItems: 'center',
    borderBottomColor: '#8F3B10',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  gameScoreTotal: {
    backgroundColor: '#FFF3C2',
    borderBottomWidth: 0,
  },
  gameScoreTotalText: {
    color: '#210505',
    fontSize: 13,
  },
  gameScorecard: {
    backgroundColor: '#3A0A05',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    overflow: 'hidden',
    width: '100%',
  },
  gameValue: {
    color: '#FFF3C2',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    width: 72,
  },
  historyGameDate: {
    color: '#806B56',
    fontSize: 11,
    fontWeight: '700',
  },
  historyGameLoss: {
    backgroundColor: '#FFE2D6',
    borderColor: '#C62B22',
  },
  historyGameRow: {
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 3,
    gap: 2,
    padding: 6,
    width: '100%',
  },
  historyGameTie: {
    backgroundColor: '#FFF3C2',
    borderColor: '#B97812',
  },
  historyGameText: {
    flex: 1,
    gap: 3,
  },
  historyGameTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  historyGameWin: {
    backgroundColor: '#F1FFD8',
    borderColor: '#2F8F3E',
  },
  historyIdentityLabel: {
    color: '#FFD76B',
    fontSize: 11,
    fontWeight: '800',
  },
  historyIdentityName: {
    color: '#FFF3C2',
    fontSize: 18,
    fontWeight: '900',
  },
  historyIdentityRow: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    width: '100%',
  },
  historyIdentityText: {
    flex: 1,
  },
  historyListPanel: {
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    gap: 6,
    padding: 8,
    width: '100%',
  },
  historyListTitle: {
    color: '#FFD329',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  historyOpponentName: {
    color: '#210505',
    fontSize: 17,
    fontWeight: '900',
  },
  historyResult: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 2,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  headToHeadComparison: {
    gap: 8,
    width: '100%',
  },
  historyResultLoss: {
    backgroundColor: '#C62B22',
    borderColor: '#7A1208',
    color: '#FFF3C2',
  },
  historyResultTie: {
    backgroundColor: '#FFE08A',
    borderColor: '#B97812',
    color: '#5A1308',
  },
  historyResultWin: {
    backgroundColor: '#7DD957',
    borderColor: '#2F8F3E',
    color: '#183B12',
  },
  historyScore: {
    color: '#210505',
    fontSize: 18,
    fontWeight: '900',
  },
  historyScoreDivider: {
    color: '#8F3B10',
    fontSize: 15,
    fontWeight: '900',
  },
  historyScorePill: {
    alignItems: 'center',
    backgroundColor: '#FFD76B',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 4,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 4,
    width: 108,
  },
  historyScorePillLoss: {
    backgroundColor: '#FFB6A6',
    borderColor: '#C62B22',
  },
  historyScorePillTie: {
    backgroundColor: '#FFE08A',
    borderColor: '#B97812',
  },
  historyScorePillWin: {
    backgroundColor: '#DFF7A8',
    borderColor: '#2F8F3E',
  },
  playerIdentityCard: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    width: '100%',
  },
  playerIdentityName: {
    color: '#FFF3C2',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 31,
  },
  playerIdentityText: {
    flex: 1,
    gap: 2,
  },
  playerIdentityUsername: {
    color: '#FFD329',
    fontSize: 14,
    fontWeight: '900',
  },
  playerPrimaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 9,
    borderWidth: 3,
    flex: 1,
    height: 50,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  playerPrimaryButtonText: {
    color: '#210505',
    fontSize: 16,
    fontWeight: '900',
  },
  playerSecondaryButton: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#FFB000',
    borderRadius: 9,
    borderWidth: 2,
    flex: 1,
    height: 50,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  playerSecondaryButtonText: {
    color: '#FFD329',
    fontSize: 14,
    fontWeight: '900',
  },
  playerStatsActions: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  playerStatsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: 10,
    justifyContent: 'space-between',
    position: 'relative',
    width: '100%',
    zIndex: 1,
  },
  playerStatsHeaderTitle: {
    color: '#FFF3C2',
    flex: 1,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  playerStatsHeaderToggle: {
    backgroundColor: '#3A0A05',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flex: 1,
    flexDirection: 'row',
    maxWidth: 190,
    padding: 2,
  },
  playerStatsMetricRow: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
  },
  playerStatsMetrics: {
    gap: 6,
    width: '100%',
  },
  playerStatsToggleButton: {
    alignItems: 'center',
    borderRadius: 4,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 6,
  },
  playerStatsToggleButtonSelected: {
    backgroundColor: '#FFD329',
  },
  playerStatsToggleText: {
    color: '#FFD329',
    fontSize: 13,
    fontWeight: '900',
  },
  playerStatsToggleTextSelected: {
    color: '#210505',
  },
  pressed: {
    opacity: 0.72,
  },
  playerStatBox: {
    minWidth: 0,
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
  statsBackButton: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 8,
    borderWidth: 2,
    height: 44,
    justifyContent: 'center',
    width: 44,
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
  statsMessage: {
    color: '#FFF3C2',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  statsSingleLineValue: {
    color: '#FFD329',
    flexShrink: 0,
    fontSize: 16,
    fontWeight: '900',
    minWidth: 88,
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
