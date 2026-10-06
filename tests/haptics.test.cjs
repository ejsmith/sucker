const assert = require('node:assert/strict');
const test = require('node:test');
const { defaultHapticPreferences, parseHapticPreferences, hapticSteps } = require('../.build/src/haptics/patterns.js');
const { createHapticPlayer } = require('../.build/src/haptics/player.js');

test('saved preferences survive a round trip and keep each event independent', () => {
  const saved = {
    ...defaultHapticPreferences,
    punchReceived: { preset: 'aftershock', gapMs: 175, delayMs: 50 },
    sucker: { preset: 'off', gapMs: 100, delayMs: 0 },
  };
  assert.deepEqual(parseHapticPreferences(JSON.stringify(saved)), saved);
  assert.deepEqual(parseHapticPreferences('{broken'), defaultHapticPreferences);
  assert.deepEqual(parseHapticPreferences(null), defaultHapticPreferences);
});

test('invalid saved choices cannot create unbounded timers or borrow another event’s pattern', () => {
  const preferences = parseHapticPreferences(
    JSON.stringify({
      punchLanded: { preset: 'flourish', gapMs: -300, delayMs: 10000 },
      punchReceived: { preset: 'aftershock', gapMs: '100', delayMs: null },
      sucker: false,
    }),
  );
  assert.deepEqual(preferences.punchLanded, { preset: 'rigid', gapMs: 50, delayMs: 250 });
  assert.deepEqual(preferences.punchReceived, { preset: 'aftershock', gapMs: 100, delayMs: 0 });
  assert.deepEqual(preferences.sucker, defaultHapticPreferences.sucker);
});

test('spacing and delay are measured from event reveal, with Off producing no taps', () => {
  assert.deepEqual(hapticSteps({ preset: 'flourish', gapMs: 100, delayMs: 25 }), [
    { effect: 'light', atMs: 25 },
    { effect: 'light', atMs: 125 },
    { effect: 'medium', atMs: 225 },
  ]);
  assert.deepEqual(hapticSteps({ preset: 'off', gapMs: 100, delayMs: 0 }), []);
});

function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  let active = true;
  const player = createHapticPlayer({
    trigger: (effect, event) => {
      calls.push({ effect, event });
    },
    cancel: () => {},
    isActive: () => active,
  });
  t.after(player.cancel);
  return {
    player,
    calls,
    background: () => {
      active = false;
    },
  };
}

test('closing a preview cancels the aftershock before it can fire', (t) => {
  const { player, calls } = harness(t);
  player.play('punchReceived', { preset: 'aftershock', gapMs: 100, delayMs: 0 });
  player.cancel();
  t.mock.timers.tick(500);
  assert.deepEqual(calls, [{ effect: 'heavy', event: 'punchReceived' }]);
});

test('a new preview replaces pending taps instead of interleaving patterns', (t) => {
  const { player, calls } = harness(t);
  player.play('sucker', { preset: 'flourish', gapMs: 100, delayMs: 50 });
  t.mock.timers.tick(50);
  player.play('punchLanded', { preset: 'rigid', gapMs: 100, delayMs: 0 });
  t.mock.timers.tick(500);
  assert.deepEqual(calls, [
    { effect: 'light', event: 'sucker' },
    { effect: 'rigid', event: 'punchLanded' },
  ]);
});

test('backgrounding suppresses pending feedback and new requests', (t) => {
  const { player, calls, background } = harness(t);
  player.play('sucker', { preset: 'flourish', gapMs: 100, delayMs: 50 });
  background();
  t.mock.timers.tick(500);
  player.play('punchLanded', defaultHapticPreferences.punchLanded);
  assert.deepEqual(calls, []);
});

test('unsupported hardware cannot throw or reject into gameplay', async () => {
  for (const trigger of [
    () => {
      throw new Error('unsupported');
    },
    () => Promise.reject(new Error('unsupported')),
  ]) {
    const player = createHapticPlayer({ trigger, cancel: () => {}, isActive: () => true });
    assert.doesNotThrow(() => player.play('punchLanded', defaultHapticPreferences.punchLanded));
    await new Promise((resolve) => setImmediate(resolve));
    player.cancel();
  }
});
