import { supabase } from './supabase';

const avatarPublicBase = supabase.storage.from('avatars').getPublicUrl('').data.publicUrl.replace(/\/$/, '');

export function getSafeAvatarUrl(value: string | null | undefined, profileId: string) {
  if (!value) return null;

  try {
    const candidate = new URL(value);
    const base = new URL(avatarPublicBase);
    const ownerPath = `${base.pathname}/${encodeURIComponent(profileId)}/`;
    return candidate.origin === base.origin && candidate.pathname.startsWith(ownerPath) ? value : null;
  } catch {
    return null;
  }
}

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

  return { ...data, avatar_url: getSafeAvatarUrl(data.avatar_url, data.id) };
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

  return data.map((profile) => ({ ...profile, avatar_url: getSafeAvatarUrl(profile.avatar_url, profile.id) }));
}

export async function getProfilesByIds(profileIds: string[]) {
  const uniqueIds = [...new Set(profileIds)].filter(Boolean);
  if (!uniqueIds.length) {
    return [];
  }

  const { data, error } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', uniqueIds);

  if (error) {
    throw error;
  }

  return data.map((profile) => ({ ...profile, avatar_url: getSafeAvatarUrl(profile.avatar_url, profile.id) }));
}
