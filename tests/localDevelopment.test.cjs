const assert = require('node:assert/strict');
const test = require('node:test');
const { isLocalBackendUrl } = require('../.build/src/multiplayer/localDevelopment');

test('recognizes loopback and private development backend URLs', () => {
  for (const url of [
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://10.1.2.3:54321',
    'http://172.16.0.1:54321',
    'http://172.31.255.255:54321',
    'http://192.168.1.20:54321',
    'http://100.64.0.1:54321',
    'http://100.119.128.1:54321',
    'http://100.127.255.255:54321',
    'http://sucker.local:54321',
  ]) {
    assert.equal(isLocalBackendUrl(url), true, url);
  }
});

test('rejects hosted, malformed, and public-range URLs', () => {
  for (const url of [
    'https://project.supabase.co',
    'http://100.63.255.255:54321',
    'http://100.128.0.1:54321',
    'http://172.15.0.1:54321',
    'http://172.32.0.1:54321',
    'not a url',
  ]) {
    assert.equal(isLocalBackendUrl(url), false, url);
  }
});
