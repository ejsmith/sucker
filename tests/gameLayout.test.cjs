const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createGameLayout,
  gameDesignHeight,
  gameDesignWidth,
  gameViewportPresets,
  getSafeGameStageStyle,
  minimumTouchSize,
} = require('../.build/src/ui/gameLayout');
const {
  getPhoneStageStyle,
  phoneStageMaxHeight,
  phoneStageMaxWidth,
  phoneStageMinHeight,
  phoneStageMinWidth,
} = require('../.build/src/ui/phoneStage');

// These values deliberately live in the test rather than being derived from
// gameViewportPresets. They are the accepted safe-stage contract for the
// devices represented by the visual regression suite.
const acceptedPhoneViewports = [
  { key: 'se', width: 375, height: 667, insets: { top: 20, right: 0, bottom: 0, left: 0 }, stage: [375, 647] },
  {
    key: 'mini',
    width: 375,
    height: 812,
    insets: { top: 50, right: 0, bottom: 34, left: 0 },
    stage: [375, 728],
  },
  {
    key: 'iphone16',
    width: 393,
    height: 852,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
    stage: [393, 759],
  },
  {
    key: 'iphone17',
    width: 402,
    height: 874,
    insets: { top: 62, right: 0, bottom: 34, left: 0 },
    stage: [402, 778],
  },
  {
    key: 'max',
    width: 430,
    height: 932,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
    stage: [430, 839],
  },
  {
    key: 'android',
    width: 360,
    height: 800,
    insets: { top: 24, right: 0, bottom: 24, left: 0 },
    stage: [360, 752],
  },
  {
    key: 'androidLarge',
    width: 412,
    height: 915,
    insets: { top: 24, right: 0, bottom: 24, left: 0 },
    stage: [412, 867],
  },
];

test('supported phone presets fill the safe viewport without creating overflow', () => {
  for (const fixture of acceptedPhoneViewports) {
    const stage = getSafeGameStageStyle(fixture.width, fixture.height, fixture.insets);
    const [expectedWidth, expectedHeight] = fixture.stage;

    assert.equal(stage.width, expectedWidth, `${fixture.key} width`);
    assert.equal(stage.height, expectedHeight, `${fixture.key} height`);
  }
});

test('exported viewport presets retain the independently accepted device geometry', () => {
  for (const fixture of acceptedPhoneViewports) {
    const preset = gameViewportPresets.find(({ key }) => key === fixture.key);
    assert.ok(preset, `${fixture.key} preset`);
    assert.equal(preset.width, fixture.width, `${fixture.key} width`);
    assert.equal(preset.height, fixture.height, `${fixture.key} height`);
    assert.deepEqual(preset.insets, fixture.insets, `${fixture.key} insets`);
  }
});

test('the design viewport produces an exact one-to-one layout scale', () => {
  const layout = createGameLayout(gameDesignWidth, gameDesignHeight);

  assert.equal(layout.scale, 1);
  assert.equal(layout.unit(8), 8);
  assert.equal(layout.strokeWidth(3), 3);
  assert.equal(layout.touchSize(32), minimumTouchSize);
});

test('the standard iPhone safe stage keeps reference-sized game elements', () => {
  const fixture = acceptedPhoneViewports.find(({ key }) => key === 'iphone16');
  assert.ok(fixture);
  const stage = getSafeGameStageStyle(fixture.width, fixture.height, fixture.insets);
  const layout = createGameLayout(stage.width, stage.height);

  assert.equal(layout.scale, 1);
  assert.equal(layout.styles.screen.padding, 6);
  assert.equal(layout.styles.topBar.minHeight, 56);
  assert.equal(layout.styles.playerPill.minHeight, 64);
  assert.equal(layout.styles.controlsRow.height, 60);
});

test('layout values change continuously across nearby viewport widths', () => {
  const narrow = createGameLayout(389, gameDesignHeight);
  const wide = createGameLayout(390, gameDesignHeight);

  assert.ok(wide.scale > narrow.scale);
  assert.ok(wide.scale - narrow.scale < 0.003);
  assert.ok(wide.styles.scoreBox.height > narrow.styles.scoreBox.height);
  assert.ok(wide.styles.scoreBox.height - narrow.styles.scoreBox.height < 0.2);
});

test('minimum touch targets remain reachable on the shortest supported phone', () => {
  const fixture = acceptedPhoneViewports.find(({ key }) => key === 'se');
  assert.ok(fixture);
  const stage = getSafeGameStageStyle(fixture.width, fixture.height, fixture.insets);
  const layout = createGameLayout(stage.width, stage.height);

  assert.ok(layout.touchSize(32) >= minimumTouchSize);
  assertTouchTargets(layout);
});

test('stage caps apply continuously through the former 499/500 breakpoint', () => {
  const at499 = getPhoneStageStyle(499, 900);
  const at500 = getPhoneStageStyle(500, 900);
  const at501 = getPhoneStageStyle(501, 900);

  assert.deepEqual(at499, { width: phoneStageMaxWidth, height: 900 });
  assert.deepEqual(at500, at499);
  assert.deepEqual(at501, at500);

  const justBelowWidthCap = getPhoneStageStyle(phoneStageMaxWidth - 0.5, 900);
  const atWidthCap = getPhoneStageStyle(phoneStageMaxWidth, 900);
  const justAboveWidthCap = getPhoneStageStyle(phoneStageMaxWidth + 0.5, 900);
  assert.equal(atWidthCap.width - justBelowWidthCap.width, 0.5);
  assert.equal(justAboveWidthCap.width - atWidthCap.width, 0);

  const justBelowHeightCap = getPhoneStageStyle(400, phoneStageMaxHeight - 0.5);
  const atHeightCap = getPhoneStageStyle(400, phoneStageMaxHeight);
  const justAboveHeightCap = getPhoneStageStyle(400, phoneStageMaxHeight + 0.5);
  assert.equal(atHeightCap.height - justBelowHeightCap.height, 0.5);
  assert.equal(justAboveHeightCap.height - atHeightCap.height, 0);
});

test('short or zoomed web viewports receive a minimum usable scrollable stage', () => {
  const viewport = { width: 720, height: 450 };
  const stage = getPhoneStageStyle(viewport.width, viewport.height);
  const layout = createGameLayout(stage.width, stage.height);

  assert.deepEqual(stage, { width: phoneStageMaxWidth, height: phoneStageMinHeight });
  assert.ok(stage.height > viewport.height);
  assert.ok(layout.scale >= 0.75);
  assertTouchTargets(layout);
});

test('undersized viewports preserve a minimum canvas in both axes', () => {
  const stage = getPhoneStageStyle(240, 360);

  assert.deepEqual(stage, { width: phoneStageMinWidth, height: phoneStageMinHeight });
});

test('wide web viewports use the capped phone-sized stage instead of stretching the game', () => {
  const stage = getPhoneStageStyle(1440, 1200);

  assert.deepEqual(stage, { width: phoneStageMaxWidth, height: phoneStageMaxHeight });
});

test('proportional stage mode stays inside its available viewport', () => {
  const viewport = { width: 320, height: 570 };
  const stage = getPhoneStageStyle(viewport.width, viewport.height, { fillNarrowViewport: false });

  assert.ok(stage.width <= viewport.width);
  assert.ok(stage.height <= viewport.height);
  assert.ok(Math.abs(stage.width / stage.height - 393 / 852) < 1e-12);
});

function assertTouchTargets(layout) {
  const dimensions = [
    ['backButton.height', layout.styles.backButton.height],
    ['backButton.width', layout.styles.backButton.width],
    ['menuDotsButton.height', layout.styles.menuDotsButton.height],
    ['menuDotsButton.width', layout.styles.menuDotsButton.width],
    ['categoryTileButton.height', layout.styles.categoryTileButton.height],
    ['categoryTileButton.width', layout.styles.categoryTileButton.width],
    ['scoreBox.height', layout.styles.scoreBox.height],
    ['scorePressWrap.height', layout.styles.scorePressWrap.height],
    ['scorePressWrap.width', layout.styles.scorePressWrap.width],
    ['opponentScoreWrap.height', layout.styles.opponentScoreWrap.height],
    ['opponentScoreWrap.width', layout.styles.opponentScoreWrap.width],
    ['rollButtonWrap.height', layout.styles.rollButtonWrap.height],
    ['tokenButtonWrap.height', layout.styles.tokenButtonWrap.height],
    ['tokenButtonWrap.width', layout.styles.tokenButtonWrap.width],
    ['playButtonWrap.height', layout.styles.playButtonWrap.height],
    ['gameOverActions.height', layout.styles.gameOverActions.height],
    ['gameOverCloseButton.height', layout.styles.gameOverCloseButton.height],
    ['gameOverCloseButton.width', layout.styles.gameOverCloseButton.width],
    ['gameOverPrimaryButton.minHeight', layout.styles.gameOverPrimaryButton.minHeight],
    ['gameOverSecondaryButton.minHeight', layout.styles.gameOverSecondaryButton.minHeight],
    ['nextTurnGameButton.minHeight', layout.styles.nextTurnGameButton.minHeight],
    ['nextTurnsCloseButton.height', layout.styles.nextTurnsCloseButton.height],
    ['nextTurnsCloseButton.width', layout.styles.nextTurnsCloseButton.width],
    ['nextTurnsLobbyButton.minHeight', layout.styles.nextTurnsLobbyButton.minHeight],
    ['suckerPunchRollButton.height', layout.styles.suckerPunchRollButton.height],
    ['tokenMenuClose.height', layout.styles.tokenMenuClose.height],
    ['tokenMenuClose.width', layout.styles.tokenMenuClose.width],
    ['tokenOption.minHeight', layout.styles.tokenOption.minHeight],
    ['topMenuItem.minHeight', layout.styles.topMenuItem.minHeight],
  ];

  for (const [label, value] of dimensions) {
    assert.ok(value >= minimumTouchSize, `${label} was ${value}`);
  }
}
