const { measureComputerStrategy } = require('../.build/src/game/computerSimulation');

const gameCount = Number(process.argv[2] ?? 1000);
const seed = Number(process.argv[3] ?? 1);
const result = measureComputerStrategy({ gameCount, seed });

console.log(`Computer simulation (${result.gameCount} games, seed ${seed})`);
console.log(`Average score: ${result.averageScore.toFixed(3)}`);
console.log(`Low score: ${result.lowScore}`);
console.log(`High score: ${result.highScore}`);
