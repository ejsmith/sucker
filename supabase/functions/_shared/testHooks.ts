type EnvReader = { get(name: string): string | undefined };

const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'host.docker.internal', 'localhost']);

// Hosted projects always use a dotted hostname. Local Edge Runtime containers
// reach the API through loopback or a single-label Docker alias such as `kong`.
export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return loopbackHosts.has(hostname) || !hostname.includes('.');
  } catch {
    return false;
  }
}

// Test hooks fix dice, Punch odds, and timers. Honor them only on a local
// backend so a stray hosted secret can never rig production games.
export function readLocalTestHook(name: string, env: EnvReader = Deno.env): string | undefined {
  return isLocalSupabaseUrl(env.get('SUPABASE_URL')) ? env.get(name) : undefined;
}
