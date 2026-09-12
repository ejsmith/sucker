const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

test('independent tabs preserve both pending computer results', async () => {
  const storage = new Map();
  const uploaded = new Set();
  const asyncStorage = {
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => { storage.set(key, value); },
    removeItem: async (key) => { storage.delete(key); },
    getAllKeys: async () => [...storage.keys()],
    multiGet: async (keys) => keys.map((key) => [key, storage.get(key) ?? null]),
  };
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } }, error: null }) },
    rpc: async (_name, args) => {
      uploaded.add(args.p_game_id);
      return { data: { games_played: uploaded.size }, error: null };
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/multiplayer/computerResultQueue.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const tab = () => {
    const exports = {};
    vm.runInNewContext(compiled, {
      exports,
      require: (name) => name.includes('async-storage')
        ? { __esModule: true, default: asyncStorage }
        : { supabase, isMultiplayerConfigured: true },
    });
    return exports;
  };
  const a = tab();
  const b = tab();
  await Promise.all([
    a.enqueueComputerResult('owner', 'game-a', { total_score: 10 }),
    b.enqueueComputerResult('owner', 'game-b', { total_score: 20 }),
  ]);
  await Promise.all([a.flushComputerResults('owner'), b.flushComputerResults('owner')]);
  console.log(`Two simultaneous completed games; ${uploaded.size} distinct results delivered.`);
  assert.equal(uploaded.size, 2);
  assert.equal(storage.size, 0);
  storage.set('sucker.computer-results.v1.owner', JSON.stringify([{ gameId: 'legacy', payload: {} }]));
  await a.flushComputerResults('owner');
  assert.equal(uploaded.size, 3);
  assert.equal(storage.size, 0);
});
