-- Accumulate matchup deltas under a pair lock so concurrent game completions
-- neither collide on their first insert nor overwrite previously counted games.
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
    if table_name not in ('turns','turn_actions','token_events','game_players','game_player_results','head_to_head_stats')
      or operation not in ('insert','update','upsert','increment') then raise exception 'Invalid game move write'; end if;
    if table_name <> 'head_to_head_stats' and
      coalesce(change->'data'->>'game_id',change->'match'->>'game_id','') <> p_game_id::text then
      raise exception 'Move write must belong to the locked game';
    end if;
    if table_name = 'head_to_head_stats' and (
      not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'opponent_id')::uuid)
    ) then raise exception 'Stats write must belong to this game'; end if;
    select string_agg(format('%I',key),',') into fields from jsonb_object_keys(change->'data') key;
    if fields is null then raise exception 'Empty game move write'; end if;

    if operation='increment' or (table_name='head_to_head_stats' and operation='insert') then
      if table_name <> 'head_to_head_stats' then raise exception 'Invalid move increment'; end if;
      -- Per-game deltas, never pre-read aggregate totals. Supporting insert here
      -- also makes two older first-matchup plans safe during the rollout.
      select string_agg(case
        when key in ('player_id','opponent_id') then null
        when key='highest_score' then 'highest_score = greatest(target.highest_score,excluded.highest_score)'
        when key='average_score' then 'average_score = round((target.total_score + excluded.total_score)::numeric / (target.games_played + excluded.games_played),2)'
        when key='average_sucker_tokens_spent' then 'average_sucker_tokens_spent = round((target.sucker_tokens_spent + excluded.sucker_tokens_spent)::numeric / (target.games_played + excluded.games_played),2)'
        when key='average_sucker_tokens_leftover' then 'average_sucker_tokens_leftover = round((target.sucker_tokens_leftover + excluded.sucker_tokens_leftover)::numeric / (target.games_played + excluded.games_played),2)'
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
