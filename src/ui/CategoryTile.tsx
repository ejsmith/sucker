import { Image, StyleSheet, Text, View } from 'react-native';
import type { DieValue, ScoreCategory } from '../game';
import { createBoxShadowStyle } from './boxShadow';
import { DieFace } from './DieFace';
import { useGameLayout } from './gameLayoutContext';

const suckerScorecardWordmarkImage = require('../../assets/sucker-scorecard-wordmark.png');
// Match the game screen.
const gameFontBlack = 'Inter_900Black';
const gameMaxFontSizeMultiplier = 1.2;

export const upperCategories: ScoreCategory[] = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];

// A score box's red category tile, as drawn on the game screen. Sized by the
// surrounding GameLayoutContext.
export function CategoryTileFace({
  category,
  highlighted = false,
}: {
  category: ScoreCategory;
  highlighted?: boolean;
}) {
  const layout = useGameLayout();

  return (
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

function SuckerIcon() {
  const layout = useGameLayout();

  return (
    <View
      style={[styles.suckerWordmark, styles.tileSuckerWordmark, { height: layout.unit(44), width: layout.unit(68) }]}
    >
      <Image source={suckerScorecardWordmarkImage} style={styles.suckerWordmarkImage} />
    </View>
  );
}

const styles = StyleSheet.create({
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
  tileSuckerWordmark: {
    height: 24,
    width: 68,
  },
  suckerWordmarkImage: {
    height: '100%',
    resizeMode: 'contain',
    width: '100%',
  },
});
