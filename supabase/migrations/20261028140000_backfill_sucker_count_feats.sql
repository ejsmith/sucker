-- Sucker-count feats (Seeing Double through Crazy Eights) are awarded the
-- moment they happen. Credit finished games with the same count game-action
-- uses: Suckers rolled per player, once per run of rolls, where a run starts
-- over at each submission and Mulligan. Games still in progress pick theirs up
-- on their next qualifying move.
with runs as (
  select
    action.game_id,
    action.actor_id,
    action.action_type,
    action.payload,
    count(*) filter (where action.action_type in ('score_category', 'scratch_category', 'mulligan')) over (
      partition by action.game_id, action.actor_id
      order by action.created_at, action.id
      rows between unbounded preceding and 1 preceding
    ) as run
  from public.turn_actions action
  join public.games game on game.id = action.game_id
  where game.status = 'complete'
    and action.action_type in ('roll', 'score_category', 'scratch_category', 'mulligan')
),
sucker_counts as (
  select runs.game_id, runs.actor_id as player_id, count(distinct runs.run) as suckers
  from runs
  where runs.action_type = 'roll'
    and runs.payload -> 'dice' -> 0 is not null
    and runs.payload -> 'dice' = jsonb_build_array(
      runs.payload -> 'dice' -> 0,
      runs.payload -> 'dice' -> 0,
      runs.payload -> 'dice' -> 0,
      runs.payload -> 'dice' -> 0,
      runs.payload -> 'dice' -> 0
    )
  group by runs.game_id, runs.actor_id
),
tiers (feat_key, suckers) as (
  values
    ('seeing_double', 2),
    ('hat_trick', 3),
    ('four_score', 4),
    ('high_five', 5),
    ('six_pack', 6),
    ('lucky_seven', 7),
    ('crazy_eights', 8)
)
insert into public.player_feats (game_id, player_id, feat_key, earned_at)
select counts.game_id, counts.player_id, tiers.feat_key, coalesce(game.completed_at, now())
from sucker_counts counts
join tiers on counts.suckers >= tiers.suckers
join public.games game on game.id = counts.game_id
on conflict (game_id, player_id, feat_key) do nothing;
