import type { GameState } from "./game.ts";

type Json = unknown;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          display_name?: string;
          updated_at?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      games: {
        Row: {
          completed_at: string | null;
          created_at: string;
          created_by: string;
          current_player_id: string | null;
          id: string;
          last_turn_id: string | null;
          state: GameState;
          status:
            | "inviting"
            | "active"
            | "response_window"
            | "blocked_response"
            | "complete";
          updated_at: string;
          winner_id: string | null;
        };
        Insert: {
          created_by: string;
          current_player_id?: string | null;
          id?: string;
          state: GameState;
          status?:
            | "inviting"
            | "active"
            | "response_window"
            | "blocked_response"
            | "complete";
          winner_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          current_player_id?: string | null;
          last_turn_id?: string | null;
          state?: GameState;
          status?:
            | "inviting"
            | "active"
            | "response_window"
            | "blocked_response"
            | "complete";
          updated_at?: string;
          winner_id?: string | null;
        };
        Relationships: [];
      };
      game_players: {
        Row: {
          final_score: number | null;
          game_id: string;
          joined_at: string;
          player_id: string;
          seat_index: number;
          sucker_tokens: number;
          upper_bonus_awarded: boolean;
        };
        Insert: {
          final_score?: number | null;
          game_id: string;
          player_id: string;
          seat_index: number;
          sucker_tokens?: number;
          upper_bonus_awarded?: boolean;
        };
        Update: {
          final_score?: number | null;
          sucker_tokens?: number;
          upper_bonus_awarded?: boolean;
        };
        Relationships: [];
      };
      game_invites: {
        Row: {
          created_at: string;
          game_id: string;
          id: string;
          invite_code: string;
          invitee_id: string | null;
          inviter_id: string;
          status: "pending" | "accepted" | "declined" | "expired";
          updated_at: string;
        };
        Insert: {
          game_id: string;
          id?: string;
          invite_code?: string;
          invitee_id?: string | null;
          inviter_id: string;
          status?: "pending" | "accepted" | "declined" | "expired";
        };
        Update: {
          invitee_id?: string | null;
          status?: "pending" | "accepted" | "declined" | "expired";
          updated_at?: string;
        };
        Relationships: [];
      };
      turns: {
        Row: {
          category: string;
          created_at: string;
          dice: number[];
          finalized_at: string | null;
          game_id: string;
          held: boolean[];
          id: string;
          player_id: string;
          roll_count: number;
          score: number;
          status:
            | "submitted"
            | "punched"
            | "blocked"
            | "mulliganed"
            | "finalized";
          turn_index: number;
        };
        Insert: {
          category: string;
          dice: number[];
          finalized_at?: string | null;
          game_id: string;
          held: boolean[];
          id?: string;
          player_id: string;
          roll_count: number;
          score: number;
          status?:
            | "submitted"
            | "punched"
            | "blocked"
            | "mulliganed"
            | "finalized";
          turn_index: number;
        };
        Update: {
          finalized_at?: string | null;
          status?:
            | "submitted"
            | "punched"
            | "blocked"
            | "mulliganed"
            | "finalized";
        };
        Relationships: [];
      };
      turn_actions: {
        Row: {
          action_type:
            | "create_game"
            | "create_invite"
            | "accept_invite"
            | "extra_roll"
            | "roll"
            | "toggle_hold"
            | "score_category"
            | "scratch_category"
            | "pass_response"
            | "mulligan"
            | "sucker_punch"
            | "sucker_blocker"
            | "taunt";
          actor_id: string;
          created_at: string;
          game_id: string;
          id: string;
          payload: Json;
          turn_id: string | null;
        };
        Insert: {
          action_type:
            | "create_game"
            | "create_invite"
            | "accept_invite"
            | "extra_roll"
            | "roll"
            | "toggle_hold"
            | "score_category"
            | "scratch_category"
            | "pass_response"
            | "mulligan"
            | "sucker_punch"
            | "sucker_blocker"
            | "taunt";
          actor_id: string;
          game_id: string;
          id?: string;
          payload?: Json;
          turn_id?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      token_events: {
        Row: {
          created_at: string;
          event_type:
            | "earned_sucker"
            | "mulligan"
            | "sucker_punch"
            | "sucker_blocker";
          game_id: string;
          id: string;
          player_id: string;
          target_turn_id: string | null;
          token_delta: number;
        };
        Insert: {
          event_type:
            | "earned_sucker"
            | "mulligan"
            | "sucker_punch"
            | "sucker_blocker";
          game_id: string;
          id?: string;
          player_id: string;
          target_turn_id?: string | null;
          token_delta: number;
        };
        Update: never;
        Relationships: [];
      };
      game_player_results: {
        Row: GamePlayerResult;
        Insert: GamePlayerResult;
        Update: never;
        Relationships: [];
      };
      head_to_head_stats: {
        Row: HeadToHeadStats;
        Insert: {
          average_score?: number;
          forced_rerolls?: number;
          four_of_a_kind_games?: number;
          full_house_games?: number;
          games_played?: number;
          highest_score?: number;
          large_straight_games?: number;
          losses?: number;
          mulligans_used?: number;
          opponent_id: string;
          player_id: string;
          small_straight_games?: number;
          sucker_blockers_used?: number;
          sucker_games?: number;
          sucker_punches_received?: number;
          sucker_punches_used?: number;
          three_of_a_kind_games?: number;
          total_score?: number;
          upper_bonus_games?: number;
          wins?: number;
        };
        Update: Partial<
          Omit<HeadToHeadStats, "opponent_id" | "player_id" | "updated_at">
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type GamePlayerResult = {
  completed_at?: string;
  final_score: number;
  forced_rerolls?: number;
  four_of_a_kind_count?: number;
  full_house_count?: number;
  game_id: string;
  large_straight_count?: number;
  mulligans_used?: number;
  opponent_id: string;
  player_id: string;
  small_straight_count?: number;
  sucker_blockers_used?: number;
  sucker_count?: number;
  sucker_punches_received?: number;
  sucker_punches_used?: number;
  three_of_a_kind_count?: number;
  upper_bonus_awarded: boolean;
  won: boolean;
};

type HeadToHeadStats = {
  average_score: number;
  forced_rerolls: number;
  four_of_a_kind_games: number;
  full_house_games: number;
  games_played: number;
  highest_score: number;
  large_straight_games: number;
  losses: number;
  mulligans_used: number;
  opponent_id: string;
  player_id: string;
  small_straight_games: number;
  sucker_blockers_used: number;
  sucker_games: number;
  sucker_punches_received: number;
  sucker_punches_used: number;
  three_of_a_kind_games: number;
  total_score: number;
  upper_bonus_games: number;
  updated_at: string;
  wins: number;
};
