const assert = require('node:assert/strict');
const test = require('node:test');
const { createGame } = require('../.build/shared/game');
const { buildTrashTalk } = require('../.build/src/game/trashTalk');

const base = createGame(['Alice', 'Bob']);
const game = {
  ...base,
  phase: 'complete',
  players: base.players.map((player, index) => ({ ...player, id: index === 0 ? 'alice' : 'bob' })),
};
const turn = (id, turnIndex, playerId, category, score, status = 'finalized') => ({
  category,
  id,
  player_id: playerId,
  score,
  status,
  turn_index: turnIndex,
});
const turns = [
  turn('t1', 1, 'alice', 'fullHouse', 25),
  turn('t2', 2, 'bob', 'sucker', 50, 'punched'),
  turn('t3', 3, 'bob', 'sucker', 0),
  turn('t4', 4, 'alice', 'chance', 22),
  turn('t5', 5, 'bob', 'chance', 18),
];
const taunt = (actorId, createdAt, tauntId, turnId) => ({ actorId, createdAt, tauntId, turnId });
const lines = (entries) => entries.map((entry) => [entry.kind, entry.playerId ?? null, entry.text, entry.note ?? null]);

test('taunts come in the order sent, with the round and what they answered', () => {
  const talk = buildTrashTalk({
    game,
    taunts: [
      // Stored out of order: the log sorts by when each was sent.
      taunt('alice', '2026-11-25T10:03:00Z', 'warning-punch', 't5'),
      taunt('alice', '2026-11-25T10:00:00Z', 'not-invited', 't1'),
      taunt('alice', '2026-11-25T10:01:00Z', 'sucker-punched', 't2'),
      taunt('bob', '2026-11-25T10:02:00Z', 'beat-that', 't3'),
      taunt('bob', '2026-11-25T10:04:00Z', 'your-move', 'gone'),
    ],
    turns,
  });

  assert.deepEqual(lines(talk), [
    ['line', 'alice', "Full house. You're not invited.", 'Round 1 · after 25 on Full house'],
    ['line', 'alice', 'You just got Sucker Punched.', 'Round 1 · after landing a Sucker Punch'],
    // The replay of a punched turn is the same round.
    ['line', 'bob', 'Beat that, Sucker.', 'Round 1 · after 0 on Sucker'],
    ['line', 'alice', 'That was a warning punch.', 'Round 2 · after a missed Sucker Punch'],
    // A taunt whose turn is gone still shows, without a moment.
    ['line', 'bob', 'Your move, Sucker.', null],
  ]);
});

test('the end of the game follows: a rage quit and its reply, or both last words', () => {
  const quit = buildTrashTalk({
    game: { ...game, rageQuit: { playerId: 'bob', replyId: 'need-tissue' } },
    taunts: [],
    turns,
  });
  assert.deepEqual(lines(quit), [
    ['event', null, 'Bob rage quit.', null],
    ['line', 'alice', 'Need a tissue?', 'Reply'],
  ]);

  const timedOut = buildTrashTalk({ game: { ...game, timedOut: { playerId: 'alice' } }, taunts: [], turns });
  assert.deepEqual(lines(timedOut), [['event', null, 'Alice ran out of time.', null]]);

  const lastWords = buildTrashTalk({
    game: {
      ...game,
      partingShots: [
        { lineId: 'recount', playerId: 'bob' },
        { lineId: 'scoreboard', playerId: 'alice' },
      ],
    },
    taunts: [taunt('bob', '2026-11-25T10:00:00Z', 'beat-that', 't3')],
    turns,
  });
  assert.deepEqual(
    lastWords.map((entry) => [entry.playerId, entry.note]),
    [
      ['bob', 'Round 1 · after 0 on Sucker'],
      ['bob', 'Last word'],
      ['alice', 'Last word'],
    ],
  );
  assert.deepEqual(buildTrashTalk({ game, taunts: [], turns }), []);
});
