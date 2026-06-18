-- Align persisted multiplayer defaults with the Sucker! v2 token economy.

alter table public.game_players
  alter column sucker_tokens set default 8;
