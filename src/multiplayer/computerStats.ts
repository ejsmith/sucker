import { totalScore, upperBonus } from '../game';
import type { GameState, ScoreCategory, Scorecard } from '../game';
import { isMultiplayerConfigured, supabase } from './supabase';

export type ComputerStats = Awaited<ReturnType<typeof getComputerStats>>;

export async function getComputerStats() {
  if (!isMultiplayerConfigured) {
    return null;
  }

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

  const { data, error } = await supabase.from('computer_stats').select('*').eq('profile_id', user.id).maybeSingle();
  if (error) {
    throw error;
  }

  return data;
}

export async function recordComputerGameResult(game: GameState) {
  if (!isMultiplayerConfigured || game.phase !== 'complete') {
    return null;
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }
  if (!session) {
    return null;
  }

  const player = game.players[0];
  const computer = game.players[1];
  if (!player || !computer) {
    return null;
  }

  const { data, error } = await supabase.rpc('record_computer_game_result', {
    computer_scored_four_of_a_kind: scoredCategory(computer.scorecard, 'fourOfAKind'),
    computer_scored_full_house: scoredCategory(computer.scorecard, 'fullHouse'),
    computer_scored_large_straight: scoredCategory(computer.scorecard, 'largeStraight'),
    computer_scored_small_straight: scoredCategory(computer.scorecard, 'smallStraight'),
    computer_scored_sucker: scoredCategory(computer.scorecard, 'sucker'),
    computer_scored_three_of_a_kind: scoredCategory(computer.scorecard, 'threeOfAKind'),
    computer_score: totalScore(computer.scorecard),
    computer_upper_bonus_awarded: upperBonus(computer.scorecard) > 0,
    player_score: totalScore(player.scorecard),
    scored_four_of_a_kind: scoredCategory(player.scorecard, 'fourOfAKind'),
    scored_full_house: scoredCategory(player.scorecard, 'fullHouse'),
    scored_large_straight: scoredCategory(player.scorecard, 'largeStraight'),
    scored_small_straight: scoredCategory(player.scorecard, 'smallStraight'),
    scored_sucker: scoredCategory(player.scorecard, 'sucker'),
    scored_three_of_a_kind: scoredCategory(player.scorecard, 'threeOfAKind'),
    upper_bonus_awarded: upperBonus(player.scorecard) > 0,
  });

  if (error) {
    throw error;
  }

  return data;
}

function scoredCategory(scorecard: Scorecard, category: ScoreCategory) {
  return (scorecard[category] ?? 0) > 0;
}
