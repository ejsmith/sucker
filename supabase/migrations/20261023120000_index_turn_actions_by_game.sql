-- Turn history, Punch, taunt, and stats reads all filter one game's actions by
-- type and order them by time. Without this they scan every game's actions.
create index if not exists turn_actions_game_type_created_idx
on public.turn_actions (game_id, action_type, created_at);
