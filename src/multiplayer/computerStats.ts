import { totalScore, upperBonus } from '../game';
import type { GameState, ScoreCategory, Scorecard } from '../game';
import { buildCompletedPlayerStats, type SuckerStatAction, type SuckerStatTurn } from '../../shared/stats';
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

export async function recordComputerGameResult(game: GameState, actions: SuckerStatAction[], turns: SuckerStatTurn[]) {
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
  const playerScore = totalScore(player.scorecard);
  const computerScore = totalScore(computer.scorecard);
  const playerResult = buildCompletedPlayerStats({
    actions,
    gameId: game.id,
    opponent: computer,
    player,
    players: game.players,
    turns,
    winnerId: playerScore > computerScore ? player.id : computerScore > playerScore ? computer.id : null,
  });

  const { data, error } = await supabase.rpc('record_computer_game_result', {
    buzzer_beater_wins: playerResult.buzzer_beater_win,
    computer_scored_four_of_a_kind: scoredCategory(computer.scorecard, 'fourOfAKind'),
    computer_scored_full_house: scoredCategory(computer.scorecard, 'fullHouse'),
    computer_scored_large_straight: scoredCategory(computer.scorecard, 'largeStraight'),
    computer_scored_small_straight: scoredCategory(computer.scorecard, 'smallStraight'),
    computer_scored_sucker: scoredCategory(computer.scorecard, 'sucker'),
    computer_scored_three_of_a_kind: scoredCategory(computer.scorecard, 'threeOfAKind'),
    computer_score: computerScore,
    computer_upper_bonus_awarded: upperBonus(computer.scorecard) > 0,
    comeback_wins: playerResult.comeback_win,
    extra_rolls_used: playerResult.extra_rolls_used,
    mulligans_used: playerResult.mulligans_used,
    player_score: playerScore,
    scored_four_of_a_kind: scoredCategory(player.scorecard, 'fourOfAKind'),
    scored_full_house: scoredCategory(player.scorecard, 'fullHouse'),
    scored_large_straight: scoredCategory(player.scorecard, 'largeStraight'),
    scored_small_straight: scoredCategory(player.scorecard, 'smallStraight'),
    scored_sucker: scoredCategory(player.scorecard, 'sucker'),
    scored_three_of_a_kind: scoredCategory(player.scorecard, 'threeOfAKind'),
    sucker_blockers_used: playerResult.sucker_blockers_used,
    sucker_hunt_misses: playerResult.sucker_hunt_misses,
    sucker_hunts: playerResult.sucker_hunts,
    sucker_punches_used: playerResult.sucker_punches_used,
    sucker_tokens_leftover: playerResult.sucker_tokens_leftover,
    sucker_tokens_spent: playerResult.sucker_tokens_spent,
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
