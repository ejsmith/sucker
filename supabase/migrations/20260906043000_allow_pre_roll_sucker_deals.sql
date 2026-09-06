-- Sucker Deal sacrifices a category for zero even before the first roll.
-- Other scored turns still require at least one roll.
alter table public.turns drop constraint turns_roll_count_check;
alter table public.turns add constraint turns_roll_count_check
  check (roll_count >= 0 and (roll_count > 0 or score = 0));
