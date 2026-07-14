import { getPhoneStageStyle, type PhoneStageOptions } from './phoneStage';

export const gameDesignWidth = 393;
export const gameDesignHeight = 852;
export const gameMinimumContentHeight = 759;
export const minimumGameScale = 0.75;
export const minimumTouchSize = 44;

export type GameLayoutInsets = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type GameViewportPreset = {
  height: number;
  insets: GameLayoutInsets;
  key: string;
  label: string;
  width: number;
};

const noInsets: GameLayoutInsets = { bottom: 0, left: 0, right: 0, top: 0 };

export const gameViewportPresets = [
  { key: 'se', label: 'SE', width: 375, height: 667, insets: { ...noInsets, top: 20 } },
  { key: 'mini', label: 'Mini', width: 375, height: 812, insets: { ...noInsets, bottom: 34, top: 50 } },
  { key: 'iphone16', label: '16', width: 393, height: 852, insets: { ...noInsets, bottom: 34, top: 59 } },
  { key: 'iphone17', label: '17', width: 402, height: 874, insets: { ...noInsets, bottom: 34, top: 62 } },
  { key: 'max', label: 'Max', width: 430, height: 932, insets: { ...noInsets, bottom: 34, top: 59 } },
  { key: 'android', label: 'A', width: 360, height: 800, insets: { ...noInsets, bottom: 24, top: 24 } },
  { key: 'androidLarge', label: 'A+', width: 412, height: 915, insets: { ...noInsets, bottom: 24, top: 24 } },
  // Diagnostic preset: catches regressions where unequal lateral safe-area
  // insets size the stage correctly but position it on the wrong x-axis.
  { key: 'asymmetric', label: 'Inset', width: 393, height: 852, insets: { top: 59, right: 4, bottom: 34, left: 12 } },
] as const satisfies readonly GameViewportPreset[];

export type GameViewportPresetKey = (typeof gameViewportPresets)[number]['key'];

export function getSafeGameStageStyle(
  windowWidth: number,
  windowHeight: number,
  insets: GameLayoutInsets,
  options?: PhoneStageOptions,
) {
  const safeWidth = Math.max(1, windowWidth - insets.left - insets.right);
  const safeHeight = Math.max(1, windowHeight - insets.top - insets.bottom);

  return getPhoneStageStyle(safeWidth, safeHeight, options);
}

export function createGameLayout(stageWidth: number, stageHeight: number) {
  const widthScale = Math.max(0, stageWidth) / gameDesignWidth;
  const heightScale = Math.max(0, stageHeight) / gameMinimumContentHeight;
  const scale = clamp(Math.min(widthScale, heightScale), minimumGameScale, 430 / gameDesignWidth);
  const unit = (value: number) => roundLayoutValue(value * scale);
  const stroke = (value: number) => Math.max(1, unit(value));
  const touch = (value: number) => Math.max(minimumTouchSize, unit(value));

  return {
    height: stageHeight,
    heightScale,
    scale,
    stageHeight,
    stageWidth,
    stroke,
    styles: {
      avatar: {
        borderRadius: unit(25),
        borderWidth: stroke(3),
        height: unit(50),
        left: unit(10),
        top: unit(7),
        width: unit(50),
      },
      backButton: {
        height: touch(48),
        left: unit(6),
        width: touch(48),
      },
      backgroundDie: {
        height: unit(64),
        width: unit(64),
      },
      board: {
        borderRadius: unit(16),
        borderWidth: stroke(3),
        flex: 1,
      },
      boardRow: {
        borderBottomWidth: stroke(1),
        paddingHorizontal: unit(4),
        paddingVertical: unit(3),
      },
      bonusBig: {
        fontSize: unit(25),
        lineHeight: unit(27),
        width: unit(62),
      },
      bonusContent: {
        gap: unit(4),
        paddingLeft: unit(6),
      },
      bonusMeter: {
        height: unit(48),
        width: unit(43),
      },
      bonusMeterFace: {
        height: unit(44),
        width: unit(44),
      },
      bonusMeterText: {
        fontSize: unit(10),
        lineHeight: unit(12),
      },
      bonusSmall: {
        fontSize: unit(10),
        lineHeight: unit(10),
      },
      bonusTextBlock: {
        width: unit(61),
      },
      bonusValueWrap: {
        height: unit(30),
        marginTop: unit(-1),
        width: unit(62),
      },
      buttonGloss: {
        height: unit(18),
      },
      buttonInnerShade: {
        height: unit(9),
      },
      categoryTile: {
        borderRadius: unit(12),
        borderWidth: stroke(3),
        height: unit(54),
        width: unit(54),
      },
      categoryTileButton: {
        height: unit(68),
        width: unit(64),
      },
      categoryTileFrame: {
        height: unit(54),
        width: unit(54),
      },
      categoryTileShadow: {
        borderRadius: unit(12),
        height: unit(54),
        left: unit(3),
        top: unit(4),
        width: unit(54),
      },
      chanceText: {
        fontSize: unit(34),
      },
      controlsRow: {
        gap: unit(8),
        height: unit(60),
        paddingBottom: 0,
      },
      dieSlot: {
        borderRadius: unit(12),
        borderWidth: stroke(3),
      },
      heldDieGlow: {
        borderRadius: unit(15),
        bottom: unit(-3),
        left: unit(-3),
        right: unit(-3),
        top: unit(-3),
      },
      kindText: {
        fontSize: unit(28),
      },
      menuDot: {
        borderRadius: unit(4),
        borderWidth: stroke(1),
        height: unit(7),
        width: unit(7),
      },
      menuDots: {
        gap: unit(3),
      },
      menuDotsButton: {
        height: touch(32),
        right: unit(10),
        width: touch(32),
      },
      opponentScoreText: {
        fontSize: unit(32),
        lineHeight: unit(34),
      },
      opponentScoreWrap: {
        height: touch(56),
        width: touch(50),
      },
      opponentSuckerBonusBadge: {
        height: unit(19),
        right: unit(2),
        top: unit(-4),
        width: unit(39),
      },
      opponentSuckerBonusBadgeText: {
        fontSize: unit(14),
        lineHeight: unit(17),
      },
      opponentTurnRevealMessage: {
        marginTop: unit(2),
        minHeight: unit(22),
        paddingHorizontal: unit(6),
      },
      opponentTurnRevealPanel: {
        paddingHorizontal: unit(8),
        paddingVertical: unit(4),
      },
      opponentTurnRevealText: {
        fontSize: unit(15),
        lineHeight: unit(20),
      },
      opponentTurnRevealTextHighlight: {
        fontSize: unit(17),
      },
      remoteErrorNoticeOverlay: {
        left: unit(10),
        right: unit(10),
        top: unit(116),
      },
      remoteErrorNoticeText: {
        borderRadius: unit(8),
        borderWidth: stroke(2),
        fontSize: unit(12),
        paddingHorizontal: unit(10),
        paddingVertical: unit(7),
      },
      playerName: {
        fontSize: unit(12),
      },
      playerPill: {
        minHeight: unit(64),
        paddingLeft: unit(70),
        paddingRight: unit(8),
      },
      playerScore: {
        fontSize: unit(24),
        lineHeight: unit(25),
      },
      playButton: {
        borderRadius: unit(10),
        borderWidth: stroke(3),
        height: unit(60),
      },
      playButtonWrap: {
        borderRadius: unit(10),
        height: unit(60),
      },
      playText: {
        fontSize: unit(28),
      },
      rollButton: {
        borderRadius: unit(10),
        borderWidth: stroke(3),
        height: unit(60),
      },
      rollButtonWrap: {
        borderRadius: unit(10),
        height: unit(60),
      },
      rollText: {
        fontSize: unit(32),
      },
      rollsLeftBadge: {
        borderRadius: unit(5),
        borderWidth: stroke(2),
        gap: unit(3),
        height: unit(30),
        marginLeft: unit(12),
        minWidth: unit(58),
        paddingHorizontal: unit(7),
      },
      rollsLeftLabel: {
        fontSize: unit(9),
        lineHeight: unit(11),
      },
      rollsLeftNumber: {
        fontSize: unit(18),
        lineHeight: unit(20),
      },
      rollingDieImage: {
        height: unit(88),
        width: unit(88),
      },
      rollingDieTrack: {
        height: unit(88),
        width: unit(88),
      },
      rollZone: {
        gap: unit(7),
        marginTop: unit(4),
      },
      scoreBox: {
        borderRadius: unit(12),
        borderWidth: stroke(3),
        height: touch(56),
      },
      scoreBoxShadow: {
        borderRadius: unit(12),
        left: unit(3),
        top: unit(5),
      },
      scoreBoxText: {
        fontSize: unit(32),
        lineHeight: unit(34),
      },
      scoreFlyingNumber: {
        height: unit(52),
        width: unit(88),
      },
      scoreFlyingNumberText: {
        fontSize: unit(42),
        lineHeight: unit(48),
      },
      scorePair: {
        paddingHorizontal: unit(4),
      },
      scorePressWrap: {
        height: touch(56),
        width: touch(54),
      },
      screen: {
        gap: unit(8),
        padding: unit(6),
        paddingBottom: unit(2),
      },
      gameOverActions: {
        gap: unit(8),
        height: touch(54),
      },
      gameOverCloseButton: {
        borderRadius: unit(18),
        borderWidth: stroke(2),
        height: touch(36),
        right: unit(8),
        top: unit(8),
        width: touch(36),
      },
      gameOverCloseText: {
        fontSize: unit(24),
        lineHeight: unit(28),
      },
      gameOverEyebrow: {
        fontSize: unit(13),
      },
      gameOverOverlay: {
        padding: unit(14),
      },
      gameOverPanel: {
        borderRadius: unit(14),
        borderWidth: stroke(4),
        gap: unit(10),
        height: unit(240),
        padding: unit(14),
      },
      gameOverPrimaryButton: {
        borderRadius: unit(10),
        borderWidth: stroke(3),
        minHeight: touch(54),
      },
      gameOverPrimaryText: {
        fontSize: unit(20),
      },
      gameOverScoreBox: {
        borderRadius: unit(9),
        borderWidth: stroke(2),
        paddingVertical: unit(8),
      },
      gameOverScoreName: {
        fontSize: unit(12),
      },
      gameOverScores: {
        gap: unit(8),
      },
      gameOverScoreValue: {
        fontSize: unit(30),
        lineHeight: unit(34),
      },
      gameOverSecondaryButton: {
        borderRadius: unit(10),
        borderWidth: stroke(3),
        minHeight: touch(54),
      },
      gameOverSecondaryText: {
        fontSize: unit(20),
      },
      gameOverTitle: {
        fontSize: unit(30),
        lineHeight: unit(34),
      },
      nextTurnAvatar: {
        borderRadius: unit(19),
        borderWidth: stroke(2),
        height: unit(38),
        width: unit(38),
      },
      nextTurnAvatarText: {
        fontSize: unit(16),
        lineHeight: unit(18),
      },
      nextTurnGameButton: {
        borderRadius: unit(9),
        borderWidth: stroke(2),
        gap: unit(9),
        minHeight: touch(64),
        paddingHorizontal: unit(9),
        paddingVertical: unit(8),
      },
      nextTurnOpponent: {
        fontSize: unit(16),
        lineHeight: unit(19),
      },
      nextTurnScoreDivider: {
        fontSize: unit(13),
        lineHeight: unit(16),
      },
      nextTurnScorePill: {
        borderRadius: unit(8),
        borderWidth: stroke(2),
        gap: unit(4),
        minWidth: unit(70),
        paddingHorizontal: unit(8),
        paddingVertical: unit(5),
      },
      nextTurnScoreText: {
        fontSize: unit(14),
        lineHeight: unit(16),
      },
      nextTurnStatus: {
        fontSize: unit(11),
        marginTop: unit(2),
      },
      nextTurnsCloseButton: {
        borderRadius: unit(18),
        borderWidth: stroke(2),
        height: touch(36),
        right: unit(8),
        top: unit(8),
        width: touch(36),
      },
      nextTurnsCloseText: {
        fontSize: unit(14),
        lineHeight: unit(16),
      },
      nextTurnsEmpty: {
        borderRadius: unit(9),
        borderWidth: stroke(2),
        minHeight: unit(74),
        padding: unit(12),
      },
      nextTurnsEmptyText: {
        fontSize: unit(14),
      },
      nextTurnsEyebrow: {
        fontSize: unit(12),
        paddingRight: unit(42),
      },
      nextTurnsList: {
        maxHeight: unit(250),
      },
      nextTurnsListContent: {
        gap: unit(8),
        paddingBottom: unit(2),
      },
      nextTurnsLobbyButton: {
        borderRadius: unit(10),
        borderWidth: stroke(3),
        minHeight: touch(48),
      },
      nextTurnsLobbyText: {
        fontSize: unit(17),
        lineHeight: unit(20),
      },
      nextTurnsOverlay: {
        padding: unit(14),
      },
      nextTurnsPanel: {
        borderRadius: unit(14),
        borderWidth: stroke(4),
        gap: unit(10),
        padding: unit(14),
      },
      nextTurnsTitle: {
        fontSize: unit(28),
        lineHeight: unit(32),
        paddingRight: unit(42),
      },
      suckerPunchChanceDieImage: {
        height: unit(112),
        width: unit(112),
      },
      suckerPunchChanceDieShell: {
        height: unit(116),
        width: unit(116),
      },
      suckerPunchChanceDieTrack: {
        height: unit(112),
        width: unit(112),
      },
      suckerPunchChanceHint: {
        fontSize: unit(15),
        lineHeight: unit(18),
        marginTop: unit(-8),
      },
      suckerPunchChanceOverlay: {
        padding: unit(16),
      },
      suckerPunchChancePanel: {
        borderRadius: unit(14),
        borderWidth: stroke(4),
        gap: unit(14),
        maxWidth: unit(286),
        paddingHorizontal: unit(18),
        paddingVertical: unit(18),
      },
      suckerPunchChanceTitle: {
        fontSize: unit(28),
        lineHeight: unit(32),
      },
      suckerPunchNotice: {
        borderRadius: unit(14),
        borderWidth: stroke(4),
        paddingHorizontal: unit(18),
        paddingVertical: unit(14),
      },
      suckerPunchNoticeOverlay: {
        padding: unit(20),
      },
      suckerPunchNoticeText: {
        fontSize: unit(25),
        lineHeight: unit(29),
      },
      suckerPunchNoticeTitle: {
        fontSize: unit(17),
        lineHeight: unit(20),
      },
      suckerRollNotice: {
        paddingHorizontal: unit(26),
        paddingVertical: unit(18),
      },
      suckerPunchResultImageShell: {
        borderRadius: unit(12),
        borderWidth: stroke(3),
      },
      suckerPunchRollButton: {
        borderRadius: unit(10),
        borderWidth: stroke(3),
        height: touch(48),
        marginTop: unit(4),
      },
      suckerPunchRollButtonText: {
        fontSize: unit(20),
        lineHeight: unit(23),
      },
      suckerBonusBadge: {
        height: unit(19),
        right: unit(-5),
        top: unit(-8),
        width: unit(43),
      },
      suckerBonusBadgeText: {
        fontSize: unit(15),
        lineHeight: unit(17),
      },
      suckerPunchWipeImpact: {
        height: unit(36),
        marginLeft: unit(-18),
        marginTop: unit(-18),
        width: unit(36),
      },
      tileGloss: {
        borderRadius: unit(20),
        height: unit(17),
        left: unit(5),
        right: unit(5),
        top: unit(3),
      },
      tileGlossFade: {
        borderRadius: unit(18),
        height: unit(8),
        left: unit(9),
        right: unit(9),
        top: unit(18),
      },
      tokenButton: {
        borderRadius: unit(10),
        borderWidth: stroke(3),
        height: unit(60),
      },
      tokenButtonImage: {
        height: unit(44),
        width: unit(44),
      },
      tokenButtonWrap: {
        borderRadius: unit(10),
        height: unit(60),
        width: unit(60),
      },
      tokenMenuClose: {
        borderRadius: unit(8),
        borderWidth: stroke(2),
        height: touch(32),
        width: touch(32),
      },
      tokenMenuCloseText: {
        fontSize: unit(14),
      },
      tokenMenuHeader: {
        gap: unit(8),
        marginBottom: unit(2),
      },
      tokenMenuIcon: {
        height: unit(46),
        width: unit(46),
      },
      tokenMenuOverlay: {
        padding: unit(12),
      },
      tokenMenuPanel: {
        borderRadius: unit(12),
        borderWidth: stroke(3),
        gap: unit(8),
        padding: unit(10),
      },
      tokenMenuSubtitle: {
        fontSize: unit(12),
      },
      tokenMenuTitle: {
        fontSize: unit(20),
        lineHeight: unit(23),
      },
      tokenOption: {
        borderRadius: unit(9),
        borderWidth: stroke(2),
        gap: unit(9),
        minHeight: touch(58),
        paddingHorizontal: unit(9),
        paddingVertical: unit(7),
      },
      tokenOptionCost: {
        borderRadius: unit(23),
        borderWidth: stroke(2),
        height: unit(46),
        width: unit(46),
      },
      tokenOptionCostIcon: {
        height: unit(36),
        width: unit(36),
      },
      tokenOptionCostText: {
        fontSize: unit(14),
      },
      tokenOptionDescription: {
        fontSize: unit(11),
        lineHeight: unit(14),
      },
      tokenOptionTitle: {
        fontSize: unit(16),
      },
      tokenCountBadge: {
        borderRadius: unit(11),
        borderWidth: stroke(2),
        height: unit(22),
        minWidth: unit(22),
        paddingHorizontal: unit(4),
        right: unit(-7),
        top: unit(-8),
      },
      tokenCountText: {
        fontSize: unit(12),
        lineHeight: unit(14),
      },
      tokenText: {
        fontSize: unit(10),
      },
      topBar: {
        borderRadius: unit(10),
        borderWidth: stroke(2),
        minHeight: unit(56),
        paddingHorizontal: unit(10),
        paddingVertical: unit(4),
      },
      topMenu: {
        borderRadius: unit(8),
        borderWidth: stroke(2),
        padding: unit(4),
        right: unit(18),
        top: unit(50),
        width: unit(116),
      },
      topMenuItem: {
        borderRadius: unit(6),
        minHeight: touch(44),
        paddingHorizontal: unit(10),
        paddingVertical: unit(9),
      },
      topMenuText: {
        fontSize: unit(13),
      },
    },
    strokeWidth: stroke,
    touchSize: touch,
    unit,
    width: stageWidth,
    widthScale,
  };
}

export type GameLayout = ReturnType<typeof createGameLayout>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundLayoutValue(value: number) {
  return Math.round(value * 1000) / 1000;
}
