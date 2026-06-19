alter table public.turns
drop constraint if exists turns_roll_count_check;

alter table public.turns
add constraint turns_roll_count_check check (roll_count >= 1);
