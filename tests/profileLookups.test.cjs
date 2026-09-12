const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

test('profile lookups deduplicate IDs and bound each request to fifty profiles', async () => {
  const batches = [];
  const supabase = {
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/avatars/' } }) }) },
    from: () => ({
      select: () => ({
        in: async (_column, ids) => {
          batches.push(ids);
          return { error: null, data: ids.map((id) => ({ id, username: id, display_name: id, avatar_url: null })) };
        },
      }),
    }),
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/multiplayer/profiles.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    URL,
    require: (name) => {
      assert.equal(name, './supabase');
      return { supabase };
    },
  });
  const ids = Array.from({ length: 110 }, (_, index) => `player-${index}`);
  const result = await exports.getProfilesByIds([...ids, ...ids, '']);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [50, 50, 10],
  );
  assert.equal(result.length, 110);
  assert.equal(new Set(result.map((profile) => profile.id)).size, 110);
  await exports.getProfilesByIds([]);
  assert.equal(batches.length, 3);
});
