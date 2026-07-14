const assert = require('node:assert/strict');
const test = require('node:test');
const { bonusVisualColors } = require('../.build/src/ui/bonusVisuals');

test('every bonus animation face keeps strong contrast with its outline', () => {
  for (const state of ['face', 'flash', 'awarded']) {
    assert.ok(
      contrastRatio(bonusVisualColors[state], bonusVisualColors.outline) >= 4.5,
      `${state} bonus color must keep 4.5:1 contrast with its outline`,
    );
  }
});

function contrastRatio(first, second) {
  const brighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
