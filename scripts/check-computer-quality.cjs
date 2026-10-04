// Keep all 1,000 deterministic games in CI without blocking fast rule tests.
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { measureComputerStrategy } = require('../.build/src/game/computerSimulation');

if (!isMainThread) {
  parentPort.postMessage(measureComputerStrategy(workerData));
} else {
  const started = performance.now();
  Promise.all(
    [1, 501].map(
      (seed) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(__filename, { workerData: { gameCount: 500, seed } });
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`Simulation worker exited ${code}`));
          });
        }),
    ),
  )
    .then((results) => {
      const scores = results.flatMap((result) => result.scores);
      assert.equal(scores.length, 1000);
      assert.ok(scores.every((score) => Number.isInteger(score) && score > 0));
      const report = {
        firstSeed: 1,
        lastSeed: 1000,
        gameCount: scores.length,
        averageScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
        lowScore: Math.min(...scores),
        highScore: Math.max(...scores),
        minimumAverageScore: 290,
        elapsedMs: performance.now() - started,
      };
      mkdirSync('test-results', { recursive: true });
      writeFileSync('test-results/computer-quality.json', JSON.stringify(report, null, 2));
      console.log(report);
      // Baseline 298.851: tolerate <3% regression, permit improvements. Changes
      // to this quality floor require explicit strategy evaluation in review.
      assert.ok(report.averageScore >= report.minimumAverageScore, 'Computer strategy average fell below 290');
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
