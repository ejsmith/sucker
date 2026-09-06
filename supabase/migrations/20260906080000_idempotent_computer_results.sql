create table public.computer_game_results (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_id text not null check (length(game_id) between 1 and 200),
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (profile_id,game_id)
);
alter table public.computer_game_results enable row level security;
create policy "Players can read their computer results" on public.computer_game_results
  for select to authenticated using (profile_id=auth.uid());
revoke all on public.computer_game_results from anon,authenticated;
grant select on public.computer_game_results to authenticated;
grant all on public.computer_game_results to service_role;

create or replace function public.record_computer_game_result_once(p_owner_id uuid,p_game_id text,p_result jsonb)
returns public.computer_stats language plpgsql security definer set search_path=public,pg_temp as $$
declare
  inserted_game text;
  stats public.computer_stats;
begin
  if auth.uid() is null or auth.uid() is distinct from p_owner_id then
    raise exception using errcode='42501',message='Computer result belongs to a different account';
  end if;
  insert into public.computer_game_results(profile_id,game_id,result)
    values(p_owner_id,p_game_id,p_result) on conflict (profile_id,game_id) do nothing
    returning game_id into inserted_game;
  if inserted_game is null then
    select * into stats from public.computer_stats where profile_id=p_owner_id;
    return stats;
  end if;
  select * into stats from public.record_computer_game_result(
    player_score => (p_result->>'player_score')::integer,
    computer_score => (p_result->>'computer_score')::integer,
    upper_bonus_awarded => (p_result->>'upper_bonus_awarded')::boolean,
    scored_sucker => (p_result->>'scored_sucker')::boolean,
    scored_three_of_a_kind => (p_result->>'scored_three_of_a_kind')::boolean,
    scored_four_of_a_kind => (p_result->>'scored_four_of_a_kind')::boolean,
    scored_full_house => (p_result->>'scored_full_house')::boolean,
    scored_small_straight => (p_result->>'scored_small_straight')::boolean,
    scored_large_straight => (p_result->>'scored_large_straight')::boolean,
    computer_upper_bonus_awarded => (p_result->>'computer_upper_bonus_awarded')::boolean,
    computer_scored_sucker => (p_result->>'computer_scored_sucker')::boolean,
    computer_scored_three_of_a_kind => (p_result->>'computer_scored_three_of_a_kind')::boolean,
    computer_scored_four_of_a_kind => (p_result->>'computer_scored_four_of_a_kind')::boolean,
    computer_scored_full_house => (p_result->>'computer_scored_full_house')::boolean,
    computer_scored_small_straight => (p_result->>'computer_scored_small_straight')::boolean,
    computer_scored_large_straight => (p_result->>'computer_scored_large_straight')::boolean,
    buzzer_beater_wins => (p_result->>'buzzer_beater_wins')::integer,
    comeback_wins => (p_result->>'comeback_wins')::integer,
    extra_rolls_used => (p_result->>'extra_rolls_used')::integer,
    mulligans_used => (p_result->>'mulligans_used')::integer,
    sucker_hunts => (p_result->>'sucker_hunts')::integer,
    sucker_hunt_misses => (p_result->>'sucker_hunt_misses')::integer,
    sucker_punches_landed => (p_result->>'sucker_punches_landed')::integer,
    sucker_punches_used => (p_result->>'sucker_punches_used')::integer,
    sucker_blockers_used => (p_result->>'sucker_blockers_used')::integer,
    sucker_tokens_spent => (p_result->>'sucker_tokens_spent')::integer,
    sucker_tokens_leftover => (p_result->>'sucker_tokens_leftover')::integer
  );
  return stats;
end;
$$;
revoke all on function public.record_computer_game_result_once(uuid,text,jsonb) from public,anon;
grant execute on function public.record_computer_game_result_once(uuid,text,jsonb) to authenticated,service_role;
