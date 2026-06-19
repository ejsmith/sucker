import type { Database as AppDatabase } from "../../../shared/database.types.ts";
import type { GameState } from "./game.ts";

type AppTables = AppDatabase["public"]["Tables"];
type Replace<Base, Patch> = Omit<Base, keyof Patch> & Patch;
type WithRelationships<Table> = Table & { Relationships: [] };
type WithRelationshipsMap<Tables> = {
  [TableName in keyof Tables]: WithRelationships<Tables[TableName]>;
};

type GameTable = Replace<
  WithRelationships<AppTables["games"]>,
  {
    Row: Replace<AppTables["games"]["Row"], { state: GameState }>;
    Insert: Replace<AppTables["games"]["Insert"], { state: GameState }>;
    Update: Replace<AppTables["games"]["Update"], { state?: GameState }>;
  }
>;

type ActionType =
  | "create_game"
  | "create_invite"
  | "accept_invite"
  | "extra_roll"
  | "roll"
  | "score_category"
  | "scratch_category"
  | "pass_response"
  | "mulligan"
  | "sucker_punch"
  | "sucker_blocker"
  | "taunt";

type TurnActionTable = {
  Row: {
    action_type: ActionType;
    actor_id: string;
    created_at: string;
    game_id: string;
    id: string;
    payload: unknown;
    turn_id: string | null;
  };
  Insert: {
    action_type: ActionType;
    actor_id: string;
    game_id: string;
    id?: string;
    payload?: unknown;
    turn_id?: string | null;
  };
  Update: never;
  Relationships: [];
};

type TokenEventType =
  | "earned_sucker"
  | "mulligan"
  | "sucker_punch"
  | "sucker_blocker";

type TokenEventsTable = {
  Row: {
    created_at: string;
    event_type: TokenEventType;
    game_id: string;
    id: string;
    player_id: string;
    target_turn_id: string | null;
    token_delta: number;
  };
  Insert: {
    event_type: TokenEventType;
    game_id: string;
    id?: string;
    player_id: string;
    target_turn_id?: string | null;
    token_delta: number;
  };
  Update: never;
  Relationships: [];
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

type GamePlayerResultsTable = {
  Row: GamePlayerResult;
  Insert: GamePlayerResult;
  Update: never;
  Relationships: [];
};

type HeadToHeadStats = AppTables["head_to_head_stats"]["Row"];

type HeadToHeadStatsTable = {
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

type EdgeTables = Replace<
  WithRelationshipsMap<AppTables>,
  {
    games: GameTable;
    game_player_results: GamePlayerResultsTable;
    head_to_head_stats: HeadToHeadStatsTable;
    token_events: TokenEventsTable;
    turn_actions: TurnActionTable;
  }
>;

export type Database = Replace<
  AppDatabase,
  {
    public: Replace<
      AppDatabase["public"],
      {
        Tables: EdgeTables;
        CompositeTypes: Record<string, never>;
      }
    >;
  }
>;
