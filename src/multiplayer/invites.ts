import { applyMultiplayerAction } from './games';
import { supabase } from './supabase';

export async function createInviteGame() {
  return applyMultiplayerAction({ type: 'create_invite' });
}

export async function acceptInviteCode(inviteCode: string) {
  return applyMultiplayerAction({ type: 'accept_invite', inviteCode });
}

export async function listMyInvites() {
  const { data, error } = await supabase
    .from('game_invites')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data;
}
