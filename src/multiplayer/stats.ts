import type { Scorecard } from '../game';
import type { Database } from '../../shared/database.types';
import { getSafeAvatarUrl } from './profiles';
import { supabase } from './supabase';

export type ProfileStats = Database['public']['Functions']['get_profile_stat_rates']['Returns'][number];
type ProfileRecentGameRow = Database['public']['Functions']['get_profile_recent_games']['Returns'][number];

export type ProfileRecentGame = {
  completedAt: string;
  gameId: string;
  opponent: ProfileRecentGamePlayer;
  player: ProfileRecentGamePlayer;
};

export type ProfileRecentGamePlayer = {
  avatarUrl: string | null;
  id: string;
  name: string;
  score: number;
  scorecard: Scorecard;
  suckerTokens: number;
  suckerTokensSpent: number;
};

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

  const [mineResult, opponentResult, mineOverall, opponentOverall] = await Promise.all([
    supabase
      .from('head_to_head_stat_rates')
      .select('*')
      .eq('player_id', user.id)
      .eq('opponent_id', opponentProfileId)
      .maybeSingle(),
    supabase
      .from('head_to_head_stat_rates')
      .select('*')
      .eq('player_id', opponentProfileId)
      .eq('opponent_id', user.id)
      .maybeSingle(),
    getProfileStats(user.id),
    getProfileStats(opponentProfileId),
  ]);

  if (mineResult.error) throw mineResult.error;
  if (opponentResult.error) throw opponentResult.error;

  return {
    mine: mineResult.data,
    mineOverall,
    opponent: opponentResult.data,
    opponentOverall,
  };
}

export async function getProfileStats(profileId: string): Promise<ProfileStats | null> {
  const { data, error } = await supabase.rpc('get_profile_stat_rates', { target_profile_id: profileId });

  if (error) throw error;
  return (data?.[0] as ProfileStats | undefined) ?? null;
}

export async function getProfileRecentGames(profileId: string): Promise<ProfileRecentGame[]> {
  const { data, error } = await supabase.rpc('get_profile_recent_games', {
    game_limit: 25,
    target_profile_id: profileId,
  });

  if (error) throw error;
  return (data ?? []).map(toProfileRecentGame);
}

function toProfileRecentGame(row: ProfileRecentGameRow): ProfileRecentGame {
  return {
    completedAt: row.completed_at,
    gameId: row.game_id,
    opponent: toProfileRecentGamePlayer(row, 'opponent'),
    player: toProfileRecentGamePlayer(row, 'player'),
  };
}

function toProfileRecentGamePlayer(row: ProfileRecentGameRow, side: 'opponent' | 'player'): ProfileRecentGamePlayer {
  const id = row[`${side}_id`];
  return {
    avatarUrl: getSafeAvatarUrl(row[`${side}_avatar_url`], id),
    id,
    name: row[`${side}_name`],
    score: row[`${side}_score`],
    scorecard: row[`${side}_scorecard`] as Scorecard,
    suckerTokens: row[`${side}_sucker_tokens`],
    suckerTokensSpent: row[`${side}_sucker_tokens_spent`],
  };
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
