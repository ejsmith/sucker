import { StatusBar } from 'expo-status-bar';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  availableCategories,
  categoryLabels,
  createGame,
  maxAvailableRolls,
  mulliganCurrentTurn,
  purchaseExtraRoll,
  rollCurrentDice,
  rollsRemaining,
  scoreCategory,
  scoreCategoryForScorecard,
  scoreCategories,
  scoreTurn,
  scratchScoreBox,
  suckerPunchChanceByDie,
  suckerTokenCosts,
  toggleHold,
  totalScore,
} from './src/game';
import {
  applyLocalSuckerPunch,
  computerPlayerIndex,
  playComputerTurn,
  scoreLocalTurn,
  type ComputerTurnResult,
  type LocalPendingTurn,
} from './src/game/computer';
import type { DieValue, GameState, ScoreCategory, SuckerPunchOutcome } from './src/game';
import { getComputerStats, recordComputerGameResult } from './src/multiplayer/computerStats';
import {
  buyRemoteExtraRoll,
  createRematch,
  getLatestRemoteBlockedSuckerPunch,
  getGame,
  getTurn,
  rollRemoteGame,
  scoreRemoteCategory,
  scratchRemoteCategory,
  subscribeToGame,
  subscribeToGameListChanges,
  useRemoteSuckerPunch,
} from './src/multiplayer/games';
import { countGamesAwaitingTurn, syncAppBadgeCount } from './src/multiplayer/notifications';
import { getProfilesByIds } from './src/multiplayer/profiles';
import { supabase } from './src/multiplayer/supabase';
import { getHeadToHeadStats } from './src/multiplayer/stats';
import type { RemoteGameRow, RemoteGameStatus, RemoteTurnRow } from './src/multiplayer/types';
import {
  createGameLayout,
  gameViewportPresets,
  getSafeGameStageStyle,
  type GameLayout,
  type GameViewportPresetKey,
} from './src/ui/gameLayout';
import { useAppActivity } from './src/ui/useAppActivity';
import { useKeyboardStableWindowDimensions } from './src/ui/useKeyboardStableWindowDimensions';
import {
  createRollingLaunch,
  defaultRollingLaunch,
  measureInWindow,
  rollDisplayDie,
  type MeasuredRect,
  type RollingLaunch,
  type ViewRef,
  wait,
} from './src/ui/rollAnimation';
import { StatsPage } from './src/ui/StatsPage';
import { PlayerAvatar } from './src/ui/PlayerAvatar';
import { focusAccessibilityTarget } from './src/ui/accessibilityFocus';
import { Pressable } from './src/ui/Pressable';
import { useReducedMotion } from './src/ui/useReducedMotion';
import {
  buildExtraRollActionPayload,
  buildRollActionPayload,
  buildSuckerPunchActionPayload,
  type SuckerStatAction,
  type SuckerStatTurn,
} from './shared/stats';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type ScoreFlyDie = {
  face: DieValue;
  fromX: number;
  fromY: number;
  id: string;
  progress: Animated.Value;
  size: number;
  toX: number;
  toY: number;
};
type ScoreFlyNumber = {
  fromX: number;
  fromY: number;
  id: string;
  progress: Animated.Value;
  toX: number;
  toY: number;
  value: number;
};
type OpponentTurnReveal = {
  dice: ReturnType<typeof createGame>['dice'];
  dieSize: number;
  gap: number;
  id: string;
  categoryLabel: string;
  playerName: string;
  score: number;
  progress: Animated.Value;
  top: number;
};

const GameLayoutContext = createContext<GameLayout | null>(null);

function useGameLayout() {
  const layout = useContext(GameLayoutContext);
  if (!layout) {
    throw new Error('Game layout components must be rendered inside GameLayoutContext.');
  }

  return layout;
}
function concealActiveOpponentDice(game: GameState, myProfileId?: string | null): GameState {
  const currentPlayerId = game.players[game.currentPlayerIndex]?.id;
  if (!myProfileId || game.phase === 'complete' || currentPlayerId === myProfileId || game.rollNumber === 0) {
    return game;
  }

  return {
    ...game,
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollNumber: 0,
    phase: 'rolling',
  };
}

function buildRemoteGameBeforeTurn(game: GameState, turn: RemoteTurnRow): GameState | null {
  const scorerIndex = game.players.findIndex((player) => player.id === turn.player_id);
  if (scorerIndex < 0) {
    return null;
  }

  return {
    ...game,
    currentPlayerIndex: scorerIndex,
    dice: turn.dice,
    held: turn.held,
    phase: 'scoring',
    players: game.players.map((player, index) =>
      index === scorerIndex
        ? {
            ...player,
            scorecard: {
              ...player.scorecard,
              [turn.category]: null,
            },
            suckerBonusCategories: (player.suckerBonusCategories ?? []).filter(
              (category) => category !== turn.category,
            ),
          }
        : player,
    ),
    rollNumber: turn.roll_count,
  };
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
type ComputerStatsSnapshot = Awaited<ReturnType<typeof getComputerStats>>;
type HeadToHeadStatsSnapshot = Awaited<ReturnType<typeof getHeadToHeadStats>>;
type RemoteSuckerPunchResult = {
  game: ReturnType<typeof createGame> | null;
  outcome?: SuckerPunchOutcome | null;
};
type LocalPlayerProfile = {
  avatarUrl: string | null;
  displayName: string;
};
type SuckerPunchDialogState = {
  outcome?: SuckerPunchOutcome;
  phase: 'ready' | 'rolling' | 'rolled' | 'throwing' | 'result';
  scope: 'local' | 'remote';
  targetTurnId: string;
};
type SuckerBlockedNotice = {
  remoteRevealTurnId?: string;
  text: string;
  title: string;
};
type SuckerPunchWipe = {
  category: ScoreCategory;
  playerId: string;
  progress: Animated.Value;
  score: number;
  turnId: string;
};
type RemoteBlockedPunchRevealGate = {
  status: 'checking' | 'clear' | 'showing';
  turnId: string;
};
type RemoteActionHandlers = {
  onExtraRoll: (held: GameState['held']) => Promise<ReturnType<typeof createGame> | null>;
  onRematch: () => Promise<ReturnType<typeof createGame> | null>;
  onRoll: (held: GameState['held']) => Promise<ReturnType<typeof createGame> | null>;
  onScore: (category: ScoreCategory, held: GameState['held']) => Promise<ReturnType<typeof createGame> | null>;
  onScratch: (category: ScoreCategory, held: GameState['held']) => Promise<ReturnType<typeof createGame> | null>;
  onSuckerPunch: (turnId: string, chanceDie: DieValue) => Promise<RemoteSuckerPunchResult | null>;
};
type RemoteGameRequest = {
  gameId: string;
  requestId: number;
};
type NextTurnPrompt = {
  gameId: string;
  gameUpdatedAt: string;
  isGameListReady: boolean;
};
let remoteGameRequestId = 0;
const playerNames = ['You', 'Computer'];
const upperCategories: ScoreCategory[] = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const lowerCategories: ScoreCategory[] = [
  'threeOfAKind',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'sucker',
  'chance',
];

const suckerScorecardWordmarkImage = require('./assets/sucker-scorecard-wordmark.png');
const suckerLobbyHeaderImage = require('./assets/sucker-lobby-header.png');
const suckerGameBannerImage = require('./assets/sucker-game-header-clean.png');
const gameFontBlack = 'Inter_900Black';
const gameFontExtraBold = 'Inter_800ExtraBold';
const gameMaxFontSizeMultiplier = 1.2;
const usesLegacyAndroidShadowFallback = Platform.OS === 'android' && Platform.Version < 28;
const suckerTokenImage = require('./assets/sucker-token.png');
const suckerPunchLandedImage = require('./assets/sucker-punch-landed.png');
const suckerPunchBlockedImage = require('./assets/sucker-punch-blocked.png');

const backgroundDiePositions = [
  { left: 22, top: 8 },
  { right: 28, top: 18 },
  { left: 38, bottom: 18 },
  { right: 46, bottom: 10 },
  { left: '46%', top: 78 },
  { right: 10, top: '56%' },
] as const;

const computerThinkingDelayMs = 2400;
const computerScorePreviewDelayMs = 0;
const computerScoreRevealDurationMs = 520;
const computerScoreRevealPauseMs = 2000;
const computerScoreAnimationDurationMs = 950;
const suckerBlockedNoticeDurationMs = 1700;
const suckerPunchNoticeDurationMs = 1700;
const suckerPunchScoreWipeDelayMs = 240;
const suckerPunchScoreWipeDurationMs = 1250;
const remoteRollServerHeadStartMs = 80;
const rollFinalFaceHoldMs = 120;
const sectionBonusAfterScoreDelayMs = 160;
const sectionBonusAnimationDurationMs = 760;
const backSwipeEdgeWidth = 28;
const backSwipeTriggerDistance = 76;
const backSwipeMinimumMove = 18;
const backSwipeVelocity = 0.45;
const nextTurnDialogDelayMs = 1000;
const nextTurnListRefreshMs = 5000;
const upperBonusTarget = 63;
const bonusValueColor = '#5A1308';
const bonusFlashColor = '#8F0000';
const awardedBonusColor = bonusValueColor;
const bonusOutlineColor = '#5A1308';
const awardedBonusOutlineColor = bonusOutlineColor;
const bonusOutlineOffsets = [
  { x: -2, y: 0 },
  { x: 2, y: 0 },
  { x: 0, y: -2 },
  { x: 0, y: 2 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
  { x: 2, y: 2 },
];
const disableE2EAnimations = process.env.EXPO_PUBLIC_E2E_DISABLE_ANIMATIONS === '1';
type DevViewportPresetSelection = GameViewportPresetKey | 'responsive';

function getWebLocation() {
  if (Platform.OS !== 'web') {
    return null;
  }

  return (globalThis as { location?: Location }).location ?? null;
}

function getWebHistory() {
  if (Platform.OS !== 'web') {
    return null;
  }

  return (globalThis as { history?: History }).history ?? null;
}

function getDevViewportPreset(key: DevViewportPresetSelection) {
  return gameViewportPresets.find((preset) => preset.key === key) ?? null;
}

function getInitialDevViewportPresetKey(): DevViewportPresetSelection {
  const location = getWebLocation();
  const viewportKey = new URLSearchParams(location?.search ?? '').get('viewport');

  return gameViewportPresets.some((preset) => preset.key === viewportKey)
    ? (viewportKey as GameViewportPresetKey)
    : 'responsive';
}

function isWebDevViewportControlsEnabled() {
  const location = getWebLocation();

  return new URLSearchParams(location?.search ?? '').get('presets') === '1';
}

function replaceWebDevViewportPreset(key: DevViewportPresetSelection) {
  const location = getWebLocation();
  const history = getWebHistory();

  if (!location || !history) {
    return;
  }

  const params = new URLSearchParams(location.search);
  params.set('presets', '1');

  if (key === 'responsive') {
    params.delete('viewport');
  } else {
    params.set('viewport', key);
  }

  const search = params.toString();
  history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
}

function shouldShowNextTurnsAfterAction(game: RemoteGameRow, profileId: string) {
  return game.status !== 'complete' && game.current_player_id !== profileId;
}

function shouldDismissNextTurnPrompt(prompt: NextTurnPrompt, game: RemoteGameRow, profileId: string) {
  return (
    game.id === prompt.gameId &&
    new Date(game.updated_at).getTime() > new Date(prompt.gameUpdatedAt).getTime() &&
    !shouldShowNextTurnsAfterAction(game, profileId)
  );
}

function getNextTurnGames(games: RemoteGameRow[], profileId: string, currentGameId: string) {
  return games
    .filter(
      (game) =>
        game.id !== currentGameId &&
        game.current_player_id === profileId &&
        game.status !== 'complete' &&
        game.status !== 'inviting',
    )
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
}

export function RemoteGameScreen({
  gameId,
  games,
  gamesProfileId,
  onExit,
  onGameChange,
  onRefreshGames,
}: {
  gameId: string;
  games: RemoteGameRow[];
  gamesProfileId: string | null;
  onExit: () => void;
  onGameChange: (profileId: string, game: RemoteGameRow) => void;
  onRefreshGames: (profileId: string) => Promise<RemoteGameRow[]>;
}) {
  const { height: windowHeight, width: windowWidth } = useKeyboardStableWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const remoteStageStyle = getSafeGameStageStyle(windowWidth, windowHeight, safeAreaInsets, {
    fillNarrowViewport: Platform.OS !== 'web',
  });
  const remoteStageViewportWidth = Math.max(1, windowWidth - safeAreaInsets.left - safeAreaInsets.right);
  const remoteStageViewportHeight = Math.max(1, windowHeight - safeAreaInsets.top - safeAreaInsets.bottom);
  const remoteNeedsScrollableStage =
    Platform.OS === 'web' &&
    (remoteStageStyle.width > remoteStageViewportWidth || remoteStageStyle.height > remoteStageViewportHeight);
  const remoteStableHostStyle = Platform.OS === 'web' ? { minHeight: windowHeight, minWidth: windowWidth } : null;
  const isAppActive = useAppActivity();
  const [activeGameId, setActiveGameId] = useState(gameId);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [remoteGame, setRemoteGame] = useState<RemoteGameRow | null>(null);
  const [remoteLastTurn, setRemoteLastTurn] = useState<RemoteTurnRow | null>(null);
  const [remoteLastTurnLoadFailedId, setRemoteLastTurnLoadFailedId] = useState<string | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRemoteBusy, setIsRemoteBusy] = useState(false);
  const [nextTurnPrompt, setNextTurnPrompt] = useState<NextTurnPrompt | null>(null);
  const wasAppActive = useRef(isAppActive);
  const profileIdRef = useRef<string | null>(null);
  const activeGameIdRef = useRef(activeGameId);
  const nextTurnGames =
    nextTurnPrompt?.isGameListReady && profileId && gamesProfileId === profileId
      ? getNextTurnGames(games, profileId, nextTurnPrompt.gameId)
      : null;
  const isNextTurnPromptReady = Boolean(nextTurnPrompt?.isGameListReady);

  const syncRemoteGameList = useCallback(
    async (profileId: string) => {
      const games = await onRefreshGames(profileId);
      await syncAppBadgeCount(countGamesAwaitingTurn(games, profileId));
      return games;
    },
    [onRefreshGames],
  );

  const syncRemoteBadgeCount = useCallback(
    async (profileId: string) => {
      try {
        await syncRemoteGameList(profileId);
      } catch (badgeError) {
        console.warn('Unable to refresh app badge count', badgeError);
      }
    },
    [syncRemoteGameList],
  );

  useEffect(() => {
    activeGameIdRef.current = activeGameId;
  }, [activeGameId]);

  useEffect(() => {
    if (
      !nextTurnPrompt ||
      !remoteGame ||
      !profileId ||
      !shouldDismissNextTurnPrompt(nextTurnPrompt, remoteGame, profileId)
    ) {
      return;
    }

    setNextTurnPrompt(null);
  }, [nextTurnPrompt, profileId, remoteGame]);

  useEffect(() => {
    let isMounted = true;

    async function loadRemoteGame() {
      setIsLoading(true);
      setError(null);
      try {
        const [{ data: userData, error: userError }, nextGame] = await Promise.all([
          supabase.auth.getUser(),
          getGame(activeGameId),
        ]);
        if (userError) {
          throw userError;
        }
        if (!userData.user) {
          throw new Error('Sign in again to open this game.');
        }
        if (!isMounted) {
          return;
        }

        profileIdRef.current = userData.user.id;
        setProfileId(userData.user.id);
        setRemoteGame(nextGame);
        onGameChange(userData.user.id, nextGame);
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load game.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadRemoteGame();
    const unsubscribe = subscribeToGame(
      activeGameId,
      (nextGame) => {
        if (isMounted) {
          setRemoteGame(nextGame);
          if (profileIdRef.current) {
            onGameChange(profileIdRef.current, nextGame);
          }
        }
      },
      (status) => {
        if (isMounted) {
          setIsRealtimeConnected(status === 'SUBSCRIBED');
        }
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [activeGameId, onGameChange]);

  useEffect(() => {
    let isMounted = true;
    const turnId = remoteGame?.last_turn_id;
    if (!turnId) {
      setRemoteLastTurn(null);
      setRemoteLastTurnLoadFailedId(null);
      return;
    }

    void getTurn(turnId)
      .then((turn) => {
        if (isMounted) {
          setRemoteLastTurnLoadFailedId(null);
          setRemoteLastTurn(turn);
        }
      })
      .catch((turnError) => {
        if (isMounted) {
          setError(turnError instanceof Error ? turnError.message : 'Unable to load latest turn.');
          setRemoteLastTurnLoadFailedId(turnId);
          setRemoteLastTurn(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [remoteGame?.last_turn_id]);

  useEffect(() => {
    if (!remoteGame || isRealtimeConnected || !isAppActive) {
      return;
    }

    const interval = setInterval(() => {
      void getGame(activeGameId)
        .then((nextGame) => {
          setRemoteGame(nextGame);
          if (profileIdRef.current) {
            onGameChange(profileIdRef.current, nextGame);
          }
        })
        .catch((pollError) => {
          setError(pollError instanceof Error ? pollError.message : 'Unable to refresh game.');
        });
    }, 2500);

    return () => clearInterval(interval);
  }, [activeGameId, isAppActive, isRealtimeConnected, onGameChange, remoteGame]);

  useEffect(() => {
    const wasActive = wasAppActive.current;
    wasAppActive.current = isAppActive;

    if (!remoteGame || !isAppActive || wasActive) {
      return;
    }

    let isCurrent = true;
    void getGame(activeGameId)
      .then((nextGame) => {
        if (!isCurrent) {
          return;
        }

        setError(null);
        setRemoteGame(nextGame);
        if (profileId) {
          onGameChange(profileId, nextGame);
          void syncRemoteBadgeCount(profileId);
        }
      })
      .catch((refreshError) => {
        if (isCurrent) {
          setError(refreshError instanceof Error ? refreshError.message : 'Unable to refresh game.');
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [activeGameId, isAppActive, onGameChange, profileId, remoteGame, syncRemoteBadgeCount]);

  useEffect(() => {
    if (!profileId || !isAppActive || !isNextTurnPromptReady) {
      return;
    }

    const activeProfileId = profileId;
    let isCurrent = true;
    let isRefreshRunning = false;

    async function refreshNextTurnGames() {
      if (isRefreshRunning) {
        return;
      }

      isRefreshRunning = true;
      try {
        await syncRemoteGameList(activeProfileId);
      } catch (refreshError) {
        if (isCurrent) {
          console.warn('Unable to refresh next turns', refreshError);
        }
      } finally {
        isRefreshRunning = false;
      }
    }

    void refreshNextTurnGames();
    const unsubscribe = subscribeToGameListChanges(() => void refreshNextTurnGames());
    const timer = setInterval(() => void refreshNextTurnGames(), nextTurnListRefreshMs);

    return () => {
      isCurrent = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, [isAppActive, isNextTurnPromptReady, profileId, syncRemoteGameList]);

  async function runRemoteAction(
    action: () => Promise<{ game: RemoteGameRow }>,
    { showNextTurns = true }: { showNextTurns?: boolean } = {},
  ) {
    const result = await runRemoteActionResult(action, { showNextTurns });
    return result?.game.state ?? null;
  }

  async function runRemoteActionResult<Result extends { game: RemoteGameRow }>(
    action: () => Promise<Result>,
    { showNextTurns = true }: { showNextTurns?: boolean } = {},
  ) {
    setIsRemoteBusy(true);
    setError(null);
    try {
      const result = await action();
      setRemoteGame(result.game);
      if (profileId) {
        onGameChange(profileId, result.game);
        if (showNextTurns && shouldShowNextTurnsAfterAction(result.game, profileId)) {
          void prepareNextTurnPrompt(profileId, result.game);
        } else {
          setNextTurnPrompt(null);
          void syncRemoteGameList(profileId);
        }
      }
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to update game.');
      return null;
    } finally {
      setIsRemoteBusy(false);
    }
  }

  async function prepareNextTurnPrompt(profileId: string, completedGame: RemoteGameRow) {
    const prompt: NextTurnPrompt = {
      gameId: completedGame.id,
      gameUpdatedAt: completedGame.updated_at,
      isGameListReady: false,
    };
    setNextTurnPrompt(prompt);
    try {
      const games = await syncRemoteGameList(profileId);
      const refreshedGame = games.find((game) => game.id === prompt.gameId);
      if (activeGameIdRef.current !== prompt.gameId) {
        return;
      }

      if (!refreshedGame || shouldDismissNextTurnPrompt(prompt, refreshedGame, profileId)) {
        setNextTurnPrompt(null);
        return;
      }

      setNextTurnPrompt({ ...prompt, isGameListReady: true });
    } catch (promptError) {
      console.warn('Unable to load next turns', promptError);
      setNextTurnPrompt(null);
    }
  }

  function openNextTurnGame(nextGameId: string) {
    setNextTurnPrompt(null);
    setError(null);
    setIsLoading(true);
    setRemoteGame(null);
    setRemoteLastTurn(null);
    setRemoteLastTurnLoadFailedId(null);
    setActiveGameId(nextGameId);
  }

  function exitToLobby() {
    setNextTurnPrompt(null);
    onExit();
  }

  if (isLoading || !remoteGame || !profileId) {
    const loadingStage = (
      <View style={[styles.remoteLoadingScreen, remoteStageStyle]} testID="remote-loading-screen">
        <Text maxFontSizeMultiplier={gameMaxFontSizeMultiplier} style={styles.remoteLoadingTitle}>
          Loading Game
        </Text>
        {error && (
          <Text maxFontSizeMultiplier={gameMaxFontSizeMultiplier} style={styles.remoteMessage}>
            {error}
          </Text>
        )}
        <Pressable
          accessibilityLabel="Back to games"
          accessibilityRole="button"
          onPress={onExit}
          style={({ pressed }) => [styles.remoteBackButton, pressed && styles.pressed]}
        >
          <Text maxFontSizeMultiplier={gameMaxFontSizeMultiplier} style={styles.remoteBackButtonText}>
            Back
          </Text>
        </Pressable>
      </View>
    );

    return (
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={[styles.safeArea, remoteStableHostStyle]}>
        <StatusBar style="light" />
        {remoteNeedsScrollableStage ? (
          <View style={styles.gameStageScroll} testID="remote-loading-stage-scroll">
            <View
              style={[
                styles.gameStageScrollContent,
                { minHeight: remoteStageStyle.height, minWidth: remoteStageStyle.width },
              ]}
            >
              {loadingStage}
            </View>
          </View>
        ) : (
          loadingStage
        )}
      </SafeAreaView>
    );
  }

  const handlers: RemoteActionHandlers = {
    onExtraRoll: (held) => runRemoteAction(() => buyRemoteExtraRoll(remoteGame.id, held)),
    onRematch: async () => {
      return runRemoteAction(
        async () => {
          const result = await createRematch(remoteGame.id);
          setActiveGameId(result.game.id);
          return result;
        },
        { showNextTurns: false },
      );
    },
    onRoll: (held) => runRemoteAction(() => rollRemoteGame(remoteGame.id, held)),
    onScore: (category, held) => runRemoteAction(() => scoreRemoteCategory(remoteGame.id, category, held)),
    onScratch: (category, held) => runRemoteAction(() => scratchRemoteCategory(remoteGame.id, category, held)),
    onSuckerPunch: async (turnId, chanceDie) => {
      const result = await runRemoteActionResult(() => useRemoteSuckerPunch(remoteGame.id, turnId, chanceDie));
      return result ? { game: result.game.state, outcome: result.suckerPunchOutcome ?? null } : null;
    },
  };

  return (
    <LocalGameScreen
      isRemoteBusy={isRemoteBusy}
      myProfileId={profileId}
      nextTurnGames={nextTurnGames}
      onDismissNextTurns={() => setNextTurnPrompt(null)}
      onExit={exitToLobby}
      onOpenNextTurnGame={openNextTurnGame}
      remoteError={error}
      remoteGame={remoteGame.state}
      remoteHandlers={handlers}
      remoteLastTurn={remoteLastTurn}
      remoteLastTurnLoadFailedId={remoteLastTurnLoadFailedId}
      remoteLastTurnId={remoteGame.last_turn_id}
      remoteStatus={remoteGame.status}
    />
  );
}

export function LocalGameScreen({
  isRemoteBusy = false,
  localPlayerAvatarUrl,
  localPlayerName,
  myProfileId,
  nextTurnGames,
  onDismissNextTurns,
  onExit,
  onOpenNextTurnGame,
  remoteError,
  remoteGame,
  remoteHandlers,
  remoteLastTurn,
  remoteLastTurnLoadFailedId,
  remoteLastTurnId,
  remoteStatus,
}: {
  isRemoteBusy?: boolean;
  localPlayerAvatarUrl?: string | null;
  localPlayerName?: string;
  myProfileId?: string;
  nextTurnGames?: RemoteGameRow[] | null;
  onDismissNextTurns?: () => void;
  onExit?: () => void;
  onOpenNextTurnGame?: (gameId: string) => void;
  remoteError?: string | null;
  remoteGame?: ReturnType<typeof createGame>;
  remoteHandlers?: RemoteActionHandlers;
  remoteLastTurn?: RemoteTurnRow | null;
  remoteLastTurnLoadFailedId?: string | null;
  remoteLastTurnId?: string | null;
  remoteStatus?: RemoteGameStatus;
}) {
  const { height: windowHeight, width: windowWidth } = useKeyboardStableWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const [devViewportPresetKey, setDevViewportPresetKey] =
    useState<DevViewportPresetSelection>(getInitialDevViewportPresetKey);
  const localPlayerNames = [localPlayerName?.trim() || playerNames[0], playerNames[1]];
  const [localGame, setLocalGame] = useState(() => createGame(localPlayerNames));
  const [localPendingTurn, setLocalPendingTurn] = useState<LocalPendingTurn | null>(null);
  const [showSuckerPunchNotice, setShowSuckerPunchNotice] = useState(false);
  const [suckerPunchWipe, setSuckerPunchWipe] = useState<SuckerPunchWipe | null>(null);
  const [suckerBlockedNotice, setSuckerBlockedNotice] = useState<SuckerBlockedNotice | null>(null);
  const [remoteBlockedPunchRevealGate, setRemoteBlockedPunchRevealGate] = useState<RemoteBlockedPunchRevealGate | null>(
    null,
  );
  const [suckerRollNoticeTitle, setSuckerRollNoticeTitle] = useState<string | null>(null);
  const [suckerPunchDialog, setSuckerPunchDialog] = useState<SuckerPunchDialogState | null>(null);
  const [suckerPunchChanceFace, setSuckerPunchChanceFace] = useState<DieValue>(1);
  const isRemoteGame = Boolean(remoteGame && remoteHandlers && myProfileId);
  const [visibleRemoteGame, setVisibleRemoteGame] = useState(
    remoteGame ? concealActiveOpponentDice(remoteGame, myProfileId) : null,
  );
  const [isRolling, setIsRolling] = useState(false);
  const [isAwaitingRemoteRoll, setIsAwaitingRemoteRoll] = useState(false);
  const [isComputerThinking, setIsComputerThinking] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showStatsPage, setShowStatsPage] = useState(false);
  const [isTokenMenuOpen, setIsTokenMenuOpen] = useState(false);
  const [dismissedGameOverId, setDismissedGameOverId] = useState<string | null>(null);
  const [computerStats, setComputerStats] = useState<ComputerStatsSnapshot>(null);
  const [headToHeadStats, setHeadToHeadStats] = useState<HeadToHeadStatsSnapshot | null>(null);
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string | null>>({});
  const [rollingFaces, setRollingFaces] = useState<DieValue[]>([1, 1, 1, 1, 1]);
  const [rollingDieIndexes, setRollingDieIndexes] = useState<number[]>([]);
  const [rollingLaunches, setRollingLaunches] = useState<Partial<Record<number, RollingLaunch>>>({});
  const [selectedCategory, setSelectedCategory] = useState<ScoreCategory | null>(null);
  const [isChoosingSuckerDeal, setIsChoosingSuckerDeal] = useState(false);
  const [highlightCategory, setHighlightCategory] = useState<ScoreCategory | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [isNextTurnsDelayComplete, setIsNextTurnsDelayComplete] = useState(false);
  const [scoreFlyDice, setScoreFlyDice] = useState<ScoreFlyDie[]>([]);
  const [scoreFlyNumber, setScoreFlyNumber] = useState<ScoreFlyNumber | null>(null);
  const [opponentTurnReveal, setOpponentTurnReveal] = useState<OpponentTurnReveal | null>(null);
  const isAppActive = useAppActivity();
  const prefersReducedMotion = useReducedMotion();
  const shouldReduceMotion = disableE2EAnimations || prefersReducedMotion;
  const [revealingRemoteTurnId, setRevealingRemoteTurnId] = useState<string | null>(null);
  const screenRef = useRef<ViewRef | null>(null);
  const menuButtonRef = useRef<ViewRef | null>(null);
  const gameOverStatsButtonRef = useRef<ViewRef | null>(null);
  const statsReturnFocusTarget = useRef<'gameOver' | 'menu'>('menu');
  const boardRef = useRef<ViewRef | null>(null);
  const rollZoneRef = useRef<ViewRef | null>(null);
  const dieSlotRefs = useRef<(ViewRef | null)[]>([]);
  const scoreBoxRefs = useRef<Partial<Record<ScoreCategory, ViewRef | null>>>({});
  const opponentScoreRefs = useRef<Partial<Record<ScoreCategory, ViewRef | null>>>({});
  const recordedComputerGameIds = useRef<Set<string>>(new Set());
  const localSuckerStatActions = useRef<SuckerStatAction[]>([]);
  const localSuckerStatTurns = useRef<SuckerStatTurn[]>([]);
  const lastRemotePunchNoticeId = useRef<string | null>(null);
  const lastRemoteBlockedPunchNoticeId = useRef<string | null>(null);
  const remoteBlockedPunchRevealCheckTurnId = useRef<string | null>(null);
  const lastAnimatedRemoteScoreTurnId = useRef<string | null>(null);
  const suckerRollNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suckerPunchWipeStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRemoteTurnId = useRef<string | null>(null);
  const diceAnimations = useRef([...Array(5)].map(() => new Animated.Value(0))).current;
  const suckerPunchDieAnimation = useRef(new Animated.Value(0)).current;
  const suckerPunchResultCompletion = useRef<(() => void) | null>(null);
  const bgFloat = useRef(new Animated.Value(0)).current;
  const selectedPulse = useRef(new Animated.Value(0)).current;
  const sectionBonusPulse = useRef(new Animated.Value(0)).current;
  const previousHomeSectionBonusAwarded = useRef<boolean | null>(null);
  const backSwipeStartedAtEdge = useRef(false);
  const exitGame = useCallback(() => {
    setIsMenuOpen(false);
    setIsTokenMenuOpen(false);
    setShowStatsPage(false);
    setShowSuckerPunchNotice(false);
    clearSuckerPunchWipe();
    suckerPunchResultCompletion.current = null;
    setSuckerPunchDialog(null);
    onExit?.();
  }, [onExit]);
  const backSwipeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        backSwipeStartedAtEdge.current = Boolean(onExit && event.nativeEvent.locationX <= backSwipeEdgeWidth);
        return false;
      },
      onMoveShouldSetPanResponder: (_event, gestureState) => {
        if (!backSwipeStartedAtEdge.current) {
          return false;
        }

        const horizontalMove = gestureState.dx > backSwipeMinimumMove;
        const mostlyHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4;
        return horizontalMove && mostlyHorizontal;
      },
      onPanResponderRelease: (_event, gestureState) => {
        const shouldExit =
          gestureState.dx > backSwipeTriggerDistance ||
          (gestureState.dx > backSwipeMinimumMove && gestureState.vx > backSwipeVelocity);
        backSwipeStartedAtEdge.current = false;
        if (shouldExit) {
          exitGame();
        }
      },
      onPanResponderTerminate: () => {
        backSwipeStartedAtEdge.current = false;
      },
    }),
  ).current;
  const game = isRemoteGame ? (visibleRemoteGame ?? remoteGame ?? localGame) : localGame;
  const avatarProfileIdsKey = [
    ...new Set([
      ...game.players.map((player) => player.id),
      ...(nextTurnGames ?? []).flatMap((nextTurnGame) => nextTurnGame.state.players.map((player) => player.id)),
    ]),
  ]
    .filter(Boolean)
    .sort()
    .join(',');
  const liveGameRef = useRef(game);
  const myPlayerIndex = isRemoteGame
    ? Math.max(
        0,
        game.players.findIndex((player) => player.id === myProfileId),
      )
    : 0;
  const opponentPlayerIndex = game.players.findIndex((_, index) => index !== myPlayerIndex);
  const currentPlayer = game.players[game.currentPlayerIndex] ?? game.players[0];
  const pendingTurn = isRemoteGame ? null : localPendingTurn;
  const isMyRemoteTurn = !isRemoteGame || currentPlayer.id === myProfileId;
  const isRemoteResponseTurn =
    isRemoteGame && isMyRemoteTurn && (remoteStatus === 'response_window' || remoteStatus === 'blocked_response');
  const isRemoteActionPlayable = !isRemoteGame || remoteStatus === 'active' || isRemoteResponseTurn;
  const isRemoteTurnRevealPending = Boolean(
    isRemoteGame &&
    remoteLastTurnId &&
    visibleRemoteTurnId.current !== remoteLastTurnId &&
    remoteLastTurnLoadFailedId !== remoteLastTurnId,
  );
  const isComputerTurn = !isRemoteGame && game.currentPlayerIndex === computerPlayerIndex && game.phase !== 'complete';
  const openCategories = availableCategories(currentPlayer.scorecard);
  const canRollVisually =
    game.phase !== 'complete' &&
    game.rollNumber < maxAvailableRolls(game) &&
    !isComputerTurn &&
    isMyRemoteTurn &&
    isRemoteActionPlayable &&
    !isRemoteTurnRevealPending &&
    !suckerPunchDialog;
  const isRemoteInteractionPending = isRemoteBusy || isAwaitingRemoteRoll;
  const canRoll = canRollVisually && !isRolling && !isScoring && !isRemoteInteractionPending;
  const homePlayer = game.players[myPlayerIndex] ?? game.players[0];
  const opponentPlayer =
    game.players[opponentPlayerIndex] ?? game.players.find((player) => player.id !== homePlayer.id) ?? game.players[1];
  const displayPlayers = [homePlayer, opponentPlayer];
  const activePlayerViewIndex = currentPlayer.id === homePlayer.id ? 0 : 1;
  const canPlaySelected =
    selectedCategory !== null &&
    !isChoosingSuckerDeal &&
    game.rollNumber > 0 &&
    !isRolling &&
    !isScoring &&
    !isComputerTurn &&
    isMyRemoteTurn &&
    isRemoteActionPlayable &&
    !isRemoteInteractionPending &&
    !suckerPunchDialog;
  const canOpenTokenMenu =
    game.phase !== 'complete' &&
    !isRolling &&
    !isScoring &&
    !isComputerTurn &&
    isMyRemoteTurn &&
    !isRemoteTurnRevealPending &&
    !isRemoteInteractionPending &&
    !suckerPunchDialog;
  const myTokenCount = homePlayer.suckerTokens;
  const canUseLocalExtraRoll = !isRemoteGame && canOpenTokenMenu && myTokenCount >= suckerTokenCosts.extraRoll;
  const canUseRemoteExtraRoll =
    isRemoteGame && canOpenTokenMenu && isRemoteActionPlayable && myTokenCount >= suckerTokenCosts.extraRoll;
  const canUseLocalMulligan = !isRemoteGame && canOpenTokenMenu && myTokenCount >= suckerTokenCosts.mulligan;
  const canStartSuckerDeal = canOpenTokenMenu && openCategories.length > 0 && isRemoteActionPlayable;
  const isLocalPendingTurnPunchable = Boolean(pendingTurn);
  const isRemoteLastTurnPunchable = Boolean(remoteLastTurn);
  const canUseLocalSuckerPunch =
    !isRemoteGame &&
    canOpenTokenMenu &&
    pendingTurn?.status === 'submitted' &&
    isLocalPendingTurnPunchable &&
    pendingTurn.responderIndex === myPlayerIndex &&
    pendingTurn.scorerIndex !== myPlayerIndex &&
    myTokenCount >= suckerTokenCosts.suckerPunch;
  const canUseRemoteSuckerPunch =
    isRemoteGame &&
    canOpenTokenMenu &&
    remoteStatus === 'response_window' &&
    Boolean(remoteLastTurnId) &&
    isRemoteLastTurnPunchable &&
    myTokenCount >= suckerTokenCosts.suckerPunch;
  const devViewportPreset = getDevViewportPreset(devViewportPresetKey);
  const effectiveWindowWidth = devViewportPreset?.width ?? windowWidth;
  const effectiveWindowHeight = devViewportPreset?.height ?? windowHeight;
  const effectiveSafeAreaInsets = devViewportPreset?.insets ?? safeAreaInsets;
  const gameStageStyle = getSafeGameStageStyle(effectiveWindowWidth, effectiveWindowHeight, effectiveSafeAreaInsets, {
    // Device presets model native safe-area layouts inside a browser. Normal
    // web windows keep one aspect ratio and use the stage scroller when short.
    fillNarrowViewport: Platform.OS !== 'web' || Boolean(devViewportPreset),
  });
  const gameLayout = useMemo(
    () => createGameLayout(gameStageStyle.width, gameStageStyle.height),
    [gameStageStyle.height, gameStageStyle.width],
  );
  const devViewportStageOffset =
    Platform.OS === 'web' && devViewportPreset
      ? {
          transform: [
            { translateX: (effectiveSafeAreaInsets.left - effectiveSafeAreaInsets.right) / 2 },
            { translateY: (effectiveSafeAreaInsets.top - effectiveSafeAreaInsets.bottom) / 2 },
          ],
        }
      : null;
  const stableScreenHostStyle =
    Platform.OS === 'web' ? { minHeight: effectiveWindowHeight, minWidth: effectiveWindowWidth } : null;
  const showDevViewportControls = isWebDevViewportControlsEnabled();
  const diceTrayGap = gameLayout.unit(2);
  const diceTrayHorizontalPadding = gameLayout.unit(16);
  const diceTrayAvailableWidth = Math.max(1, gameStageStyle.width - diceTrayHorizontalPadding);
  const diceSlotSize = Math.max(1, Math.min(gameLayout.unit(76), (diceTrayAvailableWidth - diceTrayGap * 4) / 5));
  const standardRollsLeft = rollsRemaining(game);
  const homeUpperTotal = upperSectionTotal(homePlayer.scorecard);
  const opponentUpperTotal = upperSectionTotal(opponentPlayer.scorecard);
  const homeSectionBonusAwarded = homeUpperTotal >= upperBonusTarget;
  const homeScore = totalScore(homePlayer.scorecard);
  const opponentScore = totalScore(opponentPlayer.scorecard);
  const isGameOver = game.phase === 'complete';
  const gameOverVisible = isGameOver && dismissedGameOverId !== game.id;
  const hasNextTurnPrompt = nextTurnGames !== null && nextTurnGames !== undefined;
  const nextTurnsVisible = Boolean(
    isRemoteGame && hasNextTurnPrompt && isNextTurnsDelayComplete && !isRolling && !isScoring && !gameOverVisible,
  );
  const winnerName =
    homeScore === opponentScore ? null : homeScore > opponentScore ? homePlayer.name : opponentPlayer.name;
  const gameOverTitle = winnerName ? (winnerName === 'You' ? 'You win!' : `${winnerName} wins!`) : 'Tie game!';
  const remoteOpponentTurnNeedsReveal = Boolean(
    isRemoteGame &&
    remoteGame &&
    remoteLastTurn &&
    remoteLastTurn.id === remoteLastTurnId &&
    remoteLastTurn.player_id !== myProfileId &&
    revealingRemoteTurnId !== remoteLastTurn.id &&
    visibleRemoteTurnId.current !== remoteLastTurn.id &&
    lastAnimatedRemoteScoreTurnId.current !== remoteLastTurn.id,
  );
  const shouldCheckRemoteBlockedPunchBeforeReveal = Boolean(
    isRemoteGame &&
    myProfileId &&
    remoteStatus === 'response_window' &&
    remoteGame &&
    remoteLastTurn &&
    remoteOpponentTurnNeedsReveal &&
    remoteLastTurn.player_id !== myProfileId &&
    remoteGame.players[remoteGame.currentPlayerIndex]?.id === myProfileId,
  );
  const isRemoteBlockedPunchRevealGateForTurn = Boolean(
    remoteBlockedPunchRevealGate && remoteLastTurn && remoteBlockedPunchRevealGate.turnId === remoteLastTurn.id,
  );
  const remoteBlockedPunchRevealGateStatus =
    isRemoteBlockedPunchRevealGateForTurn && remoteBlockedPunchRevealGate
      ? remoteBlockedPunchRevealGate.status
      : 'unchecked';
  const shouldHoldRemoteTurnRevealForBlockedPunch =
    shouldCheckRemoteBlockedPunchBeforeReveal && remoteBlockedPunchRevealGateStatus !== 'clear';
  const remoteNextTurnIsMine = Boolean(
    isRemoteGame &&
    remoteGame &&
    (remoteGame.phase === 'complete' || remoteGame.players[remoteGame.currentPlayerIndex]?.id === myProfileId),
  );
  const shouldHoldRemoteTurnReveal = Boolean(
    isRemoteGame &&
    remoteGame &&
    remoteNextTurnIsMine &&
    remoteLastTurnId &&
    visibleRemoteTurnId.current !== remoteLastTurnId &&
    remoteLastTurnLoadFailedId !== remoteLastTurnId &&
    (remoteStatus === 'active' || remoteStatus === 'response_window' || remoteStatus === 'complete') &&
    (!remoteLastTurn ||
      remoteLastTurn.id !== remoteLastTurnId ||
      remoteOpponentTurnNeedsReveal ||
      revealingRemoteTurnId === remoteLastTurnId),
  );
  const sectionBonusScale = sectionBonusPulse.interpolate({
    inputRange: [0, 0.28, 0.52, 0.76, 1],
    outputRange: [1, 2.45, 1.34, 1.1, 1],
  });
  const sectionBonusRotate = sectionBonusPulse.interpolate({
    inputRange: [0, 0.2, 0.4, 0.62, 0.82, 1],
    outputRange: ['0deg', '-7deg', '7deg', '-4deg', '3deg', '0deg'],
  });
  const sectionBonusColor = sectionBonusPulse.interpolate({
    inputRange: [0, 0.3, 0.58, 1],
    outputRange: [bonusValueColor, bonusFlashColor, bonusValueColor, awardedBonusColor],
  });

  useEffect(() => {
    liveGameRef.current = game;
  }, [game]);

  useEffect(() => {
    setIsNextTurnsDelayComplete(false);
    if (!hasNextTurnPrompt || isRolling || isScoring || gameOverVisible) {
      return;
    }

    const timer = setTimeout(() => setIsNextTurnsDelayComplete(true), nextTurnDialogDelayMs);
    return () => clearTimeout(timer);
  }, [gameOverVisible, hasNextTurnPrompt, isRolling, isScoring]);

  useEffect(() => {
    if (previousHomeSectionBonusAwarded.current === null) {
      sectionBonusPulse.setValue(homeSectionBonusAwarded ? 1 : 0);
      previousHomeSectionBonusAwarded.current = homeSectionBonusAwarded;
      return;
    }

    if (!homeSectionBonusAwarded) {
      sectionBonusPulse.setValue(0);
      previousHomeSectionBonusAwarded.current = false;
      return;
    }

    sectionBonusPulse.setValue(1);
    previousHomeSectionBonusAwarded.current = true;
  }, [homeSectionBonusAwarded, sectionBonusPulse]);

  useEffect(() => {
    if (shouldReduceMotion || !isAppActive) {
      return;
    }

    const loops: Animated.CompositeAnimation[] = [];

    if (Platform.OS !== 'web') {
      loops.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(bgFloat, {
              toValue: 1,
              duration: 5200,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(bgFloat, {
              toValue: 0,
              duration: 5200,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
    }

    if (Platform.OS !== 'web' && selectedCategory !== null) {
      loops.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(selectedPulse, {
              toValue: 1,
              duration: 620,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(selectedPulse, {
              toValue: 0,
              duration: 620,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
    } else {
      selectedPulse.setValue(0);
    }

    if (loops.length === 0) {
      bgFloat.setValue(0);
      return;
    }

    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [bgFloat, isAppActive, selectedCategory, selectedPulse, shouldReduceMotion]);

  useEffect(() => {
    return () => {
      if (suckerRollNoticeTimer.current) {
        clearTimeout(suckerRollNoticeTimer.current);
      }
      if (suckerPunchWipeStartTimer.current) {
        clearTimeout(suckerPunchWipeStartTimer.current);
      }
    };
  }, []);

  function showSuckerRollBanner(title: string) {
    if (suckerRollNoticeTimer.current) {
      clearTimeout(suckerRollNoticeTimer.current);
    }

    setSuckerRollNoticeTitle(title);
    suckerRollNoticeTimer.current = setTimeout(() => {
      setSuckerRollNoticeTitle(null);
      suckerRollNoticeTimer.current = null;
    }, 1250);
  }

  function createSuckerPunchWipe({ category, playerId, score, turnId }: Omit<SuckerPunchWipe, 'progress'>) {
    return {
      category,
      playerId,
      progress: new Animated.Value(0),
      score,
      turnId,
    };
  }

  function runSuckerPunchScoreWipe(wipe: SuckerPunchWipe) {
    if (suckerPunchWipeStartTimer.current) {
      clearTimeout(suckerPunchWipeStartTimer.current);
    }

    suckerPunchWipeStartTimer.current = setTimeout(() => {
      suckerPunchWipeStartTimer.current = null;
      requestAnimationFrame(() => {
        void runAnimation(
          Animated.timing(wipe.progress, {
            toValue: 1,
            duration: suckerPunchScoreWipeDurationMs,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ).then(() => {
          setSuckerPunchWipe((current) => (current?.turnId === wipe.turnId ? null : current));
        });
      });
    }, suckerPunchScoreWipeDelayMs);
  }

  function clearSuckerPunchWipe() {
    if (suckerPunchWipeStartTimer.current) {
      clearTimeout(suckerPunchWipeStartTimer.current);
      suckerPunchWipeStartTimer.current = null;
    }
    setSuckerPunchWipe(null);
  }

  function showSuckerPunchNoticeAndWipe(details: Omit<SuckerPunchWipe, 'progress'>) {
    setSuckerPunchWipe(createSuckerPunchWipe(details));
    setShowSuckerPunchNotice(true);
  }

  function showSuckerPunchScoreWipe(details: Omit<SuckerPunchWipe, 'progress'>) {
    const wipe = createSuckerPunchWipe(details);
    setSuckerPunchWipe(wipe);
    runSuckerPunchScoreWipe(wipe);
  }

  useEffect(() => {
    if (isRemoteGame) {
      return;
    }

    void refreshComputerStats();
  }, [isRemoteGame]);

  useEffect(() => {
    if (isRemoteGame) {
      return;
    }

    if (!isComputerTurn || isComputerThinking || isRolling || isScoring || opponentTurnReveal) {
      return;
    }

    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setIsComputerThinking(true);
    const timer = setTimeout(() => {
      const result = playComputerTurn(game, pendingTurn);
      void animateComputerTurnResult(result);
    }, computerThinkingDelayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [game, isComputerTurn, isRemoteGame, isRolling, isScoring, opponentTurnReveal, pendingTurn]);

  useEffect(() => {
    if (!showSuckerPunchNotice) {
      return;
    }

    const wipe = suckerPunchWipe;
    const timer = setTimeout(() => {
      setShowSuckerPunchNotice(false);
      if (!wipe) {
        return;
      }

      runSuckerPunchScoreWipe(wipe);
    }, suckerPunchNoticeDurationMs);
    return () => clearTimeout(timer);
  }, [showSuckerPunchNotice, suckerPunchWipe]);

  useEffect(() => {
    if (!suckerBlockedNotice) {
      return;
    }

    const notice = suckerBlockedNotice;
    const timer = setTimeout(() => {
      setSuckerBlockedNotice(null);
      const remoteRevealTurnId = notice.remoteRevealTurnId;
      if (remoteRevealTurnId) {
        setRemoteBlockedPunchRevealGate((current) =>
          current?.turnId === remoteRevealTurnId ? { status: 'clear', turnId: remoteRevealTurnId } : current,
        );
      }
    }, suckerBlockedNoticeDurationMs);
    return () => clearTimeout(timer);
  }, [suckerBlockedNotice]);

  useEffect(() => {
    if (
      !isRemoteGame ||
      !remoteLastTurnId ||
      !remoteLastTurn ||
      remoteLastTurn.id !== remoteLastTurnId ||
      remoteLastTurn.player_id !== myProfileId ||
      remoteLastTurn.status !== 'punched'
    ) {
      return;
    }

    if (lastRemotePunchNoticeId.current === remoteLastTurnId) {
      return;
    }

    lastRemotePunchNoticeId.current = remoteLastTurnId;
    showSuckerPunchNoticeAndWipe({
      category: remoteLastTurn.category,
      playerId: remoteLastTurn.player_id,
      score: remoteLastTurn.score,
      turnId: remoteLastTurn.id,
    });
  }, [isRemoteGame, myProfileId, remoteLastTurn, remoteLastTurnId, remoteStatus]);

  useEffect(() => {
    if (!shouldCheckRemoteBlockedPunchBeforeReveal || !myProfileId || !remoteGame || !remoteLastTurn) {
      return;
    }

    if (remoteBlockedPunchRevealCheckTurnId.current === remoteLastTurn.id) {
      return;
    }

    const revealTurnId = remoteLastTurn.id;
    remoteBlockedPunchRevealCheckTurnId.current = revealTurnId;
    setRemoteBlockedPunchRevealGate({ status: 'checking', turnId: revealTurnId });

    let isMounted = true;
    void getLatestRemoteBlockedSuckerPunch(remoteGame.id, myProfileId, remoteLastTurn.turn_index - 1)
      .then((blockedPunch) => {
        if (!isMounted) {
          return;
        }

        if (!blockedPunch || lastRemoteBlockedPunchNoticeId.current === blockedPunch.id) {
          setRemoteBlockedPunchRevealGate({ status: 'clear', turnId: revealTurnId });
          return;
        }

        lastRemoteBlockedPunchNoticeId.current = blockedPunch.id;
        setRemoteBlockedPunchRevealGate({ status: 'showing', turnId: revealTurnId });
        setSuckerBlockedNotice({
          remoteRevealTurnId: revealTurnId,
          text: 'Sucker Punch!',
          title: 'You blocked',
        });
      })
      .catch((blockedPunchError) => {
        console.warn('Unable to load blocked Sucker Punch notice', blockedPunchError);
        if (isMounted) {
          setRemoteBlockedPunchRevealGate({ status: 'clear', turnId: revealTurnId });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [myProfileId, remoteGame, remoteLastTurn, shouldCheckRemoteBlockedPunchBeforeReveal]);

  useEffect(() => {
    if (isRemoteGame) {
      return;
    }

    if (game.phase !== 'complete' || recordedComputerGameIds.current.has(game.id)) {
      return;
    }

    recordedComputerGameIds.current.add(game.id);
    void recordComputerGameResult(game, localSuckerStatActions.current, localSuckerStatTurns.current)
      .then((nextStats) => {
        if (nextStats) {
          setComputerStats(nextStats);
        }
      })
      .catch((statsError) => {
        console.warn('Unable to record computer stats', statsError);
      });
  }, [game, isRemoteGame]);

  useEffect(() => {
    if (!isRemoteGame || !opponentPlayer.id) {
      setHeadToHeadStats(null);
      return;
    }

    let isMounted = true;
    void getHeadToHeadStats(opponentPlayer.id)
      .then((nextStats) => {
        if (isMounted) {
          setHeadToHeadStats(nextStats);
        }
      })
      .catch((statsError) => {
        console.warn('Unable to load head-to-head stats', statsError);
        if (isMounted) {
          setHeadToHeadStats(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isRemoteGame, opponentPlayer.id, remoteLastTurnId, remoteStatus]);

  useEffect(() => {
    if (!isRemoteGame) {
      setPlayerAvatars({});
      return;
    }
    if (!isAppActive || !avatarProfileIdsKey) {
      return;
    }

    let isMounted = true;
    const profileIds = avatarProfileIdsKey.split(',');
    void getProfilesByIds(profileIds)
      .then((profiles) => {
        if (isMounted) {
          const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
          setPlayerAvatars(
            Object.fromEntries(
              profileIds.map((profileId) => [profileId, profilesById.get(profileId)?.avatar_url ?? null]),
            ),
          );
        }
      })
      .catch(() => {
        // Keep already loaded avatars visible through a transient profile error.
      });
    return () => {
      isMounted = false;
    };
  }, [avatarProfileIdsKey, isAppActive, isRemoteGame, remoteLastTurnId]);

  useEffect(() => {
    if (!isRemoteGame) {
      setVisibleRemoteGame(null);
      visibleRemoteTurnId.current = null;
      return;
    }

    if (
      !isAwaitingRemoteRoll &&
      !isRolling &&
      !isScoring &&
      !opponentTurnReveal &&
      remoteGame &&
      !shouldHoldRemoteTurnReveal
    ) {
      setVisibleRemoteGame(concealActiveOpponentDice(remoteGame, myProfileId));
      visibleRemoteTurnId.current = remoteLastTurnId ?? null;
    }
  }, [
    isAwaitingRemoteRoll,
    isRemoteGame,
    isRolling,
    isScoring,
    myProfileId,
    opponentTurnReveal,
    remoteGame,
    remoteLastTurnId,
    shouldHoldRemoteTurnReveal,
  ]);

  useEffect(() => {
    if (
      !remoteOpponentTurnNeedsReveal ||
      !remoteGame ||
      !remoteLastTurn ||
      isRolling ||
      isScoring ||
      opponentTurnReveal ||
      shouldHoldRemoteTurnRevealForBlockedPunch
    ) {
      return;
    }

    setRevealingRemoteTurnId(remoteLastTurn.id);
    void animateRemoteOpponentScoreTurn(remoteGame, remoteLastTurn);
  }, [
    isRolling,
    isScoring,
    opponentTurnReveal,
    remoteGame,
    remoteLastTurn,
    remoteOpponentTurnNeedsReveal,
    shouldHoldRemoteTurnRevealForBlockedPunch,
  ]);

  async function refreshComputerStats() {
    try {
      setComputerStats(await getComputerStats());
    } catch (statsError) {
      console.warn('Unable to load computer stats', statsError);
    }
  }

  async function refreshVisibleStats() {
    if (!isRemoteGame) {
      await refreshComputerStats();
      return;
    }

    try {
      setHeadToHeadStats(await getHeadToHeadStats(opponentPlayer.id));
    } catch (statsError) {
      console.warn('Unable to load head-to-head stats', statsError);
      setHeadToHeadStats(null);
    }
  }

  function recordLocalAction(action_type: SuckerStatAction['action_type'], actor_id: string, payload?: unknown) {
    localSuckerStatActions.current.push({ action_type, actor_id, payload });
  }

  function recordLocalScoreTurn(result: ComputerTurnResult) {
    const animation = result.scoreAnimation;
    if (!animation) {
      return;
    }

    const scorer = result.game.players[animation.scorerIndex];
    if (!scorer) {
      return;
    }

    localSuckerStatTurns.current.push({
      category: animation.category,
      player_id: scorer.id,
      score: animation.score,
      status: result.game.phase === 'complete' ? 'finalized' : (result.pendingTurn?.status ?? 'submitted'),
      turn_id: result.pendingTurn?.id ?? `local-turn-${localSuckerStatTurns.current.length + 1}`,
      turn_index: localSuckerStatTurns.current.length + 1,
    });
  }

  function updateLocalScoreTurnStatus(turnId: string, status: NonNullable<SuckerStatTurn['status']>) {
    localSuckerStatTurns.current = localSuckerStatTurns.current.map((turn) =>
      turn.turn_id === turnId ? { ...turn, status } : turn,
    );
  }

  function setLiveRemoteGame(nextGame: ReturnType<typeof createGame>) {
    liveGameRef.current = nextGame;
    setVisibleRemoteGame(nextGame);
  }

  function settleRemoteOptimisticAction(
    result: Promise<ReturnType<typeof createGame> | null>,
    rollbackGame: ReturnType<typeof createGame>,
  ) {
    void result.then((nextGame) => {
      if (nextGame) {
        setLiveRemoteGame(nextGame);
        return;
      }

      setLiveRemoteGame(remoteGame && myProfileId ? concealActiveOpponentDice(remoteGame, myProfileId) : rollbackGame);
    });
  }

  async function handleRoll() {
    if (!canRoll) {
      return;
    }

    const sourceGame = liveGameRef.current;

    if (!isRemoteGame && pendingTurn) {
      clearLocalTurnResponseWindow();
    }
    setHighlightCategory(null);
    setIsChoosingSuckerDeal(false);

    if (isRemoteGame && remoteHandlers) {
      await animateRemoteRoll(remoteHandlers.onRoll(sourceGame.held), sourceGame);
      return;
    }

    const nextGame = rollCurrentDice(sourceGame);
    recordLocalAction('roll', homePlayer.id, buildRollActionPayload(nextGame.dice));
    await animateRollTo(nextGame, sourceGame);
  }

  async function animateRemoteRoll(
    nextGamePromise: Promise<ReturnType<typeof createGame> | null>,
    sourceGame: ReturnType<typeof createGame>,
  ) {
    setIsAwaitingRemoteRoll(true);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setRollingDieIndexes([]);
    setRollingLaunches({});

    await wait(remoteRollServerHeadStartMs);
    setIsAwaitingRemoteRoll(false);
    await animateRollToPending(nextGamePromise, sourceGame);
  }

  async function animateRollTo(
    nextGame: ReturnType<typeof createGame> | null,
    sourceGame: ReturnType<typeof createGame>,
  ) {
    await animateRollToPending(Promise.resolve(nextGame), sourceGame);
  }

  async function animateRollToPending(
    nextGamePromise: Promise<ReturnType<typeof createGame> | null>,
    sourceGame: ReturnType<typeof createGame>,
  ) {
    const rollingIndexes = sourceGame.held
      .map((held, index) => (held ? null : index))
      .filter((index): index is number => index !== null);
    setIsRolling(true);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setRollingFaces(sourceGame.dice);
    rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));

    if (rollingIndexes.length === 0) {
      const nextGame = await nextGamePromise;
      if (!nextGame) {
        setIsRolling(false);
        return;
      }
      const finalDice = nextGame.dice;
      if (isRemoteGame) {
        setLiveRemoteGame(nextGame);
      } else {
        liveGameRef.current = nextGame;
        setLocalGame(nextGame);
      }
      if (isSuckerDice(finalDice)) {
        showSuckerRollBanner('You rolled');
      }
      setIsRolling(false);
      return;
    }

    const launchSide = Math.random() < 0.5 ? 'left' : 'right';
    const [rollZoneRect, slotRects] = await Promise.all([
      measureInWindow(rollZoneRef.current),
      Promise.all(dieSlotRefs.current.map((ref) => measureInWindow(ref))),
    ]);
    const launches = Object.fromEntries(
      rollingIndexes.map((index) => [
        index,
        createRollingLaunch(index, launchSide, rollZoneRect, slotRects[index] ?? null, gameLayout.unit(88)),
      ]),
    ) as Partial<Record<number, RollingLaunch>>;
    setRollingLaunches(launches);
    setRollingDieIndexes(rollingIndexes);

    let resolvedNextGame: ReturnType<typeof createGame> | null | undefined;
    const trackedNextGamePromise = nextGamePromise.then((gameResult) => {
      resolvedNextGame = gameResult;
      return gameResult;
    });
    const scrambleTimer = setInterval(() => {
      setRollingFaces(
        (faces) => faces.map((face, index) => (rollingIndexes.includes(index) ? rollDisplayDie() : face)) as DieValue[],
      );
    }, 65);
    const rollAnimation = Animated.parallel(
      rollingIndexes.map((index) => {
        const launch = launches[index] ?? defaultRollingLaunch;

        return Animated.sequence([
          Animated.delay(launch.delay),
          Animated.timing(diceAnimations[index], {
            toValue: 1,
            duration: launch.duration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]);
      }),
    );

    let nextGame: ReturnType<typeof createGame> | null = null;
    try {
      await runAnimation(rollAnimation);
      nextGame = resolvedNextGame === undefined ? await trackedNextGamePromise : resolvedNextGame;
    } finally {
      clearInterval(scrambleTimer);
    }

    if (!nextGame) {
      rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));
      setRollingDieIndexes([]);
      setRollingLaunches({});
      setIsRolling(false);
      return;
    }
    const finalDice = nextGame.dice;

    setRollingFaces(finalDice);
    await wait(rollFinalFaceHoldMs);

    if (isRemoteGame) {
      setLiveRemoteGame(nextGame);
    } else {
      liveGameRef.current = nextGame;
      setLocalGame(nextGame);
    }
    if (isSuckerDice(finalDice)) {
      showSuckerRollBanner('You rolled');
    }
    rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));
    setRollingDieIndexes([]);
    setRollingLaunches({});
    setIsRolling(false);
  }

  function finishComputerTurnResult(result: ComputerTurnResult) {
    recordLocalScoreTurn(result);
    const punchedTurn =
      result.suckerPunchAttempt?.outcome.landed && result.pendingTurn?.status === 'punched' ? result.pendingTurn : null;
    if (result.suckerPunchAttempt) {
      const puncher = result.game.players[result.suckerPunchAttempt.puncherIndex];
      const target = result.game.players[result.suckerPunchAttempt.targetPlayerIndex];
      if (puncher && target) {
        recordLocalAction(
          'sucker_punch',
          puncher.id,
          buildSuckerPunchActionPayload(target.id, result.suckerPunchAttempt.outcome, {
            id: result.suckerPunchAttempt.targetTurnId,
          }),
        );
      }
      if (result.suckerPunchAttempt.outcome.landed) {
        updateLocalScoreTurnStatus(result.suckerPunchAttempt.targetTurnId, 'punched');
      }
    }
    setLocalGame(result.game);
    setLocalPendingTurn(result.pendingTurn);
    if (punchedTurn && punchedTurn.scorerIndex === myPlayerIndex) {
      const player = result.game.players[punchedTurn.scorerIndex];
      if (player) {
        showSuckerPunchNoticeAndWipe({
          category: punchedTurn.category,
          playerId: player.id,
          score: displayScoreWithoutSuckerBonus(punchedTurn.score, punchedTurn.hadSuckerBonus) ?? punchedTurn.score,
          turnId: punchedTurn.id,
        });
      }
    }
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setIsComputerThinking(false);
  }

  function didBlockSuckerPunchAgainstMe(result: ComputerTurnResult) {
    return Boolean(
      result.suckerPunchAttempt &&
      !result.suckerPunchAttempt.outcome.landed &&
      result.suckerPunchAttempt.targetPlayerIndex === myPlayerIndex,
    );
  }

  async function showBlockedSuckerPunchBeforeTurnReveal() {
    setSuckerBlockedNotice({
      text: 'Sucker Punch!',
      title: 'You blocked',
    });
    await wait(suckerBlockedNoticeDurationMs);
    setSuckerBlockedNotice(null);
  }

  function clearLocalTurnResponseWindow() {
    setLocalPendingTurn(null);
    setShowSuckerPunchNotice(false);
    clearSuckerPunchWipe();
    setSuckerBlockedNotice(null);
    setSuckerRollNoticeTitle(null);
  }

  async function animateOpponentScoreReveal({
    category,
    dice,
    displayScore,
    playerName,
    scoreId,
    targetRef,
  }: {
    category: ScoreCategory;
    dice: GameState['dice'];
    displayScore: number;
    playerName: string;
    scoreId: string;
    targetRef: ViewRef | null | undefined;
  }) {
    const [screenRect, boardRect, targetRect] = await Promise.all([
      measureInWindow(screenRef.current),
      measureInWindow(boardRef.current),
      measureInWindow(targetRef ?? null),
    ]);

    if (!screenRect || !targetRect) {
      return false;
    }

    const dieSize = Math.min(54, Math.max(46, (screenRect.width - 56) / 5.6));
    const gap = Math.max(4, Math.min(7, dieSize * 0.12));
    const rowWidth = dieSize * dice.length + gap * (dice.length - 1);
    const revealLeft = Math.max(12, (screenRect.width - rowWidth) / 2);
    const boardTop = boardRect ? boardRect.y - screenRect.y : screenRect.height * 0.22;
    const revealTop = Math.max(96, Math.min(screenRect.height - 170, boardTop));
    const targetCenterX = targetRect.x - screenRect.x + targetRect.width / 2 - dieSize / 2;
    const targetCenterY = targetRect.y - screenRect.y + targetRect.height / 2 - dieSize / 2;
    const targetOffsets = [
      { x: -12, y: -4 },
      { x: -6, y: 4 },
      { x: 0, y: -2 },
      { x: 6, y: 4 },
      { x: 12, y: -4 },
    ];
    const revealProgress = new Animated.Value(0);

    setIsScoring(true);
    setOpponentTurnReveal({
      dice,
      dieSize,
      gap,
      id: scoreId,
      categoryLabel: formatScoreRevealCategory(category),
      playerName,
      score: displayScore,
      progress: revealProgress,
      top: revealTop,
    });

    await runAnimation(
      Animated.timing(revealProgress, {
        toValue: 1,
        duration: computerScoreRevealDurationMs,
        easing: Easing.out(Easing.back(1.12)),
        useNativeDriver: true,
      }),
    );
    await wait(computerScoreRevealPauseMs);
    setOpponentTurnReveal(null);

    const flyingDice = dice.map((face, index) => {
      const offset = targetOffsets[index] ?? { x: 0, y: 0 };
      return {
        face,
        fromX: revealLeft + index * (dieSize + gap),
        fromY: revealTop,
        id: `${scoreId}-die-${index}`,
        progress: new Animated.Value(0),
        size: dieSize,
        toX: targetCenterX + offset.x,
        toY: targetCenterY + offset.y,
      };
    });
    const flyingScore = {
      fromX: screenRect.width / 2 - 44,
      fromY: revealTop + dieSize + 4,
      id: scoreId,
      progress: new Animated.Value(0),
      toX: targetRect.x - screenRect.x + targetRect.width / 2 - 44,
      toY: targetRect.y - screenRect.y + targetRect.height / 2 - 24,
      value: displayScore,
    };

    setScoreFlyDice(flyingDice);
    setScoreFlyNumber(flyingScore);
    await runAnimation(
      Animated.parallel([
        Animated.stagger(
          42,
          flyingDice.map((die) =>
            Animated.timing(die.progress, {
              toValue: 1,
              duration: 700,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }),
          ),
        ),
        Animated.timing(flyingScore.progress, {
          toValue: 1,
          duration: computerScoreAnimationDurationMs,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    setScoreFlyDice([]);
    setScoreFlyNumber(null);
    setIsScoring(false);

    return true;
  }

  async function animateComputerTurnResult(result: ComputerTurnResult) {
    if (didBlockSuckerPunchAgainstMe(result)) {
      await showBlockedSuckerPunchBeforeTurnReveal();
    }

    if (!result.scoreAnimation) {
      finishComputerTurnResult(result);
      return;
    }

    const { category, dice, hadSuckerBonus, score, scorerIndex } = result.scoreAnimation;
    setLocalPendingTurn(null);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(category);

    await wait(computerScorePreviewDelayMs);

    const displayScore = displayScoreWithoutSuckerBonus(score, hadSuckerBonus) ?? score;
    const targetRef =
      scorerIndex === myPlayerIndex ? scoreBoxRefs.current[category] : opponentScoreRefs.current[category];

    if (scorerIndex !== myPlayerIndex) {
      await animateOpponentScoreReveal({
        category,
        dice,
        displayScore,
        playerName: result.game.players[scorerIndex]?.name ?? 'Opponent',
        scoreId: `computer-score-${category}-${Date.now()}`,
        targetRef,
      });

      finishComputerTurnResult(result);
      return;
    }

    const [screenRect, targetRect] = await Promise.all([
      measureInWindow(screenRef.current),
      measureInWindow(targetRef ?? null),
    ]);

    if (!screenRect || !targetRect) {
      finishComputerTurnResult(result);
      return;
    }

    const flyingScore = {
      fromX: screenRect.width / 2 - 44,
      fromY: screenRect.height * 0.44,
      id: `computer-score-${category}-${Date.now()}`,
      progress: new Animated.Value(0),
      toX: targetRect.x - screenRect.x + targetRect.width / 2 - 44,
      toY: targetRect.y - screenRect.y + targetRect.height / 2 - 24,
      value: displayScore,
    };

    setIsScoring(true);
    setScoreFlyNumber(flyingScore);
    requestAnimationFrame(() => {
      Animated.timing(flyingScore.progress, {
        toValue: 1,
        duration: computerScoreAnimationDurationMs,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setScoreFlyNumber(null);
        setIsScoring(false);
        finishComputerTurnResult(result);
      });
    });
  }

  async function animateRemoteOpponentScoreTurn(nextRemoteGame: GameState, turn: RemoteTurnRow) {
    const previousGame = buildRemoteGameBeforeTurn(nextRemoteGame, turn) ?? visibleRemoteGame;
    if (!previousGame) {
      setVisibleRemoteGame(nextRemoteGame);
      visibleRemoteTurnId.current = turn.id;
      lastAnimatedRemoteScoreTurnId.current = turn.id;
      setRevealingRemoteTurnId(null);
      return;
    }

    liveGameRef.current = previousGame;
    setVisibleRemoteGame(previousGame);
    await waitForNextFrame();

    const scorerIndex = previousGame.players.findIndex((player) => player.id === turn.player_id);
    const scorer =
      previousGame.players[scorerIndex] ?? nextRemoteGame.players.find((player) => player.id === turn.player_id);
    const hadSuckerBonus = scorer ? hasPreviewSuckerBonus(turn.dice, turn.category, scorer.scorecard) : false;

    setLocalPendingTurn(null);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(turn.category);

    const displayScore = displayScoreWithoutSuckerBonus(turn.score, hadSuckerBonus) ?? turn.score;
    const didAnimateReveal = await animateOpponentScoreReveal({
      category: turn.category,
      dice: turn.dice,
      displayScore,
      playerName: scorer?.name ?? 'Opponent',
      scoreId: `remote-score-${turn.id}`,
      targetRef: opponentScoreRefs.current[turn.category],
    });

    setVisibleRemoteGame(nextRemoteGame);
    liveGameRef.current = nextRemoteGame;
    visibleRemoteTurnId.current = turn.id;
    lastAnimatedRemoteScoreTurnId.current = turn.id;
    setRevealingRemoteTurnId(null);
    setHighlightCategory(null);

    if (!didAnimateReveal) {
      setIsScoring(false);
      setOpponentTurnReveal(null);
      setScoreFlyDice([]);
      setScoreFlyNumber(null);
    }
  }

  async function handleUseExtraRoll() {
    if (!canUseLocalExtraRoll && !canUseRemoteExtraRoll) {
      return;
    }

    setIsTokenMenuOpen(false);
    if (isRemoteGame && remoteHandlers) {
      await remoteHandlers.onExtraRoll(game.held);
      return;
    }

    recordLocalAction('extra_roll', homePlayer.id, buildExtraRollActionPayload(game, homePlayer.id));
    if (pendingTurn) {
      clearLocalTurnResponseWindow();
    }
    setLocalGame(purchaseExtraRoll(game));
  }

  function handleUseMulligan() {
    if (!canUseLocalMulligan) {
      return;
    }

    setIsTokenMenuOpen(false);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    if (pendingTurn) {
      clearLocalTurnResponseWindow();
    }
    recordLocalAction('mulligan', homePlayer.id);
    setLocalGame(mulliganCurrentTurn(game));
  }

  function handleStartSuckerDeal() {
    if (!canStartSuckerDeal) {
      return;
    }

    setIsTokenMenuOpen(false);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setIsChoosingSuckerDeal(true);
  }

  async function handleSuckerDealTarget(category: ScoreCategory) {
    if (!canStartSuckerDeal || !openCategories.includes(category)) {
      return;
    }

    const sourceGame = liveGameRef.current;
    setIsChoosingSuckerDeal(false);

    if (isRemoteGame && remoteHandlers) {
      const optimisticGame = scratchScoreBox(sourceGame, category);
      setLiveRemoteGame(optimisticGame);
      settleRemoteOptimisticAction(remoteHandlers.onScratch(category, sourceGame.held), sourceGame);
      return;
    }

    const nextGame = scratchScoreBox(sourceGame, category);
    liveGameRef.current = nextGame;
    setLocalGame(nextGame);
    localSuckerStatTurns.current.push({
      category,
      player_id: currentPlayer.id,
      score: 0,
      status: 'submitted',
      turn_id: `local-turn-${localSuckerStatTurns.current.length + 1}`,
      turn_index: localSuckerStatTurns.current.length + 1,
    });
    clearLocalTurnResponseWindow();
  }

  function handleUseSuckerPunch() {
    if (canUseLocalSuckerPunch && pendingTurn) {
      setIsTokenMenuOpen(false);
      setSelectedCategory(null);
      setIsChoosingSuckerDeal(false);
      setSuckerPunchChanceFace(1);
      suckerPunchDieAnimation.setValue(0);
      suckerPunchResultCompletion.current = null;
      setSuckerPunchDialog({ phase: 'ready', scope: 'local', targetTurnId: pendingTurn.id });
      return;
    }

    if (!canUseRemoteSuckerPunch || !remoteLastTurnId) {
      return;
    }

    setIsTokenMenuOpen(false);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setSuckerPunchChanceFace(1);
    suckerPunchDieAnimation.setValue(0);
    suckerPunchResultCompletion.current = null;
    setSuckerPunchDialog({ phase: 'ready', scope: 'remote', targetTurnId: remoteLastTurnId });
  }

  function handleDismissSuckerPunchResult() {
    const dialog = suckerPunchDialog;
    if (!dialog || dialog.phase !== 'result') {
      return;
    }

    setSuckerPunchDialog(null);
    const completeAfterResult = suckerPunchResultCompletion.current;
    suckerPunchResultCompletion.current = null;
    completeAfterResult?.();
  }

  async function handleRollSuckerPunchChance() {
    const dialog = suckerPunchDialog;
    if (!dialog || dialog.phase !== 'ready') {
      return;
    }

    setSuckerPunchDialog({ ...dialog, phase: 'rolling' });
    suckerPunchDieAnimation.setValue(0);

    const scrambleTimer = setInterval(() => {
      setSuckerPunchChanceFace(rollDisplayDie());
    }, 70);
    const chanceRollAnimation = Animated.timing(suckerPunchDieAnimation, {
      toValue: 1,
      duration: defaultRollingLaunch.duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    try {
      await runAnimation(chanceRollAnimation);
    } finally {
      clearInterval(scrambleTimer);
    }

    const chanceDie = rollDisplayDie();
    setSuckerPunchChanceFace(chanceDie);
    await wait(rollFinalFaceHoldMs);
    suckerPunchDieAnimation.setValue(0);
    setSuckerPunchDialog({ ...dialog, phase: 'rolled' });
  }

  async function handleThrowSuckerPunch() {
    const dialog = suckerPunchDialog;
    if (!dialog || dialog.phase !== 'rolled') {
      return;
    }

    const chanceDie = suckerPunchChanceFace;
    setSuckerPunchDialog({ ...dialog, phase: 'throwing' });

    let outcome: SuckerPunchOutcome | null = null;
    let completeAfterResult: (() => void) | null = null;

    if (dialog.scope === 'local') {
      const targetTurn = pendingTurn;
      const scorer = targetTurn ? game.players[targetTurn.scorerIndex] : null;
      const isStillPunchable =
        Boolean(targetTurn) &&
        targetTurn?.id === dialog.targetTurnId &&
        targetTurn.status === 'submitted' &&
        targetTurn.responderIndex === myPlayerIndex &&
        targetTurn.scorerIndex !== myPlayerIndex &&
        myTokenCount >= suckerTokenCosts.suckerPunch;

      if (!targetTurn || !scorer || !isStillPunchable) {
        setSuckerPunchDialog(null);
        suckerPunchResultCompletion.current = null;
        return;
      }

      const punched = applyLocalSuckerPunch(game, targetTurn, myPlayerIndex, Math.random, chanceDie);
      if (!punched.outcome) {
        setSuckerPunchDialog(null);
        suckerPunchResultCompletion.current = null;
        return;
      }

      outcome = punched.outcome;

      recordLocalAction(
        'sucker_punch',
        homePlayer.id,
        buildSuckerPunchActionPayload(scorer.id, punched.outcome, { id: targetTurn.id }),
      );

      completeAfterResult = () => {
        if (!punched.outcome?.landed) {
          setLocalGame(punched.game);
          setLocalPendingTurn(null);
          return;
        }

        const targetScore =
          displayScoreWithoutSuckerBonus(
            scorer.scorecard[targetTurn.category],
            (scorer.suckerBonusCategories ?? []).includes(targetTurn.category),
          ) ?? targetTurn.score;
        updateLocalScoreTurnStatus(targetTurn.id, 'punched');
        const replayed = playComputerTurn(punched.game, null);
        setLocalGame(punched.game);
        setLocalPendingTurn(punched.pendingTurn);
        showSuckerPunchScoreWipe({
          category: targetTurn.category,
          playerId: scorer.id,
          score: targetScore,
          turnId: targetTurn.id,
        });
        setIsComputerThinking(true);
        setTimeout(() => {
          void animateComputerTurnResult(replayed);
        }, computerThinkingDelayMs);
      };
    } else {
      if (!remoteHandlers || remoteStatus !== 'response_window' || remoteLastTurnId !== dialog.targetTurnId) {
        setSuckerPunchDialog(null);
        suckerPunchResultCompletion.current = null;
        return;
      }

      const result = await remoteHandlers.onSuckerPunch(dialog.targetTurnId, chanceDie);
      if (!result?.outcome) {
        setSuckerPunchDialog(null);
        suckerPunchResultCompletion.current = null;
        return;
      }

      outcome = result.outcome;
      if (result.game) {
        const targetTurn = remoteLastTurn;
        const targetPlayer = targetTurn ? game.players.find((player) => player.id === targetTurn.player_id) : null;
        const targetScore = targetTurn
          ? (displayScoreWithoutSuckerBonus(
              targetPlayer?.scorecard[targetTurn.category] ?? null,
              Boolean(targetPlayer?.suckerBonusCategories?.includes(targetTurn.category)),
            ) ?? targetTurn.score)
          : null;
        completeAfterResult = () => {
          setLiveRemoteGame(result.game as ReturnType<typeof createGame>);
          if (outcome?.landed && targetTurn && targetScore !== null) {
            showSuckerPunchScoreWipe({
              category: targetTurn.category,
              playerId: targetTurn.player_id,
              score: targetScore,
              turnId: targetTurn.id,
            });
          }
        };
      }
    }

    setSuckerPunchChanceFace(outcome.chanceDie);
    suckerPunchResultCompletion.current = completeAfterResult;
    setSuckerPunchDialog({ ...dialog, outcome, phase: 'result' });
  }

  async function handleRematch() {
    setDismissedGameOverId(null);
    setIsMenuOpen(false);
    setIsTokenMenuOpen(false);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setShowSuckerPunchNotice(false);
    clearSuckerPunchWipe();
    setSuckerBlockedNotice(null);
    setSuckerRollNoticeTitle(null);
    suckerPunchResultCompletion.current = null;
    setSuckerPunchDialog(null);

    if (isRemoteGame && remoteHandlers) {
      await remoteHandlers.onRematch();
      return;
    }

    setLocalPendingTurn(null);
    recordedComputerGameIds.current.clear();
    localSuckerStatActions.current = [];
    localSuckerStatTurns.current = [];
    setLocalGame(createGame(localPlayerNames));
  }

  function handleCloseGameOver() {
    setDismissedGameOverId(game.id);
    onExit?.();
  }

  function handleOpenNextTurnGame(gameId: string) {
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setIsMenuOpen(false);
    setIsTokenMenuOpen(false);
    onOpenNextTurnGame?.(gameId);
  }

  function handleNextTurnsLobby() {
    setIsMenuOpen(false);
    setIsTokenMenuOpen(false);
    onExit?.();
  }

  function handleOpenStats(returnFocusTarget: 'gameOver' | 'menu') {
    statsReturnFocusTarget.current = returnFocusTarget;
    setIsMenuOpen(false);
    setShowStatsPage(true);
    void refreshVisibleStats();
  }

  function handleCloseStats() {
    setShowStatsPage(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focusAccessibilityTarget(
          statsReturnFocusTarget.current === 'gameOver' ? gameOverStatsButtonRef.current : menuButtonRef.current,
        );
      });
    });
  }

  function commitLocalScore(category: ScoreCategory, sourceGame = liveGameRef.current) {
    const result = scoreLocalTurn(sourceGame, category);
    recordLocalScoreTurn(result);
    liveGameRef.current = result.game;
    setLocalGame(result.game);
    setLocalPendingTurn(result.pendingTurn);
    return result;
  }

  function applyScoreSubmission(
    category: ScoreCategory,
    scoringGame: GameState,
    remoteScorePromise: Promise<GameState | null> | null,
    optimisticScoredGame: GameState | null,
  ) {
    if (remoteScorePromise && optimisticScoredGame) {
      setLiveRemoteGame(optimisticScoredGame);
      settleRemoteOptimisticAction(remoteScorePromise, scoringGame);
    } else {
      commitLocalScore(category, scoringGame);
    }

    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
  }

  async function playSectionBonusAwardAnimationAfterScore(shouldAnimate: boolean) {
    if (!shouldAnimate) {
      return;
    }

    sectionBonusPulse.stopAnimation();
    if (shouldReduceMotion) {
      sectionBonusPulse.setValue(1);
      return;
    }

    await waitForNextFrame();
    await wait(sectionBonusAfterScoreDelayMs);
    sectionBonusPulse.setValue(0);
    await runAnimation(
      Animated.timing(sectionBonusPulse, {
        toValue: 1,
        duration: sectionBonusAnimationDurationMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    );
  }

  function handleSelectCategory(category: ScoreCategory) {
    if (isChoosingSuckerDeal) {
      void handleSuckerDealTarget(category);
      return;
    }

    if (
      game.rollNumber === 0 ||
      isRolling ||
      isScoring ||
      isComputerTurn ||
      !isMyRemoteTurn ||
      !isRemoteActionPlayable ||
      !openCategories.includes(category)
    ) {
      return;
    }

    setSelectedCategory(category);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
  }

  async function handlePlayScore() {
    if (!selectedCategory || isScoring) {
      return;
    }

    const category = selectedCategory;
    const scoringGame = liveGameRef.current;
    const targetRef =
      activePlayerViewIndex === 0 ? scoreBoxRefs.current[category] : opponentScoreRefs.current[category];
    const [screenRect, targetRect, sourceRects] = await Promise.all([
      measureInWindow(screenRef.current),
      measureInWindow(targetRef ?? null),
      Promise.all(dieSlotRefs.current.map((ref) => measureInWindow(ref))),
    ]);

    if (!screenRect || !targetRect || sourceRects.some((rect) => rect === null)) {
      if (isRemoteGame && remoteHandlers) {
        const optimisticGame = scoreTurn(scoringGame, category);
        const shouldAnimateSectionBonus = didAwardUpperBonusForPlayer(scoringGame, optimisticGame, homePlayer.id);
        const remoteScorePromise = remoteHandlers.onScore(category, scoringGame.held);
        applyScoreSubmission(category, scoringGame, remoteScorePromise, optimisticGame);
        await playSectionBonusAwardAnimationAfterScore(shouldAnimateSectionBonus);
      } else {
        const result = commitLocalScore(category, scoringGame);
        setSelectedCategory(null);
        setIsChoosingSuckerDeal(false);
        await playSectionBonusAwardAnimationAfterScore(
          didAwardUpperBonusForPlayer(scoringGame, result.game, homePlayer.id),
        );
      }
      return;
    }

    const diceSize = Math.min(sourceRects[0]?.width ?? 56, sourceRects[0]?.height ?? 56);
    const targetCenterX = targetRect.x - screenRect.x + targetRect.width / 2 - diceSize / 2;
    const targetCenterY = targetRect.y - screenRect.y + targetRect.height / 2 - diceSize / 2;
    const targetOffsets = [
      { x: -12, y: -4 },
      { x: -6, y: 4 },
      { x: 0, y: -2 },
      { x: 6, y: 4 },
      { x: 12, y: -4 },
    ];
    const flyingDice = scoringGame.dice.map((face, index) => {
      const rect = sourceRects[index] as MeasuredRect;
      const offset = targetOffsets[index] ?? { x: 0, y: 0 };
      return {
        face,
        fromX: rect.x - screenRect.x,
        fromY: rect.y - screenRect.y,
        id: `${category}-${index}-${Date.now()}`,
        progress: new Animated.Value(0),
        size: diceSize,
        toX: targetCenterX + offset.x,
        toY: targetCenterY + offset.y,
      };
    });

    setIsScoring(true);
    setScoreFlyDice(flyingDice);
    const remoteScorePromise =
      isRemoteGame && remoteHandlers ? remoteHandlers.onScore(category, scoringGame.held) : null;
    const optimisticScoredGame = remoteScorePromise ? scoreTurn(scoringGame, category) : null;
    const expectedScoredGame = optimisticScoredGame ?? scoreTurn(scoringGame, category);
    const shouldAnimateSectionBonus = didAwardUpperBonusForPlayer(scoringGame, expectedScoredGame, homePlayer.id);
    requestAnimationFrame(() => {
      void runAnimation(
        Animated.stagger(
          42,
          flyingDice.map((die) =>
            Animated.timing(die.progress, {
              toValue: 1,
              duration: 700,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }),
          ),
        ),
      ).then(async () => {
        setScoreFlyDice([]);
        applyScoreSubmission(category, scoringGame, remoteScorePromise, optimisticScoredGame);
        await playSectionBonusAwardAnimationAfterScore(shouldAnimateSectionBonus);
        setIsScoring(false);
      });
    });
  }

  async function handleToggleHold(index: number) {
    const sourceGame = liveGameRef.current;
    if (
      isRolling ||
      isScoring ||
      sourceGame.rollNumber === 0 ||
      !isMyRemoteTurn ||
      !isRemoteActionPlayable ||
      isRemoteInteractionPending
    ) {
      return;
    }

    if (isRemoteGame && remoteHandlers) {
      setLiveRemoteGame(toggleHold(sourceGame, index));
      return;
    }

    setLocalGame((state) => {
      const nextGame = toggleHold(state, index);
      liveGameRef.current = nextGame;
      return nextGame;
    });
  }

  function renderGameScreen() {
    return (
      <GameLayoutContext.Provider value={gameLayout}>
        <View
          aria-hidden={Platform.OS === 'web' ? showStatsPage : undefined}
          ref={screenRef}
          style={[styles.screen, gameLayout.styles.screen, gameStageStyle, devViewportStageOffset]}
          testID="game-screen"
          {...(showStatsPage ? {} : backSwipeResponder.panHandlers)}
        >
          <BackgroundDicePattern floatValue={bgFloat} />
          <View style={[styles.topBar, gameLayout.styles.topBar]} testID="game-top-bar">
            <View pointerEvents="none" style={styles.topBarBannerClip}>
              <Image resizeMode="cover" source={suckerGameBannerImage} style={styles.topBarBannerImage} />
            </View>
            {onExit && (
              <Pressable
                accessibilityLabel="Back to games"
                accessibilityRole="button"
                onPress={exitGame}
                style={({ pressed }) => [styles.backButton, gameLayout.styles.backButton, pressed && styles.pressed]}
                testID="game-back-button"
              >
                <GameBackChevronIcon size={gameLayout.unit(34)} />
              </Pressable>
            )}
            <Pressable
              accessibilityLabel="Open menu"
              accessibilityRole="button"
              accessibilityState={{ expanded: isMenuOpen }}
              onPress={() => setIsMenuOpen((open) => !open)}
              ref={menuButtonRef}
              style={({ pressed }) => [
                styles.menuDotsButton,
                gameLayout.styles.menuDotsButton,
                pressed && styles.pressed,
              ]}
              testID="game-menu-button"
            >
              <View style={[styles.menuDots, gameLayout.styles.menuDots]}>
                <View style={[styles.menuDot, gameLayout.styles.menuDot]} />
                <View style={[styles.menuDot, gameLayout.styles.menuDot]} />
                <View style={[styles.menuDot, gameLayout.styles.menuDot]} />
              </View>
            </Pressable>
          </View>
          {isMenuOpen && (
            <View pointerEvents="box-none" style={styles.topMenuLayer}>
              <Pressable
                accessibilityLabel="Close menu"
                accessibilityRole="button"
                onPress={() => setIsMenuOpen(false)}
                style={StyleSheet.absoluteFill}
              />
              <View style={[styles.topMenu, gameLayout.styles.topMenu]}>
                <Pressable
                  accessibilityLabel="View stats"
                  accessibilityRole="button"
                  onPress={() => handleOpenStats('menu')}
                  style={({ pressed }) => [
                    styles.topMenuItem,
                    gameLayout.styles.topMenuItem,
                    pressed && styles.pressed,
                  ]}
                  testID="game-stats-menu-item"
                >
                  <Text maxFontSizeMultiplier={1.2} style={[styles.topMenuText, gameLayout.styles.topMenuText]}>
                    Stats
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.playerStrip} testID="player-strip">
            {displayPlayers.map((player, index) => (
              <View
                key={player.id}
                style={[
                  styles.playerPill,
                  gameLayout.styles.playerPill,
                  player.id === currentPlayer.id && styles.activePlayer,
                ]}
              >
                <PlayerAvatar
                  avatarUrl={isRemoteGame ? playerAvatars[player.id] : index === 0 ? localPlayerAvatarUrl : null}
                  fontFamily={gameFontBlack}
                  name={player.name}
                  size={gameLayout.unit(54)}
                  style={[
                    styles.avatar,
                    gameLayout.styles.avatar,
                    player.id === currentPlayer.id && styles.activeAvatar,
                  ]}
                  testID={index === 0 ? 'home-player-avatar' : 'opponent-player-avatar'}
                />
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  style={[styles.playerScore, gameLayout.styles.playerScore]}
                >
                  {totalScore(player.scorecard)}
                </Text>
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  numberOfLines={1}
                  style={[styles.playerName, gameLayout.styles.playerName]}
                >
                  {player.name}
                </Text>
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  style={[styles.tokenText, gameLayout.styles.tokenText]}
                >
                  {player.suckerTokens} Tokens
                </Text>
              </View>
            ))}
          </View>
          <View ref={boardRef} style={[styles.board, gameLayout.styles.board]} testID="scorecard-board">
            {upperCategories.map((leftCategory, index) => (
              <ScorePair
                key={leftCategory}
                leftCategory={leftCategory}
                rightCategory={lowerCategories[index]}
                activePlayer={currentPlayer}
                activePlayerIndex={activePlayerViewIndex}
                homePlayer={homePlayer}
                opponentPlayer={opponentPlayer}
                dice={game.dice}
                canChoose={
                  game.rollNumber > 0 &&
                  !isRolling &&
                  !isScoring &&
                  !isComputerTurn &&
                  isMyRemoteTurn &&
                  isRemoteActionPlayable &&
                  !isRemoteInteractionPending
                }
                selectedCategory={selectedCategory}
                isChoosingSuckerDeal={isChoosingSuckerDeal}
                highlightCategory={highlightCategory}
                openCategories={openCategories}
                onSelect={handleSelectCategory}
                setOpponentScoreRef={(scoreCategoryName, node) => {
                  opponentScoreRefs.current[scoreCategoryName] = node;
                }}
                setScoreBoxRef={(scoreCategoryName, node) => {
                  scoreBoxRefs.current[scoreCategoryName] = node;
                }}
                selectedPulse={selectedPulse}
                suckerPunchWipe={suckerPunchWipe}
              />
            ))}

            <View style={[styles.boardRow, gameLayout.styles.boardRow]}>
              <View style={[styles.scorePair, gameLayout.styles.scorePair]}>
                <View style={styles.bonusPanel} testID="section-bonus-panel">
                  <View style={[styles.bonusContent, gameLayout.styles.bonusContent]}>
                    <View style={[styles.bonusTextBlock, gameLayout.styles.bonusTextBlock]}>
                      <Text
                        maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                        style={[styles.bonusSmall, gameLayout.styles.bonusSmall]}
                      >
                        Section{'\n'}Bonus
                      </Text>
                      <BonusValueText
                        awarded={homeSectionBonusAwarded}
                        faceColor={sectionBonusColor}
                        rotate={sectionBonusRotate}
                        scale={sectionBonusScale}
                      />
                    </View>
                    <BonusMeter total={homeUpperTotal} />
                    <BonusMeter total={opponentUpperTotal} />
                  </View>
                </View>
              </View>
              <ScoreCell
                category="chance"
                activePlayer={currentPlayer}
                activePlayerIndex={activePlayerViewIndex}
                homePlayer={homePlayer}
                opponentPlayer={opponentPlayer}
                dice={game.dice}
                canChoose={
                  game.rollNumber > 0 &&
                  !isRolling &&
                  !isScoring &&
                  !isComputerTurn &&
                  isMyRemoteTurn &&
                  isRemoteActionPlayable &&
                  !isRemoteInteractionPending
                }
                selectedCategory={selectedCategory}
                isChoosingSuckerDeal={isChoosingSuckerDeal}
                highlightCategory={highlightCategory}
                openCategories={openCategories}
                onSelect={handleSelectCategory}
                setOpponentScoreRef={(scoreCategoryName, node) => {
                  opponentScoreRefs.current[scoreCategoryName] = node;
                }}
                setScoreBoxRef={(scoreCategoryName, node) => {
                  scoreBoxRefs.current[scoreCategoryName] = node;
                }}
                selectedPulse={selectedPulse}
                suckerPunchWipe={suckerPunchWipe}
              />
            </View>
          </View>

          <View ref={rollZoneRef} style={[styles.rollZone, gameLayout.styles.rollZone]}>
            <View style={[styles.diceTray, { gap: diceTrayGap, height: diceSlotSize }]} testID="dice-tray">
              {game.dice.map((die, index) => {
                const isFlying = isRolling && rollingDieIndexes.includes(index);
                const showDie = activePlayerViewIndex === 0 && (game.rollNumber > 0 || isRolling);
                const showSlotDie = showDie && !isFlying;
                const showHeldDie = showDie && game.held[index];
                const dieDisabled = !showDie || isRolling || isScoring || !isMyRemoteTurn || isRemoteInteractionPending;

                return (
                  <View key={`die-${index}`} style={[styles.dieMotion, { height: diceSlotSize, width: diceSlotSize }]}>
                    {showHeldDie && usesLegacyAndroidShadowFallback && (
                      <View pointerEvents="none" style={[styles.heldDieGlow, gameLayout.styles.heldDieGlow]} />
                    )}
                    <Pressable
                      accessibilityElementsHidden={!showDie}
                      accessibilityHint={
                        dieDisabled
                          ? undefined
                          : showHeldDie
                            ? 'Double tap to release this die'
                            : 'Double tap to hold this die'
                      }
                      accessibilityLabel={`Die ${index + 1}: ${die}, ${showHeldDie ? 'held' : 'not held'}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: dieDisabled, selected: showHeldDie }}
                      accessible={showDie}
                      disabled={dieDisabled}
                      importantForAccessibility={showDie ? 'yes' : 'no-hide-descendants'}
                      onPress={() => void handleToggleHold(index)}
                      ref={(node) => {
                        dieSlotRefs.current[index] = node;
                      }}
                      style={({ pressed }) => [
                        styles.dieSlot,
                        gameLayout.styles.dieSlot,
                        isFlying && styles.settlingDieSlot,
                        showHeldDie && styles.heldDie,
                        pressed && styles.pressed,
                      ]}
                      testID={`die-slot-${index}`}
                    >
                      {showSlotDie && (
                        <DieFace
                          face={die}
                          style={[
                            styles.dieImage,
                            showHeldDie && styles.heldDieImage,
                            isScoring && styles.scoringSourceDieImage,
                          ]}
                        />
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {isRolling && (
              <View pointerEvents="none" style={styles.rollingDiceOverlay}>
                {rollingDieIndexes.map((index) => {
                  const face = rollingFaces[index];
                  const launch = rollingLaunches[index] ?? defaultRollingLaunch;
                  const flyY = diceAnimations[index].interpolate({
                    inputRange: [0, 0.2, 0.45, 0.72, 0.9, 1],
                    outputRange: [
                      launch.fromY,
                      launch.midY - 10,
                      launch.midY,
                      launch.toY - 12,
                      launch.toY - 3,
                      launch.toY,
                    ],
                  });
                  const flyX = diceAnimations[index].interpolate({
                    inputRange: [0, 0.22, 0.5, 0.74, 0.9, 1],
                    outputRange: [
                      launch.fromX,
                      launch.fromX * 0.62 + launch.midX * 0.38,
                      launch.midX,
                      launch.toX + (launch.side === 'left' ? -12 : 12),
                      launch.toX + (launch.side === 'left' ? -4 : 4),
                      launch.toX,
                    ],
                  });
                  const flyScale = diceAnimations[index].interpolate({
                    inputRange: [0, 0.25, 0.55, 0.76, 0.9, 1],
                    outputRange: [0.86 + index * 0.02, 1.18, launch.peakScale, 1.02, 0.78, 0.72],
                  });
                  const flyRotate = diceAnimations[index].interpolate({
                    inputRange: [0, 0.2, 0.4, 0.62, 0.84, 1],
                    outputRange: [
                      `${launch.side === 'left' ? -28 : 28}deg`,
                      `${launch.spin}deg`,
                      `${-launch.spin * 0.72}deg`,
                      `${launch.spin * 0.46}deg`,
                      `${-launch.spin * 0.14}deg`,
                      '0deg',
                    ],
                  });
                  const flyOpacity = diceAnimations[index].interpolate({
                    inputRange: [0, 0.76, 1],
                    outputRange: [1, 1, 1],
                  });

                  return (
                    <Animated.View
                      key={`flying-die-${index}`}
                      style={[
                        styles.rollingDieTrack,
                        gameLayout.styles.rollingDieTrack,
                        {
                          opacity: flyOpacity,
                          transform: [
                            { translateX: flyX },
                            { translateY: flyY },
                            { rotate: flyRotate },
                            { scale: flyScale },
                          ],
                        },
                      ]}
                    >
                      <DieFace face={face} style={[styles.rollingDieImage, gameLayout.styles.rollingDieImage]} />
                    </Animated.View>
                  );
                })}
              </View>
            )}

            <View style={[styles.controlsRow, gameLayout.styles.controlsRow]} testID="game-controls-row">
              <View style={[styles.rollButtonWrap, gameLayout.styles.rollButtonWrap]}>
                <Pressable
                  accessibilityLabel="Roll dice"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canRoll }}
                  disabled={!canRoll}
                  onPress={handleRoll}
                  style={({ pressed }) => [
                    styles.rollButton,
                    gameLayout.styles.rollButton,
                    !canRoll && styles.disabledRollButton,
                    pressed && styles.pressed,
                  ]}
                  testID="roll-button"
                >
                  <View style={[styles.buttonGloss, gameLayout.styles.buttonGloss]} />
                  <View style={[styles.buttonInnerShade, gameLayout.styles.buttonInnerShade]} />
                  <Text
                    maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                    style={[styles.rollText, gameLayout.styles.rollText]}
                  >
                    ROLL
                  </Text>
                  <View style={[styles.rollsLeftBadge, gameLayout.styles.rollsLeftBadge]}>
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[styles.rollsLeftNumber, gameLayout.styles.rollsLeftNumber]}
                      testID="rolls-left-count"
                    >
                      {standardRollsLeft}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[styles.rollsLeftLabel, gameLayout.styles.rollsLeftLabel]}
                    >
                      LEFT
                    </Text>
                  </View>
                </Pressable>
              </View>

              <View style={[styles.tokenButtonWrap, gameLayout.styles.tokenButtonWrap]}>
                <Pressable
                  accessibilityLabel="Sucker token menu"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canOpenTokenMenu }}
                  disabled={!canOpenTokenMenu}
                  onPress={() => setIsTokenMenuOpen(true)}
                  style={({ pressed }) => [
                    styles.tokenButton,
                    gameLayout.styles.tokenButton,
                    !canOpenTokenMenu && styles.disabledButton,
                    pressed && styles.pressed,
                  ]}
                  testID="token-menu-button"
                >
                  <View style={[styles.buttonInnerShade, gameLayout.styles.buttonInnerShade]} />
                  <Image
                    source={suckerTokenImage}
                    style={[styles.tokenButtonImage, gameLayout.styles.tokenButtonImage]}
                  />
                  <View style={[styles.tokenCountBadge, gameLayout.styles.tokenCountBadge]}>
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[styles.tokenCountText, gameLayout.styles.tokenCountText]}
                      testID="token-count"
                    >
                      {myTokenCount}
                    </Text>
                  </View>
                </Pressable>
              </View>

              <View style={[styles.playButtonWrap, gameLayout.styles.playButtonWrap]}>
                <Pressable
                  accessibilityLabel={
                    selectedCategory ? `Play ${categoryLabels[selectedCategory]} score` : 'Play selected score'
                  }
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canPlaySelected }}
                  disabled={!canPlaySelected}
                  onPress={handlePlayScore}
                  style={({ pressed }) => [
                    styles.playButton,
                    gameLayout.styles.playButton,
                    !canPlaySelected && styles.disabledButton,
                    pressed && styles.pressed,
                  ]}
                  testID="play-score-button"
                >
                  <View style={[styles.playGloss, gameLayout.styles.buttonGloss]} />
                  <View style={[styles.buttonInnerShade, gameLayout.styles.buttonInnerShade]} />
                  <Text
                    maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                    style={[styles.playText, gameLayout.styles.playText]}
                  >
                    PLAY
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          {isTokenMenuOpen && (
            <View style={[styles.tokenMenuOverlay, gameLayout.styles.tokenMenuOverlay]} testID="token-menu-overlay">
              <Pressable
                accessibilityLabel="Close Sucker token menu"
                accessibilityRole="button"
                onPress={() => setIsTokenMenuOpen(false)}
                style={StyleSheet.absoluteFill}
              />
              <View style={[styles.tokenMenuPanel, gameLayout.styles.tokenMenuPanel]}>
                <View style={[styles.tokenMenuHeader, gameLayout.styles.tokenMenuHeader]}>
                  <Image source={suckerTokenImage} style={[styles.tokenMenuIcon, gameLayout.styles.tokenMenuIcon]} />
                  <View style={styles.tokenMenuHeaderText}>
                    <Text maxFontSizeMultiplier={1.2} style={[styles.tokenMenuTitle, gameLayout.styles.tokenMenuTitle]}>
                      Sucker Tokens
                    </Text>
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={[styles.tokenMenuSubtitle, gameLayout.styles.tokenMenuSubtitle]}
                    >
                      {myTokenCount} available
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Close Sucker token menu"
                    accessibilityRole="button"
                    hitSlop={gameLayout.unit(8)}
                    onPress={() => setIsTokenMenuOpen(false)}
                    style={[styles.tokenMenuClose, gameLayout.styles.tokenMenuClose]}
                    testID="token-menu-close-button"
                  >
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[styles.tokenMenuCloseText, gameLayout.styles.tokenMenuCloseText]}
                    >
                      X
                    </Text>
                  </Pressable>
                </View>

                <TokenMenuOption
                  cost={suckerTokenCosts.extraRoll}
                  description="Add one roll to the Roll button."
                  disabled={!canUseLocalExtraRoll && !canUseRemoteExtraRoll}
                  label="Extra Roll"
                  onPress={() => void handleUseExtraRoll()}
                  testID="token-option-extra-roll"
                />
                <TokenMenuOption
                  cost={suckerTokenCosts.mulligan}
                  description="Discard this turn and start it over."
                  disabled={!canUseLocalMulligan}
                  label="Mulligan"
                  onPress={handleUseMulligan}
                  testID="token-option-mulligan"
                />
                <TokenMenuOption
                  cost={0}
                  costLabel="+1"
                  description="Pick a score box to sacrifice for 0 and gain 1 token."
                  disabled={!canStartSuckerDeal}
                  label="Sucker Deal"
                  onPress={handleStartSuckerDeal}
                  testID="token-option-sucker-deal"
                />
                <TokenMenuOption
                  cost={suckerTokenCosts.suckerPunch}
                  description={
                    isRemoteGame
                      ? 'Roll for a chance to make your opponent replay their turn.'
                      : 'Roll for a chance to make the computer replay its turn.'
                  }
                  disabled={!canUseLocalSuckerPunch && !canUseRemoteSuckerPunch}
                  label="Sucker Punch"
                  onPress={() => void handleUseSuckerPunch()}
                  testID="token-option-sucker-punch"
                />
              </View>
            </View>
          )}
          {suckerPunchDialog && (
            <SuckerPunchChanceDialog
              face={suckerPunchChanceFace}
              onDismissResult={handleDismissSuckerPunchResult}
              onRoll={() => void handleRollSuckerPunchChance()}
              onThrowPunch={() => void handleThrowSuckerPunch()}
              outcome={suckerPunchDialog.outcome}
              phase={suckerPunchDialog.phase}
              rollProgress={suckerPunchDieAnimation}
            />
          )}
          {opponentTurnReveal && (
            <View pointerEvents="none" style={[styles.opponentTurnRevealOverlay, { top: opponentTurnReveal.top }]}>
              <View style={[styles.opponentTurnRevealPanel, gameLayout.styles.opponentTurnRevealPanel]}>
                <View style={[styles.opponentTurnRevealDiceRow, { gap: opponentTurnReveal.gap }]}>
                  {opponentTurnReveal.dice.map((face, index) => {
                    const opacity = opponentTurnReveal.progress.interpolate({
                      inputRange: [0, Math.min(0.76, 0.16 + index * 0.08), 1],
                      outputRange: [0, 0, 1],
                    });
                    const translateY = opponentTurnReveal.progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [gameLayout.unit(-26 - index * 2), 0],
                    });
                    const scale = opponentTurnReveal.progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.74, 1],
                    });
                    const rotate = opponentTurnReveal.progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [index % 2 === 0 ? '-16deg' : '16deg', '0deg'],
                    });

                    return (
                      <Animated.View
                        key={`${opponentTurnReveal.id}-reveal-${index}`}
                        style={[
                          styles.opponentTurnRevealDie,
                          {
                            height: opponentTurnReveal.dieSize,
                            opacity,
                            transform: [{ translateY }, { rotate }, { scale }],
                            width: opponentTurnReveal.dieSize,
                          },
                        ]}
                      >
                        <DieFace face={face} style={styles.opponentTurnRevealDieImage} />
                      </Animated.View>
                    );
                  })}
                </View>
                <Animated.View
                  style={[
                    styles.opponentTurnRevealMessage,
                    gameLayout.styles.opponentTurnRevealMessage,
                    {
                      opacity: opponentTurnReveal.progress.interpolate({
                        inputRange: [0, 0.58, 1],
                        outputRange: [0, 0, 1],
                      }),
                      transform: [
                        {
                          translateY: opponentTurnReveal.progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [gameLayout.unit(8), 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Text
                    adjustsFontSizeToFit
                    maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                    numberOfLines={1}
                    style={[styles.opponentTurnRevealText, gameLayout.styles.opponentTurnRevealText]}
                  >
                    {opponentTurnReveal.playerName} played{' '}
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[
                        styles.opponentTurnRevealTextHighlight,
                        gameLayout.styles.opponentTurnRevealTextHighlight,
                      ]}
                    >
                      {opponentTurnReveal.score}
                    </Text>{' '}
                    on{' '}
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[
                        styles.opponentTurnRevealTextHighlight,
                        gameLayout.styles.opponentTurnRevealTextHighlight,
                      ]}
                    >
                      {opponentTurnReveal.categoryLabel}
                    </Text>
                  </Text>
                </Animated.View>
              </View>
            </View>
          )}
          {scoreFlyDice.length > 0 && (
            <View pointerEvents="none" style={styles.scoreDiceOverlay}>
              {scoreFlyDice.map((die, index) => {
                const translateX = die.progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, die.toX - die.fromX],
                });
                const translateY = die.progress.interpolate({
                  inputRange: [0, 0.24, 0.72, 1],
                  outputRange: [
                    0,
                    gameLayout.unit(-30 - index * 2),
                    die.toY - die.fromY - gameLayout.unit(16),
                    die.toY - die.fromY,
                  ],
                });
                const scale = die.progress.interpolate({
                  inputRange: [0, 0.2, 0.78, 1],
                  outputRange: [1, 1.16, 0.78, 0.34],
                });
                const opacity = die.progress.interpolate({
                  inputRange: [0, 0.72, 1],
                  outputRange: [1, 1, 0],
                });
                const rotate = die.progress.interpolate({
                  inputRange: [0, 0.35, 0.72, 1],
                  outputRange: [
                    '0deg',
                    index % 2 === 0 ? '18deg' : '-18deg',
                    index % 2 === 0 ? '-10deg' : '10deg',
                    '0deg',
                  ],
                });

                return (
                  <Animated.View
                    key={die.id}
                    style={[
                      styles.scoreFlyingDie,
                      {
                        height: die.size,
                        left: die.fromX,
                        opacity,
                        top: die.fromY,
                        transform: [{ translateX }, { translateY }, { rotate }, { scale }],
                        width: die.size,
                      },
                    ]}
                  >
                    <DieFace face={die.face} style={styles.scoreFlyingDieImage} />
                  </Animated.View>
                );
              })}
            </View>
          )}
          {scoreFlyNumber && (
            <View pointerEvents="none" style={styles.scoreNumberOverlay}>
              {(() => {
                const translateX = scoreFlyNumber.progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, scoreFlyNumber.toX - scoreFlyNumber.fromX],
                });
                const translateY = scoreFlyNumber.progress.interpolate({
                  inputRange: [0, 0.24, 1],
                  outputRange: [0, gameLayout.unit(-18), scoreFlyNumber.toY - scoreFlyNumber.fromY],
                });
                const scale = scoreFlyNumber.progress.interpolate({
                  inputRange: [0, 0.25, 1],
                  outputRange: [1.8, 2.05, 0.82],
                });
                const opacity = scoreFlyNumber.progress.interpolate({
                  inputRange: [0, 0.82, 1],
                  outputRange: [1, 1, 0.1],
                });

                return (
                  <Animated.View
                    style={[
                      styles.scoreFlyingNumber,
                      gameLayout.styles.scoreFlyingNumber,
                      {
                        left: scoreFlyNumber.fromX,
                        opacity,
                        top: scoreFlyNumber.fromY,
                        transform: [{ translateX }, { translateY }, { scale }],
                      },
                    ]}
                  >
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[styles.scoreFlyingNumberText, gameLayout.styles.scoreFlyingNumberText]}
                    >
                      {scoreFlyNumber.value}
                    </Text>
                  </Animated.View>
                );
              })()}
            </View>
          )}
          {showSuckerPunchNotice && (
            <View
              pointerEvents="none"
              style={[styles.suckerPunchNoticeOverlay, gameLayout.styles.suckerPunchNoticeOverlay]}
              testID="sucker-punch-notice"
            >
              <View style={[styles.suckerPunchNotice, gameLayout.styles.suckerPunchNotice]}>
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  style={[styles.suckerPunchNoticeTitle, gameLayout.styles.suckerPunchNoticeTitle]}
                >
                  You got
                </Text>
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  style={[styles.suckerPunchNoticeText, gameLayout.styles.suckerPunchNoticeText]}
                >
                  Sucker Punched!
                </Text>
              </View>
            </View>
          )}
          {suckerBlockedNotice && (
            <View
              pointerEvents="none"
              style={[styles.suckerPunchNoticeOverlay, gameLayout.styles.suckerPunchNoticeOverlay]}
            >
              <View style={[styles.suckerPunchNotice, gameLayout.styles.suckerPunchNotice]}>
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  style={[styles.suckerPunchNoticeTitle, gameLayout.styles.suckerPunchNoticeTitle]}
                >
                  {suckerBlockedNotice.title}
                </Text>
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  style={[styles.suckerPunchNoticeText, gameLayout.styles.suckerPunchNoticeText]}
                >
                  {suckerBlockedNotice.text}
                </Text>
              </View>
            </View>
          )}
          {suckerRollNoticeTitle && (
            <View
              pointerEvents="none"
              style={[styles.suckerPunchNoticeOverlay, gameLayout.styles.suckerPunchNoticeOverlay]}
              testID="sucker-roll-notice"
            >
              <View
                style={[
                  styles.suckerPunchNotice,
                  gameLayout.styles.suckerPunchNotice,
                  styles.suckerRollNotice,
                  gameLayout.styles.suckerRollNotice,
                ]}
              >
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  style={[styles.suckerPunchNoticeTitle, gameLayout.styles.suckerPunchNoticeTitle]}
                >
                  {suckerRollNoticeTitle}
                </Text>
                <Text
                  maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                  style={[styles.suckerPunchNoticeText, gameLayout.styles.suckerPunchNoticeText]}
                >
                  Sucker!!
                </Text>
              </View>
            </View>
          )}
          {remoteError && (
            <View
              pointerEvents="none"
              style={[styles.remoteErrorNoticeOverlay, gameLayout.styles.remoteErrorNoticeOverlay]}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={[styles.remoteErrorNoticeText, gameLayout.styles.remoteErrorNoticeText]}
              >
                {remoteError}
              </Text>
            </View>
          )}
          {nextTurnsVisible && (
            <View style={[styles.nextTurnsOverlay, gameLayout.styles.nextTurnsOverlay]} testID="next-turns-dialog">
              <View style={[styles.nextTurnsPanel, gameLayout.styles.nextTurnsPanel]}>
                <Pressable
                  accessibilityLabel="Close next turns"
                  accessibilityRole="button"
                  hitSlop={gameLayout.unit(8)}
                  onPress={onDismissNextTurns}
                  style={({ pressed }) => [
                    styles.nextTurnsCloseButton,
                    gameLayout.styles.nextTurnsCloseButton,
                    pressed && styles.pressed,
                  ]}
                  testID="next-turns-close-button"
                >
                  <Text
                    maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                    style={[styles.nextTurnsCloseText, gameLayout.styles.nextTurnsCloseText]}
                  >
                    X
                  </Text>
                </Pressable>
                <Text maxFontSizeMultiplier={1.2} style={[styles.nextTurnsEyebrow, gameLayout.styles.nextTurnsEyebrow]}>
                  Turn Finished
                </Text>
                <Text maxFontSizeMultiplier={1.2} style={[styles.nextTurnsTitle, gameLayout.styles.nextTurnsTitle]}>
                  Keep playing?
                </Text>
                {nextTurnGames && nextTurnGames.length > 0 ? (
                  <ScrollView
                    contentContainerStyle={[styles.nextTurnsListContent, gameLayout.styles.nextTurnsListContent]}
                    showsVerticalScrollIndicator={false}
                    style={[styles.nextTurnsList, gameLayout.styles.nextTurnsList]}
                  >
                    {nextTurnGames.map((nextTurnGame) => (
                      <NextTurnGameButton
                        avatarUrls={playerAvatars}
                        game={nextTurnGame}
                        key={nextTurnGame.id}
                        onPress={() => handleOpenNextTurnGame(nextTurnGame.id)}
                        profileId={myProfileId ?? homePlayer.id}
                      />
                    ))}
                  </ScrollView>
                ) : (
                  <View style={[styles.nextTurnsEmpty, gameLayout.styles.nextTurnsEmpty]}>
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={[styles.nextTurnsEmptyText, gameLayout.styles.nextTurnsEmptyText]}
                    >
                      No other turns right now.
                    </Text>
                  </View>
                )}
                <Pressable
                  accessibilityLabel="Return to game lobby"
                  accessibilityRole="button"
                  onPress={handleNextTurnsLobby}
                  style={({ pressed }) => [
                    styles.nextTurnsLobbyButton,
                    gameLayout.styles.nextTurnsLobbyButton,
                    pressed && styles.pressed,
                  ]}
                  testID="next-turns-lobby-button"
                >
                  <View style={[styles.buttonInnerShade, gameLayout.styles.buttonInnerShade]} />
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={[styles.nextTurnsLobbyText, gameLayout.styles.nextTurnsLobbyText]}
                  >
                    Game Lobby
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          {gameOverVisible && (
            <View style={[styles.gameOverOverlay, gameLayout.styles.gameOverOverlay]} testID="game-over-overlay">
              <View style={[styles.gameOverPanel, gameLayout.styles.gameOverPanel]} testID="game-over-panel">
                <Pressable
                  accessibilityLabel="Close game and return to games list"
                  accessibilityRole="button"
                  hitSlop={gameLayout.unit(8)}
                  onPress={handleCloseGameOver}
                  style={({ pressed }) => [
                    styles.gameOverCloseButton,
                    gameLayout.styles.gameOverCloseButton,
                    pressed && styles.pressed,
                  ]}
                  testID="game-over-close-button"
                >
                  <Text
                    maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                    style={[styles.gameOverCloseText, gameLayout.styles.gameOverCloseText]}
                  >
                    ×
                  </Text>
                </Pressable>
                <Text maxFontSizeMultiplier={1.2} style={[styles.gameOverEyebrow, gameLayout.styles.gameOverEyebrow]}>
                  Game Over
                </Text>
                <Text maxFontSizeMultiplier={1.2} style={[styles.gameOverTitle, gameLayout.styles.gameOverTitle]}>
                  {gameOverTitle}
                </Text>
                <View style={[styles.gameOverScores, gameLayout.styles.gameOverScores]}>
                  <View
                    style={[styles.gameOverScoreBox, gameLayout.styles.gameOverScoreBox]}
                    testID="game-over-home-score"
                  >
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={[styles.gameOverScoreName, gameLayout.styles.gameOverScoreName]}
                    >
                      {homePlayer.name}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[styles.gameOverScoreValue, gameLayout.styles.gameOverScoreValue]}
                    >
                      {homeScore}
                    </Text>
                  </View>
                  <View
                    style={[styles.gameOverScoreBox, gameLayout.styles.gameOverScoreBox]}
                    testID="game-over-opponent-score"
                  >
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={[styles.gameOverScoreName, gameLayout.styles.gameOverScoreName]}
                    >
                      {opponentPlayer.name}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
                      style={[styles.gameOverScoreValue, gameLayout.styles.gameOverScoreValue]}
                    >
                      {opponentScore}
                    </Text>
                  </View>
                </View>
                <View style={[styles.gameOverActions, gameLayout.styles.gameOverActions]}>
                  <Pressable
                    accessibilityLabel="Start a rematch"
                    accessibilityRole="button"
                    onPress={() => void handleRematch()}
                    style={({ pressed }) => [
                      styles.gameOverPrimaryButton,
                      gameLayout.styles.gameOverPrimaryButton,
                      pressed && styles.pressed,
                    ]}
                    testID="game-over-rematch-button"
                  >
                    <View style={[styles.buttonGloss, gameLayout.styles.buttonGloss]} />
                    <View style={[styles.buttonInnerShade, gameLayout.styles.buttonInnerShade]} />
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={[styles.gameOverPrimaryText, gameLayout.styles.gameOverPrimaryText]}
                    >
                      Rematch
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="View game stats"
                    accessibilityRole="button"
                    onPress={() => handleOpenStats('gameOver')}
                    ref={gameOverStatsButtonRef}
                    style={({ pressed }) => [
                      styles.gameOverSecondaryButton,
                      gameLayout.styles.gameOverSecondaryButton,
                      pressed && styles.pressed,
                    ]}
                    testID="game-over-stats-button"
                  >
                    <View style={[styles.buttonInnerShade, gameLayout.styles.buttonInnerShade]} />
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={[styles.gameOverSecondaryText, gameLayout.styles.gameOverSecondaryText]}
                    >
                      Stats
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
          {showStatsPage && (
            <Modal
              accessibilityLabel="Game stats"
              animationType="none"
              navigationBarTranslucent
              onRequestClose={handleCloseStats}
              presentationStyle="overFullScreen"
              statusBarTranslucent
              transparent
              visible
            >
              <View style={[styles.statsModalHost, needsScrollableStage && styles.statsModalScrollableHost]}>
                <View
                  style={[
                    styles.statsModalStage,
                    gameStageStyle,
                    {
                      transform: [
                        { translateX: (effectiveSafeAreaInsets.left - effectiveSafeAreaInsets.right) / 2 },
                        { translateY: (effectiveSafeAreaInsets.top - effectiveSafeAreaInsets.bottom) / 2 },
                      ],
                    },
                  ]}
                  testID="stats-modal-stage"
                >
                  <StatsPage
                    currentOpponentName={opponentPlayer.name}
                    currentScore={totalScore(homePlayer.scorecard)}
                    onClose={handleCloseStats}
                    opponentScore={totalScore(opponentPlayer.scorecard)}
                    opponentStats={isRemoteGame ? (headToHeadStats?.opponent ?? null) : null}
                    stats={isRemoteGame ? (headToHeadStats?.mine ?? null) : computerStats}
                    statsKind={isRemoteGame ? 'headToHead' : 'computer'}
                  />
                </View>
              </View>
            </Modal>
          )}
        </View>
      </GameLayoutContext.Provider>
    );
  }

  const availableStageViewportWidth =
    effectiveWindowWidth - effectiveSafeAreaInsets.left - effectiveSafeAreaInsets.right;
  const availableStageViewportHeight =
    effectiveWindowHeight - effectiveSafeAreaInsets.top - effectiveSafeAreaInsets.bottom;
  const needsScrollableStage =
    Platform.OS === 'web' &&
    !devViewportPreset &&
    (gameStageStyle.width > availableStageViewportWidth || gameStageStyle.height > availableStageViewportHeight);

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={[styles.safeArea, stableScreenHostStyle]}>
      <StatusBar style="light" />
      {showDevViewportControls && (
        <DevViewportPresetControls
          activePresetKey={devViewportPresetKey}
          onSelect={(key) => {
            setDevViewportPresetKey(key);
            replaceWebDevViewportPreset(key);
          }}
        />
      )}
      {needsScrollableStage ? (
        <View style={styles.gameStageScroll} testID="game-stage-scroll">
          <View
            style={[
              styles.gameStageScrollContent,
              { minHeight: gameStageStyle.height, minWidth: gameStageStyle.width },
            ]}
          >
            {renderGameScreen()}
          </View>
        </View>
      ) : (
        renderGameScreen()
      )}
    </SafeAreaView>
  );
}

type PlayerView = ReturnType<typeof createGame>['players'][number];

function NextTurnGameButton({
  avatarUrls,
  game,
  onPress,
  profileId,
}: {
  avatarUrls: Readonly<Record<string, string | null>>;
  game: RemoteGameRow;
  onPress: () => void;
  profileId: string;
}) {
  const layout = useGameLayout();
  const opponent = game.state.players.find((player) => player.id !== profileId);
  const me = game.state.players.find((player) => player.id === profileId);
  const opponentName = opponent?.name ?? 'Opponent';
  const myScore = me ? totalScore(me.scorecard) : 0;
  const opponentScore = opponent ? totalScore(opponent.scorecard) : 0;

  return (
    <Pressable
      accessibilityLabel={`Play ${opponentName}. Score ${myScore} to ${opponentScore}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.nextTurnGameButton, layout.styles.nextTurnGameButton, pressed && styles.pressed]}
      testID={`next-turn-game-${game.id}`}
    >
      <PlayerAvatar
        avatarUrl={opponent ? avatarUrls[opponent.id] : null}
        decorative
        initialStyle={[styles.nextTurnAvatarText, layout.styles.nextTurnAvatarText]}
        name={opponentName}
        size={layout.unit(38)}
        style={[styles.nextTurnAvatar, layout.styles.nextTurnAvatar]}
        testID={`next-turn-avatar-${game.id}`}
      />
      <View style={styles.nextTurnGameText}>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={[styles.nextTurnOpponent, layout.styles.nextTurnOpponent]}
        >
          {opponentName}
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={[styles.nextTurnStatus, layout.styles.nextTurnStatus]}>
          Your turn
        </Text>
      </View>
      <View style={[styles.nextTurnScorePill, layout.styles.nextTurnScorePill]}>
        <Text
          maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
          style={[styles.nextTurnScoreText, layout.styles.nextTurnScoreText]}
        >
          {myScore}
        </Text>
        <Text
          maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
          style={[styles.nextTurnScoreDivider, layout.styles.nextTurnScoreDivider]}
        >
          -
        </Text>
        <Text
          maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
          style={[styles.nextTurnScoreText, layout.styles.nextTurnScoreText]}
        >
          {opponentScore}
        </Text>
      </View>
    </Pressable>
  );
}

function upperSectionTotal(scorecard: PlayerView['scorecard']) {
  return upperCategories.reduce((sum, category) => sum + (scorecard[category] ?? 0), 0);
}

function didAwardUpperBonusForPlayer(beforeGame: GameState, afterGame: GameState, playerId: string) {
  const beforePlayer = beforeGame.players.find((player) => player.id === playerId);
  const afterPlayer = afterGame.players.find((player) => player.id === playerId);

  if (!beforePlayer || !afterPlayer) {
    return false;
  }

  return (
    upperSectionTotal(beforePlayer.scorecard) < upperBonusTarget &&
    upperSectionTotal(afterPlayer.scorecard) >= upperBonusTarget
  );
}

function BonusValueText({
  awarded,
  faceColor,
  rotate,
  scale,
}: {
  awarded: boolean;
  faceColor: Animated.AnimatedInterpolation<string | number>;
  rotate: Animated.AnimatedInterpolation<string | number>;
  scale: Animated.AnimatedInterpolation<number>;
}) {
  const layout = useGameLayout();
  const outlineColor = awarded ? awardedBonusOutlineColor : bonusOutlineColor;

  return (
    <Animated.View
      style={[styles.bonusValueWrap, layout.styles.bonusValueWrap, { transform: [{ scale }, { rotate }] }]}
    >
      {bonusOutlineOffsets.map((offset, index) => (
        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
          key={`${offset.x}:${offset.y}:${index}`}
          numberOfLines={1}
          style={[
            styles.bonusBig,
            layout.styles.bonusBig,
            styles.bonusBigOutline,
            { color: outlineColor, left: layout.unit(offset.x), top: layout.unit(offset.y) },
          ]}
        >
          +35
        </Text>
      ))}
      <Animated.Text
        adjustsFontSizeToFit
        maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
        numberOfLines={1}
        style={[styles.bonusBig, layout.styles.bonusBig, styles.bonusBigFace, { color: faceColor }]}
      >
        +35
      </Animated.Text>
    </Animated.View>
  );
}

function TokenMenuOption({
  cost,
  costLabel,
  description,
  disabled = false,
  label,
  onPress,
  testID,
}: {
  cost: number;
  costLabel?: string;
  description: string;
  disabled?: boolean;
  label: string;
  onPress?: () => void;
  testID?: string;
}) {
  const layout = useGameLayout();
  return (
    <Pressable
      accessibilityLabel={`${label}, ${costLabel ?? cost} tokens. ${description}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tokenOption,
        layout.styles.tokenOption,
        disabled && styles.disabledTokenOption,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <View style={[styles.tokenOptionCost, layout.styles.tokenOptionCost]}>
        <Image source={suckerTokenImage} style={[styles.tokenOptionCostIcon, layout.styles.tokenOptionCostIcon]} />
        <Text
          maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
          style={[styles.tokenOptionCostText, layout.styles.tokenOptionCostText]}
        >
          {costLabel ?? cost}
        </Text>
      </View>
      <View style={styles.tokenOptionBody}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={[styles.tokenOptionTitle, layout.styles.tokenOptionTitle, disabled && styles.disabledTokenOptionText]}
        >
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          style={[
            styles.tokenOptionDescription,
            layout.styles.tokenOptionDescription,
            disabled && styles.disabledTokenOptionText,
          ]}
        >
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

function SuckerPunchChanceDialog({
  face,
  onDismissResult,
  onRoll,
  onThrowPunch,
  outcome,
  phase,
  rollProgress,
}: {
  face: DieValue;
  onDismissResult: () => void;
  onRoll: () => void;
  onThrowPunch: () => void;
  outcome?: SuckerPunchOutcome;
  phase: SuckerPunchDialogState['phase'];
  rollProgress: Animated.Value;
}) {
  const layout = useGameLayout();
  const isResult = phase === 'result';
  const didLand = Boolean(outcome?.landed);
  const didBlock = isResult && !didLand;
  const isRolled = phase === 'rolled';
  const isRollingChance = phase === 'rolling';
  const isThrowing = phase === 'throwing';
  const chancePercent = suckerPunchChanceByDie[face];
  const title = isResult
    ? outcome?.landed
      ? 'Punch landed!'
      : 'Punch blocked!'
    : isRolled
      ? `Rolled ${face}`
      : isThrowing
        ? 'Throwing Punch'
        : 'Sucker Punch';
  const buttonLabel =
    phase === 'rolling'
      ? 'ROLLING'
      : isRolled
        ? 'THROW PUNCH'
        : isThrowing
          ? 'THROWING'
          : isResult
            ? 'CONTINUE'
            : 'ROLL';
  const flyY = rollProgress.interpolate({
    inputRange: [0, 0.2, 0.45, 0.72, 0.9, 1],
    outputRange: [22, 12, -24, -12, -3, 0],
  });
  const flyX = rollProgress.interpolate({
    inputRange: [0, 0.22, 0.5, 0.74, 0.9, 1],
    outputRange: [-102, -58, 42, -12, -4, 0],
  });
  const flyScale = rollProgress.interpolate({
    inputRange: [0, 0.25, 0.55, 0.76, 0.9, 1],
    outputRange: [0.86, 1.18, 1.36, 1.02, 0.9, 1],
  });
  const flyRotate = rollProgress.interpolate({
    inputRange: [0, 0.2, 0.4, 0.62, 0.84, 1],
    outputRange: ['-28deg', '110deg', '-79deg', '51deg', '-15deg', '0deg'],
  });

  return (
    <View
      style={[styles.suckerPunchChanceOverlay, layout.styles.suckerPunchChanceOverlay]}
      testID="sucker-punch-chance-dialog"
    >
      <View style={[styles.suckerPunchChancePanel, layout.styles.suckerPunchChancePanel]}>
        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
          numberOfLines={1}
          style={[styles.suckerPunchChanceTitle, layout.styles.suckerPunchChanceTitle]}
        >
          {title}
        </Text>
        {phase === 'ready' && (
          <Text
            maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
            style={[styles.suckerPunchChanceHint, layout.styles.suckerPunchChanceHint]}
          >
            Higher roll, higher chance.
          </Text>
        )}
        {isRolled && (
          <Text
            maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
            style={[styles.suckerPunchChanceHint, layout.styles.suckerPunchChanceHint]}
          >
            {chancePercent}% chance to land.
          </Text>
        )}
        {isThrowing && (
          <Text
            maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
            style={[styles.suckerPunchChanceHint, layout.styles.suckerPunchChanceHint]}
          >
            Will it land?
          </Text>
        )}

        <View
          style={
            isResult
              ? [styles.suckerPunchResultImageShell, layout.styles.suckerPunchResultImageShell]
              : [styles.suckerPunchChanceDieShell, layout.styles.suckerPunchChanceDieShell]
          }
        >
          {isResult ? (
            <Image
              source={didBlock ? suckerPunchBlockedImage : suckerPunchLandedImage}
              style={styles.suckerPunchResultImage}
              testID="sucker-punch-result-image"
            />
          ) : (
            <Animated.View
              style={[
                styles.suckerPunchChanceDieTrack,
                layout.styles.suckerPunchChanceDieTrack,
                isRollingChance && {
                  transform: [{ translateX: flyX }, { translateY: flyY }, { rotate: flyRotate }, { scale: flyScale }],
                },
              ]}
              testID="sucker-punch-chance-die-track"
            >
              <DieFace
                face={face}
                style={[styles.suckerPunchChanceDieImage, layout.styles.suckerPunchChanceDieImage]}
              />
            </Animated.View>
          )}
        </View>

        <Pressable
          accessibilityLabel={buttonLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: phase === 'rolling' || isThrowing }}
          disabled={phase === 'rolling' || isThrowing}
          onPress={isResult ? onDismissResult : isRolled ? onThrowPunch : onRoll}
          style={({ pressed }) => [
            styles.suckerPunchRollButton,
            layout.styles.suckerPunchRollButton,
            (phase === 'rolling' || isThrowing) && styles.disabledSuckerPunchRollButton,
            pressed && styles.pressed,
          ]}
          testID="sucker-punch-chance-roll-button"
        >
          <Text
            maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
            style={[styles.suckerPunchRollButtonText, layout.styles.suckerPunchRollButtonText]}
          >
            {buttonLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function BonusMeter({ total }: { total: number }) {
  const layout = useGameLayout();
  const clampedTotal = Math.max(0, Math.min(upperBonusTarget, total));
  const progress = clampedTotal / upperBonusTarget;
  const size = layout.unit(44);
  const strokeWidth = layout.strokeWidth(5);
  const center = size / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const progressColor = '#F12D22';

  return (
    <View style={[styles.bonusMeter, layout.styles.bonusMeter]}>
      <View style={[styles.bonusMeterFace, layout.styles.bonusMeterFace]}>
        <Svg height={size} style={styles.bonusMeterSvg} width={size}>
          <Circle cx={center} cy={center} fill="#E7A845" r={radius} stroke="#5A1308" strokeWidth={strokeWidth} />
          {progress > 0 && (
            <Circle
              cx={center}
              cy={center}
              fill="transparent"
              r={radius}
              stroke={progressColor}
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={circumference * (1 - progress)}
              strokeLinecap="round"
              strokeWidth={strokeWidth}
              transform={`rotate(-90 ${center} ${center})`}
            />
          )}
        </Svg>
        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
          numberOfLines={1}
          style={[styles.bonusMeterText, layout.styles.bonusMeterText]}
        >
          {clampedTotal}/63
        </Text>
      </View>
    </View>
  );
}

type ScorePairProps = {
  leftCategory: ScoreCategory;
  rightCategory?: ScoreCategory;
  activePlayer: PlayerView;
  activePlayerIndex: number;
  homePlayer: PlayerView;
  opponentPlayer: PlayerView;
  dice: ReturnType<typeof createGame>['dice'];
  canChoose: boolean;
  selectedCategory: ScoreCategory | null;
  isChoosingSuckerDeal: boolean;
  highlightCategory: ScoreCategory | null;
  openCategories: ScoreCategory[];
  onSelect: (category: ScoreCategory) => void;
  setOpponentScoreRef: (category: ScoreCategory, node: ViewRef | null) => void;
  setScoreBoxRef: (category: ScoreCategory, node: ViewRef | null) => void;
  selectedPulse: Animated.Value;
  suckerPunchWipe: SuckerPunchWipe | null;
};

function ScorePair(props: ScorePairProps) {
  const layout = useGameLayout();
  return (
    <View style={[styles.boardRow, layout.styles.boardRow]}>
      <ScoreCell category={props.leftCategory} {...props} />
      {props.rightCategory ? (
        <ScoreCell category={props.rightCategory} {...props} />
      ) : (
        <View style={[styles.scorePair, layout.styles.scorePair]} />
      )}
    </View>
  );
}

type ScoreCellProps = Omit<ScorePairProps, 'leftCategory' | 'rightCategory'> & {
  category: ScoreCategory;
};

function ScoreCell({
  category,
  activePlayer,
  activePlayerIndex,
  homePlayer,
  opponentPlayer,
  dice,
  canChoose,
  selectedCategory,
  isChoosingSuckerDeal,
  highlightCategory,
  openCategories,
  onSelect,
  setOpponentScoreRef,
  setScoreBoxRef,
  selectedPulse,
  suckerPunchWipe,
}: ScoreCellProps) {
  const layout = useGameLayout();
  const homeLockedScore = homePlayer.scorecard[category];
  const opponentLockedScore = opponentPlayer.scorecard[category];
  const activeLockedScore = activePlayer.scorecard[category];
  const locked = activeLockedScore !== null;
  const selectable = canChoose && openCategories.includes(category);
  const selected = selectedCategory === category;
  const highlighted = selected || highlightCategory === category || (isChoosingSuckerDeal && selectable);
  const previewHasSuckerBonus = selected && !locked && hasPreviewSuckerBonus(dice, category, activePlayer.scorecard);
  const previewScore =
    selected && !locked
      ? previewHasSuckerBonus
        ? scoreCategory(dice, category)
        : scoreCategoryForScorecard(dice, category, activePlayer.scorecard)
      : null;
  const homePreviewScore = activePlayerIndex === 0 ? previewScore : null;
  const opponentPreviewScore = activePlayerIndex === 1 ? previewScore : null;
  const homeLockedSuckerBonus = (homePlayer.suckerBonusCategories ?? []).includes(category);
  const opponentLockedSuckerBonus = (opponentPlayer.suckerBonusCategories ?? []).includes(category);
  const homeSuckerBonus = homeLockedSuckerBonus || (activePlayerIndex === 0 && previewHasSuckerBonus);
  const opponentSuckerBonus = opponentLockedSuckerBonus || (activePlayerIndex === 1 && previewHasSuckerBonus);
  const homeDisplayScore = displayScoreWithoutSuckerBonus(homeLockedScore, homeLockedSuckerBonus);
  const opponentDisplayScore = displayScoreWithoutSuckerBonus(opponentLockedScore, opponentLockedSuckerBonus);
  const homeWipe =
    suckerPunchWipe?.category === category && suckerPunchWipe.playerId === homePlayer.id ? suckerPunchWipe : null;
  const opponentWipe =
    suckerPunchWipe?.category === category && suckerPunchWipe.playerId === opponentPlayer.id ? suckerPunchWipe : null;
  const scoreText =
    homeDisplayScore !== null ? String(homeDisplayScore) : homePreviewScore !== null ? String(homePreviewScore) : '';
  const opponentScoreText =
    opponentDisplayScore !== null
      ? String(opponentDisplayScore)
      : opponentPreviewScore !== null
        ? String(opponentPreviewScore)
        : '';
  const categoryLabel = categoryLabels[category];
  const scoreActionDisabled = !selectable || locked;
  const homeScoreAccessibilityValue = formatAccessibleScore(homeLockedScore, homePreviewScore);
  const opponentScoreAccessibilityValue = formatAccessibleScore(opponentLockedScore, opponentPreviewScore);
  const selectedScale = selectedPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, highlighted ? 1.06 : 1],
  });

  return (
    <View style={[styles.scorePair, layout.styles.scorePair]}>
      <Pressable
        accessibilityHint={scoreActionDisabled ? undefined : 'Selects this category for the current turn'}
        accessibilityLabel={`${categoryLabel} category for ${activePlayer.name}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: scoreActionDisabled, selected }}
        aria-pressed={selected}
        disabled={scoreActionDisabled}
        nativeID={`category-button-${category}`}
        onPress={() => onSelect(category)}
        testID={`category-button-${category}`}
        style={({ pressed }) => [
          styles.categoryTileButton,
          layout.styles.categoryTileButton,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.categoryTileFrame, layout.styles.categoryTileFrame]}>
          <View pointerEvents="none" style={[styles.categoryTileShadow, layout.styles.categoryTileShadow]} />
          <View
            style={[
              styles.categoryTile,
              layout.styles.categoryTile,
              category === 'sucker' && styles.suckerCategoryTile,
              highlighted && styles.selectedCategoryTile,
            ]}
          >
            <View style={[styles.tileGloss, layout.styles.tileGloss]} />
            <View style={[styles.tileGlossFade, layout.styles.tileGlossFade]} />
            <CategoryTile category={category} />
          </View>
        </View>
      </Pressable>
      <Animated.View
        style={[
          styles.scorePressWrap,
          layout.styles.scorePressWrap,
          {
            transform: [{ scale: selectedScale }],
          },
        ]}
      >
        <View pointerEvents="none" style={[styles.scoreBoxShadow, layout.styles.scoreBoxShadow]} />
        <View
          accessibilityLabel={`${homePlayer.name}, ${categoryLabel} score: ${homeScoreAccessibilityValue}`}
          accessibilityRole="text"
          accessibilityValue={{ text: homeScoreAccessibilityValue }}
          accessible
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          accessibilityElementsHidden
          accessible={false}
          aria-hidden
          disabled={scoreActionDisabled}
          importantForAccessibility="no-hide-descendants"
          onPress={() => onSelect(category)}
          ref={(node) => setScoreBoxRef(category, node)}
          style={({ pressed }) => [
            styles.scoreBox,
            layout.styles.scoreBox,
            homeLockedScore !== null && styles.lockedScoreBox,
            highlighted && activePlayerIndex === 0 && styles.selectedScoreBox,
            homePreviewScore === 0 && styles.zeroPreviewScoreBox,
            pressed && styles.pressed,
          ]}
          tabIndex={-1}
          testID={`home-score-box-${category}`}
        >
          {homeSuckerBonus && <SuckerBonusBadge />}
          {homeWipe ? (
            <SuckerPunchScoreWipe home progress={homeWipe.progress} score={homeWipe.score} />
          ) : (
            <Text
              maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
              numberOfLines={1}
              style={[
                styles.scoreBoxText,
                layout.styles.scoreBoxText,
                homePreviewScore !== null && styles.previewScoreText,
              ]}
            >
              {scoreText}
            </Text>
          )}
        </Pressable>
      </Animated.View>
      <View style={[styles.opponentScoreWrap, layout.styles.opponentScoreWrap]}>
        <View
          accessibilityLabel={`${opponentPlayer.name}, ${categoryLabel} score: ${opponentScoreAccessibilityValue}`}
          accessibilityRole="text"
          accessibilityValue={{ text: opponentScoreAccessibilityValue }}
          accessible
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          accessibilityElementsHidden
          accessible={false}
          aria-hidden
          disabled={scoreActionDisabled}
          importantForAccessibility="no-hide-descendants"
          onPress={() => onSelect(category)}
          ref={(node) => setOpponentScoreRef(category, node)}
          style={styles.opponentScoreButton}
          tabIndex={-1}
          testID={`opponent-score-box-${category}`}
        >
          {opponentSuckerBonus && <SuckerBonusBadge opponent />}
          {opponentWipe ? (
            <SuckerPunchScoreWipe home={false} progress={opponentWipe.progress} score={opponentWipe.score} />
          ) : (
            <Text
              maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
              numberOfLines={1}
              style={[
                styles.opponentScoreText,
                layout.styles.opponentScoreText,
                opponentPreviewScore !== null && styles.previewScoreText,
              ]}
            >
              {opponentScoreText}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function formatAccessibleScore(lockedScore: number | null, previewScore: number | null) {
  if (lockedScore !== null) {
    return `${lockedScore} points, scored`;
  }

  if (previewScore !== null) {
    return `${previewScore} points, preview`;
  }

  return 'Not scored';
}

function SuckerPunchScoreWipe({ home, progress, score }: { home: boolean; progress: Animated.Value; score: number }) {
  const layout = useGameLayout();
  const scoreOpacity = progress.interpolate({
    inputRange: [0, 0.2, 0.26, 1],
    outputRange: [1, 1, 0, 0],
  });
  const impactOpacity = progress.interpolate({
    inputRange: [0, 0.08, 0.62, 0.9, 1],
    outputRange: [0, 1, 1, 0.28, 0],
  });
  const impactScale = progress.interpolate({
    inputRange: [0, 0.24, 0.68, 1],
    outputRange: [0, 1.42, 0.94, 0],
  });

  return (
    <Animated.View pointerEvents="none" style={styles.suckerPunchScoreWipe} testID="sucker-punch-score-wipe">
      <Animated.View
        style={[
          styles.suckerPunchWipeImpact,
          layout.styles.suckerPunchWipeImpact,
          {
            opacity: impactOpacity,
            transform: [{ scale: impactScale }],
          },
        ]}
        testID="sucker-punch-impact"
      >
        <Svg
          height={layout.unit(36)}
          style={styles.suckerPunchWipeImpactGraphic}
          viewBox="0 0 36 36"
          width={layout.unit(36)}
        >
          <Path
            d="M18 1 22 11 33 6 27 16 35 18 27 22 33 31 22 27 18 35 14 27 3 31 9 22 1 18 9 14 3 5 14 11Z"
            fill="#FFD329"
            stroke="#F12D22"
            strokeLinejoin="round"
            strokeWidth={3}
          />
          <Circle cx={18} cy={18} fill="#F12D22" r={4} />
        </Svg>
      </Animated.View>
      <Animated.Text
        maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
        numberOfLines={1}
        style={[
          home ? styles.scoreBoxText : styles.opponentScoreText,
          home ? layout.styles.scoreBoxText : layout.styles.opponentScoreText,
          styles.suckerPunchWipeScoreText,
          {
            opacity: scoreOpacity,
          },
        ]}
      >
        {score}
      </Animated.Text>
    </Animated.View>
  );
}

function runAnimation(animation: Animated.CompositeAnimation) {
  return new Promise<void>((resolve) => {
    animation.start(() => resolve());
  });
}

function formatScoreRevealCategory(category: ScoreCategory) {
  switch (category) {
    case 'threeOfAKind':
      return '3 of a Kind';
    case 'fourOfAKind':
      return '4 of a Kind';
    case 'fullHouse':
      return 'Full House';
    case 'smallStraight':
      return 'Small Straight';
    case 'largeStraight':
      return 'Large Straight';
    default:
      return categoryLabels[category];
  }
}
function displayScoreWithoutSuckerBonus(score: number | null, hasSuckerBonus: boolean) {
  if (score === null) {
    return null;
  }

  return hasSuckerBonus ? Math.max(0, score - 50) : score;
}

function hasPreviewSuckerBonus(
  dice: ReturnType<typeof createGame>['dice'],
  category: ScoreCategory,
  scorecard: PlayerView['scorecard'],
) {
  return category !== 'sucker' && scorecard.sucker !== null && dice.every((die) => die === dice[0]);
}

function isSuckerDice(dice: ReturnType<typeof createGame>['dice']) {
  return dice.every((die) => die === dice[0]);
}

function SuckerBonusBadge({ opponent = false }: { opponent?: boolean }) {
  const layout = useGameLayout();
  return (
    <View
      style={[
        styles.suckerBonusBadge,
        opponent ? layout.styles.opponentSuckerBonusBadge : layout.styles.suckerBonusBadge,
      ]}
    >
      <Text
        maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
        style={[
          styles.suckerBonusBadgeText,
          opponent ? layout.styles.opponentSuckerBonusBadgeText : layout.styles.suckerBonusBadgeText,
        ]}
      >
        +50
      </Text>
    </View>
  );
}

function BackgroundDicePattern({ floatValue }: { floatValue: Animated.Value }) {
  const layout = useGameLayout();
  const drift = floatValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, layout.unit(9)],
  });

  return (
    <View pointerEvents="none" style={styles.backgroundPattern}>
      {[1, 2, 3, 4, 5, 6].map((face, index) => (
        <Animated.View
          key={`${face}-${index}`}
          style={[
            styles.backgroundDie,
            layout.styles.backgroundDie,
            scalePosition(backgroundDiePositions[index], layout),
            {
              transform: [
                { translateY: index % 2 === 0 ? drift : Animated.multiply(drift, -1) },
                { rotate: `${index % 2 === 0 ? -12 : 14}deg` },
              ],
            },
          ]}
        >
          <DieFace face={face as DieValue} style={styles.dieImage} variant="background" />
        </Animated.View>
      ))}
    </View>
  );
}

function scalePosition(position: Readonly<Record<string, number | string>>, layout: GameLayout) {
  return Object.fromEntries(
    Object.entries(position).map(([edge, value]) => [edge, typeof value === 'number' ? layout.unit(value) : value]),
  );
}

const diePipPositions: Record<DieValue, Array<[number, number]>> = {
  1: [[34, 34]],
  2: [
    [20, 20],
    [48, 48],
  ],
  3: [
    [20, 20],
    [34, 34],
    [48, 48],
  ],
  4: [
    [20, 20],
    [48, 20],
    [20, 48],
    [48, 48],
  ],
  5: [
    [20, 20],
    [48, 20],
    [34, 34],
    [20, 48],
    [48, 48],
  ],
  6: [
    [20, 18],
    [48, 18],
    [20, 34],
    [48, 34],
    [20, 50],
    [48, 50],
  ],
};

function DieFace({
  face,
  style,
  variant = 'white',
}: {
  face: DieValue;
  style?: StyleProp<ViewStyle>;
  variant?: 'background' | 'pips' | 'white';
}) {
  const pipColor = variant === 'background' ? '#B91510' : variant === 'pips' ? '#FFFFFF' : '#414141';

  return (
    <View style={style}>
      <Svg height="100%" viewBox="0 0 68 68" width="100%">
        {variant !== 'pips' && (
          <>
            <Rect fill={variant === 'background' ? '#5A1308' : '#210505'} height={61} rx={11} width={61} x={4} y={5} />
            <Rect
              fill={variant === 'background' ? '#7A1208' : '#EEEEEE'}
              height={61}
              rx={11}
              stroke={variant === 'background' ? '#5A1308' : '#838383'}
              strokeWidth={1.5}
              width={61}
              x={2}
              y={2}
            />
            {variant === 'white' && <Rect fill="#FFFFFF" height={56} rx={9} width={56} x={4.5} y={4.5} />}
          </>
        )}
        {diePipPositions[face].map(([cx, cy]) => (
          <Circle cx={cx} cy={cy} fill={pipColor} key={`${cx}:${cy}`} r={variant === 'pips' ? 7 : 6} />
        ))}
      </Svg>
    </View>
  );
}

function CategoryTile({ category }: { category: ScoreCategory }) {
  const layout = useGameLayout();
  const upperIndex = upperCategories.indexOf(category);

  if (upperIndex >= 0) {
    const face = (upperIndex + 1) as DieValue;
    return <DieFace face={face} style={styles.categoryDiePips} variant="pips" />;
  }

  switch (category) {
    case 'threeOfAKind':
      return (
        <Text maxFontSizeMultiplier={gameMaxFontSizeMultiplier} style={[styles.kindText, layout.styles.kindText]}>
          3x
        </Text>
      );
    case 'fourOfAKind':
      return (
        <Text maxFontSizeMultiplier={gameMaxFontSizeMultiplier} style={[styles.kindText, layout.styles.kindText]}>
          4x
        </Text>
      );
    case 'fullHouse':
      return <FullHouseIcon />;
    case 'smallStraight':
      return <StraightIcon label="SMALL" cardCount={3} />;
    case 'largeStraight':
      return <StraightIcon label="LARGE" cardCount={4} />;
    case 'sucker':
      return <SuckerIcon />;
    case 'chance':
      return (
        <Text maxFontSizeMultiplier={gameMaxFontSizeMultiplier} style={[styles.chanceText, layout.styles.chanceText]}>
          ?
        </Text>
      );
    default:
      return null;
  }
}

function FullHouseIcon() {
  const layout = useGameLayout();
  return (
    <View style={[styles.fullHouseIcon, { height: layout.unit(42), width: layout.unit(44) }]}>
      <View
        style={[
          styles.houseRoof,
          {
            borderBottomWidth: layout.unit(18),
            borderLeftWidth: layout.unit(21),
            borderRightWidth: layout.unit(21),
          },
        ]}
      />
      <View style={[styles.houseBody, { height: layout.unit(20), width: layout.unit(34) }]}>
        <View
          style={[
            styles.houseDoor,
            {
              borderTopLeftRadius: layout.unit(4),
              borderTopRightRadius: layout.unit(4),
              height: layout.unit(13),
              width: layout.unit(8),
            },
          ]}
        />
      </View>
    </View>
  );
}

function StraightIcon({ label, cardCount }: { label: string; cardCount: 3 | 4 }) {
  const layout = useGameLayout();
  const cards = [...Array(cardCount)];
  const fanCardWidth = layout.unit(17);
  const fanCardSpread = layout.unit(7);
  const fanWidth = fanCardWidth + (cardCount - 1) * fanCardSpread;

  return (
    <View style={[styles.straightIcon, { height: layout.unit(48), width: layout.unit(52) }]}>
      <View style={[styles.cardFan, { height: layout.unit(30), width: fanWidth }]}>
        {cards.map((_, index) => (
          <View
            key={index}
            style={[
              styles.fanCard,
              {
                left: index * fanCardSpread,
                top: Math.abs(index - (cardCount - 1) / 2) * layout.unit(3),
                transform: [{ rotate: `${(index - (cardCount - 1) / 2) * 13}deg` }],
                borderRadius: layout.unit(3),
                borderWidth: layout.strokeWidth(2),
                height: layout.unit(25),
                width: fanCardWidth,
              },
            ]}
          >
            <View
              style={[
                styles.fanCardCorner,
                { borderRadius: layout.unit(2), height: layout.unit(5), width: layout.unit(5) },
              ]}
            />
          </View>
        ))}
      </View>
      <Text
        maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
        style={[
          styles.straightLabel,
          { bottom: layout.unit(1), fontSize: layout.unit(9), lineHeight: layout.unit(10) },
          label === 'LARGE' && styles.largeStraightLabel,
          label === 'LARGE' && { fontSize: layout.unit(8) },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function DevViewportPresetControls({
  activePresetKey,
  onSelect,
}: {
  activePresetKey: DevViewportPresetSelection;
  onSelect: (key: DevViewportPresetSelection) => void;
}) {
  return (
    <View style={styles.devViewportPresetBar}>
      <Pressable
        accessibilityLabel="Responsive viewport"
        accessibilityRole="button"
        accessibilityState={{ selected: activePresetKey === 'responsive' }}
        onPress={() => onSelect('responsive')}
        style={[
          styles.devViewportPresetButton,
          activePresetKey === 'responsive' && styles.activeDevViewportPresetButton,
        ]}
      >
        <Text
          maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
          style={[styles.devViewportPresetText, activePresetKey === 'responsive' && styles.activeDevViewportPresetText]}
        >
          Resp
        </Text>
      </Pressable>
      {gameViewportPresets.map((preset) => (
        <Pressable
          accessibilityLabel={`${preset.label} viewport`}
          accessibilityRole="button"
          accessibilityState={{ selected: activePresetKey === preset.key }}
          key={preset.key}
          onPress={() => onSelect(preset.key)}
          style={[
            styles.devViewportPresetButton,
            activePresetKey === preset.key && styles.activeDevViewportPresetButton,
          ]}
        >
          <Text
            maxFontSizeMultiplier={gameMaxFontSizeMultiplier}
            style={[styles.devViewportPresetText, activePresetKey === preset.key && styles.activeDevViewportPresetText]}
          >
            {preset.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function SuckerIcon() {
  return <SuckerWordmark variant="tile" />;
}

function SuckerWordmark({ variant }: { variant: 'header' | 'tile' }) {
  const layout = useGameLayout();
  const isHeader = variant === 'header';

  return (
    <View
      style={[
        styles.suckerWordmark,
        isHeader ? styles.headerSuckerWordmark : styles.tileSuckerWordmark,
        isHeader
          ? { height: layout.unit(44), width: layout.unit(168) }
          : { height: layout.unit(44), width: layout.unit(68) },
      ]}
    >
      <Image
        source={isHeader ? suckerLobbyHeaderImage : suckerScorecardWordmarkImage}
        style={styles.suckerWordmarkImage}
      />
    </View>
  );
}

function GameBackChevronIcon({ size }: { size: number }) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M15 18 9 12l6-6"
        fill="none"
        stroke="#050505"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={4.6}
        transform="translate(1.2 1.2)"
      />
      <Path
        d="M15 18 9 12l6-6"
        fill="none"
        stroke="#FFF0A6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={4.6}
      />
    </Svg>
  );
}

function createBoxShadowStyle(offsetX: number, offsetY: number, blurRadius: number, color: string): ViewStyle {
  if (usesLegacyAndroidShadowFallback) {
    const extent = Math.max(Math.abs(offsetX), Math.abs(offsetY), blurRadius);
    return extent === 0 ? {} : { elevation: Math.max(1, Math.ceil(extent)) };
  }

  return {
    boxShadow: [{ blurRadius, color, offsetX, offsetY }],
  };
}

const styles = StyleSheet.create({
  fontLoadingScreen: {
    backgroundColor: '#8F0000',
    flex: 1,
  },
  safeArea: {
    alignItems: 'center',
    backgroundColor: '#A60000',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  gameStageScroll: {
    alignSelf: 'stretch',
    flex: 1,
    overflow: 'scroll',
  },
  gameStageScrollContent: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
  },
  statsModalHost: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  statsModalScrollableHost: {
    justifyContent: 'flex-start',
    overflow: 'scroll',
  },
  statsModalStage: {
    backgroundColor: '#8F0000',
    overflow: 'hidden',
    position: 'relative',
  },
  devViewportPresetBar: {
    backgroundColor: 'rgba(33, 5, 5, 0.84)',
    borderColor: '#FFD329',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    left: 8,
    padding: 4,
    position: 'absolute',
    right: 8,
    top: 8,
    zIndex: 120,
  },
  devViewportPresetButton: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderRadius: 5,
    minWidth: 32,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  activeDevViewportPresetButton: {
    backgroundColor: '#FFD329',
  },
  devViewportPresetText: {
    color: '#210505',
    fontSize: 11,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 13,
  },
  activeDevViewportPresetText: {
    color: '#8F0000',
  },
  screen: {
    backgroundColor: '#A60000',
    gap: 8,
    overflow: 'hidden',
    padding: 6,
    paddingBottom: 2,
  },
  remoteBackButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 8,
    borderWidth: 3,
    height: 44,
    justifyContent: 'center',
    minWidth: 120,
  },
  remoteBackButtonText: {
    color: '#210505',
    fontSize: 16,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  remoteLoadingScreen: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    gap: 12,
    justifyContent: 'center',
    padding: 16,
  },
  remoteLoadingTitle: {
    color: '#FFD329',
    fontSize: 26,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  remoteMessage: {
    color: '#FFF3C2',
    fontSize: 14,
    fontFamily: gameFontExtraBold,
    fontWeight: '800',
    textAlign: 'center',
  },
  backgroundPattern: {
    ...StyleSheet.absoluteFill,
    opacity: 0.12,
  },
  backgroundDie: {
    height: 64,
    opacity: 0.45,
    position: 'absolute',
    width: 64,
  },
  topBar: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    borderColor: '#FFD329',
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 56,
    overflow: 'visible',
    paddingHorizontal: 10,
    paddingVertical: 4,
    position: 'relative',
    zIndex: 60,
  },
  topBarBannerClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: 8,
    overflow: 'hidden',
    zIndex: 1,
  },
  topBarBannerImage: {
    height: '100%',
    width: '100%',
  },
  backButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    left: 6,
    position: 'absolute',
    top: -1,
    width: 48,
    zIndex: 25,
  },
  menuDots: {
    alignItems: 'center',
    gap: 3,
    justifyContent: 'center',
  },
  menuDot: {
    backgroundColor: '#FFF0A6',
    borderColor: '#050505',
    borderRadius: 4,
    borderWidth: 1,
    height: 7,
    width: 7,
  },
  menuDotsButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: 10,
    top: 11,
    width: 32,
    zIndex: 25,
  },
  topMenuLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 80,
  },
  topMenu: {
    backgroundColor: '#FFF3C2',
    borderColor: '#210505',
    borderRadius: 8,
    borderWidth: 2,
    elevation: 12,
    padding: 4,
    position: 'absolute',
    right: 18,
    top: 50,
    width: 116,
    zIndex: 82,
  },
  topMenuItem: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  topMenuText: {
    color: '#210505',
    fontSize: 13,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  playerStrip: {
    backgroundColor: '#1B0505',
    borderRadius: 8,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  playerPill: {
    alignItems: 'center',
    flex: 1,
    minHeight: 64,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingLeft: 70,
    paddingRight: 8,
  },
  activePlayer: {
    backgroundColor: '#B91510',
  },
  playerScore: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 25,
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 0,
  },
  playerName: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    maxWidth: '100%',
  },
  tokenText: {
    color: '#FFD329',
    fontSize: 10,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#160303',
    borderColor: '#FFD329',
    borderRadius: 25,
    borderWidth: 3,
    height: 50,
    justifyContent: 'center',
    left: 10,
    position: 'absolute',
    top: 7,
    width: 50,
  },
  activeAvatar: {
    backgroundColor: '#FFD76A',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  board: {
    backgroundColor: '#F3B84A',
    borderColor: '#210505',
    borderRadius: 16,
    borderWidth: 3,
    flex: 0.94,
    overflow: 'hidden',
  },
  boardRow: {
    borderBottomColor: '#FFE083',
    borderBottomWidth: 1,
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  scorePair: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minWidth: 0,
    paddingHorizontal: 4,
  },
  categoryTileButton: {
    alignItems: 'flex-start',
    flexShrink: 0,
    height: 68,
    justifyContent: 'center',
    overflow: 'visible',
    width: 64,
  },
  categoryTileFrame: {
    height: 54,
    position: 'relative',
    width: 54,
  },
  categoryTileShadow: {
    backgroundColor: '#5A1308',
    borderRadius: 12,
    height: 54,
    left: 3,
    opacity: 0.5,
    position: 'absolute',
    top: 4,
    width: 54,
  },
  categoryTile: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFF3C2',
    borderRadius: 12,
    borderWidth: 3,
    justifyContent: 'center',
    height: 54,
    overflow: 'hidden',
    width: 54,
  },
  selectedCategoryTile: {
    borderColor: '#FFD329',
  },
  suckerCategoryTile: {
    overflow: 'visible',
    zIndex: 2,
  },
  tileGloss: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    height: 17,
    left: 5,
    opacity: 0.23,
    position: 'absolute',
    right: 5,
    top: 3,
  },
  tileGlossFade: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    height: 8,
    left: 9,
    opacity: 0.08,
    position: 'absolute',
    right: 9,
    top: 18,
  },
  categoryDiePips: {
    height: '112%',
    width: '112%',
    zIndex: 1,
  },
  kindText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    textAlign: 'center',
  },
  chanceText: {
    color: '#FFFFFF',
    fontSize: 34,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  scoreBox: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 12,
    borderWidth: 3,
    justifyContent: 'center',
    height: 56,
    overflow: 'visible',
    width: '100%',
  },
  scoreBoxShadow: {
    backgroundColor: '#5A1308',
    borderRadius: 12,
    height: '100%',
    left: 3,
    opacity: 0.5,
    position: 'absolute',
    top: 5,
    width: '100%',
  },
  scorePressWrap: {
    height: 56,
    width: 54,
  },
  opponentScoreWrap: {
    alignItems: 'center',
    flexShrink: 0,
    height: 56,
    justifyContent: 'center',
    width: 50,
  },
  opponentScoreButton: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedScoreBox: {
    backgroundColor: '#FFE08A',
  },
  selectedScoreBox: {
    borderColor: '#FFD329',
    borderWidth: 3,
  },
  zeroPreviewScoreBox: {
    backgroundColor: '#F7D09B',
  },
  scoreBoxText: {
    color: '#7A220D',
    fontSize: 32,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 34,
    textAlign: 'center',
    width: '100%',
  },
  opponentScoreText: {
    color: '#A24B13',
    fontSize: 32,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 34,
    textAlign: 'center',
    width: '100%',
  },
  suckerPunchScoreWipe: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 8,
  },
  suckerPunchWipeScoreText: {
    zIndex: 1,
  },
  suckerPunchWipeImpact: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    height: 36,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -18,
    marginTop: -18,
    position: 'absolute',
    top: '50%',
    width: 36,
    zIndex: 3,
  },
  suckerPunchWipeImpactGraphic: {
    backgroundColor: 'transparent',
  },
  previewScoreText: {
    color: '#7A1208',
  },
  suckerBonusBadge: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderBottomColor: '#7A1208',
    borderBottomWidth: 2,
    borderRadius: 2,
    height: 19,
    justifyContent: 'center',
    position: 'absolute',
    right: -5,
    top: -8,
    transform: [{ rotate: '-1deg' }],
    width: 43,
    zIndex: 5,
  },
  suckerBonusBadgeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 17,
    textShadowColor: '#7A1208',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  bonusPanel: {
    flex: 1,
    justifyContent: 'center',
  },
  bonusContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'flex-start',
    paddingLeft: 6,
  },
  bonusTextBlock: {
    justifyContent: 'center',
    width: 61,
  },
  bonusSmall: {
    color: '#5A1308',
    fontSize: 10,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 10,
    textTransform: 'uppercase',
  },
  bonusValueWrap: {
    height: 30,
    marginTop: -1,
    position: 'relative',
    width: 62,
  },
  bonusBig: {
    fontSize: 25,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 27,
    textAlign: 'center',
    width: 62,
  },
  bonusBigOutline: {
    position: 'absolute',
  },
  bonusBigFace: {
    left: 0,
    position: 'absolute',
    top: 0,
  },

  bonusMeter: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    position: 'relative',
    width: 43,
  },
  bonusMeterFace: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    position: 'relative',
    width: 44,
  },
  bonusMeterSvg: {
    left: 0,
    position: 'absolute',
    top: 0,
  },
  bonusMeterText: {
    color: '#5A1308',
    fontSize: 10,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 12,
    textAlign: 'center',
    zIndex: 2,
  },
  diceTray: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    height: 70,
    justifyContent: 'center',
  },
  rollZone: {
    gap: 7,
    marginTop: 4,
    position: 'relative',
  },
  dieMotion: {
    aspectRatio: 1,
    flexShrink: 0,
    height: '100%',
    position: 'relative',
  },
  dieSlot: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#7A220D',
    borderRadius: 12,
    borderWidth: 3,
    height: '100%',
    justifyContent: 'center',
    ...createBoxShadowStyle(0, 0, 2, 'rgba(5, 5, 5, 0.4)'),
    width: '100%',
  },
  settlingDieSlot: {
    opacity: 0.55,
  },
  heldDie: {
    backgroundColor: '#FFF0A6',
    borderColor: '#FFD329',
    ...(usesLegacyAndroidShadowFallback ? { elevation: 0 } : createBoxShadowStyle(0, 0, 6, '#FFD329')),
  },
  heldDieGlow: {
    backgroundColor: '#FFD329',
    opacity: 0.58,
    position: 'absolute',
  },
  dieImage: {
    height: '100%',
    width: '100%',
  },
  scoringSourceDieImage: {
    opacity: 0,
  },
  heldDieImage: {
    transform: [{ scale: 1.03 }],
  },
  rollingDiceOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 8,
  },
  rollingDieTrack: {
    alignItems: 'center',
    height: 88,
    justifyContent: 'center',
    position: 'absolute',
    left: 0,
    top: 0,
    width: 88,
  },
  rollingDieImage: {
    height: 88,
    width: 88,
  },
  opponentTurnRevealOverlay: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 26,
  },
  opponentTurnRevealPanel: {
    alignItems: 'center',
    backgroundColor: 'rgba(90, 19, 8, 0.68)',
    borderBottomColor: 'rgba(255, 211, 41, 0.5)',
    borderBottomWidth: 1,
    borderTopColor: 'rgba(255, 211, 41, 0.5)',
    borderTopWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: '100%',
  },
  opponentTurnRevealDiceRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  opponentTurnRevealDie: {
    alignItems: 'center',
    justifyContent: 'center',
    ...createBoxShadowStyle(0, 4, 0, 'rgba(5, 5, 5, 0.38)'),
  },
  opponentTurnRevealDieImage: {
    height: '100%',
    width: '100%',
  },
  opponentTurnRevealMessage: {
    alignItems: 'center',
    marginTop: 2,
    maxWidth: '96%',
    minHeight: 22,
    paddingHorizontal: 6,
  },
  opponentTurnRevealText: {
    color: '#FFF3C2',
    fontSize: 15,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 20,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  opponentTurnRevealTextHighlight: {
    color: '#FFD329',
    fontSize: 17,
    textShadowColor: '#5A1308',
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 0,
  },
  scoreDiceOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 24,
  },
  scoreFlyingDie: {
    alignItems: 'center',
    height: 64,
    justifyContent: 'center',
    position: 'absolute',
    width: 64,
  },
  scoreFlyingDieImage: {
    height: '100%',
    width: '100%',
  },
  scoreNumberOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 25,
  },
  scoreFlyingNumber: {
    alignItems: 'center',
    height: 52,
    justifyContent: 'center',
    position: 'absolute',
    width: 88,
  },
  scoreFlyingNumberText: {
    color: '#7A220D',
    fontSize: 42,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 48,
    textAlign: 'center',
    textShadowColor: '#FFF3C2',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  suckerPunchChanceOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(20, 0, 0, 0.66)',
    justifyContent: 'center',
    padding: 16,
    zIndex: 96,
  },
  suckerPunchChancePanel: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 14,
    borderWidth: 4,
    gap: 14,
    maxWidth: 286,
    paddingHorizontal: 18,
    paddingVertical: 18,
    ...createBoxShadowStyle(0, 6, 0, 'rgba(5, 5, 5, 0.5)'),
    width: '100%',
  },
  suckerPunchChanceTitle: {
    color: '#FFD329',
    fontSize: 28,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 32,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  suckerPunchChanceHint: {
    color: '#FFF3C2',
    fontSize: 15,
    fontFamily: gameFontExtraBold,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: -8,
    textAlign: 'center',
  },
  suckerPunchChanceDieShell: {
    alignItems: 'center',
    height: 116,
    justifyContent: 'center',
    width: 116,
  },
  suckerPunchChanceDieTrack: {
    alignItems: 'center',
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  suckerPunchChanceDieImage: {
    height: 112,
    width: 112,
  },
  suckerPunchResultImageShell: {
    alignItems: 'center',
    aspectRatio: 1,
    borderColor: '#050505',
    borderRadius: 12,
    borderWidth: 3,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  suckerPunchResultImage: {
    height: '100%',
    resizeMode: 'cover',
    width: '100%',
  },
  suckerPunchRollButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 10,
    borderWidth: 3,
    height: 48,
    justifyContent: 'center',
    marginTop: 4,
    ...createBoxShadowStyle(0, 4, 0, 'rgba(5, 5, 5, 0.4)'),
    width: '100%',
  },
  disabledSuckerPunchRollButton: {
    opacity: 0.72,
  },
  suckerPunchRollButtonText: {
    color: '#FFF3C2',
    fontSize: 20,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 23,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  suckerPunchNoticeOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 85,
  },
  suckerPunchNotice: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 14,
    borderWidth: 4,
    paddingHorizontal: 18,
    paddingVertical: 14,
    ...createBoxShadowStyle(0, 5, 0, 'rgba(5, 5, 5, 0.45)'),
    transform: [{ rotate: '-2deg' }],
  },
  suckerRollNotice: {
    paddingHorizontal: 26,
    paddingVertical: 18,
    transform: [{ rotate: '2deg' }],
  },
  suckerPunchNoticeTitle: {
    color: '#FFF3C2',
    fontSize: 17,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 20,
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
    textTransform: 'uppercase',
  },
  suckerPunchNoticeText: {
    color: '#FFD329',
    fontSize: 25,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 29,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  remoteErrorNoticeOverlay: {
    alignItems: 'center',
    left: 10,
    position: 'absolute',
    right: 10,
    top: 116,
    zIndex: 88,
  },
  remoteErrorNoticeText: {
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 8,
    borderWidth: 2,
    color: '#FFF3C2',
    fontSize: 12,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 7,
    textAlign: 'center',
  },
  nextTurnsOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(20, 0, 0, 0.62)',
    justifyContent: 'center',
    padding: 14,
    zIndex: 94,
  },
  nextTurnsPanel: {
    alignItems: 'stretch',
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 14,
    borderWidth: 4,
    gap: 10,
    maxHeight: '78%',
    padding: 14,
    ...createBoxShadowStyle(0, 6, 0, 'rgba(5, 5, 5, 0.5)'),
    width: '100%',
  },
  nextTurnsCloseButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 36,
    zIndex: 2,
  },
  nextTurnsCloseText: {
    color: '#FFF3C2',
    fontSize: 14,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 16,
    textAlign: 'center',
  },
  nextTurnsEyebrow: {
    color: '#FFF3C2',
    fontSize: 12,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    paddingRight: 42,
    textTransform: 'uppercase',
  },
  nextTurnsTitle: {
    color: '#FFD329',
    fontSize: 28,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 32,
    paddingRight: 42,
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  nextTurnsList: {
    maxHeight: 250,
    width: '100%',
  },
  nextTurnsListContent: {
    gap: 8,
    paddingBottom: 2,
  },
  nextTurnGameButton: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 9,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 9,
    minHeight: 64,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  nextTurnAvatar: {
    alignItems: 'center',
    backgroundColor: '#D71920',
    borderColor: '#5A1308',
    borderRadius: 19,
    borderWidth: 2,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  nextTurnAvatarText: {
    color: '#FFD329',
    fontSize: 16,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 18,
  },
  nextTurnGameText: {
    flex: 1,
    minWidth: 0,
  },
  nextTurnOpponent: {
    color: '#210505',
    fontSize: 16,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 19,
  },
  nextTurnStatus: {
    color: '#8F3B10',
    fontSize: 11,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  nextTurnScorePill: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minWidth: 70,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  nextTurnScoreText: {
    color: '#FFD329',
    fontSize: 14,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 16,
  },
  nextTurnScoreDivider: {
    color: '#FFF3C2',
    fontSize: 13,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 16,
  },
  nextTurnsEmpty: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 243, 194, 0.1)',
    borderColor: '#8F3B10',
    borderRadius: 9,
    borderWidth: 2,
    minHeight: 74,
    justifyContent: 'center',
    padding: 12,
  },
  nextTurnsEmptyText: {
    color: '#FFF3C2',
    fontSize: 14,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    textAlign: 'center',
  },
  nextTurnsLobbyButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 10,
    borderWidth: 3,
    justifyContent: 'center',
    minHeight: 48,
    overflow: 'hidden',
  },
  nextTurnsLobbyText: {
    color: '#FFD329',
    fontSize: 17,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 20,
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  gameOverOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(20, 0, 0, 0.68)',
    justifyContent: 'center',
    padding: 14,
    zIndex: 96,
  },
  gameOverPanel: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 14,
    borderWidth: 4,
    gap: 10,
    height: 240,
    padding: 14,
    ...createBoxShadowStyle(0, 6, 0, 'rgba(5, 5, 5, 0.5)'),
    width: '100%',
  },
  gameOverCloseButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 36,
    zIndex: 2,
  },
  gameOverCloseText: {
    color: '#FFD329',
    fontSize: 24,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 28,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  gameOverEyebrow: {
    color: '#FFF3C2',
    fontSize: 13,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  gameOverTitle: {
    color: '#FFD329',
    fontSize: 30,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 34,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  gameOverScores: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  gameOverScoreBox: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 9,
    borderWidth: 2,
    flex: 1,
    paddingVertical: 8,
  },
  gameOverScoreName: {
    color: '#8F3B10',
    fontSize: 12,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    maxWidth: '100%',
  },
  gameOverScoreValue: {
    color: '#210505',
    fontSize: 30,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 34,
  },
  gameOverActions: {
    flexDirection: 'row',
    gap: 8,
    height: 54,
    width: '100%',
  },
  gameOverPrimaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 10,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  gameOverPrimaryText: {
    color: '#210505',
    fontSize: 20,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    textShadowColor: '#FFF3C2',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  gameOverSecondaryButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 10,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  gameOverSecondaryText: {
    color: '#FFD329',
    fontSize: 20,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  rollButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 10,
    borderWidth: 3,
    flexDirection: 'row',
    height: 60,
    justifyContent: 'center',
    overflow: 'hidden',
    ...createBoxShadowStyle(0, 3, 0, 'rgba(5, 5, 5, 0.35)'),
  },
  disabledRollButton: {
    opacity: 0.55,
  },
  controlsRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    height: 60,
    paddingBottom: 0,
  },
  rollButtonWrap: {
    borderRadius: 10,
    flex: 2,
    height: 60,
  },
  tokenButtonWrap: {
    borderRadius: 10,
    height: 60,
    width: 60,
  },
  tokenButton: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 10,
    borderWidth: 3,
    height: 60,
    justifyContent: 'center',
    overflow: 'visible',
    ...createBoxShadowStyle(0, 3, 0, 'rgba(5, 5, 5, 0.35)'),
  },
  tokenButtonImage: {
    height: 44,
    resizeMode: 'contain',
    width: 44,
  },
  tokenCountBadge: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    borderColor: '#FFF3C2',
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    minWidth: 22,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -7,
    top: -8,
  },
  tokenCountText: {
    color: '#FFF3C2',
    fontSize: 12,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 14,
  },
  tokenMenuOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(20, 0, 0, 0.56)',
    justifyContent: 'flex-end',
    padding: 12,
    zIndex: 90,
  },
  tokenMenuPanel: {
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 12,
    borderWidth: 3,
    gap: 8,
    padding: 10,
    ...createBoxShadowStyle(0, 5, 0, 'rgba(5, 5, 5, 0.45)'),
    width: '100%',
  },
  tokenMenuHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 2,
  },
  tokenMenuIcon: {
    height: 46,
    resizeMode: 'contain',
    width: 46,
  },
  tokenMenuHeaderText: {
    flex: 1,
  },
  tokenMenuTitle: {
    color: '#FFD329',
    fontSize: 20,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 23,
  },
  tokenMenuSubtitle: {
    color: '#FFF3C2',
    fontSize: 12,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  tokenMenuClose: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  tokenMenuCloseText: {
    color: '#FFF3C2',
    fontSize: 14,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  tokenOption: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 9,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 9,
    minHeight: 58,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  disabledTokenOption: {
    opacity: 0.48,
  },
  tokenOptionCost: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderRadius: 23,
    borderWidth: 2,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  tokenOptionCostIcon: {
    height: 36,
    opacity: 0.92,
    resizeMode: 'contain',
    width: 36,
  },
  tokenOptionCostText: {
    color: '#FFF3C2',
    fontSize: 14,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    position: 'absolute',
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  tokenOptionBody: {
    flex: 1,
  },
  tokenOptionTitle: {
    color: '#210505',
    fontSize: 16,
    fontFamily: gameFontBlack,
    fontWeight: '900',
  },
  tokenOptionDescription: {
    color: '#7A220D',
    fontSize: 11,
    fontFamily: gameFontExtraBold,
    fontWeight: '800',
    lineHeight: 14,
  },
  disabledTokenOptionText: {
    color: '#7A5A45',
  },
  buttonGloss: {
    backgroundColor: '#FFFFFF',
    height: 18,
    left: 0,
    opacity: 0.24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  buttonInnerShade: {
    backgroundColor: '#5A1308',
    bottom: 0,
    height: 9,
    left: 0,
    opacity: 0.18,
    position: 'absolute',
    right: 0,
  },
  rollText: {
    color: '#210505',
    fontSize: 32,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    textShadowColor: '#FFF3C2',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  rollsLeftBadge: {
    alignItems: 'center',
    backgroundColor: '#E8B552',
    borderColor: '#9A3F0C',
    borderRadius: 5,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 3,
    height: 30,
    justifyContent: 'center',
    marginLeft: 12,
    minWidth: 58,
    paddingHorizontal: 7,
  },
  rollsLeftNumber: {
    color: '#7A220D',
    fontSize: 18,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 20,
  },
  rollsLeftLabel: {
    color: '#7A220D',
    fontSize: 9,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    lineHeight: 11,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderRadius: 10,
    borderWidth: 3,
    height: 60,
    justifyContent: 'center',
    overflow: 'hidden',
    ...createBoxShadowStyle(0, 3, 0, 'rgba(5, 5, 5, 0.35)'),
  },
  playButtonWrap: {
    borderRadius: 10,
    flex: 1,
    height: 60,
  },
  playGloss: {
    backgroundColor: '#FFFFFF',
    height: 18,
    left: 0,
    opacity: 0.3,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  playText: {
    color: '#FFD329',
    fontSize: 28,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  fullHouseIcon: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 44,
  },
  houseRoof: {
    borderBottomColor: '#FFFFFF',
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderLeftWidth: 21,
    borderRightColor: 'transparent',
    borderRightWidth: 21,
    height: 0,
    marginBottom: -1,
    width: 0,
  },
  houseBody: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    height: 21,
    justifyContent: 'flex-end',
    width: 32,
  },
  houseDoor: {
    backgroundColor: '#F12D22',
    height: 11,
    width: 8,
  },
  straightIcon: {
    alignItems: 'center',
    height: 50,
    justifyContent: 'center',
    width: 58,
  },
  cardFan: {
    height: 28,
    position: 'relative',
    width: 52,
  },
  fanCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#F7E9D0',
    borderWidth: 1,
    borderRadius: 4,
    height: 25,
    position: 'absolute',
    ...createBoxShadowStyle(1, 1, 0, 'rgba(122, 64, 29, 0.25)'),
    top: 0,
    width: 17,
  },
  fanCardCorner: {
    backgroundColor: '#F12D22',
    borderRadius: 2,
    height: 4,
    left: 3,
    opacity: 0.9,
    position: 'absolute',
    top: 3,
    width: 4,
  },
  straightLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: gameFontBlack,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 2,
    textShadowColor: '#7A401D',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  largeStraightLabel: {
    transform: [{ translateY: 1 }],
  },
  suckerWordmark: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerSuckerWordmark: {
    height: 48,
    marginTop: -1,
    width: 242,
  },
  tileSuckerWordmark: {
    height: 24,
    width: 68,
  },
  suckerWordmarkImage: {
    height: '100%',
    resizeMode: 'contain',
    width: '100%',
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.72,
  },
});
