-- Community leaderboards and feats. See docs/community-leaderboards.md.
-- Only server-authoritative multiplayer results (game_player_results) count.

alter table public.profiles
  add column show_on_leaderboards boolean not null default true;

alter table public.game_player_results
  add column rating_before numeric(7, 2),
  add column rating_after numeric(7, 2);

create index game_player_results_completed_at_idx
on public.game_player_results (completed_at desc);

create index game_player_results_pair_completed_idx
on public.game_player_results (player_id, opponent_id, completed_at desc);

create table public.player_standings (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  rating numeric(7, 2) not null default 1200,
  rated_games integer not null default 0,
  peak_rating numeric(7, 2) not null default 1200,
  current_win_streak integer not null default 0,
  best_win_streak integer not null default 0,
  updated_at timestamptz not null default now()
);

create index player_standings_rating_idx on public.player_standings (rating desc);

alter table public.player_standings enable row level security;
grant all on public.player_standings to service_role;

-- One row per feat occurrence. Feat keys are cataloged in shared/feats.ts.
create table public.player_feats (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  feat_key text not null check (feat_key ~ '^[a-z0-9_]{1,40}$'),
  earned_at timestamptz not null default now(),
  primary key (game_id, player_id, feat_key)
);

create index player_feats_player_idx on public.player_feats (player_id, feat_key);
create index player_feats_key_idx on public.player_feats (feat_key, player_id);

alter table public.player_feats enable row level security;
grant all on public.player_feats to service_role;

-- Allow per-game feat inserts in the atomic completion write plan.
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
    if table_name not in ('turns','turn_actions','token_events','game_players','game_player_results','head_to_head_stats','rage_quits','player_feats')
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

-- Milestones are awarded once, as of the completing game, so a replay of
-- history awards them on the same game they were first reached.
create function public.award_milestone_feat(
  target_player_id uuid,
  target_feat_key text,
  target_game_id uuid,
  earned timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.player_feats (game_id, player_id, feat_key, earned_at)
  select target_game_id, target_player_id, target_feat_key, earned
  where not exists (
    select 1 from public.player_feats feat
    where feat.player_id = target_player_id and feat.feat_key = target_feat_key
  );
$$;

revoke all on function public.award_milestone_feat(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.award_milestone_feat(uuid, text, uuid, timestamptz) to service_role;

-- Elo with provisional K and repeat-opponent damping, plus streaks and
-- milestone feats. Idempotent: a game whose results already carry ratings is skipped.
create function public.apply_completed_game_standings(target_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  results public.game_player_results[];
  result public.game_player_results;
  standing_a public.player_standings;
  standing_b public.player_standings;
  completed timestamptz;
  pair_games integer;
  damping numeric;
  score_a numeric;
  expected_a numeric;
  next_a numeric;
  next_b numeric;
  player_games integer;
  opponent_games integer;
  beaten integer;
begin
  select array_agg(r order by r.player_id) into results
  from public.game_player_results r
  where r.game_id = target_game_id;

  if coalesce(array_length(results, 1), 0) <> 2 or (results[1]).rating_after is not null then
    return;
  end if;

  completed := greatest((results[1]).completed_at, (results[2]).completed_at);

  insert into public.player_standings (player_id)
  values ((results[1]).player_id), ((results[2]).player_id)
  on conflict (player_id) do nothing;

  -- Lock in a global order so concurrent completions sharing a player cannot deadlock.
  perform 1 from public.player_standings standing
  where standing.player_id in ((results[1]).player_id, (results[2]).player_id)
  order by standing.player_id
  for update;

  select * into strict standing_a from public.player_standings where player_id = (results[1]).player_id;
  select * into strict standing_b from public.player_standings where player_id = (results[2]).player_id;

  select count(*) into pair_games
  from public.game_player_results r
  where r.player_id = (results[1]).player_id
    and r.opponent_id = (results[2]).player_id
    and r.completed_at > completed - interval '7 days'
    and r.completed_at <= completed;
  damping := case when pair_games <= 3 then 1 else 0.25 end;

  score_a := case when (results[1]).won then 1 when (results[2]).won then 0 else 0.5 end;
  expected_a := 1 / (1 + power(10::numeric, (standing_b.rating - standing_a.rating) / 400));
  next_a := round(
    standing_a.rating
      + (case when standing_a.rated_games < 10 then 40 else 24 end) * damping * (score_a - expected_a),
    2
  );
  next_b := round(
    standing_b.rating
      + (case when standing_b.rated_games < 10 then 40 else 24 end) * damping * ((1 - score_a) - (1 - expected_a)),
    2
  );

  update public.player_standings set
    rating = next_a,
    rated_games = rated_games + 1,
    peak_rating = greatest(peak_rating, next_a),
    current_win_streak = case when (results[1]).won then current_win_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when (results[1]).won then current_win_streak + 1 else 0 end),
    updated_at = now()
  where player_id = (results[1]).player_id;

  update public.player_standings set
    rating = next_b,
    rated_games = rated_games + 1,
    peak_rating = greatest(peak_rating, next_b),
    current_win_streak = case when (results[2]).won then current_win_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when (results[2]).won then current_win_streak + 1 else 0 end),
    updated_at = now()
  where player_id = (results[2]).player_id;

  update public.game_player_results set rating_before = standing_a.rating, rating_after = next_a
  where game_id = target_game_id and player_id = (results[1]).player_id;
  update public.game_player_results set rating_before = standing_b.rating, rating_after = next_b
  where game_id = target_game_id and player_id = (results[2]).player_id;

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
    if opponent_games = 1 and player_games >= 6 then
      perform public.award_milestone_feat(result.player_id, 'welcome_wagon', target_game_id, completed);
    end if;
    if (
      select count(*) from public.game_player_results r
      where r.player_id = result.player_id and r.opponent_id = result.opponent_id and r.completed_at <= completed
    ) >= 10 then
      perform public.award_milestone_feat(result.player_id, 'nemesis', target_game_id, completed);
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_completed_game_standings(uuid) from public, anon, authenticated;
grant execute on function public.apply_completed_game_standings(uuid) to service_role;

-- commit_game_move writes game_player_results before it marks the game
-- complete, so the results are visible here in the same transaction.
create function public.apply_standings_on_game_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.apply_completed_game_standings(new.id);
  return new;
end;
$$;

revoke all on function public.apply_standings_on_game_complete() from public, anon, authenticated;

create trigger games_apply_standings_on_complete
after update of status on public.games
for each row
when (new.status = 'complete' and old.status is distinct from 'complete')
execute function public.apply_standings_on_game_complete();

-- Replay existing history once, oldest first.
do $$
declare
  completed_game record;
begin
  for completed_game in
    select r.game_id
    from public.game_player_results r
    group by r.game_id
    having count(*) = 2
    order by max(r.completed_at), r.game_id
  loop
    perform public.apply_completed_game_standings(completed_game.game_id);
  end loop;
end;
$$;

create function public.get_leaderboard(board text, max_rows integer default 25)
returns table (
  rank integer,
  player_id uuid,
  display_name text,
  username text,
  avatar_url text,
  value numeric,
  sample_size integer,
  is_me boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
declare
  viewer uuid := auth.uid();
  row_limit integer := least(greatest(coalesce(max_rows, 25), 1), 100);
  week_start timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
begin
  if viewer is null then
    raise exception 'You must be signed in to view leaderboards.' using errcode = '42501';
  end if;
  if board not in ('rating', 'weekly_high_score', 'all_time_high_score', 'sharpshooter', 'win_streak') then
    raise exception 'Unknown leaderboard.' using errcode = '22023';
  end if;

  return query
  -- Forfeits count toward ratings and streaks only, never scores or punch rates.
  with entries as (
    select standing.player_id, standing.rating as value, standing.rated_games as sample_size
    from public.player_standings standing
    where board = 'rating' and standing.rated_games >= 5
    union all
    select r.player_id, max(r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'weekly_high_score' and r.completed_at >= week_start
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
    group by r.player_id
    union all
    select r.player_id, max(r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'all_time_high_score'
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
    group by r.player_id
    union all
    select r.player_id,
      round(100.0 * sum(r.sucker_punches_landed) / sum(r.sucker_punches_used), 1),
      sum(r.sucker_punches_used)::integer
    from public.game_player_results r
    where board = 'sharpshooter'
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
    group by r.player_id
    having sum(r.sucker_punches_used) >= 10
    union all
    select standing.player_id, standing.best_win_streak::numeric, standing.rated_games
    from public.player_standings standing
    where board = 'win_streak' and standing.best_win_streak >= 3
  ),
  ranked as (
    select
      entry.player_id,
      entry.value,
      entry.sample_size,
      profile.display_name,
      profile.username,
      profile.avatar_url,
      rank() over (order by entry.value desc)::integer as rank
    from entries entry
    join public.profiles profile on profile.id = entry.player_id
    where profile.show_on_leaderboards
  ),
  positioned as (
    select ranked.*, row_number() over (order by ranked.rank, ranked.display_name, ranked.player_id) as position
    from ranked
  )
  select
    positioned.rank,
    positioned.player_id,
    positioned.display_name,
    positioned.username,
    positioned.avatar_url,
    positioned.value,
    positioned.sample_size,
    positioned.player_id = viewer
  from positioned
  where positioned.position <= row_limit or positioned.player_id = viewer
  order by positioned.position;
end;
$$;

revoke all on function public.get_leaderboard(text, integer) from public;
grant execute on function public.get_leaderboard(text, integer) to authenticated;

create function public.get_player_card(target_profile_id uuid)
returns table (
  player_id uuid,
  display_name text,
  username text,
  avatar_url text,
  show_on_leaderboards boolean,
  rating numeric,
  rated_games integer,
  peak_rating numeric,
  rating_rank integer,
  current_win_streak integer,
  best_win_streak integer,
  games_played integer,
  wins integer,
  losses integer,
  highest_score integer,
  feats_earned integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view players.' using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.display_name,
    profile.username,
    profile.avatar_url,
    profile.show_on_leaderboards,
    standing.rating,
    coalesce(standing.rated_games, 0),
    standing.peak_rating,
    case
      when profile.show_on_leaderboards and standing.rated_games >= 5 then (
        select count(*)::integer + 1
        from public.player_standings other
        join public.profiles other_profile on other_profile.id = other.player_id
        where other_profile.show_on_leaderboards and other.rated_games >= 5 and other.rating > standing.rating
      )
    end,
    coalesce(standing.current_win_streak, 0),
    coalesce(standing.best_win_streak, 0),
    coalesce(totals.games_played, 0),
    coalesce(totals.wins, 0),
    coalesce(totals.losses, 0),
    coalesce(totals.highest_score, 0),
    (select count(distinct feat.feat_key)::integer from public.player_feats feat where feat.player_id = profile.id)
  from public.profiles profile
  left join public.player_standings standing on standing.player_id = profile.id
  left join lateral (
    select
      sum(stats.games_played)::integer as games_played,
      sum(stats.wins)::integer as wins,
      sum(stats.losses)::integer as losses,
      max(stats.highest_score)::integer as highest_score
    from public.head_to_head_stats stats
    where stats.player_id = profile.id
  ) totals on true
  where profile.id = target_profile_id;
end;
$$;

revoke all on function public.get_player_card(uuid) from public;
grant execute on function public.get_player_card(uuid) to authenticated;

-- Every feat anyone has earned, with how rare it is and the target's own count.
create function public.get_player_feats(target_profile_id uuid)
returns table (
  feat_key text,
  times_earned integer,
  first_earned_at timestamptz,
  last_earned_at timestamptz,
  earned_pct numeric
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view feats.' using errcode = '42501';
  end if;

  return query
  with population as (
    select count(distinct r.player_id)::numeric as players from public.game_player_results r
  ),
  holders as (
    select feat.feat_key, count(distinct feat.player_id)::numeric as players
    from public.player_feats feat
    group by feat.feat_key
  ),
  mine as (
    select feat.feat_key, count(*)::integer as times, min(feat.earned_at) as first_at, max(feat.earned_at) as last_at
    from public.player_feats feat
    where feat.player_id = target_profile_id
    group by feat.feat_key
  )
  select
    holders.feat_key,
    coalesce(mine.times, 0),
    mine.first_at,
    mine.last_at,
    round(100 * holders.players / nullif(population.players, 0), 1)
  from holders
  cross join population
  left join mine on mine.feat_key = holders.feat_key
  order by holders.feat_key;
end;
$$;

revoke all on function public.get_player_feats(uuid) from public;
grant execute on function public.get_player_feats(uuid) to authenticated;
