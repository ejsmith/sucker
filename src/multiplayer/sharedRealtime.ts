import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type RealtimeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';
type MessageListener = (event: string, payload: Record<string, unknown>) => void;
type StatusListener = (status: RealtimeStatus, error?: Error) => void;
type SharedTopic = {
  channel: RealtimeChannel | null;
  closed: boolean;
  lastStatus: { error?: Error; status: RealtimeStatus } | null;
  messageListeners: Set<MessageListener>;
  statusListeners: Set<StatusListener>;
};

const openTopics = new Map<string, SharedTopic>();
const closingTopics = new Map<string, Promise<void>>();

// The database broadcasts to fixed topics (player:<id>, game:<id>), so every
// screen listening to one topic must share one channel: supabase.channel()
// hands back the existing channel for a topic, and a subscribed channel cannot
// take new callbacks. A topic being closed is reopened only after it is gone.
export function subscribeToPrivateTopic(
  topic: string,
  onMessage: MessageListener,
  onStatus?: StatusListener,
): () => void {
  const shared = openTopics.get(topic) ?? openTopic(topic);
  shared.messageListeners.add(onMessage);
  if (onStatus) {
    shared.statusListeners.add(onStatus);
    const lastStatus = shared.lastStatus;
    if (lastStatus)
      queueMicrotask(() => shared.statusListeners.has(onStatus) && onStatus(lastStatus.status, lastStatus.error));
  }

  return () => {
    shared.messageListeners.delete(onMessage);
    if (onStatus) shared.statusListeners.delete(onStatus);
    if (shared.messageListeners.size > 0 || shared.statusListeners.size > 0) return;
    closeTopic(topic, shared);
  };
}

function openTopic(topic: string): SharedTopic {
  const shared: SharedTopic = {
    channel: null,
    closed: false,
    lastStatus: null,
    messageListeners: new Set(),
    statusListeners: new Set(),
  };
  openTopics.set(topic, shared);
  void (closingTopics.get(topic) ?? Promise.resolve()).then(() => {
    if (shared.closed) return;
    shared.channel = supabase
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: '*' }, (message) => {
        const payload = (message.payload ?? {}) as Record<string, unknown>;
        for (const listener of [...shared.messageListeners]) listener(message.event, payload);
      })
      .subscribe((status, error) => {
        shared.lastStatus = { error, status };
        for (const listener of [...shared.statusListeners]) listener(status, error);
      });
  });
  return shared;
}

function closeTopic(topic: string, shared: SharedTopic) {
  shared.closed = true;
  if (openTopics.get(topic) === shared) openTopics.delete(topic);
  const channel = shared.channel;
  if (!channel) return;

  const closing = supabase
    .removeChannel(channel)
    .catch(() => undefined)
    .then(() => {
      // A timed-out unsubscribe leaves the channel listed, and the next
      // supabase.channel() call for this topic would return it.
      if (supabase.realtime.channels.includes(channel)) {
        channel.teardown();
        supabase.realtime.channels = supabase.realtime.channels.filter((candidate) => candidate !== channel);
      }
    })
    .finally(() => {
      if (closingTopics.get(topic) === closing) closingTopics.delete(topic);
    });
  closingTopics.set(topic, closing);
}
