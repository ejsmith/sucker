import { StatusBar } from 'expo-status-bar';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
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
  createGame,
  rollCurrentDice,
  scoreCategoryForScorecard,
  scoreTurn,
  toggleHold,
  totalScore,
} from './src/game';
import type { DieValue, ScoreCategory } from './src/game';
import Svg, { Circle } from 'react-native-svg';

type ViewRef = ComponentRef<typeof View>;
type MeasuredRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};
type ScoreFlyDie = {
  face: DieValue;
  fromX: number;
  fromY: number;
  id: string;
  progress: Animated.Value;
  toX: number;
  toY: number;
};
type RollingLaunch = {
  delay: number;
  duration: number;
  lift: number;
  peakScale: number;
  settleX: number;
  skimX: number;
  startY: number;
  side: 'left' | 'right';
  spin: number;
};

const playerNames = ['You', 'Maya'];
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

const backgroundDiePositions = [
  { left: 22, top: 8 },
  { right: 28, top: 18 },
  { left: 38, bottom: 18 },
  { right: 46, bottom: 10 },
  { left: '46%', top: 78 },
  { right: 10, top: '56%' },
] as const;

const suckerOutlineOffsets = [
  { x: -3, y: -1 },
  { x: 3, y: -1 },
  { x: -2, y: 0 },
  { x: 2, y: 0 },
  { x: -2, y: 2 },
  { x: 2, y: 2 },
  { x: 0, y: -3 },
  { x: 0, y: 3 },
] as const;

export default function App() {
  const { width: screenWidth } = useWindowDimensions();
  const [game, setGame] = useState(() => createGame(playerNames));
  const [isRolling, setIsRolling] = useState(false);
  const [failedDiceImages, setFailedDiceImages] = useState<number[]>([]);
  const [rollingFaces, setRollingFaces] = useState<DieValue[]>([1, 1, 1, 1, 1]);
  const [rollingDieIndexes, setRollingDieIndexes] = useState<number[]>([]);
  const [rollingLaunches, setRollingLaunches] = useState<Partial<Record<number, RollingLaunch>>>({});
  const [selectedCategory, setSelectedCategory] = useState<ScoreCategory | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [scoreFlyDice, setScoreFlyDice] = useState<ScoreFlyDie[]>([]);
  const screenRef = useRef<ViewRef | null>(null);
  const dieSlotRefs = useRef<(ViewRef | null)[]>([]);
  const scoreBoxRefs = useRef<Partial<Record<ScoreCategory, ViewRef | null>>>({});
  const opponentScoreRefs = useRef<Partial<Record<ScoreCategory, ViewRef | null>>>({});
  const diceAnimations = useRef([...Array(5)].map(() => new Animated.Value(0))).current;
  const bgFloat = useRef(new Animated.Value(0)).current;
  const selectedPulse = useRef(new Animated.Value(0)).current;
  const currentPlayer = game.players[game.currentPlayerIndex];
  const openCategories = availableCategories(currentPlayer.scorecard);
  const leader = useMemo(
    () => [...game.players].sort((a, b) => totalScore(b.scorecard) - totalScore(a.scorecard))[0],
    [game.players],
  );
  const canRollVisually = game.phase !== 'complete' && game.rollNumber < 4;
  const canRoll = canRollVisually && !isRolling && !isScoring;
  const homePlayer = game.players[0];
  const opponentPlayer = game.players[1];
  const canPlaySelected = selectedCategory !== null && game.rollNumber > 0 && !isRolling && !isScoring;

  useEffect(() => {
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

  function handleRoll() {
    if (!canRoll) {
      return;
    }

    const rollingIndexes = game.held
      .map((held, index) => (held ? null : index))
      .filter((index): index is number => index !== null);
    const nextGame = rollCurrentDice(game);
    const finalDice = nextGame.dice;

    setGame(nextGame);
    setIsRolling(true);
    setSelectedCategory(null);
    setRollingDieIndexes(rollingIndexes);
    const launchSide = Math.random() < 0.5 ? 'left' : 'right';
    const launches = Object.fromEntries(
      rollingIndexes.map((index) => [index, createRollingLaunch(index, launchSide)]),
    ) as Partial<Record<number, RollingLaunch>>;
    setRollingLaunches(launches);
    setRollingFaces(game.dice);
    rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));

    if (rollingIndexes.length === 0) {
      setIsRolling(false);
      return;
    }

    const scrambleTimer = setInterval(() => {
      setRollingFaces((faces) =>
        faces.map((face, index) => (rollingIndexes.includes(index) ? rollDisplayDie() : face)) as DieValue[],
      );
    }, 65);

    Animated.parallel(
      rollingIndexes.map((index) => {
        const launch = launches[index] ?? defaultRollingLaunch;

        return (
        Animated.sequence([
          Animated.delay(launch.delay),
          Animated.timing(diceAnimations[index], {
            toValue: 1,
            duration: launch.duration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ])
        );
      }),
    ).start(() => {
      clearInterval(scrambleTimer);
      setRollingFaces(finalDice);
      rollingIndexes.forEach((index) => diceAnimations[index].setValue(0));
      setRollingDieIndexes([]);
      setRollingLaunches({});
      setIsRolling(false);
    });
  }

  function handleSelectCategory(category: ScoreCategory) {
    if (game.rollNumber === 0 || isRolling || isScoring || !openCategories.includes(category)) {
      return;
    }

    setSelectedCategory(category);
  }

  async function handlePlayScore() {
    if (!selectedCategory || isScoring) {
      return;
    }

    const category = selectedCategory;
    const targetRef =
      game.currentPlayerIndex === 0 ? scoreBoxRefs.current[category] : opponentScoreRefs.current[category];
    const [screenRect, targetRect, sourceRects] = await Promise.all([
      measureInWindow(screenRef.current),
      measureInWindow(targetRef ?? null),
      Promise.all(dieSlotRefs.current.map((ref) => measureInWindow(ref))),
    ]);

    if (!screenRect || !targetRect || sourceRects.some((rect) => rect === null)) {
      setGame((state) => scoreTurn(state, category));
      setSelectedCategory(null);
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
      const offset = targetOffsets[index];
      return {
        face,
        fromX: rect.x - screenRect.x,
        fromY: rect.y - screenRect.y,
        id: `${category}-${index}-${Date.now()}`,
        progress: new Animated.Value(0),
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
        setGame((state) => scoreTurn(state, category));
        setSelectedCategory(null);
      });
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View ref={screenRef} style={styles.screen}>
        <BackgroundDicePattern floatValue={bgFloat} />
        <View style={styles.topBar}>
          <Text style={styles.backButton}>‹</Text>
          <Text style={styles.appTitle}>Sucker!</Text>
          <Text style={styles.turnText}>
            {game.phase === 'complete'
              ? `${leader.name} wins with ${totalScore(leader.scorecard)}`
              : `${currentPlayer.name}'s turn`}
          </Text>
          <View style={styles.menuDots}>
            <View style={styles.menuDot} />
            <View style={styles.menuDot} />
            <View style={styles.menuDot} />
          </View>
        </View>

        <View style={styles.playerStrip}>
          {game.players.map((player, index) => (
            <View key={player.id} style={[styles.playerPill, index === game.currentPlayerIndex && styles.activePlayer]}>
              <View style={[styles.avatar, index === game.currentPlayerIndex && styles.activeAvatar]}>
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

        <View style={styles.board}>
          {upperCategories.map((leftCategory, index) => (
            <ScorePair
              key={leftCategory}
              leftCategory={leftCategory}
              rightCategory={lowerCategories[index]}
              activePlayer={currentPlayer}
              activePlayerIndex={game.currentPlayerIndex}
              homePlayer={homePlayer}
              opponentPlayer={opponentPlayer}
              dice={game.dice}
              canChoose={game.rollNumber > 0 && !isRolling && !isScoring}
              selectedCategory={selectedCategory}
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
            <View style={styles.bonusPanel}>
              <View style={styles.bonusContent}>
                <View style={styles.bonusTextBlock}>
                  <Text style={styles.bonusSmall}>Section{'\n'}Bonus</Text>
                  <Text style={styles.bonusBig}>+35</Text>
                </View>
                <BonusMeter total={upperSectionTotal(homePlayer.scorecard)} />
                <BonusMeter total={upperSectionTotal(opponentPlayer.scorecard)} />
              </View>
            </View>
            <ScoreCell
              category="chance"
              activePlayer={currentPlayer}
              activePlayerIndex={game.currentPlayerIndex}
              homePlayer={homePlayer}
              opponentPlayer={opponentPlayer}
              dice={game.dice}
              canChoose={game.rollNumber > 0 && !isRolling && !isScoring}
              selectedCategory={selectedCategory}
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

        <View style={styles.rollZone}>
          <View style={styles.diceTray}>
            {game.dice.map((die, index) => {
              const isFlying = isRolling && rollingDieIndexes.includes(index);
              const showDie = game.rollNumber > 0 || isRolling;

              return (
                <View key={`die-${index}`} style={styles.dieMotion}>
                  <Pressable
                    disabled={!showDie || isRolling || isScoring}
                    onPress={() => setGame((state) => toggleHold(state, index))}
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
                    {showDie && (
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
                const trackWidth = Math.max((screenWidth - 16) / 5, 64);
                const trackLeft = index * trackWidth;
                const sideStartX =
                  launch.side === 'left'
                    ? -trackLeft - trackWidth - 34
                    : screenWidth - trackLeft + 20;
                const flyY = diceAnimations[index].interpolate({
                  inputRange: [0, 0.18, 0.42, 0.7, 1],
                  outputRange: [launch.startY, -18 - launch.lift, -34 - launch.lift * 0.35, -7, 0],
                });
                const flyX = diceAnimations[index].interpolate({
                  inputRange: [0, 0.24, 0.5, 0.76, 1],
                  outputRange: [
                    sideStartX,
                    sideStartX * 0.54,
                    launch.skimX,
                    launch.settleX,
                    0,
                  ],
                });
                const flyScale = diceAnimations[index].interpolate({
                  inputRange: [0, 0.25, 0.55, 0.82, 1],
                  outputRange: [0.86 + index * 0.02, 1.18, launch.peakScale, 1.03, 0.72],
                });
                const flyRotate = diceAnimations[index].interpolate({
                  inputRange: [0, 0.2, 0.4, 0.62, 0.82, 1],
                  outputRange: [
                    `${launch.side === 'left' ? -28 : 28}deg`,
                    `${launch.spin}deg`,
                    `${-launch.spin * 0.72}deg`,
                    `${launch.spin * 0.46}deg`,
                    `${-launch.spin * 0.22}deg`,
                    '0deg',
                  ],
                });
                const flyOpacity = diceAnimations[index].interpolate({
                  inputRange: [0, 0.76, 1],
                  outputRange: [1, 1, 0],
                });

                return (
                  <Animated.View
                    key={`flying-die-${index}`}
                    style={[
                      styles.rollingDieTrack,
                      {
                        left: `${index * 20}%`,
                        opacity: flyOpacity,
                        transform: [{ translateX: flyX }, { translateY: flyY }, { rotate: flyRotate }, { scale: flyScale }],
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
              style={({ pressed }) => [styles.rollButton, !canRoll && styles.disabledRollButton, pressed && styles.pressed]}
            >
              <View style={styles.buttonGloss} />
              <Text style={styles.rollText}>ROLL</Text>
              <View style={styles.rollMeters}>
                {[0, 1, 2, 3].map((rollIndex) => (
                  <View
                    key={rollIndex}
                    style={[styles.rollMeter, rollIndex < game.rollNumber && styles.rollMeterFilled]}
                  >
                    <Text style={styles.rollMeterText}>{rollIndex + 1}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          </View>

          <Pressable
            disabled={!canPlaySelected}
            onPress={handlePlayScore}
            style={({ pressed }) => [styles.playButton, !canPlaySelected && styles.disabledButton, pressed && styles.pressed]}
          >
            <View style={styles.playGloss} />
            <Text style={styles.playText}>PLAY</Text>
          </Pressable>
          </View>
        </View>
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
                outputRange: ['0deg', index % 2 === 0 ? '18deg' : '-18deg', index % 2 === 0 ? '-10deg' : '10deg', '0deg'],
              });

              return (
                <Animated.View
                  key={die.id}
                  style={[
                    styles.scoreFlyingDie,
                    {
                      left: die.fromX,
                      opacity,
                      top: die.fromY,
                      transform: [{ translateX }, { translateY }, { rotate }, { scale }],
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
      </View>
    </SafeAreaView>
  );
}

type PlayerView = ReturnType<typeof createGame>['players'][number];

function upperSectionTotal(scorecard: PlayerView['scorecard']) {
  return upperCategories.reduce((sum, category) => sum + (scorecard[category] ?? 0), 0);
}

function BonusMeter({ total }: { total: number }) {
  const clampedTotal = Math.max(0, Math.min(63, total));
  const progress = clampedTotal / 63;
  const size = 44;
  const strokeWidth = 5;
  const center = size / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={styles.bonusMeter}>
      <View style={styles.bonusMeterFace}>
        <Svg height={size} style={styles.bonusMeterSvg} width={size}>
          <Circle cx={center} cy={center} fill="#E7B45C" r={radius} stroke="#8E4A25" strokeWidth={strokeWidth} />
          {progress > 0 && (
            <Circle
              cx={center}
              cy={center}
              fill="transparent"
              r={radius}
              stroke="#65EFFF"
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
      {props.rightCategory ? <ScoreCell category={props.rightCategory} {...props} /> : <View style={styles.scorePair} />}
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
  const previewScore = selected && !locked ? scoreCategoryForScorecard(dice, category, activePlayer.scorecard) : null;
  const homePreviewScore = activePlayerIndex === 0 ? previewScore : null;
  const opponentPreviewScore = activePlayerIndex === 1 ? previewScore : null;
  const homeSuckerBonus = (homePlayer.suckerBonusCategories ?? []).includes(category);
  const opponentSuckerBonus = (opponentPlayer.suckerBonusCategories ?? []).includes(category);
  const scoreText =
    homeLockedScore !== null ? String(homeLockedScore) : homePreviewScore !== null ? String(homePreviewScore) : '';
  const opponentScoreText =
    opponentLockedScore !== null
      ? String(opponentLockedScore)
      : opponentPreviewScore !== null
        ? String(opponentPreviewScore)
        : '';
  const selectedScale = selectedPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, selected ? 1.06 : 1],
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
            selected && styles.selectedCategoryTile,
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
            selected && activePlayerIndex === 0 && styles.selectedScoreBox,
            homePreviewScore === 0 && styles.zeroPreviewScoreBox,
            pressed && styles.pressed,
          ]}
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
  return (
    <View style={styles.suckerIcon}>
      {suckerOutlineOffsets.map((offset) => (
        <Text
          adjustsFontSizeToFit
          allowFontScaling={false}
          key={`${offset.x}-${offset.y}`}
          numberOfLines={1}
          style={[
            styles.suckerText,
            styles.suckerTextOutline,
            {
              transform: [{ translateX: offset.x }, { translateY: offset.y }],
            },
          ]}
        >
          Sucker!
        </Text>
      ))}
      <Text adjustsFontSizeToFit allowFontScaling={false} numberOfLines={1} style={styles.suckerText}>
        Sucker!
      </Text>
    </View>
  );
}

function rollDisplayDie(): DieValue {
  return (Math.floor(Math.random() * 6) + 1) as DieValue;
}

const defaultRollingLaunch: RollingLaunch = {
  delay: 0,
  duration: 760,
  lift: 16,
  peakScale: 1.45,
  settleX: 0,
  skimX: 24,
  startY: 18,
  side: 'left',
  spin: 110,
};

function createRollingLaunch(index: number, side: RollingLaunch['side']): RollingLaunch {
  const direction = side === 'left' ? 1 : -1;
  const spreadRank = index - 2;

  return {
    delay: Math.round(Math.random() * 90 + index * (8 + Math.random() * 12)),
    duration: Math.round(600 + Math.random() * 260),
    lift: 8 + Math.random() * 30,
    peakScale: 1.26 + Math.random() * 0.38,
    settleX: direction * (6 + index * 5) + (Math.random() * 18 - 9),
    skimX: direction * (18 + Math.random() * 56 + spreadRank * (5 + Math.random() * 5)),
    startY: 12 + Math.random() * 22,
    side,
    spin: direction * (88 + Math.random() * 58),
  };
}

function measureInWindow(node: ViewRef | null): Promise<MeasuredRect | null> {
  return new Promise((resolve) => {
    if (!node) {
      resolve(null);
      return;
    }

    node.measureInWindow((x, y, width, height) => {
      if (width === 0 || height === 0) {
        resolve(null);
        return;
      }

      resolve({ height, width, x, y });
    });
  });
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#086BAF',
  },
  screen: {
    backgroundColor: '#086BAF',
    flex: 1,
    gap: 7,
    overflow: 'hidden',
    padding: 8,
    paddingBottom: 12,
  },
  backgroundPattern: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.22,
  },
  backgroundDie: {
    height: 64,
    opacity: 0.45,
    position: 'absolute',
    resizeMode: 'contain',
    tintColor: '#2B8FDD',
    width: 64,
  },
  topBar: {
    alignItems: 'center',
    backgroundColor: '#123D69',
    borderBottomColor: '#6FB6E8',
    borderBottomWidth: 2,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  backButton: {
    color: '#FFF9D8',
    fontSize: 54,
    fontWeight: '900',
    left: 16,
    lineHeight: 54,
    position: 'absolute',
    textShadowColor: '#061C2C',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  menuDots: {
    gap: 4,
    position: 'absolute',
    right: 18,
  },
  menuDot: {
    backgroundColor: '#FFF9D8',
    borderColor: '#061C2C',
    borderRadius: 8,
    borderWidth: 1,
    height: 13,
    width: 13,
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  turnText: {
    color: '#BDEBFF',
    fontSize: 12,
    fontWeight: '800',
  },
  playerStrip: {
    backgroundColor: '#0B304C',
    borderRadius: 8,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  playerPill: {
    alignItems: 'center',
    flex: 1,
    minHeight: 66,
    justifyContent: 'center',
    paddingLeft: 70,
    paddingRight: 8,
  },
  activePlayer: {
    backgroundColor: '#559CF0',
  },
  playerScore: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
    textShadowColor: '#061C2C',
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
    color: '#FFE35F',
    fontSize: 10,
    fontWeight: '900',
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#0A2741',
    borderColor: '#FFE9A6',
    borderRadius: 27,
    borderWidth: 3,
    height: 54,
    justifyContent: 'center',
    left: 10,
    position: 'absolute',
    top: 6,
    width: 54,
  },
  activeAvatar: {
    backgroundColor: '#F5C86E',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  board: {
    backgroundColor: '#F0BB5E',
    borderColor: '#11334B',
    borderRadius: 18,
    borderWidth: 3,
    flex: 0.94,
    overflow: 'hidden',
  },
  boardRow: {
    borderBottomColor: '#F7D77C',
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
    backgroundColor: '#EF423D',
    borderColor: '#FFF7E8',
    borderRadius: 12,
    borderWidth: 3,
    justifyContent: 'center',
    shadowColor: '#7B3B1E',
    shadowOffset: { width: 3, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 0,
    height: 56,
    overflow: 'hidden',
    width: 56,
  },
  selectedCategoryTile: {
    borderColor: '#79E5FF',
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
    backgroundColor: '#FFF9D8',
    borderColor: '#B6732D',
    borderRadius: 12,
    borderWidth: 3,
    justifyContent: 'center',
    shadowColor: '#8D4E20',
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
    width: 44,
  },
  lockedScoreBox: {
    backgroundColor: '#FFE89A',
  },
  selectedScoreBox: {
    borderColor: '#58E7FF',
    borderWidth: 3,
  },
  zeroPreviewScoreBox: {
    backgroundColor: '#F1D6B8',
  },
  scoreBoxText: {
    color: '#8D4E20',
    fontSize: 32,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 34,
    textAlign: 'center',
  },
  opponentScoreText: {
    color: '#A95E21',
    fontSize: 32,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 34,
    textAlign: 'center',
    width: '100%',
  },
  previewScoreText: {
    color: '#0E6C8A',
  },
  suckerBonusBadge: {
    alignItems: 'center',
    backgroundColor: '#D93D4E',
    borderBottomColor: '#8A2430',
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
    textShadowColor: '#8A2430',
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
    color: '#A95E21',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 10,
    textTransform: 'uppercase',
  },
  bonusBig: {
    color: '#FFE35F',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 30,
    textShadowColor: '#7A401D',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
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
    color: '#A95E21',
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
    backgroundColor: '#11384C',
    borderColor: '#59BCE8',
    borderRadius: 12,
    borderWidth: 3,
    height: '100%',
    justifyContent: 'center',
    shadowColor: '#63CBFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    width: '100%',
  },
  settlingDieSlot: {
    opacity: 0.55,
  },
  heldDie: {
    backgroundColor: '#DDF2C9',
    borderColor: '#78D86D',
    shadowColor: '#B9FF74',
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
    top: 0,
    width: '20%',
  },
  rollingDieImage: {
    height: 88,
    resizeMode: 'contain',
    width: 88,
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
  flyingDieFallback: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    position: 'absolute',
    zIndex: 1,
  },
  rollButton: {
    alignItems: 'center',
    backgroundColor: '#7BF1F0',
    borderBottomColor: '#0A3856',
    borderColor: '#B7FFFF',
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    flex: 1,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  disabledRollButton: {
    opacity: 0.55,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 8,
    height: 58,
  },
  rollButtonWrap: {
    flex: 2,
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
  rollText: {
    color: '#15266F',
    fontSize: 30,
    fontWeight: '900',
    textShadowColor: '#FFFFFF',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  rollMeters: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 14,
  },
  rollMeter: {
    alignItems: 'center',
    backgroundColor: '#49BFCE',
    borderColor: '#6EE5F0',
    borderRadius: 3,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    opacity: 0.65,
    width: 24,
  },
  rollMeterFilled: {
    backgroundColor: '#E9FBFF',
    opacity: 1,
  },
  rollMeterText: {
    color: '#1A3B82',
    fontSize: 16,
    fontWeight: '900',
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: '#76D330',
    borderBottomColor: '#1D4E0F',
    borderColor: '#B8FF6C',
    borderRadius: 8,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
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
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    textShadowColor: '#1B2A14',
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
    backgroundColor: '#EF423D',
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
    backgroundColor: '#EF423D',
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
  suckerIcon: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    transform: [{ rotate: '-6deg' }],
    width: 78,
  },
  suckerText: {
    color: '#FFD329',
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 21,
    position: 'absolute',
    textAlign: 'center',
    textShadowColor: '#D88F00',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
    width: 82,
  },
  suckerTextOutline: {
    color: '#111111',
    textShadowOffset: { width: 0, height: 0 },
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.72,
  },
});
