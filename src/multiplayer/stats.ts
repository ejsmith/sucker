import { supabase } from './supabase';

export type AllTimeOpponentRecord = {
  gamesPlayed: number;
  losses: number;
  ties: number;
  wins: number;
};

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

export async function getAllTimeOpponentRecord(): Promise<AllTimeOpponentRecord> {
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

  const { data, error } = await supabase
    .from('head_to_head_stats')
    .select('games_played,wins,losses')
    .eq('player_id', user.id);

  if (error) {
    throw error;
  }

  return (data ?? []).reduce<AllTimeOpponentRecord>(
    (record, row) => {
      const gamesPlayed = Number(row.games_played) || 0;
      const wins = Number(row.wins) || 0;
      const losses = Number(row.losses) || 0;
      return {
        gamesPlayed: record.gamesPlayed + gamesPlayed,
        losses: record.losses + losses,
        ties: record.ties + Math.max(0, gamesPlayed - wins - losses),
        wins: record.wins + wins,
      };
    },
    { gamesPlayed: 0, losses: 0, ties: 0, wins: 0 },
  );
}
