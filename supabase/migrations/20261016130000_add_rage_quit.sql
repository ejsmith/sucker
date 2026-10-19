-- Rage Quit: a player may flip the table and forfeit any unfinished game. The
-- opponent wins, the win/loss counts, and the quitter is publicly marked for a
-- day. Forfeited games never feed score averages, highs, or category rates.

alter table public.turn_actions
drop constraint turn_actions_action_type_check;

alter table public.turn_actions
add constraint turn_actions_action_type_check check (
  action_type in (
    'create_game',
    'create_invite',
    'accept_invite',
    'rematch_game',
    'nudge_turn',
    'extra_roll',
    'roll',
    'score_category',
    'scratch_category',
    'pass_response',
    'mulligan',
    'sucker_punch',
    'sucker_blocker',
    'taunt',
    'rage_quit',
    'rage_quit_reply'
  )
);

-- rage_quits counts this player's quits against the opponent. rage_quit_games
-- counts every forfeited game in the matchup, so rates can exclude them.
alter table public.head_to_head_stats
add column rage_quits integer not null default 0,
add column rage_quit_games integer not null default 0;

-- Public, server-written shame. Any signed-in player can see who quit and when.
create table public.rage_quits (
  game_id uuid primary key references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index rage_quits_player_created_idx
on public.rage_quits (player_id, created_at desc);

alter table public.rage_quits enable row level security;

-- Only the last day matters for the badge. Counts live in stats, and game
-- history reads this table through a security-definer function.
create policy "Recent rage quits are public to signed-in players"
on public.rage_quits for select
to authenticated
using (created_at > now() - interval '24 hours');

revoke all on public.rage_quits from anon, authenticated;
grant select on public.rage_quits to authenticated;
grant all on public.rage_quits to service_role;

create or replace view public.head_to_head_stat_rates
with (security_invoker = true) as
select
  player_id,
  opponent_id,
  games_played,
  wins,
  losses,
  highest_score,
  average_score,
  blowout_wins,
  blowout_losses,
  comeback_wins,
  extra_rolls_used,
  sucker_hunts,
  sucker_hunt_misses,
  sucker_punches_received,
  sucker_punches_used,
  sucker_blockers_used,
  mulligans_used,
  forced_rerolls,
  average_sucker_tokens_spent,
  average_sucker_tokens_leftover,
  case when games_played - rage_quit_games <= 0 then 0 else round(upper_bonus_games::numeric / (games_played - rage_quit_games) * 100, 2) end as upper_bonus_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(sucker_games::numeric / (games_played - rage_quit_games) * 100, 2) end as sucker_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(three_of_a_kind_games::numeric / (games_played - rage_quit_games) * 100, 2) end as three_of_a_kind_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(four_of_a_kind_games::numeric / (games_played - rage_quit_games) * 100, 2) end as four_of_a_kind_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(full_house_games::numeric / (games_played - rage_quit_games) * 100, 2) end as full_house_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(small_straight_games::numeric / (games_played - rage_quit_games) * 100, 2) end as small_straight_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(large_straight_games::numeric / (games_played - rage_quit_games) * 100, 2) end as large_straight_pct,
  buzzer_beater_wins,
  case when sucker_punches_used = 0 then 0 else round(sucker_punches_landed::numeric / sucker_punches_used * 100, 2) end as sucker_punch_landed_pct,
  rage_quits,
  rage_quit_games
from public.head_to_head_stats;

revoke all on public.head_to_head_stat_rates from anon, authenticated;
grant select on public.head_to_head_stat_rates to authenticated;

drop function public.get_profile_stat_rates(uuid);

create function public.get_profile_stat_rates(target_profile_id uuid)
returns table (
  games_played integer,
  wins integer,
  losses integer,
  highest_score integer,
  average_score numeric,
  blowout_wins integer,
  blowout_losses integer,
  comeback_wins integer,
  extra_rolls_used integer,
  sucker_hunts integer,
  sucker_hunt_misses integer,
  sucker_punches_received integer,
  sucker_punches_used integer,
  sucker_blockers_used integer,
  mulligans_used integer,
  forced_rerolls integer,
  average_sucker_tokens_spent numeric,
  average_sucker_tokens_leftover numeric,
  upper_bonus_pct numeric,
  sucker_pct numeric,
  three_of_a_kind_pct numeric,
  four_of_a_kind_pct numeric,
  full_house_pct numeric,
  small_straight_pct numeric,
  large_straight_pct numeric,
  buzzer_beater_wins integer,
  sucker_punch_landed_pct numeric,
  rage_quits integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view stats.' using errcode = '42501';
  end if;

  return query
  with totals as (
    select
      coalesce(sum(stats.games_played), 0)::integer as games_played,
      coalesce(sum(stats.games_played - stats.rage_quit_games), 0)::numeric as scored_games,
      coalesce(sum(stats.wins), 0)::integer as wins,
      coalesce(sum(stats.losses), 0)::integer as losses,
      coalesce(max(stats.highest_score), 0)::integer as highest_score,
      coalesce(sum(stats.total_score), 0)::numeric as total_score,
      coalesce(sum(stats.blowout_wins), 0)::integer as blowout_wins,
      coalesce(sum(stats.blowout_losses), 0)::integer as blowout_losses,
      coalesce(sum(stats.comeback_wins), 0)::integer as comeback_wins,
      coalesce(sum(stats.extra_rolls_used), 0)::integer as extra_rolls_used,
      coalesce(sum(stats.sucker_hunts), 0)::integer as sucker_hunts,
      coalesce(sum(stats.sucker_hunt_misses), 0)::integer as sucker_hunt_misses,
      coalesce(sum(stats.sucker_punches_received), 0)::integer as sucker_punches_received,
      coalesce(sum(stats.sucker_punches_used), 0)::integer as sucker_punches_used,
      coalesce(sum(stats.sucker_punches_landed), 0)::integer as sucker_punches_landed,
      coalesce(sum(stats.sucker_blockers_used), 0)::integer as sucker_blockers_used,
      coalesce(sum(stats.mulligans_used), 0)::integer as mulligans_used,
      coalesce(sum(stats.forced_rerolls), 0)::integer as forced_rerolls,
      coalesce(sum(stats.sucker_tokens_spent), 0)::numeric as sucker_tokens_spent,
      coalesce(sum(stats.sucker_tokens_leftover), 0)::numeric as sucker_tokens_leftover,
      coalesce(sum(stats.upper_bonus_games), 0)::numeric as upper_bonus_games,
      coalesce(sum(stats.sucker_games), 0)::numeric as sucker_games,
      coalesce(sum(stats.three_of_a_kind_games), 0)::numeric as three_of_a_kind_games,
      coalesce(sum(stats.four_of_a_kind_games), 0)::numeric as four_of_a_kind_games,
      coalesce(sum(stats.full_house_games), 0)::numeric as full_house_games,
      coalesce(sum(stats.small_straight_games), 0)::numeric as small_straight_games,
      coalesce(sum(stats.large_straight_games), 0)::numeric as large_straight_games,
      coalesce(sum(stats.buzzer_beater_wins), 0)::integer as buzzer_beater_wins,
      coalesce(sum(stats.rage_quits), 0)::integer as rage_quits
    from public.head_to_head_stats stats
    where stats.player_id = target_profile_id
  )
  select
    totals.games_played,
    totals.wins,
    totals.losses,
    totals.highest_score,
    coalesce(round(totals.total_score / nullif(totals.scored_games, 0), 2), 0),
    totals.blowout_wins,
    totals.blowout_losses,
    totals.comeback_wins,
    totals.extra_rolls_used,
    totals.sucker_hunts,
    totals.sucker_hunt_misses,
    totals.sucker_punches_received,
    totals.sucker_punches_used,
    totals.sucker_blockers_used,
    totals.mulligans_used,
    totals.forced_rerolls,
    coalesce(round(totals.sucker_tokens_spent / nullif(totals.scored_games, 0), 2), 0),
    coalesce(round(totals.sucker_tokens_leftover / nullif(totals.scored_games, 0), 2), 0),
    coalesce(round(totals.upper_bonus_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.sucker_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.three_of_a_kind_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.four_of_a_kind_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.full_house_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.small_straight_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.large_straight_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    totals.buzzer_beater_wins,
    case
      when totals.sucker_punches_used = 0 then 0
      else round(totals.sucker_punches_landed::numeric / totals.sucker_punches_used * 100, 2)
    end,
    totals.rage_quits
  from totals
  where totals.games_played > 0;
end;
$$;

revoke all on function public.get_profile_stat_rates(uuid) from public;
grant execute on function public.get_profile_stat_rates(uuid) to authenticated;

drop function public.get_profile_recent_games(uuid, integer);

create function public.get_profile_recent_games(target_profile_id uuid, game_limit integer default 25)
returns table (
  game_id uuid,
  completed_at timestamptz,
  player_id uuid,
  player_name text,
  player_avatar_url text,
  player_score integer,
  player_scorecard jsonb,
  player_sucker_tokens integer,
  player_sucker_tokens_spent integer,
  opponent_id uuid,
  opponent_name text,
  opponent_avatar_url text,
  opponent_score integer,
  opponent_scorecard jsonb,
  opponent_sucker_tokens integer,
  opponent_sucker_tokens_spent integer,
  winner_id uuid,
  rage_quitter_id uuid
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view completed games.' using errcode = '42501';
  end if;

  return query
  select
    game.id,
    coalesce(game.completed_at, game.updated_at),
    selected_player.player_id,
    selected_profile.display_name,
    selected_profile.avatar_url,
    selected_result.final_score,
    coalesce(selected_state.value -> 'scorecard', '{}'::jsonb),
    selected_result.sucker_tokens_leftover,
    selected_result.sucker_tokens_spent,
    opponent_player.player_id,
    opponent_profile.display_name,
    opponent_profile.avatar_url,
    opponent_result.final_score,
    coalesce(opponent_state.value -> 'scorecard', '{}'::jsonb),
    opponent_result.sucker_tokens_leftover,
    opponent_result.sucker_tokens_spent,
    game.winner_id,
    rage_quit.player_id
  from public.games game
  join public.game_players selected_player
    on selected_player.game_id = game.id
    and selected_player.player_id = target_profile_id
    and selected_player.hidden_at is null
  join public.game_players opponent_player
    on opponent_player.game_id = game.id
    and opponent_player.player_id <> target_profile_id
  join public.game_player_results selected_result
    on selected_result.game_id = game.id
    and selected_result.player_id = selected_player.player_id
  join public.game_player_results opponent_result
    on opponent_result.game_id = game.id
    and opponent_result.player_id = opponent_player.player_id
  join public.profiles selected_profile on selected_profile.id = selected_player.player_id
  join public.profiles opponent_profile on opponent_profile.id = opponent_player.player_id
  left join public.rage_quits rage_quit on rage_quit.game_id = game.id
  cross join lateral (
    select player.value
    from jsonb_array_elements(game.state -> 'players') player(value)
    where player.value ->> 'id' = selected_player.player_id::text
    limit 1
  ) selected_state
  cross join lateral (
    select player.value
    from jsonb_array_elements(game.state -> 'players') player(value)
    where player.value ->> 'id' = opponent_player.player_id::text
    limit 1
  ) opponent_state
  where game.status = 'complete'
  order by coalesce(game.completed_at, game.updated_at) desc
  limit least(greatest(coalesce(game_limit, 25), 1), 25);
end;
$$;

revoke all on function public.get_profile_recent_games(uuid, integer) from public;
grant execute on function public.get_profile_recent_games(uuid, integer) to authenticated;

-- Same transaction as before, plus the public rage-quit record. Score averages
-- divide by played-out games only, so a forfeit's partial score never counts.
create or replace function public.commit_game_move(
  p_actor_id uuid,
  p_request_id uuid,
  p_game_id uuid,
  p_expected_updated_at timestamptz,
  p_game_patch jsonb,
  p_writes jsonb,
  p_result jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_game public.games;
  next_game public.games;
  action_request public.game_action_requests;
  change jsonb;
  table_name text;
  operation text;
  fields text;
  assignments text;
  predicates text;
  conflict_fields text;
  move_response jsonb;
  affected_rows integer;
begin
  select * into strict action_request from public.game_action_requests
    where actor_id = p_actor_id and request_id = p_request_id for update;
  if action_request.status = 'completed' then return action_request.response; end if;
  if action_request.status <> 'processing' then raise exception 'Action is not processing'; end if;
  if action_request.game_id is distinct from p_game_id then raise exception 'Action belongs to a different game'; end if;

  select * into strict current_game from public.games where id = p_game_id for update;
  if not exists(select 1 from public.game_players where game_id=p_game_id and player_id=p_actor_id) then
    raise exception 'Player is not in this game';
  end if;
  if current_game.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='PT409', message='The game changed on another device. Refresh and try again.';
  end if;
  if exists(select 1 from jsonb_object_keys(p_game_patch) key where key not in
    ('state','status','current_player_id','last_turn_id','completed_at','winner_id')) then
    raise exception 'Invalid game move fields';
  end if;

  -- Finalizing separate games can touch the same two matchup rows in opposite
  -- seat order. Serialize that pair before taking either aggregate row lock.
  if exists(select 1 from jsonb_array_elements(p_writes) item where item->>'table'='head_to_head_stats') then
    perform pg_advisory_xact_lock(hashtextextended(
      (select string_agg(player_id::text,',' order by player_id) from public.game_players where game_id=p_game_id),
      6601
    ));
  end if;

  for change in select value from jsonb_array_elements(p_writes) loop
    table_name := change->>'table';
    operation := change->>'operation';
    if table_name not in ('turns','turn_actions','token_events','game_players','game_player_results','head_to_head_stats','rage_quits')
      or operation not in ('insert','update','upsert','increment') then raise exception 'Invalid game move write'; end if;
    if table_name <> 'head_to_head_stats' and
      coalesce(change->'data'->>'game_id',change->'match'->>'game_id','') <> p_game_id::text then
      raise exception 'Move write must belong to the locked game';
    end if;
    if table_name = 'head_to_head_stats' and (
      not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'opponent_id')::uuid)
    ) then raise exception 'Stats write must belong to this game'; end if;
    if table_name = 'rage_quits' and (
      operation <> 'insert'
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
    ) then raise exception 'Rage quit must belong to a player in this game'; end if;
    select string_agg(format('%I',key),',') into fields from jsonb_object_keys(change->'data') key;
    if fields is null then raise exception 'Empty game move write'; end if;

    if operation='increment' or (table_name='head_to_head_stats' and operation='insert') then
      if table_name <> 'head_to_head_stats' then raise exception 'Invalid move increment'; end if;
      -- Per-game deltas, never pre-read aggregate totals. Supporting insert here
      -- also makes two older first-matchup plans safe during the rollout.
      select string_agg(case
        when key in ('player_id','opponent_id') then null
        when key='highest_score' then 'highest_score = greatest(target.highest_score,excluded.highest_score)'
        when key='average_score' then 'average_score = coalesce(round((target.total_score + excluded.total_score)::numeric / nullif(target.games_played - target.rage_quit_games + excluded.games_played - excluded.rage_quit_games,0),2),0)'
        when key='average_sucker_tokens_spent' then 'average_sucker_tokens_spent = coalesce(round((target.sucker_tokens_spent + excluded.sucker_tokens_spent)::numeric / nullif(target.games_played - target.rage_quit_games + excluded.games_played - excluded.rage_quit_games,0),2),0)'
        when key='average_sucker_tokens_leftover' then 'average_sucker_tokens_leftover = coalesce(round((target.sucker_tokens_leftover + excluded.sucker_tokens_leftover)::numeric / nullif(target.games_played - target.rage_quit_games + excluded.games_played - excluded.rage_quit_games,0),2),0)'
        else format('%1$I = target.%1$I + excluded.%1$I',key)
      end,',') into assignments from jsonb_object_keys(change->'data') key;
      execute format('insert into public.head_to_head_stats as target (%1$s)
        select %1$s from jsonb_populate_record(null::public.head_to_head_stats,$1)
        on conflict (player_id,opponent_id) do update set %2$s',fields,assignments) using change->'data';
    elsif operation='update' then
      if table_name not in ('turns','game_players','head_to_head_stats') then raise exception 'Invalid move update'; end if;
      select string_agg(format('%I = source.%I',key,key),',') into assignments from jsonb_object_keys(change->'data') key;
      select string_agg(format('target.%I is not distinct from filter.%I',key,key),' and ')
        into predicates from jsonb_object_keys(change->'match') key;
      if predicates is null then raise exception 'Move update requires a match'; end if;
      execute format('update public.%1$I target set %2$s from jsonb_populate_record(null::public.%1$I,$1) source,
        jsonb_populate_record(null::public.%1$I,$2) filter where %3$s',table_name,assignments,predicates)
        using change->'data',change->'match';
      get diagnostics affected_rows = row_count;
      if affected_rows <> 1 then raise exception 'Move update target is missing or ambiguous'; end if;
    elsif operation='insert' then
      execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1)',table_name,fields)
        using change->'data';
    else
      if table_name='game_player_results' then conflict_fields := 'game_id,player_id';
      elsif table_name='head_to_head_stats' then conflict_fields := 'player_id,opponent_id';
      else raise exception 'Invalid move upsert'; end if;
      select string_agg(format('%I = excluded.%I',key,key),',') into assignments from jsonb_object_keys(change->'data') key;
      execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1)
        on conflict (%3$s) do update set %4$s',table_name,fields,conflict_fields,assignments) using change->'data';
    end if;
  end loop;

  next_game := jsonb_populate_record(current_game,p_game_patch);
  update public.games set state=next_game.state,status=next_game.status,current_player_id=next_game.current_player_id,
    last_turn_id=next_game.last_turn_id,completed_at=next_game.completed_at,winner_id=next_game.winner_id
    where id=p_game_id returning * into next_game;
  move_response := jsonb_set(p_result,'{game}',to_jsonb(next_game));
  update public.game_action_requests set status='completed',http_status=200,response=move_response
    where actor_id=p_actor_id and request_id=p_request_id;
  return move_response;
end;
$$;
revoke all on function public.commit_game_move(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_game_move(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb) to service_role;
