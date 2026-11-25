-- End-game recap: canned parting shots after a played-out game, one read of
-- a finished game in full, and links from the score boards to the games that
-- set them. See docs/end-game-recap.md.

-- What each turn cost: Extra Rolls and Mulligans bought on it, including the
-- Mulligans that replayed it. Null on turns from before this was kept.
alter table public.turns
add column extra_rolls integer check (extra_rolls >= 0),
add column mulligans integer check (mulligans >= 0);

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
    'turn_timeout',
    'parting_shot'
  )
);

-- One finished game, told in full: the final state, both players with their
-- rating change and feats, every turn, and the actions the recap and trash
-- talk are built from. Finished games are open to any signed-in player, like
-- the scores on the boards and in profile histories; unfinished ones stay
-- private to their players.
create function public.get_game_recap(target_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  target public.games%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to see game recaps.' using errcode = '42501';
  end if;

  select * into target from public.games game where game.id = target_game_id;
  if not found or target.status <> 'complete' then
    raise exception 'Only finished games have recaps.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'game',
    jsonb_build_object(
      'completed_at', target.completed_at,
      'id', target.id,
      'state', target.state,
      'winner_id', target.winner_id
    ),
    'players',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'avatar_url', profile.avatar_url,
            'display_name', profile.display_name,
            'feat_keys',
            coalesce(
              (
                select jsonb_agg(feat.feat_key order by feat.earned_at, feat.feat_key)
                from public.player_feats feat
                where feat.game_id = target.id and feat.player_id = player.player_id
              ),
              '[]'::jsonb
            ),
            'player_id', player.player_id,
            'rating_after', result.rating_after,
            'rating_before', result.rating_before,
            'username', profile.username
          )
          order by player.seat_index
        ),
        '[]'::jsonb
      )
      from public.game_players player
      join public.profiles profile on profile.id = player.player_id
      left join public.game_player_results result
        on result.game_id = player.game_id and result.player_id = player.player_id
      where player.game_id = target.id
    ),
    'turns',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'category', turn.category,
            'dice', turn.dice,
            'extra_rolls', turn.extra_rolls,
            'id', turn.id,
            'mulligans', turn.mulligans,
            'player_id', turn.player_id,
            'roll_count', turn.roll_count,
            'score', turn.score,
            'status', turn.status,
            'turn_index', turn.turn_index
          )
          order by turn.turn_index
        ),
        '[]'::jsonb
      )
      from public.turns turn
      where turn.game_id = target.id
    ),
    'actions',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'action_type', action.action_type,
            'actor_id', action.actor_id,
            'created_at', action.created_at,
            'payload', action.payload,
            'turn_id', action.turn_id
          )
          order by action.created_at, action.id
        ),
        '[]'::jsonb
      )
      from public.turn_actions action
      where action.game_id = target.id
        and action.action_type in (
          'extra_roll',
          'roll',
          'mulligan',
          'sucker_punch',
          'sucker_blocker',
          'score_category',
          'scratch_category',
          'taunt'
        )
    )
  );
end;
$$;

revoke all on function public.get_game_recap(uuid) from public;
grant execute on function public.get_game_recap(uuid) to authenticated;

-- Score boards link each row to the game that set the score: the first game
-- in which the player reached it.
drop function public.get_leaderboard(text, integer);

create function public.get_leaderboard(board text, max_rows integer default 25)
returns table (
  rank integer,
  player_id uuid,
  display_name text,
  username text,
  avatar_url text,
  value numeric,
  sample_size integer,
  is_me boolean,
  game_id uuid
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

  return query
  with positioned as (
    select ranked.*, row_number() over (order by ranked.rank, ranked.display_name, ranked.player_id) as position
    from public.ranked_leaderboard(board) ranked
  )
  select
    positioned.rank,
    positioned.player_id,
    positioned.display_name,
    positioned.username,
    positioned.avatar_url,
    positioned.value,
    positioned.sample_size,
    positioned.player_id = viewer,
    (
      select result.game_id
      from public.game_player_results result
      where board in ('weekly_high_score', 'all_time_high_score')
        and result.player_id = positioned.player_id
        and result.final_score = positioned.value
        and (board = 'all_time_high_score' or result.completed_at >= week_start)
        and not exists (select 1 from public.rage_quits quit where quit.game_id = result.game_id)
        and not exists (select 1 from public.timeout_forfeits timeout where timeout.game_id = result.game_id)
      order by result.completed_at, result.game_id
      limit 1
    )
  from positioned
  where positioned.position <= row_limit or positioned.player_id = viewer
  order by positioned.position;
end;
$$;

revoke all on function public.get_leaderboard(text, integer) from public;
grant execute on function public.get_leaderboard(text, integer) to authenticated;
