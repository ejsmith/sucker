const {
  createSuckerTokenStrategyCandidates,
  runSuckerTokenStrategyTournament,
} = require('../.build/src/game/computerTournament');

const candidates = createSuckerTokenStrategyCandidates();
const result = runSuckerTokenStrategyTournament({ candidates });

console.log(`Sucker token strategy tournament (${candidates.length} candidates)`);
for (const [index, round] of result.rounds.entries()) {
  console.log(`\nRound ${index + 1}: ${round.round.gameCount} head-to-head games, seed ${round.round.seed}`);
  for (const score of round.scores.slice(0, Math.min(8, round.scores.length))) {
    console.log(
      `${(score.result.winRate * 100).toFixed(1)}% wins | ${score.result.averageMargin.toFixed(3)} margin | ` +
        `${score.result.averageScore.toFixed(3)}-${score.result.averageOpponentScore.toFixed(3)} avg | ${score.candidate.name}`,
    );
  }
}

console.log('\nWinner');
console.log(
  `${(result.winner.result.winRate * 100).toFixed(1)}% wins | ${result.winner.result.averageMargin.toFixed(3)} margin | ` +
    result.winner.candidate.name,
);
console.log(JSON.stringify(result.winner.candidate.strategy, null, 2));
