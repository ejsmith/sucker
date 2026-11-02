const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameListRealtimeTopic, createRealtimeTopic } = require('../.build/src/multiplayer/realtimeTopics');

test('concurrent game-list subscriptions receive distinct realtime topics', () => {
  const first = createGameListRealtimeTopic();
  const second = createGameListRealtimeTopic();

  assert.match(first, /^games:list:\d+$/);
  assert.match(second, /^games:list:\d+$/);
  assert.notEqual(first, second);
});

test('resubscribing to the same game gets a fresh realtime topic', () => {
  const first = createRealtimeTopic('game:abc');
  const second = createRealtimeTopic('game:abc');

  assert.match(first, /^game:abc:\d+$/);
  assert.notEqual(first, second);
});
