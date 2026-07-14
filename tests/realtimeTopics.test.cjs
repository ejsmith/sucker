const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameListRealtimeTopic } = require('../.build/src/multiplayer/realtimeTopics');

test('concurrent game-list subscriptions receive distinct realtime topics', () => {
  const first = createGameListRealtimeTopic();
  const second = createGameListRealtimeTopic();

  assert.match(first, /^games:list:\d+$/);
  assert.match(second, /^games:list:\d+$/);
  assert.notEqual(first, second);
});
