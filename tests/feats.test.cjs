const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('the Edge Function feats module mirrors shared/feats.ts apart from import specifiers', () => {
  const appSource = fs.readFileSync(path.join(root, 'shared/feats.ts'), 'utf8');
  const edgeSource = fs.readFileSync(path.join(root, 'supabase/functions/_shared/feats.ts'), 'utf8');

  assert.equal(edgeSource.replace(/from '\.\/(game|stats)\.ts'/g, "from './$1'"), appSource);
});
