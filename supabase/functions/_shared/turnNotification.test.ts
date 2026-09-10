import { buildScoredTurnNotification } from './turnNotification.ts';

Deno.test('pre-roll scratch notifications do not claim placeholder dice were rolled', () => {
  const result = buildScoredTurnNotification('Alice', 'Ones', true, { dice: [1, 1, 1, 1, 1], roll_count: 0, score: 0 });
  if (result.title !== 'Your turn' || result.body !== 'Alice scratched Ones.') {
    throw new Error(`Unexpected notification: ${JSON.stringify(result)}`);
  }
});

Deno.test('actual Sucker rolls still receive a Sucker notification', () => {
  const result = buildScoredTurnNotification('Alice', 'Sucker', false, {
    dice: [1, 1, 1, 1, 1],
    roll_count: 1,
    score: 50,
  });
  if (result.title !== 'SUCKER!!') throw new Error(`Unexpected notification: ${JSON.stringify(result)}`);
});
