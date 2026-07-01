export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

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
      };
      friendships: {
        Row: {
          addressee_id: string;
          created_at: string;
          id: string;
          requester_id: string;
          status: 'pending' | 'accepted' | 'blocked';
          updated_at: string;
        };
        Insert: {
          addressee_id: string;
          id?: string;
          requester_id: string;
          status?: 'pending' | 'accepted' | 'blocked';
        };
        Update: {
          status?: 'pending' | 'accepted' | 'blocked';
          updated_at?: string;
        };
      };
      games: {
        Row: {
          completed_at: string | null;
          created_at: string;
          created_by: string;
          current_player_id: string | null;
          id: string;
          last_turn_id: string | null;
          state: Json;
          status: 'inviting' | 'active' | 'response_window' | 'blocked_response' | 'complete';
          updated_at: string;
          winner_id: string | null;
        };
        Insert: {
          created_by: string;
          current_player_id?: string | null;
          id?: string;
          state: Json;
          status?: 'inviting' | 'active' | 'response_window' | 'blocked_response' | 'complete';
          winner_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          current_player_id?: string | null;
          last_turn_id?: string | null;
          state?: Json;
          status?: 'inviting' | 'active' | 'response_window' | 'blocked_response' | 'complete';
          updated_at?: string;
          winner_id?: string | null;
        };
      };
      game_players: {
        Row: {
          final_score: number | null;
          game_id: string;
          joined_at: string;
          player_id: string;
          removed_at: string | null;
          seat_index: number;
          sucker_tokens: number;
          upper_bonus_awarded: boolean;
        };
        Insert: {
          final_score?: number | null;
          game_id: string;
          player_id: string;
          removed_at?: string | null;
          seat_index: number;
          sucker_tokens?: number;
          upper_bonus_awarded?: boolean;
        };
        Update: {
          final_score?: number | null;
          removed_at?: string | null;
          sucker_tokens?: number;
          upper_bonus_awarded?: boolean;
        };
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
          status: 'submitted' | 'punched' | 'blocked' | 'mulliganed' | 'finalized';
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
          status?: 'submitted' | 'punched' | 'blocked' | 'mulliganed' | 'finalized';
          turn_index: number;
        };
        Update: {
          finalized_at?: string | null;
          status?: 'submitted' | 'punched' | 'blocked' | 'mulliganed' | 'finalized';
        };
      };
      game_invites: {
        Row: {
          created_at: string;
          game_id: string;
          id: string;
          invite_code: string;
          invitee_id: string | null;
          inviter_id: string;
          status: 'pending' | 'accepted' | 'declined' | 'expired';
          updated_at: string;
        };
        Insert: {
          game_id: string;
          id?: string;
          invite_code?: string;
          invitee_id?: string | null;
          inviter_id: string;
          status?: 'pending' | 'accepted' | 'declined' | 'expired';
        };
        Update: {
          invitee_id?: string | null;
          status?: 'pending' | 'accepted' | 'declined' | 'expired';
          updated_at?: string;
        };
      };
      push_tokens: {
        Row: {
          created_at: string;
          device_name: string | null;
          expo_push_token: string;
          id: string;
          platform: 'ios' | 'android';
          profile_id: string;
          updated_at: string;
        };
        Insert: {
          device_name?: string | null;
          expo_push_token: string;
          id?: string;
          platform: 'ios' | 'android';
          profile_id: string;
        };
        Update: {
          device_name?: string | null;
          expo_push_token?: string;
          platform?: 'ios' | 'android';
          updated_at?: string;
        };
      };
      web_push_subscriptions: {
        Row: {
          auth_key: string;
          created_at: string;
          endpoint: string;
          expiration_time: string | null;
          id: string;
          p256dh_key: string;
          platform: 'web';
          profile_id: string;
          updated_at: string;
          user_agent: string | null;
        };
        Insert: {
          auth_key: string;
          endpoint: string;
          expiration_time?: string | null;
          id?: string;
          p256dh_key: string;
          platform?: 'web';
          profile_id: string;
          user_agent?: string | null;
        };
        Update: {
          auth_key?: string;
          endpoint?: string;
          expiration_time?: string | null;
          p256dh_key?: string;
          platform?: 'web';
          updated_at?: string;
          user_agent?: string | null;
        };
      };
      head_to_head_stats: {
        Row: {
          average_score: number;
          average_sucker_tokens_leftover: number;
          average_sucker_tokens_spent: number;
          blowout_losses: number;
          blowout_wins: number;
          comeback_wins: number;
          extra_rolls_used: number;
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
          sucker_hunt_misses: number;
          sucker_hunts: number;
          sucker_punches_received: number;
          sucker_punches_used: number;
          sucker_tokens_leftover: number;
          sucker_tokens_spent: number;
          three_of_a_kind_games: number;
          total_score: number;
          upper_bonus_games: number;
          updated_at: string;
          wins: number;
        };
        Insert: never;
        Update: never;
      };
      computer_stats: {
        Row: {
          average_score: number;
          average_sucker_tokens_leftover: number;
          average_sucker_tokens_spent: number;
          blowout_losses: number;
          blowout_wins: number;
          comeback_wins: number;
          computer_average_score: number;
          computer_four_of_a_kind_games: number;
          computer_full_house_games: number;
          computer_highest_score: number;
          computer_large_straight_games: number;
          computer_small_straight_games: number;
          computer_sucker_games: number;
          computer_three_of_a_kind_games: number;
          computer_total_score: number;
          computer_upper_bonus_games: number;
          extra_rolls_used: number;
          four_of_a_kind_games: number;
          full_house_games: number;
          games_played: number;
          highest_score: number;
          large_straight_games: number;
          losses: number;
          mulligans_used: number;
          profile_id: string;
          small_straight_games: number;
          sucker_games: number;
          sucker_blockers_used: number;
          sucker_punches_used: number;
          sucker_hunt_misses: number;
          sucker_hunts: number;
          sucker_tokens_leftover: number;
          sucker_tokens_spent: number;
          three_of_a_kind_games: number;
          total_score: number;
          updated_at: string;
          upper_bonus_games: number;
          wins: number;
        };
        Insert: {
          average_score?: number;
          average_sucker_tokens_leftover?: number;
          average_sucker_tokens_spent?: number;
          blowout_losses?: number;
          blowout_wins?: number;
          comeback_wins?: number;
          computer_average_score?: number;
          computer_four_of_a_kind_games?: number;
          computer_full_house_games?: number;
          computer_highest_score?: number;
          computer_large_straight_games?: number;
          computer_small_straight_games?: number;
          computer_sucker_games?: number;
          computer_three_of_a_kind_games?: number;
          computer_total_score?: number;
          computer_upper_bonus_games?: number;
          extra_rolls_used?: number;
          four_of_a_kind_games?: number;
          full_house_games?: number;
          games_played?: number;
          highest_score?: number;
          large_straight_games?: number;
          losses?: number;
          mulligans_used?: number;
          profile_id: string;
          small_straight_games?: number;
          sucker_games?: number;
          sucker_blockers_used?: number;
          sucker_punches_used?: number;
          sucker_hunt_misses?: number;
          sucker_hunts?: number;
          sucker_tokens_leftover?: number;
          sucker_tokens_spent?: number;
          three_of_a_kind_games?: number;
          total_score?: number;
          upper_bonus_games?: number;
          wins?: number;
        };
        Update: {
          average_score?: number;
          average_sucker_tokens_leftover?: number;
          average_sucker_tokens_spent?: number;
          blowout_losses?: number;
          blowout_wins?: number;
          comeback_wins?: number;
          computer_average_score?: number;
          computer_four_of_a_kind_games?: number;
          computer_full_house_games?: number;
          computer_highest_score?: number;
          computer_large_straight_games?: number;
          computer_small_straight_games?: number;
          computer_sucker_games?: number;
          computer_three_of_a_kind_games?: number;
          computer_total_score?: number;
          computer_upper_bonus_games?: number;
          extra_rolls_used?: number;
          four_of_a_kind_games?: number;
          full_house_games?: number;
          games_played?: number;
          highest_score?: number;
          large_straight_games?: number;
          losses?: number;
          mulligans_used?: number;
          small_straight_games?: number;
          sucker_games?: number;
          sucker_blockers_used?: number;
          sucker_punches_used?: number;
          sucker_hunt_misses?: number;
          sucker_hunts?: number;
          sucker_tokens_leftover?: number;
          sucker_tokens_spent?: number;
          three_of_a_kind_games?: number;
          total_score?: number;
          upper_bonus_games?: number;
          wins?: number;
        };
      };
      head_to_head_stat_rates: {
        Row: {
          average_score: number;
          average_sucker_tokens_leftover: number;
          average_sucker_tokens_spent: number;
          blowout_losses: number;
          blowout_wins: number;
          comeback_wins: number;
          extra_rolls_used: number;
          forced_rerolls: number;
          four_of_a_kind_pct: number;
          full_house_pct: number;
          games_played: number;
          highest_score: number;
          large_straight_pct: number;
          losses: number;
          mulligans_used: number;
          opponent_id: string;
          player_id: string;
          small_straight_pct: number;
          sucker_blockers_used: number;
          sucker_hunt_misses: number;
          sucker_hunts: number;
          sucker_pct: number;
          sucker_punches_received: number;
          sucker_punches_used: number;
          three_of_a_kind_pct: number;
          upper_bonus_pct: number;
          wins: number;
        };
        Insert: never;
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: {
      record_computer_game_result: {
        Args: {
          computer_scored_four_of_a_kind: boolean;
          computer_scored_full_house: boolean;
          computer_scored_large_straight: boolean;
          computer_scored_small_straight: boolean;
          computer_scored_sucker: boolean;
          computer_scored_three_of_a_kind: boolean;
          computer_score: number;
          computer_upper_bonus_awarded: boolean;
          comeback_wins: number;
          extra_rolls_used: number;
          mulligans_used: number;
          player_score: number;
          scored_four_of_a_kind: boolean;
          scored_full_house: boolean;
          scored_large_straight: boolean;
          scored_small_straight: boolean;
          scored_sucker: boolean;
          scored_three_of_a_kind: boolean;
          sucker_blockers_used: number;
          sucker_hunt_misses: number;
          sucker_hunts: number;
          sucker_punches_used: number;
          sucker_tokens_leftover: number;
          sucker_tokens_spent: number;
          upper_bonus_awarded: boolean;
        };
        Returns: Database['public']['Tables']['computer_stats']['Row'];
      };
    };
    Enums: Record<string, never>;
  };
};
