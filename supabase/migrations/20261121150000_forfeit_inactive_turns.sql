-- A player who leaves their turn unfinished for 30 days forfeits. Hiding a game
-- does not stop the clock, so a hidden game can no longer strand the opponent.
-- The forfeit counts like a rage quit in stats (record and rating, never scores
-- or per-game feats) but is recorded separately: no salt, no rage-quit counts.

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
    'rage_quit_reply',
    'turn_timeout'
  )
);

-- When the current player's turn began. Only a turn change resets it.
alter table public.games
add column turn_started_at timestamptz not null default now();

-- Existing turns started when the opponent last acted. Never start one more
-- than 23 days back, so every current turn still gets the 7-day and 1-day
-- warnings before it can forfeit. Skip the timestamp and broadcast triggers:
-- this is not a move, and an in-flight move must not see the game as changed.
alter table public.games disable trigger user;

update public.games game
set turn_started_at = greatest(
  coalesce(
    (
      select max(action.created_at)
      from public.turn_actions action
      where action.game_id = game.id
        and action.actor_id is distinct from game.current_player_id
        and action.action_type not in ('taunt', 'nudge_turn', 'rage_quit_reply')
    ),
    game.created_at
  ),
  now() - interval '23 days'
)
where game.status in ('active', 'response_window', 'blocked_response');

alter table public.games enable trigger user;

-- The inactivity clock starts when the turn passes, or when an invite is
-- accepted. Rolls and other mid-turn actions do not reset it.
create or replace function public.track_turn_start()
returns trigger
language plpgsql
as $$
begin
  if new.current_player_id is distinct from old.current_player_id
    or (old.status = 'inviting' and new.status <> 'inviting') then
    new.turn_started_at = now();
  end if;
  return new;
end;
$$;

create trigger games_track_turn_start
before update on public.games
for each row execute function public.track_turn_start();

create index games_turn_started_idx
on public.games (turn_started_at)
where status in ('active', 'response_window');

-- A forfeit by inactivity: the player let their turn run out. Stats treat it
-- like a rage quit (record and rating only), but it is never public shame.
create table public.timeout_forfeits (
  game_id uuid primary key references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One row per forfeit warning push, so each is sent once per turn. A new turn
-- has a new turn_started_at, so its warnings start over.
create table public.turn_timeout_warnings (
  game_id uuid not null references public.games(id) on delete cascade,
  turn_started_at timestamptz not null,
  days_left integer not null,
  sent_at timestamptz not null default now(),
  primary key (game_id, turn_started_at, days_left)
);

alter table public.timeout_forfeits enable row level security;
alter table public.turn_timeout_warnings enable row level security;
revoke all on public.timeout_forfeits from anon, authenticated;
revoke all on public.turn_timeout_warnings from anon, authenticated;
grant all on public.timeout_forfeits to service_role;
grant all on public.turn_timeout_warnings to service_role;

-- Same transaction as before, plus the timeout record.
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
    if table_name not in ('turns','turn_actions','token_events','game_players','game_player_results','head_to_head_stats','rage_quits','timeout_forfeits','player_feats')
      or operation not in ('insert','update','upsert','increment') then raise exception 'Invalid game move write'; end if;
    if table_name <> 'head_to_head_stats' and
      coalesce(change->'data'->>'game_id',change->'match'->>'game_id','') <> p_game_id::text then
      raise exception 'Move write must belong to the locked game';
    end if;
    if table_name = 'head_to_head_stats' and (
      not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'opponent_id')::uuid)
    ) then raise exception 'Stats write must belong to this game'; end if;
    if table_name = 'player_feats' and (
      operation <> 'insert'
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
    ) then raise exception 'Feat write must belong to a player in this game'; end if;
    if table_name = 'rage_quits' and (
      operation <> 'insert'
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
    ) then raise exception 'Rage quit must belong to a player in this game'; end if;
    if table_name = 'timeout_forfeits' and (
      operation <> 'insert'
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
    ) then raise exception 'Timeout must belong to a player in this game'; end if;
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

-- A timeout, like a rage quit, earns no rating- or timing-based game feats.
-- It never counts toward Table Flipper.
create or replace function public.apply_completed_game_standings(target_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  results public.game_player_results[];
  result public.game_player_results;
  completed timestamptz;
  player_games integer;
  opponent_games integer;
  beaten integer;
  player_lost boolean;
  loss_streak integer;
  win_streak integer;
  losses integer;
  quits integer;
  forfeited boolean;
  first_roll timestamptz;
  rating_gap numeric;
begin
  select array_agg(r order by r.player_id) into results
  from public.game_player_results r
  where r.game_id = target_game_id;

  if coalesce(array_length(results, 1), 0) <> 2 or (results[1]).rating_after is not null then
    return;
  end if;

  completed := greatest((results[1]).completed_at, (results[2]).completed_at);

  -- Creates and locks both standings rows.
  perform public.rate_completed_game(target_game_id);

  forfeited := exists(select 1 from public.rage_quits quit where quit.game_id = target_game_id)
    or exists(select 1 from public.timeout_forfeits timeout where timeout.game_id = target_game_id);
  select min(action.created_at) into first_roll
  from public.turn_actions action
  where action.game_id = target_game_id and action.action_type = 'roll';

  -- Every Sucker face each player has rolled in a finished game, as bits 1 to 6.
  update public.player_standings standing set
    sucker_faces = standing.sucker_faces | faces.rolled
  from (
    select action.actor_id, bit_or(1 << ((action.payload -> 'dice' ->> 0)::integer - 1)) as rolled
    from public.turn_actions action
    where action.game_id = target_game_id
      and action.action_type = 'roll'
      and action.payload -> 'dice' ->> 0 in ('1', '2', '3', '4', '5', '6')
      and action.payload -> 'dice' = jsonb_build_array(
        action.payload -> 'dice' -> 0,
        action.payload -> 'dice' -> 0,
        action.payload -> 'dice' -> 0,
        action.payload -> 'dice' -> 0,
        action.payload -> 'dice' -> 0
      )
    group by action.actor_id
  ) faces
  where standing.player_id = faces.actor_id;

  update public.player_standings set
    current_win_streak = case when (results[1]).won then current_win_streak + 1 else 0 end,
    current_loss_streak = case when (results[2]).won then current_loss_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when (results[1]).won then current_win_streak + 1 else 0 end),
    updated_at = now()
  where player_id = (results[1]).player_id;

  update public.player_standings set
    current_win_streak = case when (results[2]).won then current_win_streak + 1 else 0 end,
    current_loss_streak = case when (results[1]).won then current_loss_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when (results[2]).won then current_win_streak + 1 else 0 end),
    updated_at = now()
  where player_id = (results[2]).player_id;

  foreach result in array results loop
    select count(*) into player_games from public.game_player_results r
    where r.player_id = result.player_id and r.completed_at <= completed;
    select count(*) into opponent_games from public.game_player_results r
    where r.player_id = result.opponent_id and r.completed_at <= completed;
    select count(distinct r.opponent_id) into beaten from public.game_player_results r
    where r.player_id = result.player_id and r.won and r.completed_at <= completed;

    if beaten >= 10 then perform public.award_milestone_feat(result.player_id, 'globetrotter_10', target_game_id, completed); end if;
    if beaten >= 25 then perform public.award_milestone_feat(result.player_id, 'globetrotter_25', target_game_id, completed); end if;
    if beaten >= 100 then perform public.award_milestone_feat(result.player_id, 'globetrotter_100', target_game_id, completed); end if;
    if player_games >= 100 then perform public.award_milestone_feat(result.player_id, 'centurion', target_game_id, completed); end if;
    select standing.current_win_streak into win_streak
    from public.player_standings standing where standing.player_id = result.player_id;
    if win_streak >= 5 then perform public.award_milestone_feat(result.player_id, 'hot_streak', target_game_id, completed); end if;
    if win_streak >= 10 then perform public.award_milestone_feat(result.player_id, 'on_fire', target_game_id, completed); end if;
    if (select standing.sucker_faces = 63 from public.player_standings standing where standing.player_id = result.player_id) then
      perform public.award_milestone_feat(result.player_id, 'sucker_collector', target_game_id, completed);
    end if;
    if opponent_games = 1 and player_games >= 6 then
      perform public.award_milestone_feat(result.player_id, 'welcome_wagon', target_game_id, completed);
    end if;
    if (
      select count(*) from public.game_player_results r
      where r.player_id = result.player_id and r.opponent_id = result.opponent_id and r.completed_at <= completed
    ) >= 10 then
      perform public.award_milestone_feat(result.player_id, 'nemesis', target_game_id, completed);
    end if;
    if result.won and (
      select count(*) = 5 and bool_and(recent.won)
      from (
        select r.won
        from public.game_player_results r
        where r.player_id = result.player_id and r.opponent_id = result.opponent_id and r.completed_at <= completed
        order by r.completed_at desc, r.game_id desc
        limit 5
      ) recent
    ) then
      perform public.award_milestone_feat(result.player_id, 'got_your_number', target_game_id, completed);
    end if;

    -- Defeats: a loss means the opponent won; ties are neither.
    player_lost := case when result.player_id = (results[1]).player_id then (results[2]).won else (results[1]).won end;

    -- Per-game feats that need ratings or timing. A forfeit awards none.
    -- Rating gaps use the shown ratings before the game, once both players
    -- have 5 earlier games, so new players' settling ratings never count.
    if not forfeited then
      if player_games >= 6 and opponent_games >= 6 then
        select opponent.rating_before - own.rating_before into rating_gap
        from public.game_player_results own
        join public.game_player_results opponent
          on opponent.game_id = own.game_id and opponent.player_id = own.opponent_id
        where own.game_id = target_game_id and own.player_id = result.player_id;
        if result.won and rating_gap >= 200 then
          insert into public.player_feats (game_id, player_id, feat_key, earned_at)
          values (target_game_id, result.player_id, 'giant_killer', completed)
          on conflict do nothing;
        end if;
        if player_lost and rating_gap <= -200 then
          insert into public.player_feats (game_id, player_id, feat_key, earned_at)
          values (target_game_id, result.player_id, 'banana_peel', completed)
          on conflict do nothing;
        end if;
      end if;
      if completed - first_roll <= interval '1 hour' then
        insert into public.player_feats (game_id, player_id, feat_key, earned_at)
        values (target_game_id, result.player_id, 'blitz', completed)
        on conflict do nothing;
      end if;
      if completed - first_roll >= interval '30 days' then
        insert into public.player_feats (game_id, player_id, feat_key, earned_at)
        values (target_game_id, result.player_id, 'the_long_game', completed)
        on conflict do nothing;
      end if;
    end if;
    select standing.current_loss_streak into loss_streak
    from public.player_standings standing where standing.player_id = result.player_id;
    if loss_streak >= 5 then perform public.award_milestone_feat(result.player_id, 'ice_cold', target_game_id, completed); end if;
    if loss_streak >= 10 then perform public.award_milestone_feat(result.player_id, 'deep_freeze', target_game_id, completed); end if;

    if player_lost then
      if (
        select count(*) = 5 and bool_and(recent.lost)
        from (
          select (not r.won and g.winner_id = r.opponent_id) as lost
          from public.game_player_results r
          join public.games g on g.id = r.game_id
          where r.player_id = result.player_id and r.opponent_id = result.opponent_id and r.completed_at <= completed
          order by r.completed_at desc, r.game_id desc
          limit 5
        ) recent
      ) then
        perform public.award_milestone_feat(result.player_id, 'pigeon', target_game_id, completed);
      end if;
      if opponent_games = 1 and player_games >= 6 then
        perform public.award_milestone_feat(result.player_id, 'welcome_mat', target_game_id, completed);
      end if;
      select count(*) into losses
      from public.game_player_results r
      join public.games g on g.id = r.game_id
      where r.player_id = result.player_id and not r.won and g.winner_id = r.opponent_id and r.completed_at <= completed;
      if losses >= 100 then
        perform public.award_milestone_feat(result.player_id, 'glutton_for_punishment', target_game_id, completed);
      end if;
    end if;

    select count(*) into quits
    from public.rage_quits quit
    join public.game_player_results r on r.game_id = quit.game_id and r.player_id = quit.player_id
    where quit.player_id = result.player_id and r.completed_at <= completed;
    if quits >= 5 then perform public.award_milestone_feat(result.player_id, 'table_flipper', target_game_id, completed); end if;
  end loop;
end;
$$;

-- Timeouts' partial scores stay off score and punch-rate boards.
create or replace function public.ranked_leaderboard(board text)
returns table (
  rank integer,
  player_id uuid,
  display_name text,
  username text,
  avatar_url text,
  value numeric,
  sample_size integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
declare
  week_start timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
begin
  if board not in ('rating', 'weekly_high_score', 'all_time_high_score', 'sharpshooter', 'win_streak') then
    raise exception 'Unknown leaderboard.' using errcode = '22023';
  end if;

  return query
  -- Forfeits count toward ratings and streaks only, never scores or punch rates.
  with entries as (
    select
      standing.player_id,
      public.conservative_rating(standing.rating, standing.rating_deviation, standing.rated_at, now()) as value,
      standing.rated_games as sample_size
    from public.player_standings standing
    where board = 'rating' and standing.rated_games >= 5
    union all
    select r.player_id, max(r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'weekly_high_score' and r.completed_at >= week_start
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
      and not exists (select 1 from public.timeout_forfeits timeout where timeout.game_id = r.game_id)
    group by r.player_id
    union all
    select r.player_id, max(r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'all_time_high_score'
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
      and not exists (select 1 from public.timeout_forfeits timeout where timeout.game_id = r.game_id)
    group by r.player_id
    union all
    select r.player_id,
      round(100.0 * sum(r.sucker_punches_landed) / sum(r.sucker_punches_used), 1),
      sum(r.sucker_punches_used)::integer
    from public.game_player_results r
    where board = 'sharpshooter'
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
      and not exists (select 1 from public.timeout_forfeits timeout where timeout.game_id = r.game_id)
    group by r.player_id
    having sum(r.sucker_punches_used) >= 10
    union all
    select standing.player_id, standing.best_win_streak::numeric, standing.rated_games
    from public.player_standings standing
    where board = 'win_streak' and standing.best_win_streak >= 3
  )
  select
    (rank() over (order by entry.value desc))::integer,
    entry.player_id,
    profile.display_name,
    profile.username,
    profile.avatar_url,
    entry.value,
    entry.sample_size
  from entries entry
  join public.profiles profile on profile.id = entry.player_id
  where profile.show_on_leaderboards;
end;
$$;

-- Game history says who ran out of time, separately from who rage quit.
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
  rage_quitter_id uuid,
  timed_out_player_id uuid
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
    rage_quit.player_id,
    timeout.player_id
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
  left join public.timeout_forfeits timeout on timeout.game_id = game.id
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

-- Claims the most urgent forfeit warning now due on each unfinished turn,
-- unless it or a more urgent one was already sent this turn. game-action passes
-- the shared timeout constants. Overlapping sweeps cannot both claim one.
create or replace function public.claim_turn_timeout_warnings(
  p_timeout_days integer,
  p_warning_days integer[],
  p_limit integer default 100
)
returns table (game_id uuid, player_id uuid, days_left integer)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select
      game.id,
      game.current_player_id,
      game.turn_started_at,
      (
        select min(warning.days)
        from unnest(p_warning_days) warning(days)
        where game.turn_started_at <= now() - make_interval(days => p_timeout_days - warning.days)
      ) as days_left
    from public.games game
    where game.status in ('active', 'response_window')
      and game.current_player_id is not null
      and game.turn_started_at > now() - make_interval(days => p_timeout_days)
      and game.turn_started_at <= now() - make_interval(
        days => p_timeout_days - (select max(warning.days) from unnest(p_warning_days) warning(days))
      )
  ),
  claimed as (
    insert into public.turn_timeout_warnings (game_id, turn_started_at, days_left)
    select due.id, due.turn_started_at, due.days_left
    from due
    where due.days_left is not null
      and not exists (
        select 1
        from public.turn_timeout_warnings sent
        where sent.game_id = due.id
          and sent.turn_started_at = due.turn_started_at
          and sent.days_left <= due.days_left
      )
    order by due.turn_started_at
    limit greatest(coalesce(p_limit, 100), 1)
    on conflict do nothing
    returning turn_timeout_warnings.game_id, turn_timeout_warnings.days_left
  )
  select claimed.game_id, due.current_player_id, claimed.days_left
  from claimed
  join due on due.id = claimed.game_id;
$$;

revoke all on function public.claim_turn_timeout_warnings(integer, integer[], integer) from public, anon, authenticated;
grant execute on function public.claim_turn_timeout_warnings(integer, integer[], integer) to service_role;

-- Every hour, ask game-action to send due warnings and forfeit expired turns:
-- stats, ratings, and pushes live in the Edge Function, so the database only
-- schedules it. Vault holds the project URL, a key the Functions gateway
-- accepts (anon_key), and the sweep secret game-action checks. Without all
-- three the job is a no-op.
create extension if not exists pg_net with schema extensions;

create or replace function public.request_inactive_game_sweep()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  gateway_key text;
  sweep_secret text;
begin
  select secret.decrypted_secret into project_url from vault.decrypted_secrets secret where secret.name = 'project_url';
  select secret.decrypted_secret into gateway_key from vault.decrypted_secrets secret where secret.name = 'anon_key';
  select secret.decrypted_secret into sweep_secret
  from vault.decrypted_secrets secret where secret.name = 'inactivity_sweep_secret';
  if project_url is null or gateway_key is null or sweep_secret is null then
    return null;
  end if;

  return net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/game-action',
    body := jsonb_build_object('type', 'expire_inactive_games'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || gateway_key,
      'apikey', gateway_key,
      'x-inactivity-sweep-secret', sweep_secret
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.request_inactive_game_sweep() from public, anon, authenticated;
grant execute on function public.request_inactive_game_sweep() to service_role;

select cron.schedule(
  'expire-inactive-games',
  '43 * * * *',
  $$select public.request_inactive_game_sweep()$$
);
