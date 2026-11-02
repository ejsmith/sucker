let subscriptionId = 0;

// supabase.channel() returns an existing channel with the same topic, and
// removeChannel() finishes asynchronously. A screen that unsubscribes and
// resubscribes (for example when a frozen screen's effects reconnect) would get
// the old, already-subscribed channel back and crash adding callbacks to it.
// Give every subscription its own topic.
export function createRealtimeTopic(name: string) {
  subscriptionId += 1;
  return `${name}:${subscriptionId}`;
}

export function createGameListRealtimeTopic() {
  return createRealtimeTopic('games:list');
}
