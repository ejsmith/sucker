const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

// Isolate hostile inputs so a regression cannot hang the test runner.
function bounded(source) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 100_000,
  });
  assert.equal(result.error?.code, undefined, `Parser exceeded two-second limit: ${result.error?.code}`);
  assert.equal(result.status, 0, result.stderr);
}

test('query-string handles malformed Unicode in bounded time and preserves its CommonJS API', () => {
  bounded(`
    const assert = require('node:assert/strict');
    const query = require('query-string');
    assert.equal(query.parse('bad=' + '%E0%A4'.repeat(1000)).bad, '%E0%A4'.repeat(1000));
    const valid = query.parse('unicode=%E2%9C%93&space=a+b&plus=%2B&astral=%F0%9F%98%80');
    assert.equal(valid.unicode, '✓');
    assert.equal(valid.space, 'a b');
    assert.equal(valid.plus, '+');
    assert.equal(valid.astral, '😀');
  `);
});

test('decoder handles many distinct malformed runs in bounded time', () => {
  bounded(`
    const assert = require('node:assert/strict');
    const decode = require('./vendor/decode-uri-component/index.cjs');
    const runs = Array.from({length: 15000}, (_, index) =>
      '%E0%A4%' + (index >> 8).toString(16).padStart(2, '0') +
      '%' + (index & 255).toString(16).padStart(2, '0'));
    const expected = runs.map(run => decode(run)).join('|');
    assert.equal(decode(runs.join('|')), expected);
    assert.equal(decode('%FE%FFx%C2y%FF%FE'), '\\uFFFD\\uFFFDx\\uFFFDy\\uFFFD\\uFFFD');
  `);
});

for (const [format, hex] of [
  ['ICNS', '69636e73000000186963303400000000'],
  ['JPEG XL', '0000000c4a584c200d0a870a00000014667479706a786c20000000006a786c20000000006a786c7000000000'],
]) {
  test(`image-size rejects a zero-length ${format} entry without hanging`, () => {
    bounded(`
      const assert = require('node:assert/strict');
      assert.throws(() => require('image-size')(Buffer.from('${hex}', 'hex')));
    `);
  });
}

test('image-size continues to read a valid PNG and ICNS entry', () => {
  const size = require('image-size');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0VQAAAAASUVORK5CYII=', 'base64');
  assert.equal(size(png).width, 1);
  assert.equal(size(png).height, 1);
  const icns = size(Buffer.from('69636e73000000106963703400000008', 'hex'));
  assert.equal(icns.width, 16);
  assert.equal(icns.height, 16);
});

test('uuid rejects undersized caller buffers and preserves the xcode UUID consumer', () => {
  const uuid = require('uuid');
  assert.throws(() => uuid.v5('sucker', uuid.v5.DNS, new Uint8Array(8)), RangeError);
  const project = require('xcode').project('unused.pbxproj');
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});
