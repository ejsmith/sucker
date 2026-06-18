import { supabase } from './supabase';

export async function getHeadToHeadStats(opponentProfileId: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }
  if (!user) {
    throw new Error('You must be signed in to view stats.');
  }

  const { data: mine, error } = await supabase
    .from('head_to_head_stat_rates')
    .select('*')
    .eq('player_id', user.id)
    .eq('opponent_id', opponentProfileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const { data: opponent, error: opponentError } = await supabase
    .from('head_to_head_stat_rates')
    .select('*')
    .eq('player_id', opponentProfileId)
    .eq('opponent_id', user.id)
    .maybeSingle();

  if (opponentError) {
    throw opponentError;
  }

  return { mine, opponent };
}
