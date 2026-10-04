const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, modules) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(require.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      assert.ok(modules[name], `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  return exports;
}

function render(user, platform = 'ios') {
  const native = require('react-native-web');
  const { AppleAccountSection } = load('../src/multiplayer/AppleAccountSection.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { ...native, Platform: { OS: platform } },
    './appleIdentity': load('../src/multiplayer/appleIdentity.ts', {}),
    './AppleSignInButton': {
      AppleSignInButton: ({ testID }) =>
        React.createElement('button', { 'data-testid': testID }, 'Continue with Apple'),
    },
  });
  return renderToStaticMarkup(React.createElement(AppleAccountSection, { user, disabled: false, onConnect() {} }));
}

test('connected iOS accounts show persistent confirmation without the connect button', () => {
  for (const user of [
    { identities: [{ provider: 'apple' }] },
    { identities: [{ provider: 'email' }], app_metadata: { providers: ['email', 'apple'] } },
  ]) {
    const html = render(user);
    assert.match(html, /apple-connected-status/);
    assert.match(html, /✓ Apple connected/);
    assert.doesNotMatch(html, /connect-apple-button/);
    assert.doesNotMatch(html, /Connect Apple to sign in/);
  }
});

test('unlinked accounts retain the connect action and no false success indicator', () => {
  const html = render({ identities: [{ provider: 'email' }] });
  assert.match(html, /connect-apple-button/);
  assert.doesNotMatch(html, /apple-connected-status/);
});

test('web and Android do not offer the native Apple account control', () => {
  for (const platform of ['web', 'android']) assert.equal(render({ identities: [] }, platform), '');
});
