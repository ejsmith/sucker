import type { User } from '@supabase/supabase-js';

export function hasAppleIdentity(user: Pick<User, 'identities' | 'app_metadata'>) {
  return Boolean(
    user.identities?.some((identity) => identity.provider === 'apple') ||
    user.app_metadata?.providers?.includes('apple') ||
    user.app_metadata?.provider === 'apple',
  );
}
