const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const maximumFontSizeMultiplier = 1.2;
const repositoryRoot = path.resolve(__dirname, '..');
const gameUiSources = ['App.tsx', 'src/ui/PlayerAvatar.tsx', 'src/ui/StatsPage.tsx'];

test('game UI keeps Dynamic Type enabled with bounded growth', () => {
  for (const relativePath of gameUiSources) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

    assert.doesNotMatch(
      source,
      /allowFontScaling\s*=\s*\{\s*false\s*\}/,
      `${relativePath} must not disable Dynamic Type`,
    );

    const numericConstants = new Map(
      [...source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+(?:\.\d+)?)\s*;/g)].map((match) => [
        match[1],
        Number(match[2]),
      ]),
    );
    const multiplierProps = [...source.matchAll(/maxFontSizeMultiplier\s*=\s*\{\s*([^}\s]+)\s*\}/g)];
    const textElements = [...source.matchAll(/<Text\b[\s\S]*?>/g)];

    assert.ok(multiplierProps.length > 0, `${relativePath} must explicitly bound Dynamic Type growth`);
    for (const [element] of textElements) {
      assert.match(
        element,
        /maxFontSizeMultiplier\s*=/,
        `${relativePath} contains game text without bounded Dynamic Type growth: ${element.replace(/\s+/g, ' ')}`,
      );
    }

    for (const [, expression] of multiplierProps) {
      const numericValue = Number(expression);
      const value = Number.isFinite(numericValue) ? numericValue : numericConstants.get(expression);

      assert.notEqual(value, undefined, `${relativePath} uses an unresolvable Dynamic Type policy: ${expression}`);
      assert.ok(value > 1, `${relativePath} must permit some Dynamic Type growth`);
      assert.ok(
        value <= maximumFontSizeMultiplier,
        `${relativePath} exceeds the ${maximumFontSizeMultiplier} Dynamic Type growth limit`,
      );
    }
  }

  const appSource = fs.readFileSync(path.join(repositoryRoot, 'App.tsx'), 'utf8');
  assert.match(
    appSource,
    /const\s+gameMaxFontSizeMultiplier\s*=\s*1\.2\s*;/,
    'App.tsx must retain the shared game text multiplier policy',
  );
});
