const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');

// React Compiler skips a whole component when it meets code it can't handle
// (try/finally, a function used before it is declared, refs read during
// render...). That happens silently, and an uncompiled game screen re-renders
// thousands of lines on every die tap. Keep the large screens compiled.
const compiledComponents = {
  'App.tsx': ['RemoteGameScreen', 'LocalGameScreen', 'FlyingDie'],
  'src/multiplayer/MultiplayerLobby.tsx': ['MultiplayerLobby'],
  'src/network/NetworkProvider.tsx': ['NetworkProvider'],
  'src/ui/StatsPage.tsx': ['PlayerStatsPage'],
};

for (const [file, components] of Object.entries(compiledComponents)) {
  test(`React Compiler compiles ${components.join(', ')} in ${file}`, () => {
    const events = [];
    babel.transformSync(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      babelrc: false,
      configFile: false,
      filename: file,
      presets: [['@babel/preset-typescript', { allExtensions: true, isTSX: true }]],
      plugins: [
        '@babel/plugin-syntax-jsx',
        [
          'babel-plugin-react-compiler',
          { logger: { logEvent: (_file, event) => events.push(event) }, panicThreshold: 'none' },
        ],
      ],
    });
    const compiled = new Set(events.filter((event) => event.kind === 'CompileSuccess').map((event) => event.fnName));
    const failures = events
      .filter((event) => event.kind === 'CompileError')
      .map((event) => `line ${event.fnLoc?.start.line}: ${event.detail?.reason ?? event.detail}`);
    for (const component of components) {
      assert.ok(compiled.has(component), `${component} was not compiled.\n${failures.join('\n')}`);
    }
  });
}
