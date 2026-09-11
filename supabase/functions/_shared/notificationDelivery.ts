import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Database } from './database.types.ts';

// Persist delivery separately from the move. A recovered request can finish
// notification work without applying the move again. Concurrent retries share
// one lease; a worker that dies can be replaced after five minutes.
export async function deliverActionNotifications(
  admin: SupabaseClient<Database>,
  actorId: string,
  requestId: string,
  send: () => Promise<void>,
) {
  const claimedAt = new Date().toISOString();
  const expiredAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data, error } = await admin
    .from('game_action_requests')
    .update({ notification_claimed_at: claimedAt })
    .eq('actor_id', actorId)
    .eq('request_id', requestId)
    .eq('status', 'completed')
    .eq('http_status', 200)
    .is('notification_sent_at', null)
    .or(`notification_claimed_at.is.null,notification_claimed_at.lt.${expiredAt}`)
    .select('request_id');
  if (error) throw error;
  if (!data?.length) return;

  try {
    await send();
    const { error: completeError } = await admin
      .from('game_action_requests')
      .update({ notification_sent_at: new Date().toISOString() })
      .eq('actor_id', actorId)
      .eq('request_id', requestId)
      .eq('notification_claimed_at', claimedAt);
    if (completeError) throw completeError;
  } catch (error) {
    const { error: releaseError } = await admin
      .from('game_action_requests')
      .update({ notification_claimed_at: null })
      .eq('actor_id', actorId)
      .eq('request_id', requestId)
      .eq('notification_claimed_at', claimedAt);
    if (releaseError) console.error('Unable to release notification delivery lease', releaseError);
    throw error;
  }
}
