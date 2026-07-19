const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getTauntText,
  getTauntsForScenario,
  getTurnTauntScenario,
  isTauntAvailableForScenario,
  isTauntId,
  taunts,
} = require('../.build/shared/taunts');

test('taunt catalog uses stable IDs and includes the approved punch taunt', () => {
  assert.equal(getTauntText('punch-me'), 'Punch me. I dare you.');
  assert.equal(new Set(taunts.map((taunt) => taunt.id)).size, taunts.length);
});

test('taunt IDs reject arbitrary or user-authored text', () => {
  assert.equal(isTauntId('sucker'), true);
  assert.equal(isTauntId('write my own insult'), false);
  assert.equal(isTauntId(null), false);
});

test('scenario taunts are unlocked only by the matching play', () => {
  assert.equal(isTauntAvailableForScenario('sucker', 'sucker-roll'), true);
  assert.equal(isTauntAvailableForScenario('sucker', 'base'), false);
  assert.equal(isTauntAvailableForScenario('sucker-punched', 'punch-landed'), true);
  assert.equal(isTauntAvailableForScenario('sucker-punched', 'base'), false);
  assert.equal(isTauntAvailableForScenario('beat-that', 'punch-landed'), true);
  assert.equal(getTauntsForScenario('scratch').some((taunt) => taunt.id === 'zero-swagger'), true);
});

test('turn outcomes select the strongest relevant taunt scenario', () => {
  assert.equal(
    getTurnTauntScenario({ category: 'ones', dice: [6, 6, 6, 6, 6], score: 5, scratched: false }),
    'sucker-roll',
  );
  assert.equal(
    getTurnTauntScenario({ category: 'largeStraight', dice: [1, 2, 3, 4, 5], score: 40, scratched: false }),
    'straight',
  );
  assert.equal(
    getTurnTauntScenario({ category: 'smallStraight', dice: [1, 2, 3, 4, 6], score: 30, scratched: false }),
    'base',
  );
  assert.equal(
    getTurnTauntScenario({ category: 'chance', dice: [6, 6, 6, 6, 5], score: 35, scratched: false }),
    'base',
  );
  assert.equal(
    getTurnTauntScenario({ category: 'chance', dice: [6, 6, 6, 5, 5], score: 28, scratched: true }),
    'scratch',
  );
});
