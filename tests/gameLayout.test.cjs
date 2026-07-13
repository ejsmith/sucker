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
const { getPhoneStageStyle, phoneStageMaxHeight, phoneStageMaxWidth } = require('../.build/src/ui/phoneStage');

test('supported phone presets fill the safe viewport without creating overflow', () => {
  for (const preset of gameViewportPresets) {
    const stage = getSafeGameStageStyle(preset.width, preset.height, preset.insets);
    const expectedWidth = preset.width - preset.insets.left - preset.insets.right;
    const expectedHeight = preset.height - preset.insets.top - preset.insets.bottom;

    assert.equal(stage.width, expectedWidth, `${preset.key} width`);
    assert.equal(stage.height, expectedHeight, `${preset.key} height`);
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
  const preset = gameViewportPresets.find(({ key }) => key === 'iphone16');
  assert.ok(preset);

  const stage = getSafeGameStageStyle(preset.width, preset.height, preset.insets);
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
  const preset = gameViewportPresets.find(({ key }) => key === 'se');
  assert.ok(preset);

  const stage = getSafeGameStageStyle(preset.width, preset.height, preset.insets);
  const layout = createGameLayout(stage.width, stage.height);

  assert.ok(layout.touchSize(32) >= minimumTouchSize);
  assert.ok(layout.styles.backButton.height >= minimumTouchSize);
  assert.ok(layout.styles.menuDotsButton.height >= minimumTouchSize);
});

test('wide web viewports use a centered phone-sized stage instead of stretching the game', () => {
  const stage = getPhoneStageStyle(1440, 1200);

  assert.ok(stage.width <= phoneStageMaxWidth);
  assert.ok(stage.height <= phoneStageMaxHeight);
  assert.ok(Math.abs(stage.width / stage.height - gameDesignWidth / gameDesignHeight) < 0.000001);
});
