const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { formatRecord } = require('../.build/src/ui/statsFormat');

test('records show ties only when games ended tied', () => {
  assert.equal(formatRecord(5, 4, 9), '5-4');
  assert.equal(formatRecord(5, 4, 10), '5-4-1');
  assert.equal(formatRecord(0, 0, 2), '0-0-2');
});

test('record displays use the shared tie-aware formatter', () => {
  for (const file of ['App.tsx', 'src/ui/StatsPage.tsx', 'src/multiplayer/MultiplayerLobby.tsx']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /\$\{[^}]*wins\}-\$\{[^}]*losses\}/, `${file} must format records with formatRecord`);
  }
});
