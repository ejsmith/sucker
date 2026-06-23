import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
  suckerTokenCosts,
  toggleHold,
  totalScore,
} from './src/game';
import {
  applyLocalSuckerBlocker,
  applyLocalSuckerPunch,
  computerPlayerIndex,
  playComputerTurn,
  scoreLocalTurn,
  shouldComputerUseSuckerBlocker,
  type ComputerTurnResult,
  type LocalPendingTurn,
} from './src/game/computer';
import type { DieValue, GameState, ScoreCategory } from './src/game';
import { isMultiplayerConfigured } from './src/multiplayer';
import { getComputerStats, recordComputerGameResult } from './src/multiplayer/computerStats';
import {
  buyRemoteExtraRoll,
  createGameAgainst,
  getGame,
  getTurn,
  rollRemoteGame,
  scoreRemoteCategory,
  scratchRemoteCategory,
  subscribeToGame,
  useRemoteSuckerBlocker,
  useRemoteSuckerPunch,
} from './src/multiplayer/games';
import { MultiplayerLobby } from './src/multiplayer/MultiplayerLobby';
import { supabase } from './src/multiplayer/supabase';
import type { RemoteGameRow, RemoteGameStatus, RemoteTurnRow } from './src/multiplayer/types';
import { getPhoneStageStyle } from './src/ui/phoneStage';
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
import {
  buildExtraRollActionPayload,
  buildRollActionPayload,
  buildSuckerPunchActionPayload,
  type SuckerStatAction,
  type SuckerStatTurn,
} from './shared/stats';
import Svg, { Circle } from 'react-native-svg';

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
type ComputerStatsSnapshot = Awaited<ReturnType<typeof getComputerStats>>;
type RemoteActionHandlers = {
  onExtraRoll: (held: GameState['held']) => Promise<ReturnType<typeof createGame> | null>;
  onRematch: () => Promise<ReturnType<typeof createGame> | null>;
  onRoll: (held: GameState['held']) => Promise<ReturnType<typeof createGame> | null>;
  onScore: (category: ScoreCategory, held: GameState['held']) => Promise<ReturnType<typeof createGame> | null>;
  onScratch: (category: ScoreCategory, held: GameState['held']) => Promise<ReturnType<typeof createGame> | null>;
  onSuckerBlocker: (turnId: string) => Promise<ReturnType<typeof createGame> | null>;
  onSuckerPunch: (turnId: string) => Promise<ReturnType<typeof createGame> | null>;
};
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

const whiteDiceImages: Record<DieValue, ImageSourcePropType> = {
  1: require('./assets/dice/dieWhite_border1.png'),
  2: require('./assets/dice/dieWhite_border2.png'),
  3: require('./assets/dice/dieWhite_border3.png'),
  4: require('./assets/dice/dieWhite_border4.png'),
  5: require('./assets/dice/dieWhite_border5.png'),
  6: require('./assets/dice/dieWhite_border6.png'),
};

const categoryPipImages: Record<DieValue, ImageSourcePropType> = {
  1: require('./assets/dice/dieRed_pips1.png'),
  2: require('./assets/dice/dieRed_pips2.png'),
  3: require('./assets/dice/dieRed_pips3.png'),
  4: require('./assets/dice/dieRed_pips4.png'),
  5: require('./assets/dice/dieRed_pips5.png'),
  6: require('./assets/dice/dieRed_pips6.png'),
};
const suckerScorecardWordmarkImage = require('./assets/sucker-scorecard-wordmark.png');
const suckerLobbyHeaderImage = require('./assets/sucker-lobby-header.png');
const suckerGameBannerImage = require('./assets/sucker-game-header-clean.png');
const suckerTokenImage = require('./assets/sucker-token.png');

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
const upperBonusTarget = 63;
const bonusValueColor = '#FFD329';
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
export default function App() {
  const [showLocalDemo, setShowLocalDemo] = useState(() => !isMultiplayerConfigured);
  const [remoteGameId, setRemoteGameId] = useState<string | null>(null);

  if (isMultiplayerConfigured && remoteGameId) {
    return <RemoteGameScreen gameId={remoteGameId} onExit={() => setRemoteGameId(null)} />;
  }

  if (isMultiplayerConfigured && !showLocalDemo) {
    return <MultiplayerLobby onOpenGame={setRemoteGameId} onPlayLocalDemo={() => setShowLocalDemo(true)} />;
  }

  return <LocalGameScreen onExit={() => setShowLocalDemo(!isMultiplayerConfigured)} />;
}

function RemoteGameScreen({ gameId, onExit }: { gameId: string; onExit: () => void }) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [activeGameId, setActiveGameId] = useState(gameId);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [remoteGame, setRemoteGame] = useState<RemoteGameRow | null>(null);
  const [remoteLastTurn, setRemoteLastTurn] = useState<RemoteTurnRow | null>(null);
  const [remoteLastTurnLoadFailedId, setRemoteLastTurnLoadFailedId] = useState<string | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRemoteBusy, setIsRemoteBusy] = useState(false);

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

        setProfileId(userData.user.id);
        setRemoteGame(nextGame);
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
  }, [activeGameId]);

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
    if (!remoteGame || isRealtimeConnected) {
      return;
    }

    const interval = setInterval(() => {
      void getGame(activeGameId)
        .then((nextGame) => {
          setRemoteGame(nextGame);
        })
        .catch((pollError) => {
          setError(pollError instanceof Error ? pollError.message : 'Unable to refresh game.');
        });
    }, 2500);

    return () => clearInterval(interval);
  }, [activeGameId, isRealtimeConnected, remoteGame]);

  async function runRemoteAction(action: () => Promise<{ game: RemoteGameRow }>) {
    setIsRemoteBusy(true);
    setError(null);
    try {
      const result = await action();
      setRemoteGame(result.game);
      return result.game.state;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to update game.');
      return null;
    } finally {
      setIsRemoteBusy(false);
    }
  }

  if (isLoading || !remoteGame || !profileId) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={[styles.remoteLoadingScreen, getPhoneStageStyle(windowWidth, windowHeight)]}>
          <Text style={styles.remoteLoadingTitle}>Loading Game</Text>
          {error && <Text style={styles.remoteMessage}>{error}</Text>}
          <Pressable onPress={onExit} style={({ pressed }) => [styles.remoteBackButton, pressed && styles.pressed]}>
            <Text style={styles.remoteBackButtonText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const handlers: RemoteActionHandlers = {
    onExtraRoll: (held) => runRemoteAction(() => buyRemoteExtraRoll(remoteGame.id, held)),
    onRematch: async () => {
      const opponent = remoteGame.state.players.find((player) => player.id !== profileId);
      if (!opponent) {
        setError('Unable to find opponent for rematch.');
        return null;
      }

      return runRemoteAction(async () => {
        const result = await createGameAgainst(opponent.id);
        setActiveGameId(result.game.id);
        return result;
      });
    },
    onRoll: (held) => runRemoteAction(() => rollRemoteGame(remoteGame.id, held)),
    onScore: (category, held) => runRemoteAction(() => scoreRemoteCategory(remoteGame.id, category, held)),
    onScratch: (category, held) => runRemoteAction(() => scratchRemoteCategory(remoteGame.id, category, held)),
    onSuckerBlocker: (turnId) => runRemoteAction(() => useRemoteSuckerBlocker(remoteGame.id, turnId)),
    onSuckerPunch: (turnId) => runRemoteAction(() => useRemoteSuckerPunch(remoteGame.id, turnId)),
  };

  return (
    <LocalGameScreen
      isRemoteBusy={isRemoteBusy}
      myProfileId={profileId}
      onExit={onExit}
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

function LocalGameScreen({
  isRemoteBusy = false,
  myProfileId,
  onExit,
  remoteError,
  remoteGame,
  remoteHandlers,
  remoteLastTurn,
  remoteLastTurnLoadFailedId,
  remoteLastTurnId,
  remoteStatus,
}: {
  isRemoteBusy?: boolean;
  myProfileId?: string;
  onExit?: () => void;
  remoteError?: string | null;
  remoteGame?: ReturnType<typeof createGame>;
  remoteHandlers?: RemoteActionHandlers;
  remoteLastTurn?: RemoteTurnRow | null;
  remoteLastTurnLoadFailedId?: string | null;
  remoteLastTurnId?: string | null;
  remoteStatus?: RemoteGameStatus;
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [localGame, setLocalGame] = useState(() => createGame(playerNames));
  const [localPendingTurn, setLocalPendingTurn] = useState<LocalPendingTurn | null>(null);
  const [showSuckerPunchNotice, setShowSuckerPunchNotice] = useState(false);
  const [showSuckerBlockedNotice, setShowSuckerBlockedNotice] = useState(false);
  const [suckerRollNoticeTitle, setSuckerRollNoticeTitle] = useState<string | null>(null);
  const isRemoteGame = Boolean(remoteGame && remoteHandlers && myProfileId);
  const [visibleRemoteGame, setVisibleRemoteGame] = useState(
    remoteGame ? concealActiveOpponentDice(remoteGame, myProfileId) : null,
  );
  const [isRolling, setIsRolling] = useState(false);
  const [isComputerThinking, setIsComputerThinking] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showStatsPage, setShowStatsPage] = useState(false);
  const [isTokenMenuOpen, setIsTokenMenuOpen] = useState(false);
  const [dismissedGameOverId, setDismissedGameOverId] = useState<string | null>(null);
  const [computerStats, setComputerStats] = useState<ComputerStatsSnapshot>(null);
  const [failedDiceImages, setFailedDiceImages] = useState<number[]>([]);
  const [rollingFaces, setRollingFaces] = useState<DieValue[]>([1, 1, 1, 1, 1]);
  const [rollingDieIndexes, setRollingDieIndexes] = useState<number[]>([]);
  const [rollingLaunches, setRollingLaunches] = useState<Partial<Record<number, RollingLaunch>>>({});
  const [selectedCategory, setSelectedCategory] = useState<ScoreCategory | null>(null);
  const [isChoosingSuckerDeal, setIsChoosingSuckerDeal] = useState(false);
  const [highlightCategory, setHighlightCategory] = useState<ScoreCategory | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [scoreFlyDice, setScoreFlyDice] = useState<ScoreFlyDie[]>([]);
  const [scoreFlyNumber, setScoreFlyNumber] = useState<ScoreFlyNumber | null>(null);
  const [opponentTurnReveal, setOpponentTurnReveal] = useState<OpponentTurnReveal | null>(null);
  const [revealingRemoteTurnId, setRevealingRemoteTurnId] = useState<string | null>(null);
  const screenRef = useRef<ViewRef | null>(null);
  const boardRef = useRef<ViewRef | null>(null);
  const rollZoneRef = useRef<ViewRef | null>(null);
  const dieSlotRefs = useRef<(ViewRef | null)[]>([]);
  const scoreBoxRefs = useRef<Partial<Record<ScoreCategory, ViewRef | null>>>({});
  const opponentScoreRefs = useRef<Partial<Record<ScoreCategory, ViewRef | null>>>({});
  const recordedComputerGameIds = useRef<Set<string>>(new Set());
  const localSuckerStatActions = useRef<SuckerStatAction[]>([]);
  const localSuckerStatTurns = useRef<SuckerStatTurn[]>([]);
  const lastRemotePunchNoticeId = useRef<string | null>(null);
  const lastRemoteBlockNoticeId = useRef<string | null>(null);
  const lastAnimatedRemoteScoreTurnId = useRef<string | null>(null);
  const suckerRollNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRemoteTurnId = useRef<string | null>(remoteLastTurnId ?? null);
  const previousRemoteStatus = useRef<RemoteGameStatus | undefined>(remoteStatus);
  const diceAnimations = useRef([...Array(5)].map(() => new Animated.Value(0))).current;
  const bgFloat = useRef(new Animated.Value(0)).current;
  const selectedPulse = useRef(new Animated.Value(0)).current;
  const sectionBonusPulse = useRef(new Animated.Value(0)).current;
  const previousHomeSectionBonusAwarded = useRef<boolean | null>(null);
  const game = isRemoteGame ? (visibleRemoteGame ?? remoteGame ?? localGame) : localGame;
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
  const isComputerTurn = !isRemoteGame && game.currentPlayerIndex === computerPlayerIndex && game.phase !== 'complete';
  const openCategories = availableCategories(currentPlayer.scorecard);
  const canRollVisually =
    game.phase !== 'complete' &&
    game.rollNumber < maxAvailableRolls(game) &&
    !isComputerTurn &&
    isMyRemoteTurn &&
    isRemoteActionPlayable;
  const canRoll = canRollVisually && !isRolling && !isScoring && !isRemoteBusy;
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
    !isRemoteBusy;
  const canOpenTokenMenu =
    game.phase !== 'complete' && !isRolling && !isScoring && !isComputerTurn && isMyRemoteTurn && !isRemoteBusy;
  const myTokenCount = homePlayer.suckerTokens;
  const canUseLocalExtraRoll =
    !isRemoteGame &&
    canOpenTokenMenu &&
    game.rollNumber >= maxAvailableRolls(game) &&
    myTokenCount >= suckerTokenCosts.extraRoll;
  const canUseRemoteExtraRoll =
    isRemoteGame &&
    canOpenTokenMenu &&
    isRemoteActionPlayable &&
    game.rollNumber >= maxAvailableRolls(game) &&
    myTokenCount >= suckerTokenCosts.extraRoll;
  const canUseLocalMulligan =
    !isRemoteGame &&
    !pendingTurn &&
    canOpenTokenMenu &&
    game.rollNumber > 0 &&
    myTokenCount >= suckerTokenCosts.mulligan;
  const canStartSuckerDeal =
    canOpenTokenMenu && !pendingTurn && game.rollNumber > 0 && openCategories.length > 0 && isRemoteActionPlayable;
  const canUseLocalSuckerPunch =
    !isRemoteGame &&
    canOpenTokenMenu &&
    pendingTurn?.status === 'submitted' &&
    pendingTurn.responderIndex === myPlayerIndex &&
    pendingTurn.scorerIndex !== myPlayerIndex &&
    myTokenCount >= suckerTokenCosts.suckerPunch;
  const canUseLocalSuckerBlocker =
    !isRemoteGame &&
    canOpenTokenMenu &&
    pendingTurn?.status === 'punched' &&
    pendingTurn.scorerIndex === myPlayerIndex &&
    myTokenCount >= suckerTokenCosts.suckerBlocker;
  const canUseRemoteSuckerPunch =
    isRemoteGame &&
    canOpenTokenMenu &&
    remoteStatus === 'response_window' &&
    Boolean(remoteLastTurnId) &&
    myTokenCount >= suckerTokenCosts.suckerPunch;
  const canUseRemoteSuckerBlocker =
    isRemoteGame &&
    canOpenTokenMenu &&
    remoteStatus === 'blocked_response' &&
    Boolean(remoteLastTurnId) &&
    myTokenCount >= suckerTokenCosts.suckerBlocker;
  const gameStageStyle = getPhoneStageStyle(windowWidth, windowHeight);
  const standardRollsLeft = rollsRemaining(game);
  const homeUpperTotal = upperSectionTotal(homePlayer.scorecard);
  const opponentUpperTotal = upperSectionTotal(opponentPlayer.scorecard);
  const homeSectionBonusAwarded = homeUpperTotal >= upperBonusTarget;
  const homeScore = totalScore(homePlayer.scorecard);
  const opponentScore = totalScore(opponentPlayer.scorecard);
  const isGameOver = game.phase === 'complete';
  const gameOverVisible = isGameOver && dismissedGameOverId !== game.id;
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
    (remoteStatus === 'response_window' || remoteStatus === 'complete') &&
    (!remoteLastTurn ||
      remoteLastTurn.id !== remoteLastTurnId ||
      remoteOpponentTurnNeedsReveal ||
      revealingRemoteTurnId === remoteLastTurnId),
  );
  const sectionBonusScale = sectionBonusPulse.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [1, 2, 1],
  });
  const sectionBonusColor = sectionBonusPulse.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [bonusValueColor, bonusValueColor, awardedBonusColor],
  });

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

    if (!previousHomeSectionBonusAwarded.current && !disableE2EAnimations) {
      sectionBonusPulse.setValue(0);
      Animated.timing(sectionBonusPulse, {
        toValue: 1,
        duration: 560,
        easing: Easing.out(Easing.back(1.7)),
        useNativeDriver: false,
      }).start();
    } else {
      sectionBonusPulse.setValue(1);
    }

    previousHomeSectionBonusAwarded.current = true;
  }, [homeSectionBonusAwarded, sectionBonusPulse]);

  useEffect(() => {
    if (disableE2EAnimations) {
      return;
    }

    const loops = [
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
    ];

    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [bgFloat, selectedPulse]);

  useEffect(() => {
    return () => {
      if (suckerRollNoticeTimer.current) {
        clearTimeout(suckerRollNoticeTimer.current);
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

    const timer = setTimeout(() => setShowSuckerPunchNotice(false), 1700);
    return () => clearTimeout(timer);
  }, [showSuckerPunchNotice]);

  useEffect(() => {
    if (!showSuckerBlockedNotice) {
      return;
    }

    const timer = setTimeout(() => setShowSuckerBlockedNotice(false), 1700);
    return () => clearTimeout(timer);
  }, [showSuckerBlockedNotice]);

  useEffect(() => {
    if (
      !isRemoteGame ||
      remoteStatus !== 'blocked_response' ||
      !remoteLastTurnId ||
      !remoteLastTurn ||
      remoteLastTurn.id !== remoteLastTurnId ||
      remoteLastTurn.player_id !== myProfileId
    ) {
      return;
    }

    if (lastRemotePunchNoticeId.current === remoteLastTurnId) {
      return;
    }

    lastRemotePunchNoticeId.current = remoteLastTurnId;
    setShowSuckerPunchNotice(true);
  }, [isRemoteGame, myProfileId, remoteLastTurn, remoteLastTurnId, remoteStatus]);

  useEffect(() => {
    const previousStatus = previousRemoteStatus.current;
    previousRemoteStatus.current = remoteStatus;
    const serverCurrentPlayerId = remoteGame?.players[remoteGame.currentPlayerIndex]?.id;

    if (
      !isRemoteGame ||
      previousStatus !== 'blocked_response' ||
      remoteStatus !== 'active' ||
      serverCurrentPlayerId !== myProfileId ||
      !remoteLastTurnId ||
      lastRemoteBlockNoticeId.current === remoteLastTurnId
    ) {
      return;
    }

    lastRemoteBlockNoticeId.current = remoteLastTurnId;
    setShowSuckerBlockedNotice(true);
  }, [isRemoteGame, myProfileId, remoteGame, remoteLastTurnId, remoteStatus]);

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
    if (!isRemoteGame) {
      setVisibleRemoteGame(null);
      visibleRemoteTurnId.current = null;
      return;
    }

    if (!isRolling && !isScoring && !opponentTurnReveal && remoteGame && !shouldHoldRemoteTurnReveal) {
      setVisibleRemoteGame(concealActiveOpponentDice(remoteGame, myProfileId));
      visibleRemoteTurnId.current = remoteLastTurnId ?? null;
    }
  }, [
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
      opponentTurnReveal
    ) {
      return;
    }

    setRevealingRemoteTurnId(remoteLastTurn.id);
    void animateRemoteOpponentScoreTurn(remoteGame, remoteLastTurn);
  }, [isRolling, isScoring, opponentTurnReveal, remoteGame, remoteLastTurn, remoteOpponentTurnNeedsReveal]);

  async function refreshComputerStats() {
    try {
      setComputerStats(await getComputerStats());
    } catch (statsError) {
      console.warn('Unable to load computer stats', statsError);
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

  async function handleRoll() {
    if (!canRoll) {
      return;
    }

    if (!isRemoteGame && pendingTurn) {
      setLocalPendingTurn(null);
      setShowSuckerPunchNotice(false);
      setShowSuckerBlockedNotice(false);
      setSuckerRollNoticeTitle(null);
    }
    setHighlightCategory(null);
    setIsChoosingSuckerDeal(false);

    if (isRemoteGame && remoteHandlers) {
      await animateRemoteRoll(remoteHandlers.onRoll(game.held));
      return;
    }

    const nextGame = rollCurrentDice(game);
    recordLocalAction('roll', homePlayer.id, buildRollActionPayload(nextGame.dice));
    await animateRollTo(nextGame);
  }

  async function animateRemoteRoll(nextGamePromise: Promise<ReturnType<typeof createGame> | null>) {
    const rollingIndexes = game.held
      .map((held, index) => (held ? null : index))
      .filter((index): index is number => index !== null);
    const animationStartedAt = Date.now();

    setIsRolling(true);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setRollingFaces(game.dice);
    rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));

    let scrambleTimer: ReturnType<typeof setInterval> | null = null;

    try {
      if (rollingIndexes.length === 0) {
        const nextGame = await nextGamePromise;
        if (nextGame) {
          setVisibleRemoteGame(nextGame);
          if (isSuckerDice(nextGame.dice)) {
            showSuckerRollBanner('You rolled');
          }
        }
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
          createRollingLaunch(index, launchSide, rollZoneRect, slotRects[index] ?? null),
        ]),
      ) as Partial<Record<number, RollingLaunch>>;
      setRollingLaunches(launches);
      setRollingDieIndexes(rollingIndexes);

      scrambleTimer = setInterval(() => {
        setRollingFaces(
          (faces) =>
            faces.map((face, index) => (rollingIndexes.includes(index) ? rollDisplayDie() : face)) as DieValue[],
        );
      }, 65);
      const finalRevealAt = Math.max(
        0,
        Math.max(
          ...rollingIndexes.map((index) => {
            const launch = launches[index] ?? defaultRollingLaunch;
            return launch.delay + launch.duration;
          }),
        ) - 150,
      );
      const revealFinalDice = nextGamePromise.then((nextGame) => {
        if (!nextGame) {
          return null;
        }

        const elapsed = Date.now() - animationStartedAt;
        const waitMs = Math.max(0, finalRevealAt - elapsed);

        return new Promise<ReturnType<typeof createGame>>((resolve) => {
          setTimeout(() => {
            if (scrambleTimer) {
              clearInterval(scrambleTimer);
              scrambleTimer = null;
            }
            setRollingFaces(nextGame.dice);
            resolve(nextGame);
          }, waitMs);
        });
      });
      const animationDone = new Promise<void>((resolve) => {
        Animated.parallel(
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
        ).start(() => resolve());
      });

      const [nextGame] = await Promise.all([revealFinalDice, animationDone]);
      if (nextGame) {
        setVisibleRemoteGame(nextGame);
        if (isSuckerDice(nextGame.dice)) {
          showSuckerRollBanner('You rolled');
        }
      }
    } finally {
      if (scrambleTimer) {
        clearInterval(scrambleTimer);
      }
      rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));
      setRollingDieIndexes([]);
      setRollingLaunches({});
      setIsRolling(false);
    }
  }

  async function animateRollTo(nextGame: ReturnType<typeof createGame> | null) {
    const rollingIndexes = game.held
      .map((held, index) => (held ? null : index))
      .filter((index): index is number => index !== null);
    setIsRolling(true);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setRollingFaces(game.dice);
    rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));

    if (!nextGame) {
      setIsRolling(false);
      return;
    }
    const finalDice = nextGame.dice;

    if (rollingIndexes.length === 0) {
      if (isRemoteGame) {
        setVisibleRemoteGame(nextGame);
      } else {
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
        createRollingLaunch(index, launchSide, rollZoneRect, slotRects[index] ?? null),
      ]),
    ) as Partial<Record<number, RollingLaunch>>;
    setRollingLaunches(launches);
    setRollingDieIndexes(rollingIndexes);

    const scrambleTimer = setInterval(() => {
      setRollingFaces(
        (faces) => faces.map((face, index) => (rollingIndexes.includes(index) ? rollDisplayDie() : face)) as DieValue[],
      );
    }, 65);
    const finalRevealDelay = Math.max(
      0,
      Math.max(
        ...rollingIndexes.map((index) => {
          const launch = launches[index] ?? defaultRollingLaunch;
          return launch.delay + launch.duration;
        }),
      ) - 150,
    );
    const finalRevealTimer = setTimeout(() => {
      clearInterval(scrambleTimer);
      setRollingFaces(finalDice);
    }, finalRevealDelay);

    Animated.parallel(
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
    ).start(() => {
      clearInterval(scrambleTimer);
      clearTimeout(finalRevealTimer);
      if (isRemoteGame) {
        setVisibleRemoteGame(nextGame);
      } else {
        setLocalGame(nextGame);
      }
      if (isSuckerDice(finalDice)) {
        showSuckerRollBanner('You rolled');
      }
      rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));
      setRollingDieIndexes([]);
      setRollingLaunches({});
      setIsRolling(false);
    });
  }

  function finishComputerTurnResult(result: ComputerTurnResult) {
    recordLocalScoreTurn(result);
    if (result.pendingTurn?.status === 'punched' && result.pendingTurn.puncherIndex !== undefined) {
      const puncher = result.game.players[result.pendingTurn.puncherIndex];
      const scorer = result.game.players[result.pendingTurn.scorerIndex];
      if (puncher && scorer) {
        recordLocalAction('sucker_punch', puncher.id, buildSuckerPunchActionPayload(scorer.id));
        updateLocalScoreTurnStatus(result.pendingTurn.id, 'punched');
      }
    }
    setLocalGame(result.game);
    setLocalPendingTurn(result.pendingTurn);
    if (result.pendingTurn?.status === 'punched' && result.pendingTurn.scorerIndex === myPlayerIndex) {
      setShowSuckerPunchNotice(true);
    }
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setIsComputerThinking(false);
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
    const previousGame = visibleRemoteGame;
    if (!previousGame) {
      setVisibleRemoteGame(nextRemoteGame);
      visibleRemoteTurnId.current = turn.id;
      lastAnimatedRemoteScoreTurnId.current = turn.id;
      setRevealingRemoteTurnId(null);
      return;
    }

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
    setLocalGame(purchaseExtraRoll(game));
  }

  function handleUseMulligan() {
    if (!canUseLocalMulligan) {
      return;
    }

    setIsTokenMenuOpen(false);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
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

    setIsChoosingSuckerDeal(false);

    if (isRemoteGame && remoteHandlers) {
      await remoteHandlers.onScratch(category, game.held);
      return;
    }

    setLocalGame(scratchScoreBox(game, category));
    localSuckerStatTurns.current.push({
      category,
      player_id: currentPlayer.id,
      score: 0,
      status: 'submitted',
      turn_id: `local-turn-${localSuckerStatTurns.current.length + 1}`,
      turn_index: localSuckerStatTurns.current.length + 1,
    });
    setLocalPendingTurn(null);
  }

  async function handleUseSuckerPunch() {
    if (canUseLocalSuckerPunch && pendingTurn) {
      setIsTokenMenuOpen(false);
      setSelectedCategory(null);
      setIsChoosingSuckerDeal(false);
      const scorer = game.players[pendingTurn.scorerIndex];
      if (scorer) {
        recordLocalAction('sucker_punch', homePlayer.id, buildSuckerPunchActionPayload(scorer.id));
      }
      const punched = applyLocalSuckerPunch(game, pendingTurn, myPlayerIndex);
      updateLocalScoreTurnStatus(pendingTurn.id, 'punched');
      if (shouldComputerUseSuckerBlocker(punched.game, punched.pendingTurn)) {
        const blockedGame = applyLocalSuckerBlocker(punched.game, punched.pendingTurn, computerPlayerIndex);
        updateLocalScoreTurnStatus(pendingTurn.id, 'blocked');
        setLocalGame(blockedGame);
        setLocalPendingTurn(null);
        setShowSuckerBlockedNotice(true);
        return;
      }

      const replayed = playComputerTurn(punched.game, null);
      setLocalGame(punched.game);
      setLocalPendingTurn(punched.pendingTurn);
      setIsComputerThinking(true);
      setTimeout(() => {
        void animateComputerTurnResult(replayed);
      }, computerThinkingDelayMs);
      return;
    }

    if (!canUseRemoteSuckerPunch || !remoteHandlers || !remoteLastTurnId) {
      return;
    }

    setIsTokenMenuOpen(false);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    await remoteHandlers.onSuckerPunch(remoteLastTurnId);
  }

  async function handleUseSuckerBlocker() {
    if (canUseLocalSuckerBlocker && pendingTurn) {
      setIsTokenMenuOpen(false);
      setSelectedCategory(null);
      setIsChoosingSuckerDeal(false);
      recordLocalAction('sucker_blocker', homePlayer.id);
      const blockedGame = applyLocalSuckerBlocker(game, pendingTurn, myPlayerIndex);
      updateLocalScoreTurnStatus(pendingTurn.id, 'blocked');
      setLocalGame(blockedGame);
      setLocalPendingTurn(null);
      setShowSuckerPunchNotice(false);
      return;
    }

    if (!canUseRemoteSuckerBlocker || !remoteHandlers || !remoteLastTurnId) {
      return;
    }

    setIsTokenMenuOpen(false);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    await remoteHandlers.onSuckerBlocker(remoteLastTurnId);
  }

  async function handleRematch() {
    setDismissedGameOverId(null);
    setIsMenuOpen(false);
    setIsTokenMenuOpen(false);
    setSelectedCategory(null);
    setIsChoosingSuckerDeal(false);
    setHighlightCategory(null);
    setShowSuckerPunchNotice(false);
    setShowSuckerBlockedNotice(false);
    setSuckerRollNoticeTitle(null);

    if (isRemoteGame && remoteHandlers) {
      await remoteHandlers.onRematch();
      return;
    }

    setLocalPendingTurn(null);
    recordedComputerGameIds.current.clear();
    localSuckerStatActions.current = [];
    localSuckerStatTurns.current = [];
    setLocalGame(createGame(playerNames));
  }

  function handleCloseGameOver() {
    setDismissedGameOverId(game.id);
    onExit?.();
  }

  function handleDismissGameOver() {
    setDismissedGameOverId(game.id);
  }

  function commitLocalScore(category: ScoreCategory) {
    const result = scoreLocalTurn(game, category);
    recordLocalScoreTurn(result);
    setLocalGame(result.game);
    setLocalPendingTurn(result.pendingTurn);
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
    const targetRef =
      activePlayerViewIndex === 0 ? scoreBoxRefs.current[category] : opponentScoreRefs.current[category];
    const [screenRect, targetRect, sourceRects] = await Promise.all([
      measureInWindow(screenRef.current),
      measureInWindow(targetRef ?? null),
      Promise.all(dieSlotRefs.current.map((ref) => measureInWindow(ref))),
    ]);

    if (!screenRect || !targetRect || sourceRects.some((rect) => rect === null)) {
      if (isRemoteGame && remoteHandlers) {
        void remoteHandlers.onScore(category, game.held);
      } else {
        commitLocalScore(category);
      }
      setSelectedCategory(null);
      setIsChoosingSuckerDeal(false);
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
    const flyingDice = game.dice.map((face, index) => {
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
    requestAnimationFrame(() => {
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
      ).start(() => {
        setScoreFlyDice([]);
        setIsScoring(false);
        if (isRemoteGame && remoteHandlers) {
          void remoteHandlers.onScore(category, game.held);
        } else {
          commitLocalScore(category);
        }
        setSelectedCategory(null);
        setIsChoosingSuckerDeal(false);
      });
    });
  }

  async function handleToggleHold(index: number) {
    if (isRolling || isScoring || game.rollNumber === 0 || !isMyRemoteTurn || !isRemoteActionPlayable || isRemoteBusy) {
      return;
    }

    if (isRemoteGame && remoteHandlers) {
      setVisibleRemoteGame(toggleHold(game, index));
      return;
    }

    setLocalGame((state) => toggleHold(state, index));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View ref={screenRef} style={[styles.screen, gameStageStyle]} testID="game-screen">
        <BackgroundDicePattern floatValue={bgFloat} />
        <View style={styles.topBar}>
          <View pointerEvents="none" style={styles.topBarBannerClip}>
            <Image source={suckerGameBannerImage} style={styles.topBarBannerImage} />
          </View>
          {onExit && (
            <Pressable
              accessibilityLabel="Back to games"
              onPress={() => {
                setIsMenuOpen(false);
                onExit();
              }}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <Text style={styles.backButtonText}>‹</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityLabel="Open menu"
            onPress={() => setIsMenuOpen((open) => !open)}
            style={({ pressed }) => [styles.menuDotsButton, pressed && styles.pressed]}
          >
            <View style={styles.menuDots}>
              <View style={styles.menuDot} />
              <View style={styles.menuDot} />
              <View style={styles.menuDot} />
            </View>
          </Pressable>
        </View>
        {isMenuOpen && (
          <View pointerEvents="box-none" style={styles.topMenuLayer}>
            <Pressable
              accessibilityLabel="Close menu"
              onPress={() => setIsMenuOpen(false)}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.topMenu}>
              <Pressable
                onPress={() => {
                  setIsMenuOpen(false);
                  setShowStatsPage(true);
                  void refreshComputerStats();
                }}
                style={({ pressed }) => [styles.topMenuItem, pressed && styles.pressed]}
              >
                <Text style={styles.topMenuText}>Stats</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.playerStrip} testID="player-strip">
          {displayPlayers.map((player, index) => (
            <View key={player.id} style={[styles.playerPill, player.id === currentPlayer.id && styles.activePlayer]}>
              <View style={[styles.avatar, player.id === currentPlayer.id && styles.activeAvatar]}>
                <Text style={styles.avatarText}>{player.name.slice(0, 1)}</Text>
              </View>
              <Text style={styles.playerScore}>{totalScore(player.scorecard)}</Text>
              <Text numberOfLines={1} style={styles.playerName}>
                {player.name}
              </Text>
              <Text style={styles.tokenText}>{player.suckerTokens} Tokens</Text>
            </View>
          ))}
        </View>
        <View ref={boardRef} style={styles.board}>
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
                !isRemoteBusy
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
            />
          ))}

          <View style={styles.boardRow}>
            <View style={styles.bonusPanel} testID="section-bonus-panel">
              <View style={styles.bonusContent}>
                <View style={styles.bonusTextBlock}>
                  <Text style={styles.bonusSmall}>Section{'\n'}Bonus</Text>
                  <BonusValueText
                    awarded={homeSectionBonusAwarded}
                    faceColor={sectionBonusColor}
                    scale={sectionBonusScale}
                  />
                </View>
                <BonusMeter total={homeUpperTotal} />
                <BonusMeter total={opponentUpperTotal} />
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
                !isRemoteBusy
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
            />
          </View>
        </View>

        <View ref={rollZoneRef} style={styles.rollZone}>
          <View style={styles.diceTray} testID="dice-tray">
            {game.dice.map((die, index) => {
              const isFlying = isRolling && rollingDieIndexes.includes(index);
              const showDie = game.rollNumber > 0 || isRolling;
              const showSlotDie = showDie && !isFlying;

              return (
                <View key={`die-${index}`} style={styles.dieMotion}>
                  <Pressable
                    disabled={!showDie || isRolling || isScoring || !isMyRemoteTurn || isRemoteBusy}
                    onPress={() => void handleToggleHold(index)}
                    ref={(node) => {
                      dieSlotRefs.current[index] = node;
                    }}
                    style={({ pressed }) => [
                      styles.dieSlot,
                      isFlying && styles.settlingDieSlot,
                      game.held[index] && styles.heldDie,
                      pressed && styles.pressed,
                    ]}
                  >
                    {showSlotDie && (
                      <>
                        {failedDiceImages.includes(die) && <Text style={styles.dieFallback}>{die}</Text>}
                        <Image
                          source={whiteDiceImages[die]}
                          style={[
                            styles.dieImage,
                            game.held[index] && styles.heldDieImage,
                            isScoring && styles.scoringSourceDieImage,
                          ]}
                          onError={() => {
                            setFailedDiceImages((faces) => (faces.includes(die) ? faces : [...faces, die]));
                          }}
                        />
                      </>
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
                    {failedDiceImages.includes(face) && <Text style={styles.flyingDieFallback}>{face}</Text>}
                    <Image
                      source={whiteDiceImages[face]}
                      style={styles.rollingDieImage}
                      onError={() => {
                        setFailedDiceImages((faces) => (faces.includes(face) ? faces : [...faces, face]));
                      }}
                    />
                  </Animated.View>
                );
              })}
            </View>
          )}

          <View style={styles.controlsRow}>
            <View style={styles.rollButtonWrap}>
              <Pressable
                disabled={!canRoll}
                onPress={handleRoll}
                style={({ pressed }) => [
                  styles.rollButton,
                  !canRoll && styles.disabledRollButton,
                  pressed && styles.pressed,
                ]}
                testID="roll-button"
              >
                <View style={styles.buttonGloss} />
                <View style={styles.buttonInnerShade} />
                <Text style={styles.rollText}>ROLL</Text>
                <View style={styles.rollsLeftBadge}>
                  <Text style={styles.rollsLeftNumber}>{standardRollsLeft}</Text>
                  <Text style={styles.rollsLeftLabel}>LEFT</Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.tokenButtonWrap}>
              <Pressable
                accessibilityLabel="Sucker token menu"
                disabled={!canOpenTokenMenu}
                onPress={() => setIsTokenMenuOpen(true)}
                style={({ pressed }) => [
                  styles.tokenButton,
                  !canOpenTokenMenu && styles.disabledButton,
                  pressed && styles.pressed,
                ]}
                testID="token-menu-button"
              >
                <View style={styles.buttonInnerShade} />
                <Image source={suckerTokenImage} style={styles.tokenButtonImage} />
                <View style={styles.tokenCountBadge}>
                  <Text style={styles.tokenCountText}>{myTokenCount}</Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.playButtonWrap}>
              <Pressable
                disabled={!canPlaySelected}
                onPress={handlePlayScore}
                style={({ pressed }) => [
                  styles.playButton,
                  !canPlaySelected && styles.disabledButton,
                  pressed && styles.pressed,
                ]}
                testID="play-score-button"
              >
                <View style={styles.playGloss} />
                <View style={styles.buttonInnerShade} />
                <Text style={styles.playText}>PLAY</Text>
              </Pressable>
            </View>
          </View>
        </View>
        {isTokenMenuOpen && (
          <View style={styles.tokenMenuOverlay} testID="token-menu-overlay">
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsTokenMenuOpen(false)} />
            <View style={styles.tokenMenuPanel}>
              <View style={styles.tokenMenuHeader}>
                <Image source={suckerTokenImage} style={styles.tokenMenuIcon} />
                <View style={styles.tokenMenuHeaderText}>
                  <Text style={styles.tokenMenuTitle}>Sucker Tokens</Text>
                  <Text style={styles.tokenMenuSubtitle}>{myTokenCount} available</Text>
                </View>
                <Pressable
                  onPress={() => setIsTokenMenuOpen(false)}
                  style={styles.tokenMenuClose}
                  testID="token-menu-close-button"
                >
                  <Text style={styles.tokenMenuCloseText}>X</Text>
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
                    ? 'Force your opponent to replay their latest turn.'
                    : 'Force the computer to replay its latest turn.'
                }
                disabled={!canUseLocalSuckerPunch && !canUseRemoteSuckerPunch}
                label="Sucker Punch"
                onPress={() => void handleUseSuckerPunch()}
                testID="token-option-sucker-punch"
              />
              <TokenMenuOption
                cost={suckerTokenCosts.suckerBlocker}
                description={
                  isRemoteGame
                    ? 'Block the Sucker Punch and keep your score.'
                    : 'Block the computer’s Sucker Punch and keep your score.'
                }
                disabled={!canUseLocalSuckerBlocker && !canUseRemoteSuckerBlocker}
                label="Block Sucker Punch"
                onPress={() => void handleUseSuckerBlocker()}
                testID="token-option-sucker-blocker"
              />
            </View>
          </View>
        )}
        {opponentTurnReveal && (
          <View pointerEvents="none" style={[styles.opponentTurnRevealOverlay, { top: opponentTurnReveal.top }]}>
            <View style={styles.opponentTurnRevealPanel}>
              <View style={[styles.opponentTurnRevealDiceRow, { gap: opponentTurnReveal.gap }]}>
                {opponentTurnReveal.dice.map((face, index) => {
                  const opacity = opponentTurnReveal.progress.interpolate({
                    inputRange: [0, Math.min(0.76, 0.16 + index * 0.08), 1],
                    outputRange: [0, 0, 1],
                  });
                  const translateY = opponentTurnReveal.progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-26 - index * 2, 0],
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
                      {failedDiceImages.includes(face) && <Text style={styles.flyingDieFallback}>{face}</Text>}
                      <Image
                        source={whiteDiceImages[face]}
                        style={styles.opponentTurnRevealDieImage}
                        onError={() => {
                          setFailedDiceImages((faces) => (faces.includes(face) ? faces : [...faces, face]));
                        }}
                      />
                    </Animated.View>
                  );
                })}
              </View>
              <Animated.View
                style={[
                  styles.opponentTurnRevealMessage,
                  {
                    opacity: opponentTurnReveal.progress.interpolate({
                      inputRange: [0, 0.58, 1],
                      outputRange: [0, 0, 1],
                    }),
                    transform: [
                      {
                        translateY: opponentTurnReveal.progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [8, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text
                  adjustsFontSizeToFit
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={styles.opponentTurnRevealText}
                >
                  {opponentTurnReveal.playerName} played{' '}
                  <Text style={styles.opponentTurnRevealTextHighlight}>{opponentTurnReveal.score}</Text>
                  {' '}on{' '}
                  <Text style={styles.opponentTurnRevealTextHighlight}>{opponentTurnReveal.categoryLabel}</Text>
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
                outputRange: [0, -30 - index * 2, die.toY - die.fromY - 16, die.toY - die.fromY],
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
                  {failedDiceImages.includes(die.face) && <Text style={styles.flyingDieFallback}>{die.face}</Text>}
                  <Image
                    source={whiteDiceImages[die.face]}
                    style={styles.scoreFlyingDieImage}
                    onError={() => {
                      setFailedDiceImages((faces) => (faces.includes(die.face) ? faces : [...faces, die.face]));
                    }}
                  />
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
                outputRange: [0, -18, scoreFlyNumber.toY - scoreFlyNumber.fromY],
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
                    {
                      left: scoreFlyNumber.fromX,
                      opacity,
                      top: scoreFlyNumber.fromY,
                      transform: [{ translateX }, { translateY }, { scale }],
                    },
                  ]}
                >
                  <Text style={styles.scoreFlyingNumberText}>{scoreFlyNumber.value}</Text>
                </Animated.View>
              );
            })()}
          </View>
        )}
        {showSuckerPunchNotice && (
          <View pointerEvents="none" style={styles.suckerPunchNoticeOverlay}>
            <View style={styles.suckerPunchNotice}>
              <Text style={styles.suckerPunchNoticeTitle}>You got</Text>
              <Text style={styles.suckerPunchNoticeText}>Sucker Punched!</Text>
            </View>
          </View>
        )}
        {showSuckerBlockedNotice && (
          <View pointerEvents="none" style={styles.suckerPunchNoticeOverlay}>
            <View style={styles.suckerPunchNotice}>
              <Text style={styles.suckerPunchNoticeTitle}>Your punch was</Text>
              <Text style={styles.suckerPunchNoticeText}>Blocked!</Text>
            </View>
          </View>
        )}
        {suckerRollNoticeTitle && (
          <View pointerEvents="none" style={styles.suckerPunchNoticeOverlay}>
            <View style={[styles.suckerPunchNotice, styles.suckerRollNotice]}>
              <Text style={styles.suckerPunchNoticeTitle}>{suckerRollNoticeTitle}</Text>
              <Text style={styles.suckerPunchNoticeText}>Sucker!!</Text>
            </View>
          </View>
        )}
        {remoteError && (
          <View pointerEvents="none" style={styles.remoteErrorNoticeOverlay}>
            <Text style={styles.remoteErrorNoticeText}>{remoteError}</Text>
          </View>
        )}
        {gameOverVisible && (
          <View style={styles.gameOverOverlay} testID="game-over-overlay">
            <View style={styles.gameOverPanel} testID="game-over-panel">
              <Pressable
                accessibilityLabel="Close game over"
                onPress={handleCloseGameOver}
                style={({ pressed }) => [styles.gameOverCloseButton, pressed && styles.pressed]}
              >
                <Text style={styles.gameOverCloseText}>×</Text>
              </Pressable>
              <Text style={styles.gameOverEyebrow}>Game Over</Text>
              <Text style={styles.gameOverTitle}>{gameOverTitle}</Text>
              <View style={styles.gameOverScores}>
                <View style={styles.gameOverScoreBox} testID="game-over-home-score">
                  <Text style={styles.gameOverScoreName}>{homePlayer.name}</Text>
                  <Text style={styles.gameOverScoreValue}>{homeScore}</Text>
                </View>
                <View style={styles.gameOverScoreBox} testID="game-over-opponent-score">
                  <Text style={styles.gameOverScoreName}>{opponentPlayer.name}</Text>
                  <Text style={styles.gameOverScoreValue}>{opponentScore}</Text>
                </View>
              </View>
              <View style={styles.gameOverActions}>
                <Pressable
                  onPress={() => void handleRematch()}
                  style={({ pressed }) => [styles.gameOverPrimaryButton, pressed && styles.pressed]}
                >
                  <View style={styles.buttonGloss} />
                  <View style={styles.buttonInnerShade} />
                  <Text style={styles.gameOverPrimaryText}>Rematch</Text>
                </Pressable>
                <Pressable
                  onPress={handleDismissGameOver}
                  style={({ pressed }) => [styles.gameOverSecondaryButton, pressed && styles.pressed]}
                >
                  <View style={styles.buttonInnerShade} />
                  <Text style={styles.gameOverSecondaryText}>Not now</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
        {showStatsPage && (
          <StatsPage
            currentOpponentName={opponentPlayer.name}
            currentScore={totalScore(homePlayer.scorecard)}
            onClose={() => setShowStatsPage(false)}
            opponentScore={totalScore(opponentPlayer.scorecard)}
            stats={computerStats}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

type PlayerView = ReturnType<typeof createGame>['players'][number];

function upperSectionTotal(scorecard: PlayerView['scorecard']) {
  return upperCategories.reduce((sum, category) => sum + (scorecard[category] ?? 0), 0);
}

function BonusValueText({
  awarded,
  faceColor,
  scale,
}: {
  awarded: boolean;
  faceColor: Animated.AnimatedInterpolation<string | number>;
  scale: Animated.AnimatedInterpolation<number>;
}) {
  const outlineColor = awarded ? awardedBonusOutlineColor : bonusOutlineColor;

  return (
    <Animated.View style={[styles.bonusValueWrap, { transform: [{ scale }] }]}>
      {bonusOutlineOffsets.map((offset, index) => (
        <Text
          key={`${offset.x}:${offset.y}:${index}`}
          style={[styles.bonusBig, styles.bonusBigOutline, { color: outlineColor, left: offset.x, top: offset.y }]}
        >
          +35
        </Text>
      ))}
      <Animated.Text style={[styles.bonusBig, styles.bonusBigFace, { color: faceColor }]}>+35</Animated.Text>
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
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tokenOption, disabled && styles.disabledTokenOption, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={styles.tokenOptionCost}>
        <Image source={suckerTokenImage} style={styles.tokenOptionCostIcon} />
        <Text style={styles.tokenOptionCostText}>{costLabel ?? cost}</Text>
      </View>
      <View style={styles.tokenOptionBody}>
        <Text style={[styles.tokenOptionTitle, disabled && styles.disabledTokenOptionText]}>{label}</Text>
        <Text style={[styles.tokenOptionDescription, disabled && styles.disabledTokenOptionText]}>{description}</Text>
      </View>
    </Pressable>
  );
}

function BonusMeter({ total }: { total: number }) {
  const clampedTotal = Math.max(0, Math.min(upperBonusTarget, total));
  const progress = clampedTotal / upperBonusTarget;
  const size = 44;
  const strokeWidth = 5;
  const center = size / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const progressColor = '#F12D22';

  return (
    <View style={styles.bonusMeter}>
      <View style={styles.bonusMeterFace}>
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
        <Text adjustsFontSizeToFit allowFontScaling={false} numberOfLines={1} style={styles.bonusMeterText}>
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
};

function ScorePair(props: ScorePairProps) {
  return (
    <View style={styles.boardRow}>
      <ScoreCell category={props.leftCategory} {...props} />
      {props.rightCategory ? (
        <ScoreCell category={props.rightCategory} {...props} />
      ) : (
        <View style={styles.scorePair} />
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
}: ScoreCellProps) {
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
  const scoreText =
    homeDisplayScore !== null ? String(homeDisplayScore) : homePreviewScore !== null ? String(homePreviewScore) : '';
  const opponentScoreText =
    opponentDisplayScore !== null
      ? String(opponentDisplayScore)
      : opponentPreviewScore !== null
        ? String(opponentPreviewScore)
        : '';
  const selectedScale = selectedPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, highlighted ? 1.06 : 1],
  });

  return (
    <View style={styles.scorePair}>
      <Pressable
        disabled={!selectable || locked}
        nativeID={`category-button-${category}`}
        onPress={() => onSelect(category)}
        testID={`category-button-${category}`}
        style={({ pressed }) => [styles.categoryTileButton, pressed && styles.pressed]}
      >
        <View
          style={[
            styles.categoryTile,
            category === 'sucker' && styles.suckerCategoryTile,
            highlighted && styles.selectedCategoryTile,
          ]}
        >
          <View style={styles.tileGloss} />
          <View style={styles.tileGlossFade} />
          <CategoryTile category={category} />
        </View>
      </Pressable>
      <Animated.View
        style={[
          styles.scorePressWrap,
          {
            transform: [{ scale: selectedScale }],
          },
        ]}
      >
        <Pressable
          disabled={!selectable || locked}
          onPress={() => onSelect(category)}
          ref={(node) => setScoreBoxRef(category, node)}
          style={({ pressed }) => [
            styles.scoreBox,
            homeLockedScore !== null && styles.lockedScoreBox,
            highlighted && activePlayerIndex === 0 && styles.selectedScoreBox,
            homePreviewScore === 0 && styles.zeroPreviewScoreBox,
            pressed && styles.pressed,
          ]}
          testID={`home-score-box-${category}`}
        >
          {homeSuckerBonus && <SuckerBonusBadge />}
          <Text
            adjustsFontSizeToFit
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.scoreBoxText, homePreviewScore !== null && styles.previewScoreText]}
          >
            {scoreText}
          </Text>
        </Pressable>
      </Animated.View>
      <Pressable
        disabled={!selectable || locked}
        onPress={() => onSelect(category)}
        ref={(node) => setOpponentScoreRef(category, node)}
        style={styles.opponentScoreWrap}
        testID={`opponent-score-box-${category}`}
      >
        {opponentSuckerBonus && <SuckerBonusBadge compact />}
        <Text
          adjustsFontSizeToFit
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.opponentScoreText, opponentPreviewScore !== null && styles.previewScoreText]}
        >
          {opponentScoreText}
        </Text>
      </Pressable>
    </View>
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

function SuckerBonusBadge({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.suckerBonusBadge, compact && styles.compactSuckerBonusBadge]}>
      <Text style={[styles.suckerBonusBadgeText, compact && styles.compactSuckerBonusBadgeText]}>+50</Text>
    </View>
  );
}

function BackgroundDicePattern({ floatValue }: { floatValue: Animated.Value }) {
  const drift = floatValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 9],
  });

  return (
    <View pointerEvents="none" style={styles.backgroundPattern}>
      {[1, 2, 3, 4, 5, 6].map((face, index) => (
        <Animated.Image
          key={`${face}-${index}`}
          source={whiteDiceImages[face as DieValue]}
          style={[
            styles.backgroundDie,
            backgroundDiePositions[index],
            {
              transform: [
                { translateY: index % 2 === 0 ? drift : Animated.multiply(drift, -1) },
                { rotate: `${index % 2 === 0 ? -12 : 14}deg` },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

function CategoryTile({ category }: { category: ScoreCategory }) {
  const upperIndex = upperCategories.indexOf(category);

  if (upperIndex >= 0) {
    const face = (upperIndex + 1) as DieValue;
    return <Image source={categoryPipImages[face]} style={styles.categoryDiePips} />;
  }

  switch (category) {
    case 'threeOfAKind':
      return <Text style={styles.kindText}>3x</Text>;
    case 'fourOfAKind':
      return <Text style={styles.kindText}>4x</Text>;
    case 'fullHouse':
      return <FullHouseIcon />;
    case 'smallStraight':
      return <StraightIcon label="SMALL" cardCount={3} />;
    case 'largeStraight':
      return <StraightIcon label="LARGE" cardCount={4} />;
    case 'sucker':
      return <SuckerIcon />;
    case 'chance':
      return <Text style={styles.chanceText}>?</Text>;
    default:
      return null;
  }
}

function FullHouseIcon() {
  return (
    <View style={styles.fullHouseIcon}>
      <View style={styles.houseRoof} />
      <View style={styles.houseBody}>
        <View style={styles.houseDoor} />
      </View>
    </View>
  );
}

function StraightIcon({ label, cardCount }: { label: string; cardCount: 3 | 4 }) {
  const cards = [...Array(cardCount)];
  const fanCardWidth = 17;
  const fanCardSpread = 7;
  const fanWidth = fanCardWidth + (cardCount - 1) * fanCardSpread;

  return (
    <View style={styles.straightIcon}>
      <View style={[styles.cardFan, { width: fanWidth }]}>
        {cards.map((_, index) => (
          <View
            key={index}
            style={[
              styles.fanCard,
              {
                left: index * fanCardSpread,
                top: Math.abs(index - (cardCount - 1) / 2) * 3,
                transform: [{ rotate: `${(index - (cardCount - 1) / 2) * 13}deg` }],
              },
            ]}
          >
            <View style={styles.fanCardCorner} />
          </View>
        ))}
      </View>
      <Text style={[styles.straightLabel, label === 'LARGE' && styles.largeStraightLabel]}>{label}</Text>
    </View>
  );
}

function SuckerIcon() {
  return <SuckerWordmark variant="tile" />;
}

function SuckerWordmark({ variant }: { variant: 'header' | 'tile' }) {
  const isHeader = variant === 'header';

  return (
    <View style={[styles.suckerWordmark, isHeader ? styles.headerSuckerWordmark : styles.tileSuckerWordmark]}>
      <Image
        source={isHeader ? suckerLobbyHeaderImage : suckerScorecardWordmarkImage}
        style={styles.suckerWordmarkImage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  screen: {
    backgroundColor: '#8F0000',
    gap: 7,
    overflow: 'hidden',
    padding: 8,
    paddingBottom: 12,
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
    fontWeight: '900',
  },
  remoteLoadingScreen: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 16,
  },
  remoteLoadingTitle: {
    color: '#FFD329',
    fontSize: 26,
    fontWeight: '900',
  },
  remoteMessage: {
    color: '#FFF3C2',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  backgroundPattern: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.18,
  },
  backgroundDie: {
    height: 64,
    opacity: 0.45,
    position: 'absolute',
    resizeMode: 'contain',
    tintColor: '#FFB000',
    width: 64,
  },
  topBar: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    borderColor: '#FFB000',
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 58,
    overflow: 'visible',
    paddingHorizontal: 10,
    paddingVertical: 4,
    position: 'relative',
    zIndex: 60,
  },
  topBarBannerClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
    overflow: 'hidden',
    zIndex: 1,
  },
  topBarBannerImage: {
    height: '100%',
    resizeMode: 'stretch',
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
  backButtonText: {
    color: '#FFF0A6',
    fontSize: 54,
    fontWeight: '900',
    lineHeight: 54,
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
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
    ...StyleSheet.absoluteFillObject,
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
    minHeight: 66,
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
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 0,
  },
  playerName: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    maxWidth: '100%',
  },
  tokenText: {
    color: '#FFD329',
    fontSize: 10,
    fontWeight: '900',
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#160303',
    borderColor: '#FFD329',
    borderRadius: 27,
    borderWidth: 3,
    height: 52,
    justifyContent: 'center',
    left: 10,
    position: 'absolute',
    top: 6,
    width: 54,
  },
  activeAvatar: {
    backgroundColor: '#FFD76A',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  board: {
    backgroundColor: '#F3B84A',
    borderColor: '#210505',
    borderRadius: 18,
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
    justifyContent: 'flex-start',
  },
  categoryTileButton: {
    alignItems: 'flex-start',
    flexShrink: 0,
    height: 68,
    justifyContent: 'center',
    overflow: 'visible',
    width: 68,
  },
  categoryTile: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFF3C2',
    borderRadius: 12,
    borderWidth: 3,
    justifyContent: 'center',
    shadowColor: '#5A1308',
    shadowOffset: { width: 3, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 0,
    height: 56,
    overflow: 'hidden',
    width: 56,
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
    resizeMode: 'contain',
    width: '112%',
    zIndex: 1,
  },
  kindText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  chanceText: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
  },
  scoreBox: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 12,
    borderWidth: 3,
    justifyContent: 'center',
    shadowColor: '#5A1308',
    shadowOffset: { width: 3, height: 5 },
    shadowOpacity: 0.5,
    shadowRadius: 0,
    height: 56,
    overflow: 'visible',
    width: '100%',
  },
  scorePressWrap: {
    height: 56,
    marginRight: 10,
    width: 56,
  },
  opponentScoreWrap: {
    alignItems: 'center',
    flexShrink: 0,
    height: 56,
    justifyContent: 'center',
    marginLeft: -8,
    width: 54,
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
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 34,
    textAlign: 'center',
  },
  opponentScoreText: {
    color: '#A24B13',
    fontSize: 32,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 34,
    textAlign: 'center',
    width: '100%',
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
    right: -9,
    top: -12,
    transform: [{ rotate: '-1deg' }],
    width: 43,
    zIndex: 5,
  },
  compactSuckerBonusBadge: {
    right: -2,
    top: -8,
    transform: [{ rotate: '0deg' }],
    width: 39,
  },
  suckerBonusBadgeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 17,
    textShadowColor: '#7A1208',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  compactSuckerBonusBadgeText: {
    fontSize: 14,
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
    width: 67,
  },
  bonusSmall: {
    color: '#5A1308',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 10,
    textTransform: 'uppercase',
  },
  bonusValueWrap: {
    height: 34,
    marginTop: -1,
    position: 'relative',
    width: 58,
  },
  bonusBig: {
    fontSize: 28,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 30,
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
    fontWeight: '900',
    lineHeight: 12,
    textAlign: 'center',
    zIndex: 2,
  },
  diceTray: {
    flexDirection: 'row',
    gap: 8,
    height: 70,
    justifyContent: 'space-between',
  },
  rollZone: {
    gap: 7,
    marginTop: 4,
    position: 'relative',
  },
  dieMotion: {
    flex: 1,
    height: '100%',
  },
  dieSlot: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#7A220D',
    borderRadius: 12,
    borderWidth: 3,
    height: '100%',
    justifyContent: 'center',
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    width: '100%',
  },
  settlingDieSlot: {
    opacity: 0.55,
  },
  heldDie: {
    backgroundColor: '#FFF0A6',
    borderColor: '#FFD329',
    shadowColor: '#FFD329',
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  dieImage: {
    height: '92%',
    resizeMode: 'contain',
    width: '92%',
  },
  scoringSourceDieImage: {
    opacity: 0,
  },
  heldDieImage: {
    transform: [{ scale: 1.03 }],
  },
  dieFallback: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
    position: 'absolute',
  },
  rollingDiceOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    resizeMode: 'contain',
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
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.38,
    shadowRadius: 0,
  },
  opponentTurnRevealDieImage: {
    height: '100%',
    resizeMode: 'contain',
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
    ...StyleSheet.absoluteFillObject,
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
    resizeMode: 'contain',
    width: '100%',
  },
  scoreNumberOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 48,
    textAlign: 'center',
    textShadowColor: '#FFF3C2',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  suckerPunchNoticeOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.45,
    shadowRadius: 0,
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
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 7,
    textAlign: 'center',
  },
  gameOverOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 0,
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
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  gameOverTitle: {
    color: '#FFD329',
    fontSize: 30,
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
    fontWeight: '900',
    maxWidth: '100%',
  },
  gameOverScoreValue: {
    color: '#210505',
    fontSize: 30,
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
    fontWeight: '900',
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  flyingDieFallback: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    position: 'absolute',
    zIndex: 1,
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
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
  },
  disabledRollButton: {
    opacity: 0.55,
  },
  controlsRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    height: 64,
    paddingBottom: 4,
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
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
  },
  tokenButtonImage: {
    height: 44,
    resizeMode: 'contain',
    width: 44,
  },
  tokenCountBadge: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
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
    fontWeight: '900',
    lineHeight: 14,
  },
  tokenMenuOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.45,
    shadowRadius: 0,
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
    fontWeight: '900',
    lineHeight: 23,
  },
  tokenMenuSubtitle: {
    color: '#FFF3C2',
    fontSize: 12,
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
    fontWeight: '900',
  },
  tokenOptionDescription: {
    color: '#7A220D',
    fontSize: 11,
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
    fontSize: 30,
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
    fontWeight: '900',
    lineHeight: 20,
  },
  rollsLeftLabel: {
    color: '#7A220D',
    fontSize: 9,
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
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
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
    shadowColor: '#7A401D',
    shadowOffset: { width: 1, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
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
