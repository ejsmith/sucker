const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSlowActionReport, parseServerTiming, toActionAttempt } = require('../.build/src/network/slowActionReport');

test('server timing reads each named duration and skips malformed entries', () => {
  assert.deepEqual(parseServerTiming('total;dur=110.9, boot;dur=89.2, auth;desc="x";dur=60, broken;dur=abc, cold'), {
    auth: 60,
    boot: 89.2,
    total: 110.9,
  });
  assert.deepEqual(parseServerTiming(null), {});
});

test('an attempt without a response is a network failure', () => {
  assert.deepEqual(toActionAttempt(812, undefined), {
    durationMs: 812,
    edgeRegion: null,
    serverTiming: null,
    status: 'network',
  });
});

test('an attempt keeps its status, region, and server timings', () => {
  const response = new Response('{}', {
    headers: { 'server-timing': 'total;dur=420', 'x-sb-edge-region': 'us-east-1' },
    status: 503,
  });
  assert.deepEqual(toActionAttempt(900, response), {
    durationMs: 900,
    edgeRegion: 'us-east-1',
    serverTiming: 'total;dur=420',
    status: 503,
  });
});

test('a report splits client time into server time and everything outside it', () => {
  const report = buildSlowActionReport(
    'roll',
    3600.4,
    [
      { durationMs: 2100.2, edgeRegion: null, serverTiming: null, status: 'network' },
      { durationMs: 600.6, edgeRegion: 'us-east-1', serverTiming: 'total;dur=450.5, auth;dur=80', status: 200 },
    ],
    { cellularGeneration: '4g', isInternetReachable: true, type: 'cellular' },
  );

  assert.equal(report.message, 'Slow roll');
  assert.deepEqual(report.properties, {
    ActionType: 'roll',
    AttemptCount: 2,
    Attempts: [
      { durationMs: 2100, edgeRegion: null, server: {}, status: 'network' },
      { durationMs: 601, edgeRegion: 'us-east-1', server: { auth: 80, total: 450.5 }, status: 200 },
    ],
    Connection: { cellularGeneration: '4g', isInternetReachable: true, type: 'cellular' },
    OutsideServerMs: 3150,
    ServerMs: 451,
    TotalMs: 3600,
  });
});
