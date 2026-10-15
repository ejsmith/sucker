const assert = require('node:assert/strict');
const test = require('node:test');
const { createActionRequestStatus } = require('../.build/src/network/actionRequestStatus');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('idle time and quick requests never show a server warning', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const status = createActionRequestStatus();
  const snapshots = [];
  status.subscribe(() => snapshots.push(status.getSnapshot()));
  t.mock.timers.tick(30_000);
  assert.equal(status.getSnapshot(), false);
  assert.equal(await status.run(async () => 'saved'), 'saved');
  t.mock.timers.tick(30_000);
  assert.deepEqual(snapshots, []);
});

test('only a slow request shows the warning, and success clears it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const status = createActionRequestStatus();
  const request = deferred();
  const result = status.run(() => request.promise);
  t.mock.timers.tick(2999);
  assert.equal(status.getSnapshot(), false);
  t.mock.timers.tick(1);
  assert.equal(status.getSnapshot(), true);
  request.resolve('saved');
  assert.equal(await result, 'saved');
  assert.equal(status.getSnapshot(), false);
});

test('a failed request clears the warning and preserves the caller error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const status = createActionRequestStatus();
  const request = deferred();
  const result = status.run(() => request.promise);
  const failure = assert.rejects(result, /server unavailable/);
  t.mock.timers.tick(3000);
  assert.equal(status.getSnapshot(), true);
  request.reject(new Error('server unavailable'));
  await failure;
  assert.equal(status.getSnapshot(), false);
});

test('another request finishing cannot hide a request still waiting on the server', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const status = createActionRequestStatus();
  const first = deferred();
  const second = deferred();
  const firstResult = status.run(() => first.promise);
  t.mock.timers.tick(3000);
  const secondResult = status.run(() => second.promise);
  second.resolve();
  await secondResult;
  assert.equal(status.getSnapshot(), true);
  first.resolve();
  await firstResult;
  assert.equal(status.getSnapshot(), false);
});
