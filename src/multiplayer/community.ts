import type { Database } from '../../shared/database.types';
import { featCatalog, featKeys, isFeatKey, type FeatDefinition, type FeatKey } from '../../shared/feats';
import { getSafeAvatarUrl } from './profiles';
import { supabase } from './supabase';

export type LeaderboardBoard = 'rating' | 'weekly_high_score' | 'all_time_high_score' | 'sharpshooter' | 'win_streak';
export type LeaderboardRow = Database['public']['Functions']['get_leaderboard']['Returns'][number];
export type PlayerCard = Database['public']['Functions']['get_player_card']['Returns'][number];
type PlayerFeatRow = Database['public']['Functions']['get_player_feats']['Returns'][number];

export type PlayerFeat = FeatDefinition & {
  earnedPct: number | null;
  key: FeatKey;
  lastEarnedAt: string | null;
  timesEarned: number;
};

export const leaderboardBoards: { board: LeaderboardBoard; label: string; valueLabel: string }[] = [
  { board: 'rating', label: 'Rating', valueLabel: 'Rating' },
  { board: 'weekly_high_score', label: 'This Week', valueLabel: 'Best score' },
  { board: 'all_time_high_score', label: 'All Time', valueLabel: 'Best score' },
  { board: 'sharpshooter', label: 'Punch %', valueLabel: 'Landed' },
  { board: 'win_streak', label: 'Streak', valueLabel: 'Wins in a row' },
];

export async function getLeaderboard(board: LeaderboardBoard, maxRows = 25): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', { board, max_rows: maxRows });

  if (error) throw error;
  return ((data ?? []) as LeaderboardRow[]).map((row) => ({
    ...row,
    avatar_url: getSafeAvatarUrl(row.avatar_url, row.player_id),
  }));
}

export async function getPlayerCard(profileId: string): Promise<PlayerCard | null> {
  const { data, error } = await supabase.rpc('get_player_card', { target_profile_id: profileId });

  if (error) throw error;
  const card = (data as PlayerCard[] | null)?.[0];
  return card ? { ...card, avatar_url: getSafeAvatarUrl(card.avatar_url, card.player_id) } : null;
}

// Every cataloged feat, earned ones first, each with how rare it is.
export async function getPlayerFeats(profileId: string): Promise<PlayerFeat[]> {
  const { data, error } = await supabase.rpc('get_player_feats', { target_profile_id: profileId });

  if (error) throw error;
  const rows = new Map(
    ((data ?? []) as PlayerFeatRow[]).filter((row) => isFeatKey(row.feat_key)).map((row) => [row.feat_key, row]),
  );
  return featKeys
    .map((key) => {
      const row = rows.get(key);
      return {
        ...featCatalog[key],
        earnedPct: row?.earned_pct === null || row?.earned_pct === undefined ? null : Number(row.earned_pct),
        key,
        lastEarnedAt: row?.last_earned_at ?? null,
        timesEarned: row?.times_earned ?? 0,
      };
    })
    .sort((left, right) => Number(right.timesEarned > 0) - Number(left.timesEarned > 0));
}

export async function getShowOnLeaderboards(profileId: string) {
  const { data, error } = await supabase.from('profiles').select('show_on_leaderboards').eq('id', profileId).single();

  if (error) throw error;
  return data.show_on_leaderboards;
}

export async function setShowOnLeaderboards(profileId: string, showOnLeaderboards: boolean) {
  const { error } = await supabase
    .from('profiles')
    .update({ show_on_leaderboards: showOnLeaderboards })
    .eq('id', profileId);

  if (error) throw error;
}

export function formatLeaderboardValue(board: LeaderboardBoard, value: number) {
  switch (board) {
    case 'rating':
    case 'weekly_high_score':
    case 'all_time_high_score':
    case 'win_streak':
      return String(Math.round(Number(value)));
    case 'sharpshooter':
      return `${Number(value).toFixed(1)}%`;
  }
}

export function formatFeatRarity(earnedPct: number | null) {
  if (earnedPct === null || earnedPct === 0) return 'Nobody yet';
  if (earnedPct < 1) return '<1% of players';
  return `${Math.round(earnedPct)}% of players`;
}
