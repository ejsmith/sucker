import type { Database } from '../../shared/database.types';
import { featCatalog, featKeys, isFeatKey, type FeatDefinition, type FeatKey } from '../../shared/feats';
import { getSafeAvatarUrl } from './profiles';
import { supabase } from './supabase';

export type LeaderboardBoard =
  | 'rating'
  | 'weekly_high_score'
  | 'all_time_high_score'
  | 'sharpshooter'
  | 'win_streak'
  | 'saltiest'
  | 'weekly_salt'
  | 'most_punchable'
  | 'whiff_champion'
  | 'biggest_loser';
// The Hall of Suckers celebrates; the Hall of Shame ranks the funny bad stuff.
export type LeaderboardHall = 'glory' | 'shame';
export type LeaderboardRow = Database['public']['Functions']['get_leaderboard']['Returns'][number];
export type PlayerCard = Database['public']['Functions']['get_player_card']['Returns'][number];
type PlayerFeatRow = Database['public']['Functions']['get_player_feats']['Returns'][number];
type PlayerRankingRow = Database['public']['Functions']['get_player_rankings']['Returns'][number];

export type PlayerRanking = {
  board: LeaderboardBoard;
  rank: number;
  rankedPlayers: number;
  sampleSize: number;
  value: number;
};

export type PlayerFeat = FeatDefinition & {
  earnedPct: number | null;
  key: FeatKey;
  lastEarnedAt: string | null;
  timesEarned: number;
};

export const leaderboardHalls: { hall: LeaderboardHall; title: string }[] = [
  { hall: 'glory', title: 'Hall of Suckers' },
  { hall: 'shame', title: 'Hall of Shame' },
];

export const leaderboardBoards: {
  board: LeaderboardBoard;
  hall: LeaderboardHall;
  label: string;
  title: string;
  valueLabel: string;
  // Shame boards explain themselves; the joke needs the rule.
  blurb?: string;
}[] = [
  { board: 'rating', hall: 'glory', label: 'Rating', title: 'Rating', valueLabel: 'Rating' },
  { board: 'weekly_high_score', hall: 'glory', label: 'This Week', title: 'This Week', valueLabel: 'Best score' },
  { board: 'all_time_high_score', hall: 'glory', label: 'All Time', title: 'All Time', valueLabel: 'Best score' },
  { board: 'sharpshooter', hall: 'glory', label: 'Punch %', title: 'Punch %', valueLabel: 'Landed' },
  { board: 'win_streak', hall: 'glory', label: 'Streak', title: 'Streak', valueLabel: 'Wins in a row' },
  {
    blurb: 'Most rage quits, ever.',
    board: 'saltiest',
    hall: 'shame',
    label: 'Saltiest',
    title: '🧂 Saltiest',
    valueLabel: 'Rage quits',
  },
  {
    blurb: 'Most rage quits since Monday.',
    board: 'weekly_salt',
    hall: 'shame',
    label: 'Weekly',
    title: '🧂 Salt of the Week',
    valueLabel: 'Rage quits',
  },
  {
    blurb: 'Most Sucker Punches taken on the chin.',
    board: 'most_punchable',
    hall: 'shame',
    label: 'Punched',
    title: '🥊 Most Punchable',
    valueLabel: 'Punched',
  },
  {
    blurb: 'Most Sucker Punches thrown at nothing.',
    board: 'whiff_champion',
    hall: 'shame',
    label: 'Whiffs',
    title: '💨 Whiff Champion',
    valueLabel: 'Missed',
  },
  {
    blurb: 'Worst beating in one game. Rage quitting does not hide it.',
    board: 'biggest_loser',
    hall: 'shame',
    label: 'Loser',
    title: '📉 Biggest Loser',
    valueLabel: 'Lost by',
  },
];

export function getLeaderboardInfo(board: LeaderboardBoard) {
  return leaderboardBoards.find((candidate) => candidate.board === board)!;
}

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

// Every board the player is ranked on, in board order.
export async function getPlayerRankings(profileId: string): Promise<PlayerRanking[]> {
  const { data, error } = await supabase.rpc('get_player_rankings', { target_profile_id: profileId });

  if (error) throw error;
  return ((data ?? []) as PlayerRankingRow[])
    .filter((row) => isLeaderboardBoard(row.board))
    .map((row) => ({
      board: row.board as LeaderboardBoard,
      rank: row.rank,
      rankedPlayers: row.ranked_players,
      sampleSize: row.sample_size,
      value: Number(row.value),
    }));
}

export function isLeaderboardBoard(value: string): value is LeaderboardBoard {
  return leaderboardBoards.some((candidate) => candidate.board === value);
}

export function formatLeaderboardValue(board: LeaderboardBoard, value: number) {
  switch (board) {
    case 'rating':
    case 'weekly_high_score':
    case 'all_time_high_score':
    case 'win_streak':
    case 'saltiest':
    case 'weekly_salt':
    case 'most_punchable':
    case 'whiff_champion':
      return String(Math.round(Number(value)));
    case 'biggest_loser':
      return `${Math.round(Number(value))} pts`;
    case 'sharpshooter':
      return `${Number(value).toFixed(1)}%`;
  }
}

// Matches the rating board's eligibility in get_leaderboard.
export const rankedGameMinimum = 5;

export function formatRankLine(card: PlayerCard) {
  if (card.rating_rank) return `#${card.rating_rank} in the world`;
  if (card.rated_games < rankedGameMinimum) {
    const remaining = rankedGameMinimum - card.rated_games;
    return `${remaining} more ${remaining === 1 ? 'game' : 'games'} to get ranked`;
  }
  return null;
}

export function formatFeatRarity(earnedPct: number | null) {
  if (earnedPct === null || earnedPct === 0) return 'Nobody yet';
  if (earnedPct < 1) return '<1% of players';
  return `${Math.round(earnedPct)}% of players`;
}
