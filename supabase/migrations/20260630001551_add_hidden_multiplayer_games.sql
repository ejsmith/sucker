alter table public.game_players
add column if not exists hidden_at timestamptz;

create index if not exists game_players_visible_player_idx
on public.game_players(player_id, game_id)
where hidden_at is null;

create or replace function public.is_game_participant(target_game_id uuid, target_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.game_players
    where game_id = target_game_id
      and player_id = target_profile_id
      and hidden_at is null
  );
$$;
