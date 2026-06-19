const {
  createComputerStrategyCandidates,
  runComputerStrategyTournament,
} = require('../.build/src/game/computerTournament');

const candidates = createComputerStrategyCandidates();
const result = runComputerStrategyTournament({ candidates });

console.log(`Computer strategy tournament (${candidates.length} candidates)`);
for (const [index, round] of result.rounds.entries()) {
  console.log(`\nRound ${index + 1}: ${round.round.gameCount} games, seed ${round.round.seed}`);
  for (const score of round.scores.slice(0, Math.min(8, round.scores.length))) {
    console.log(
      `${score.result.averageScore.toFixed(3)} avg | ${score.result.lowScore}-${score.result.highScore} | ${score.candidate.name}`,
    );
  }
}

console.log('\nWinner');
console.log(`${result.winner.result.averageScore.toFixed(3)} avg | ${result.winner.candidate.name}`);
console.log(JSON.stringify(result.winner.candidate.strategy, null, 2));
