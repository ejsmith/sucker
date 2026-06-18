import { supabase } from './supabase';

export async function getMyProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }
  if (!user) {
    return null;
  }

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();

  if (error) {
    throw error;
  }

  return data;
}

export async function searchProfiles(query: string) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [];
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.%${trimmedQuery}%,display_name.ilike.%${trimmedQuery}%`)
    .limit(12);

  if (error) {
    throw error;
  }

  return data;
}
