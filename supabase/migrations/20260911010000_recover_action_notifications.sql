-- The committed response is the durable notification payload. Delivery state
-- must survive a lost commit response and must not be reset by request replay.
alter table public.game_action_requests
  add column notification_claimed_at timestamptz,
  add column notification_sent_at timestamptz;

-- Existing completed requests predate delivery tracking. Avoid re-notifying
-- players about historic moves when an older request is replayed.
update public.game_action_requests
set notification_sent_at = updated_at
where status = 'completed';
