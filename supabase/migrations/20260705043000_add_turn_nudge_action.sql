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
    'taunt'
  )
);
