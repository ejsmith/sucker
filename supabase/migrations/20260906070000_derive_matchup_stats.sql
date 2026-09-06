begin;

-- Drain legacy writes before replacing the function and repairing cached totals.
lock table public.game_player_results, public.head_to_head_stats in share row exclusive mode;
create index game_player_results_matchup_idx on public.game_player_results(player_id,opponent_id);

-- Rebuild cached matchup totals from uniquely keyed game results.
-- Callers hold the pair lock while writing results and refreshing both directions.
create or replace function public.refresh_matchup_stats(p_player_id uuid, p_opponent_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.head_to_head_stats (
    player_id, opponent_id,
    games_played,
    wins,
    losses,
    highest_score,
    total_score,
    average_score,
    upper_bonus_games,
    sucker_games,
    three_of_a_kind_games,
    four_of_a_kind_games,
    full_house_games,
    small_straight_games,
    large_straight_games,
    blowout_wins,
    blowout_losses,
    buzzer_beater_wins,
    comeback_wins,
    extra_rolls_used,
    mulligans_used,
    sucker_hunts,
    sucker_hunt_misses,
    sucker_punches_landed,
    sucker_punches_used,
    sucker_punches_received,
    sucker_blockers_used,
    forced_rerolls,
    sucker_tokens_spent,
    sucker_tokens_leftover,
    average_sucker_tokens_spent,
    average_sucker_tokens_leftover
  ) select p_player_id,p_opponent_id,
    count(*),
    count(*) filter (where r.won),
    count(*) filter (where not r.won and opponent.won),
    coalesce(max(r.final_score),0),
    coalesce(sum(r.final_score),0),
    coalesce(round(avg(r.final_score),2),0),
    count(*) filter (where r.upper_bonus_awarded),
    count(*) filter (where r.sucker_count > 0),
    count(*) filter (where r.three_of_a_kind_count > 0),
    count(*) filter (where r.four_of_a_kind_count > 0),
    count(*) filter (where r.full_house_count > 0),
    count(*) filter (where r.small_straight_count > 0),
    count(*) filter (where r.large_straight_count > 0),
    coalesce(sum(r.blowout_win),0),
    coalesce(sum(r.blowout_loss),0),
    coalesce(sum(r.buzzer_beater_win),0),
    coalesce(sum(r.comeback_win),0),
    coalesce(sum(r.extra_rolls_used),0),
    coalesce(sum(r.mulligans_used),0),
    coalesce(sum(r.sucker_hunts),0),
    coalesce(sum(r.sucker_hunt_misses),0),
    coalesce(sum(r.sucker_punches_landed),0),
    coalesce(sum(r.sucker_punches_used),0),
    coalesce(sum(r.sucker_punches_received),0),
    coalesce(sum(r.sucker_blockers_used),0),
    coalesce(sum(r.forced_rerolls),0),
    coalesce(sum(r.sucker_tokens_spent),0),
    coalesce(sum(r.sucker_tokens_leftover),0),
    coalesce(round(avg(r.sucker_tokens_spent),2),0),
    coalesce(round(avg(r.sucker_tokens_leftover),2),0)
  from public.game_player_results r
  left join public.game_player_results opponent
    on opponent.game_id=r.game_id and opponent.player_id=r.opponent_id
  where r.player_id=p_player_id and r.opponent_id=p_opponent_id
  on conflict (player_id,opponent_id) do update set
    games_played=excluded.games_played,
    wins=excluded.wins,
    losses=excluded.losses,
    highest_score=excluded.highest_score,
    total_score=excluded.total_score,
    average_score=excluded.average_score,
    upper_bonus_games=excluded.upper_bonus_games,
    sucker_games=excluded.sucker_games,
    three_of_a_kind_games=excluded.three_of_a_kind_games,
    four_of_a_kind_games=excluded.four_of_a_kind_games,
    full_house_games=excluded.full_house_games,
    small_straight_games=excluded.small_straight_games,
    large_straight_games=excluded.large_straight_games,
    blowout_wins=excluded.blowout_wins,
    blowout_losses=excluded.blowout_losses,
    buzzer_beater_wins=excluded.buzzer_beater_wins,
    comeback_wins=excluded.comeback_wins,
    extra_rolls_used=excluded.extra_rolls_used,
    mulligans_used=excluded.mulligans_used,
    sucker_hunts=excluded.sucker_hunts,
    sucker_hunt_misses=excluded.sucker_hunt_misses,
    sucker_punches_landed=excluded.sucker_punches_landed,
    sucker_punches_used=excluded.sucker_punches_used,
    sucker_punches_received=excluded.sucker_punches_received,
    sucker_blockers_used=excluded.sucker_blockers_used,
    forced_rerolls=excluded.forced_rerolls,
    sucker_tokens_spent=excluded.sucker_tokens_spent,
    sucker_tokens_leftover=excluded.sucker_tokens_leftover,
    average_sucker_tokens_spent=excluded.average_sucker_tokens_spent,
    average_sucker_tokens_leftover=excluded.average_sucker_tokens_leftover,
    updated_at=now();
$$;
revoke all on function public.refresh_matchup_stats(uuid,uuid) from public,anon,authenticated;
grant execute on function public.refresh_matchup_stats(uuid,uuid) to service_role;

-- A move is prepared by the trusted Edge Function and committed with its replay
-- response in one transaction. A stale preparation cannot overwrite a newer move.
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
  has_results boolean;
  matchup_players uuid[];
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

  has_results := exists(select 1 from jsonb_array_elements(p_writes) item
    where item->>'table'='game_player_results');
  if has_results then
    select array_agg(player_id order by player_id) into matchup_players
      from public.game_players where game_id=p_game_id;
    if cardinality(matchup_players) <> 2 then raise exception 'A completed game needs two players'; end if;
    -- Different games between the same players must not refresh totals concurrently.
    -- Acquire before inserting results so a waiting transaction sees the prior commit.
    perform pg_advisory_xact_lock(hashtextextended(matchup_players[1]::text || ':' || matchup_players[2]::text,0));
  end if;

  for change in select value from jsonb_array_elements(p_writes) loop
    table_name := change->>'table';
    operation := change->>'operation';
    if table_name not in ('turns','turn_actions','token_events','game_players','game_player_results','head_to_head_stats')
      or operation not in ('insert','update','upsert') then raise exception 'Invalid game move write'; end if;
    if table_name <> 'head_to_head_stats' and
      coalesce(change->'data'->>'game_id',change->'match'->>'game_id','') <> p_game_id::text then
      raise exception 'Move write must belong to the locked game';
    end if;
    if table_name = 'head_to_head_stats' and (
      not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'opponent_id')::uuid)
    ) then raise exception 'Stats write must belong to this game'; end if;
    if table_name='head_to_head_stats' then
      -- Older Edge workers still send absolute totals. Ignore those only when
      -- this transaction supplies the source results; refresh them below instead.
      if not has_results then raise exception 'Stats require completed game results'; end if;
      continue;
    end if;
    select string_agg(format('%I',key),',') into fields from jsonb_object_keys(change->'data') key;
    if fields is null then raise exception 'Empty game move write'; end if;

    if operation='update' then
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

  if has_results then
    perform public.refresh_matchup_stats(matchup_players[1],matchup_players[2]);
    perform public.refresh_matchup_stats(matchup_players[2],matchup_players[1]);
  end if;

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

-- Verify the final row at commit, after any waiting legacy writer obtains its
-- row lock. Old function invocations can resume after a migration table lock is
-- released, so the barrier alone cannot prevent a stale absolute overwrite.
create or replace function public.check_matchup_result_totals()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  source_games bigint;
  source_score bigint;
  current_stats public.head_to_head_stats;
begin
  select count(*),coalesce(sum(final_score),0) into source_games,source_score
    from public.game_player_results where player_id=new.player_id and opponent_id=new.opponent_id;
  select * into current_stats from public.head_to_head_stats
    where player_id=new.player_id and opponent_id=new.opponent_id;
  if source_games > 0 and found and
      (current_stats.games_played <> source_games or current_stats.total_score <> source_score) then
    raise exception using errcode='PT409',message='Game results changed while statistics were prepared. Refresh and try again.';
  end if;
  return null;
end;
$$;
revoke all on function public.check_matchup_result_totals() from public,anon,authenticated;
create constraint trigger matchup_result_totals_consistent
  after insert or update on public.head_to_head_stats
  deferrable initially deferred for each row execute function public.check_matchup_result_totals();

-- Repair existing totals using the same source of truth. The migration transaction
-- holds each pair lock through commit, matching the normal completion path.
do $$
declare pair record;
begin
  for pair in select distinct least(player_id,opponent_id) as first_id,
      greatest(player_id,opponent_id) as second_id from public.game_player_results
      order by first_id,second_id loop
    perform pg_advisory_xact_lock(hashtextextended(pair.first_id::text || ':' || pair.second_id::text,0));
    perform public.refresh_matchup_stats(pair.first_id,pair.second_id);
    perform public.refresh_matchup_stats(pair.second_id,pair.first_id);
  end loop;
end;
$$;

commit;
