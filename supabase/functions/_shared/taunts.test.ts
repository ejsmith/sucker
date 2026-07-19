import { getTauntText, isTauntAvailableForScenario, isTauntId, taunts } from './taunts.ts';

Deno.test('Edge taunt catalog accepts only canned taunts', () => {
  if (!isTauntId('punch-me') || getTauntText('punch-me') !== 'Punch me. I dare you.') {
    throw new Error('Expected the approved punch taunt.');
  }
  if (isTauntId('custom trash talk')) {
    throw new Error('Expected free-form taunts to be rejected.');
  }
  if (new Set(taunts.map((taunt) => taunt.id)).size !== taunts.length) {
    throw new Error('Expected unique taunt IDs.');
  }
  if (!isTauntAvailableForScenario('sucker-punched', 'punch-landed')) {
    throw new Error('Expected landed punch trash talk to unlock after a landed punch.');
  }
  if (isTauntAvailableForScenario('sucker-punched', 'base')) {
    throw new Error('Expected landed punch trash talk to stay locked after an ordinary play.');
  }
  if (!isTauntAvailableForScenario('sucker', 'sucker-roll') || isTauntAvailableForScenario('sucker', 'base')) {
    throw new Error('Expected SUCKER! to unlock only after a Sucker roll.');
  }
});
