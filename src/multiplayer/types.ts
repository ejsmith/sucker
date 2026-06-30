import type { Dice, GameState, ScoreCategory } from '../game';

export type RemoteGameStatus = 'inviting' | 'active' | 'response_window' | 'blocked_response' | 'complete';

export type RemoteGameRow = {
  completed_at: string | null;
  created_at: string;
  created_by: string;
  current_player_id: string | null;
  id: string;
  last_turn_id: string | null;
  state: GameState;
  status: RemoteGameStatus;
  updated_at: string;
  winner_id: string | null;
};

export type RemoteTurnRow = {
  category: ScoreCategory;
  created_at: string;
  dice: Dice;
  finalized_at: string | null;
  game_id: string;
  held: GameState['held'];
  id: string;
  player_id: string;
  roll_count: number;
  score: number;
  status: 'submitted' | 'punched' | 'blocked' | 'mulliganed' | 'finalized';
  turn_index: number;
};

export type MultiplayerAction =
  | {
      type: 'create_game';
      opponentProfileId: string;
    }
  | {
      type: 'create_invite';
    }
  | {
      type: 'accept_invite';
      inviteCode: string;
    }
  | {
      type: 'remove_game';
      gameId: string;
    }
  | {
      type: 'extra_roll';
      gameId: string;
      held?: GameState['held'];
    }
  | {
      type: 'roll';
      gameId: string;
      held?: GameState['held'];
    }
  | {
      type: 'score_category';
      gameId: string;
      category: ScoreCategory;
      held?: GameState['held'];
    }
  | {
      type: 'scratch_category';
      gameId: string;
      category: ScoreCategory;
      held?: GameState['held'];
    }
  | {
      type: 'pass_response';
      gameId: string;
    }
  | {
      type: 'mulligan';
      gameId: string;
    }
  | {
      type: 'sucker_punch';
      gameId: string;
      turnId: string;
    }
  | {
      type: 'sucker_blocker';
      gameId: string;
      turnId: string;
    };

export type MultiplayerActionResult = {
  game: RemoteGameRow;
  dice?: Dice;
  inviteCode?: string;
  notificationProfileIds?: string[];
};

export type ProfileInput = {
  avatarUrl?: string | null;
  displayName: string;
  username?: string | null;
};
