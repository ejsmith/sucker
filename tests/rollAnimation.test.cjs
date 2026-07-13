const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadRollAnimationModule() {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/ui/rollAnimation.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === 'react-native') {
      return { View: function View() {} };
    }

    throw new Error(`Unexpected test dependency: ${specifier}`);
  };

  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  return module.exports;
}

const { createRollingLaunch } = loadRollAnimationModule();

function withFixedRandom(run) {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
}

test('rolling launch centers every supported rendered die size over a measured slot', () => {
  const rollZone = { x: 100, y: 200, width: 300, height: 120 };
  const slot = { x: 140, y: 220, width: 60, height: 60 };

  for (const dieSize of [66, 88, 96]) {
    const launch = withFixedRandom(() => createRollingLaunch(0, 'left', rollZone, slot, dieSize));

    assert.equal(launch.toX + dieSize / 2, slot.x - rollZone.x + slot.width / 2);
    assert.equal(launch.toY + dieSize / 2, slot.y - rollZone.y + slot.height / 2);
  }
});

test('rolling launch fallback geometry scales with the rendered die', () => {
  const baseLaunch = withFixedRandom(() => createRollingLaunch(2, 'left', null, null, 88));
  const scaledLaunch = withFixedRandom(() => createRollingLaunch(2, 'left', null, null, 66));

  assert.equal(scaledLaunch.toX, baseLaunch.toX * 0.75);
  assert.equal(scaledLaunch.toY, baseLaunch.toY * 0.75);
  assert.equal(scaledLaunch.fromX, baseLaunch.fromX * 0.75);
});

test('rolling launch rejects invalid rendered sizes', () => {
  const baseLaunch = withFixedRandom(() => createRollingLaunch(1, 'right', null, null, 88));
  const invalidLaunch = withFixedRandom(() => createRollingLaunch(1, 'right', null, null, 0));

  assert.deepEqual(invalidLaunch, baseLaunch);
});
