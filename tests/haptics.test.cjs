const assert = require('node:assert/strict');
const test = require('node:test');
const {
  defaultHapticPreferences,
  parseHapticPreferences,
  buildHapticPattern,
  createHapticChoice,
  eventPresets,
  isCustomHaptic,
} = require('../.build/src/haptics/patterns.js');
const { createHapticPlayer } = require('../.build/src/haptics/player.js');
const { createNativePatternPlayer } = require('../.build/src/haptics/nativePatternPlayer.js');

test('custom preferences round trip independently for each event', () => {
  const saved = {
    ...defaultHapticPreferences,
    punchReceived: { ...createHapticChoice('rumble'), strength: 75, sharpness: 25, durationMs: 800, delayMs: 50 },
    sucker: createHapticChoice('off'),
  };
  assert.deepEqual(parseHapticPreferences(JSON.stringify(saved)), saved);
  assert.deepEqual(parseHapticPreferences('{broken'), defaultHapticPreferences);
  assert.deepEqual(parseHapticPreferences(null), defaultHapticPreferences);
});

test('migration replaces retired taps while preserving explicit Off and Original choices', () => {
  const migrated = parseHapticPreferences(
    JSON.stringify({
      punchLanded: { preset: 'rigid', gapMs: 250, delayMs: 25 },
      punchReceived: { preset: 'off', gapMs: 175, delayMs: 0 },
      sucker: { preset: 'original', gapMs: 100, delayMs: 0 },
    }),
  );
  assert.deepEqual(migrated.punchLanded, { ...createHapticChoice('crack'), delayMs: 25 });
  assert.deepEqual(migrated.punchReceived, createHapticChoice('off'));
  assert.deepEqual(migrated.sucker, createHapticChoice('original'));
});

test('invalid saved tuning cannot exceed hardware ranges or schedule unbounded feedback', () => {
  const preferences = parseHapticPreferences(
    JSON.stringify({
      punchLanded: { preset: 'not-a-pattern', strength: -30, sharpness: 1000, durationMs: 10000, delayMs: -1 },
      punchReceived: { preset: 'rumble', strength: '75', sharpness: null, durationMs: -20, delayMs: 10000 },
      sucker: false,
    }),
  );
  assert.deepEqual(preferences.punchLanded, {
    preset: 'crack',
    strength: 25,
    sharpness: 100,
    durationMs: 900,
    delayMs: 0,
  });
  assert.deepEqual(preferences.punchReceived, {
    preset: 'rumble',
    strength: 100,
    sharpness: 50,
    durationMs: 50,
    delayMs: 250,
  });
  assert.deepEqual(preferences.sucker, defaultHapticPreferences.sucker);
});

test('the catalog has distinct bounded native timelines at every tuning extreme', () => {
  const presets = eventPresets.punchLanded.filter(isCustomHaptic);
  assert.equal(
    new Set(presets.map((preset) => JSON.stringify(buildHapticPattern(createHapticChoice(preset))))).size,
    presets.length,
  );
  for (const preset of presets) {
    for (const durationMs of [50, 900])
      for (const strength of [25, 100])
        for (const sharpness of [0, 50, 100]) {
          const pattern = buildHapticPattern({ ...createHapticChoice(preset), durationMs, strength, sharpness });
          for (const points of [
            pattern.discretePattern,
            pattern.continuousPattern.amplitude,
            pattern.continuousPattern.frequency,
          ]) {
            for (const [index, point] of points.entries()) {
              assert.ok(Number.isFinite(point.time) && point.time >= 0 && point.time <= durationMs, preset);
              if (index) assert.ok(point.time > points[index - 1].time, preset);
              for (const [key, value] of Object.entries(point))
                if (key !== 'time') assert.ok(value >= 0 && value <= 1, `${preset}: ${key}`);
            }
          }
          assert.equal(pattern.continuousPattern.amplitude.at(-1).value, 0, `${preset} ends in silence`);
          assert.equal(pattern.continuousPattern.amplitude.at(-1).time, durationMs);
        }
  }
  const rumble = buildHapticPattern(createHapticChoice('rumble'));
  assert.equal(rumble.discretePattern.length, 0, 'rumble must not degrade to another tap sequence');
  assert.ok(rumble.continuousPattern.amplitude.length > 4);
});

test('tuning changes strength, texture, and timing independently without mutating the catalog', () => {
  const choice = createHapticChoice('doubleHit');
  const original = buildHapticPattern(choice);
  const tuned = buildHapticPattern({ ...choice, strength: 50, sharpness: 0, durationMs: 600 });
  original.discretePattern.forEach((point, index) =>
    assert.deepEqual(tuned.discretePattern[index], {
      time: point.time * 2,
      amplitude: point.amplitude * 0.5,
      frequency: 0,
    }),
  );
  assert.ok(tuned.continuousPattern.frequency.every((point) => point.value === 0));
  assert.ok(
    buildHapticPattern({ ...choice, sharpness: 100 }).continuousPattern.frequency.every((point) => point.value === 1),
  );
  assert.deepEqual(buildHapticPattern(choice), original);
  assert.equal(buildHapticPattern(createHapticChoice('off')), null);
  assert.equal(buildHapticPattern(createHapticChoice('original')), null);
});

function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  let active = true;
  const player = createHapticPlayer({
    playPattern: (pattern) => calls.push(['pattern', pattern]),
    playOriginal: (event) => calls.push(['original', event]),
    cancel: () => calls.push(['cancel']),
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

test('all strikes and curves are handed to native together after the reveal delay', (t) => {
  const { player, calls } = harness(t);
  const choice = { ...createHapticChoice('victory'), delayMs: 100 };
  player.play('sucker', choice);
  t.mock.timers.tick(99);
  assert.deepEqual(calls, [['cancel']]);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [['cancel'], ['pattern', buildHapticPattern(choice)]]);
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 2, 'JS must not schedule individual hits');
});

test('closing or replacing a preview stops native playback and cancels pending starts', (t) => {
  const { player, calls } = harness(t);
  player.play('sucker', { ...createHapticChoice('victory'), delayMs: 100 });
  player.play('punchLanded', createHapticChoice('crack'));
  player.cancel();
  t.mock.timers.tick(1000);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['cancel', 'cancel', 'pattern', 'cancel'],
  );
});

test('backgrounding suppresses pending feedback and new requests', (t) => {
  const { player, calls, background } = harness(t);
  player.play('sucker', { ...createHapticChoice('buildPop'), delayMs: 50 });
  background();
  player.cancel();
  t.mock.timers.tick(500);
  player.play('punchLanded', defaultHapticPreferences.punchLanded);
  assert.ok(calls.every(([kind]) => kind === 'cancel'));
});

test('Off stops an active waveform, and Original uses only the original vibration driver', (t) => {
  const { player, calls } = harness(t);
  player.play('punchReceived', createHapticChoice('rumble'));
  player.play('punchReceived', createHapticChoice('off'));
  player.play('sucker', createHapticChoice('original'));
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['cancel', 'pattern', 'cancel', 'cancel', 'original'],
  );
  assert.deepEqual(calls.at(-1), ['original', 'sucker']);
});

test('hardware start and stop failures cannot throw into gameplay', () => {
  const fail = () => {
    throw new Error('unsupported hardware');
  };
  const player = createHapticPlayer({ playPattern: fail, playOriginal: fail, cancel: fail, isActive: () => true });
  assert.doesNotThrow(() => player.play('punchLanded', defaultHapticPreferences.punchLanded));
  assert.doesNotThrow(() => player.play('sucker', createHapticChoice('original')));
  assert.doesNotThrow(player.cancel);
});

function nativeHarness(overrides = {}) {
  let id = 0;
  const allocated = new Set();
  const calls = [];
  const bridge = {
    PatternComposer_parsePattern: () => {
      allocated.add(++id);
      calls.push(['parse', id]);
      return id;
    },
    PatternComposer_play: (id) => calls.push(['play', id]),
    PatternComposer_stop: (id) => calls.push(['stop', id]),
    PatternComposer_release: (id) => {
      assert.ok(allocated.delete(id));
      calls.push(['release', id]);
    },
    ...overrides,
  };
  return { player: createNativePatternPlayer(bridge), calls, allocated };
}

test('auditioning many patterns retains at most one native handle and releases it on close', () => {
  const { player, calls, allocated } = nativeHarness();
  for (let index = 0; index < 100; index++) {
    player.playPattern(buildHapticPattern(createHapticChoice('rumble')));
    assert.equal(allocated.size, 1);
  }
  player.cancel();
  player.cancel();
  assert.equal(allocated.size, 0);
  assert.deepEqual(calls.slice(0, 6), [
    ['parse', 1],
    ['play', 1],
    ['stop', 1],
    ['release', 1],
    ['parse', 2],
    ['play', 2],
  ]);
  assert.equal(calls.filter(([kind]) => kind === 'release').length, 100);
});

test('native resources are released even when play or stop fails', () => {
  for (const method of ['PatternComposer_play', 'PatternComposer_stop']) {
    const { player, allocated } = nativeHarness({
      [method]: () => {
        throw new Error('engine interrupted');
      },
    });
    try {
      player.playPattern(buildHapticPattern(createHapticChoice('crack')));
    } catch {}
    try {
      player.cancel();
    } catch {}
    assert.equal(allocated.size, 0);
    assert.doesNotThrow(player.cancel);
  }
});
