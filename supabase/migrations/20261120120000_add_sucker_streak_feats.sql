-- Whether a turn rolled a Sucker at any point after its last Mulligan, even if
-- the dice were then rerolled or scored elsewhere. game-action sets it on each
-- submission and reads it across a player's games for Sucker Spree feats.
alter table public.turns add column rolled_sucker boolean not null default false;

create index turns_player_created_idx on public.turns (player_id, created_at);

-- Credit past turns with the same check game-action uses: a run of rolls starts
-- over at each submission and Mulligan, and a turn rolled a Sucker when its
-- run did.
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
  where action.action_type in ('roll', 'score_category', 'scratch_category', 'mulligan')
),
sucker_runs as (
  select distinct runs.game_id, runs.actor_id, runs.run
  from runs
  where runs.action_type = 'roll'
    and jsonb_typeof(runs.payload -> 'dice' -> 0) = 'number'
    and (runs.payload -> 'dice' ->> 0)::numeric in (1, 2, 3, 4, 5, 6)
    and runs.payload -> 'dice' = jsonb_build_array(
      runs.payload -> 'dice' -> 0,
      runs.payload -> 'dice' -> 0,
      runs.payload -> 'dice' -> 0,
      runs.payload -> 'dice' -> 0,
      runs.payload -> 'dice' -> 0
    )
),
sucker_turns as (
  select (runs.payload ->> 'turnId')::uuid as turn_id
  from runs
  join sucker_runs using (game_id, actor_id, run)
  where runs.action_type in ('score_category', 'scratch_category')
    and runs.payload ->> 'turnId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
update public.turns turn
set rolled_sucker = true
from sucker_turns
where turn.id = sucker_turns.turn_id;

-- Per-game streaks (Back-to-Back through Perfect Ten) are awarded the moment
-- they happen. Credit finished games from each player's kept turns in order;
-- games still in progress pick theirs up on their next qualifying move. Live
-- play also counts turns that were punched or Mulliganed after the streak's
-- Sucker, so this can under-award those games but never over-awards.
with kept_turns as (
  select
    turn.game_id,
    turn.player_id,
    turn.rolled_sucker,
    count(*) filter (where not turn.rolled_sucker) over (
      partition by turn.game_id, turn.player_id
      order by turn.turn_index
    ) as run
  from public.turns turn
  join public.games game on game.id = turn.game_id
  where game.status = 'complete'
    and turn.status in ('submitted', 'blocked', 'finalized')
),
streaks as (
  select game_id, player_id, max(length) as streak
  from (
    select game_id, player_id, count(*) filter (where rolled_sucker) as length
    from kept_turns
    group by game_id, player_id, run
  ) runs
  group by game_id, player_id
),
tiers (feat_key, streak) as (
  values
    ('back_to_back', 2),
    ('three_peat', 3),
    ('on_a_roll', 4),
    ('five_alarm_fire', 5),
    ('cant_stop', 6),
    ('seventh_heaven', 7),
    ('unstoppable', 8),
    ('cloud_nine', 9),
    ('perfect_ten', 10)
)
insert into public.player_feats (game_id, player_id, feat_key, earned_at)
select streaks.game_id, streaks.player_id, tiers.feat_key, coalesce(game.completed_at, now())
from streaks
join tiers on streaks.streak >= tiers.streak
join public.games game on game.id = streaks.game_id
on conflict (game_id, player_id, feat_key) do nothing;

-- Sucker Spree streaks run across all of a player's games, kept turns in the
-- order they were submitted. Each streak earns a tier on the turn that reached
-- it, in that turn's game.
with kept_turns as (
  select
    turn.id,
    turn.game_id,
    turn.player_id,
    turn.created_at,
    turn.rolled_sucker,
    count(*) filter (where not turn.rolled_sucker) over (
      partition by turn.player_id
      order by turn.created_at, turn.id
    ) as run
  from public.turns turn
  where turn.status in ('submitted', 'blocked', 'finalized')
),
streak_turns as (
  select
    kept_turns.*,
    row_number() over (
      partition by kept_turns.player_id, kept_turns.run
      order by kept_turns.created_at, kept_turns.id
    ) as streak
  from kept_turns
  where kept_turns.rolled_sucker
)
insert into public.player_feats (game_id, player_id, feat_key, earned_at)
select streak_turns.game_id, streak_turns.player_id, 'sucker_spree_' || streak_turns.streak, streak_turns.created_at
from streak_turns
where streak_turns.streak between 3 and 10
on conflict (game_id, player_id, feat_key) do nothing;
