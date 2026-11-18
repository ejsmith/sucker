-- End-game recap: canned parting shots after a played-out game, and one read
-- of what each player earned in it. See docs/end-game-recap.md.

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
    'parting_shot'
  )
);

-- Both players' feats and rating change for one game. Feats and results stay
-- closed to direct reads; only the game's own players see its recap.
create function public.get_game_recap(target_game_id uuid)
returns table (
  player_id uuid,
  rating_before numeric,
  rating_after numeric,
  feat_keys text[]
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.is_game_participant(target_game_id, auth.uid()) then
    raise exception 'You can only see recaps of your own games.' using errcode = '42501';
  end if;

  return query
  select
    player.player_id,
    result.rating_before,
    result.rating_after,
    coalesce(
      (
        select array_agg(feat.feat_key order by feat.earned_at, feat.feat_key)
        from public.player_feats feat
        where feat.game_id = target_game_id and feat.player_id = player.player_id
      ),
      '{}'::text[]
    )
  from public.game_players player
  left join public.game_player_results result
    on result.game_id = player.game_id and result.player_id = player.player_id
  where player.game_id = target_game_id
  order by player.seat_index;
end;
$$;

revoke all on function public.get_game_recap(uuid) from public;
grant execute on function public.get_game_recap(uuid) to authenticated;
