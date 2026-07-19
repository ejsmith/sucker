const assert = require('node:assert/strict');
const test = require('node:test');
const { getTauntText, isTauntId, taunts } = require('../.build/shared/taunts');

test('taunt catalog uses stable IDs and includes the approved punch taunt', () => {
  assert.equal(getTauntText('punch-me'), 'Punch me. I dare you.');
  assert.equal(new Set(taunts.map((taunt) => taunt.id)).size, taunts.length);
});

test('taunt IDs reject arbitrary or user-authored text', () => {
  assert.equal(isTauntId('sucker'), true);
  assert.equal(isTauntId('write my own insult'), false);
  assert.equal(isTauntId(null), false);
});
