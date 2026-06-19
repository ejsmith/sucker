const assert = require('node:assert/strict');
const test = require('node:test');

const { createComputerStrategyCandidates, runComputerStrategyTournament } = require('../.build/src/game/computerTournament');
const { measureComputerStrategy, simulateComputerScore } = require('../.build/src/game/computerSimulation');

test('computer score simulation is deterministic for a seed', () => {
  assert.equal(simulateComputerScore(42), simulateComputerScore(42));
});

test('computer strategy clears a strong 1000-game average', () => {
  const result = measureComputerStrategy({ gameCount: 1000, seed: 1 });

  assert.equal(result.gameCount, 1000);
  assert.equal(Number(result.averageScore.toFixed(3)), 285.120);
  assert.equal(result.lowScore, 136);
  assert.equal(result.highScore, 540);
});

test('computer tournament advances the strongest candidate', () => {
  const candidates = createComputerStrategyCandidates().slice(0, 4);
  const result = runComputerStrategyTournament({
    candidates,
    rounds: [{ advanceCount: 1, gameCount: 10, seed: 1 }],
  });

  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].scores.length, 4);
  assert.equal(result.winner, result.rounds[0].scores[0]);
});
