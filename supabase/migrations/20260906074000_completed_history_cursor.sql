-- Keep legacy completion chronology identical in the server cursor and UI.
alter table public.games add column completed_sort_at timestamptz
  generated always as (coalesce(completed_at, updated_at)) stored;

create index games_completed_sort_idx
on public.games (completed_sort_at desc, id desc) where status = 'complete';
