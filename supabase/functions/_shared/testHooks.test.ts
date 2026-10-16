import { isLocalSupabaseUrl, readLocalTestHook } from './testHooks.ts';

Deno.test('local Supabase URLs include loopback and Docker aliases', () => {
  for (const url of [
    'http://kong:8000',
    'http://supabase_kong_sucker:8000',
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'http://[::1]:54321',
    'http://host.docker.internal:54321',
  ]) {
    assertEquals(isLocalSupabaseUrl(url), true, url);
  }
});

Deno.test('hosted and missing Supabase URLs are not local', () => {
  for (const url of [undefined, '', 'not a url', 'https://abcdefghijklmnop.supabase.co', 'https://api.sucker.games']) {
    assertEquals(isLocalSupabaseUrl(url), false, String(url));
  }
});

Deno.test('test hooks are ignored on a hosted backend', () => {
  const hook = 'SUCKER_E2E_SUCKER_PUNCH_DIE';
  const read = (values: Record<string, string>) => readLocalTestHook(hook, { get: (name) => values[name] });
  assertEquals(read({ SUPABASE_URL: 'http://kong:8000', [hook]: '6' }), '6', 'local');
  assertEquals(read({ SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co', [hook]: '6' }), undefined, 'hosted');
  assertEquals(read({ [hook]: '6' }), undefined, 'missing URL');
});

function assertEquals<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}
