import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Database } from '../_shared/database.types.ts';

type DbClient = SupabaseClient<Database>;

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};
const avatarBucket = 'avatars';

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const authHeader = request.headers.get('Authorization') ?? '';
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const authClient = createClient<Database>(supabaseUrl, requireEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient<Database>(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    await removeAvatarObjects(admin, user.id);
    await removeGamesContainingProfile(admin, user.id);

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw deleteUserError;

    return json({ deleted: true });
  } catch (error) {
    console.error('delete-account failed', error);
    return json({ error: toErrorMessage(error) }, 500);
  }
});

async function removeAvatarObjects(admin: DbClient, profileId: string) {
  while (true) {
    const { data, error } = await admin.storage.from(avatarBucket).list(profileId, {
      limit: 1_000,
      offset: 0,
    });
    if (error) throw error;

    const paths = (data ?? []).filter((item) => item.id).map((item) => `${profileId}/${item.name}`);
    if (paths.length === 0) return;

    const { error: removeError } = await admin.storage.from(avatarBucket).remove(paths);
    if (removeError) throw removeError;
    if (paths.length < 1_000) return;
  }
}

async function removeGamesContainingProfile(admin: DbClient, profileId: string) {
  while (true) {
    const { data, error } = await admin.from('game_players').select('game_id').eq('player_id', profileId).limit(500);
    if (error) throw error;

    const gameIds = [...new Set((data ?? []).map((row) => row.game_id))];
    if (gameIds.length === 0) break;

    const { error: deleteError } = await admin.from('games').delete().in('id', gameIds);
    if (deleteError) throw deleteError;
  }

  const { error } = await admin
    .from('games')
    .delete()
    .or(`created_by.eq.${profileId},current_player_id.eq.${profileId},winner_id.eq.${profileId}`);
  if (error) throw error;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The account could not be deleted.';
}
