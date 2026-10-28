import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { newIdempotencyKey } from '../api/client';
import { togetherApi } from './api';
import type { ConnectionStatus, RealtimeClient } from './realtime';
import type { ChatMessage, PublicUser } from './types';
import { FALLBACK_POLL_MS } from './useStudyRoom';

/** A message as the screen shows it: confirmed by the server, or still on its way from this device. */
export type ChatItem = ChatMessage & { status?: 'sending' | 'failed' };
export type LiveChatBubble = { key: number; userId: number; text: string };

const TYPING_VISIBLE_MS = 4000;
const TYPING_SEND_EVERY_MS = 2500;
const BUBBLE_VISIBLE_MS = 5000;

/** Confirmed messages in server order, then this device's pending ones in the order they were written. */
function merge(list: ChatItem[], incoming: ChatMessage[]): ChatItem[] {
  if (!incoming.length) return list;
  const byId = new Map<number, ChatItem>();
  const arrived = new Set(incoming.map((m) => m.client_id).filter(Boolean));
  const pending: ChatItem[] = [];
  for (const item of list) {
    if (item.status) { if (!arrived.has(item.client_id)) pending.push(item); } else byId.set(item.id, item);
  }
  for (const m of incoming) byId.set(m.id, m);
  return [...[...byId.values()].sort((a, b) => a.id - b.id), ...pending];
}

/**
 * Chat of one study room. History comes from REST (newest page first, older pages on demand), new messages from the
 * room's realtime subscription (owned by useStudyRoom). Sending is optimistic: the message shows at once and is
 * replaced by the server's copy, matched on `client_id`; a failed send can be retried with the same id. After a
 * reconnect, or while the socket is down, the latest page is re-read so nothing is missed.
 */
export function useRoomChat(roomId: number, client: RealtimeClient, me: PublicUser, connection: ConnectionStatus) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState<Record<number, number>>({});
  const [bubbles, setBubbles] = useState<LiveChatBubble[]>([]);
  const [lastReadId, setLastReadId] = useState<number | null>(null);
  const mounted = useRef(true);
  const pendingSeq = useRef(0);
  const bubbleKey = useRef(0);
  const typingSentAt = useRef(0);
  const readKey = `mirabi.together.chat-read.v1:${me.id}:${roomId}`;

  const loadLatest = useCallback(async () => {
    try {
      const page = await togetherApi.messages(roomId);
      if (!mounted.current) return;
      setItems((list) => merge(list, page.items));
      setOlderCursor((cursor) => (cursor === undefined ? page.next_before_id : cursor));
      setLoaded(true);
    } catch {
      if (mounted.current) setLoaded(true);  // the room screen already reports connection problems
    }
  }, [roomId]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await togetherApi.messages(roomId, olderCursor);
      if (!mounted.current) return;
      setItems((list) => merge(list, page.items));
      setOlderCursor(page.next_before_id);
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }, [loadingOlder, olderCursor, roomId]);

  useEffect(() => {
    mounted.current = true;
    void loadLatest();
    void AsyncStorage.getItem(readKey).then((v) => { if (mounted.current) setLastReadId(v ? Number(v) || 0 : 0); })
      .catch(() => { if (mounted.current) setLastReadId(0); });
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
    const off = client.onMessage((m) => {
      if (!('room_id' in m) || m.room_id !== roomId) return;
      if (m.type === 'room.message') {
        setItems((list) => merge(list, [m.message]));
        const from = m.message.sender?.id;
        if (from != null && from !== me.id) {
          setTyping(({ [from]: _, ...rest }) => rest);
          if (m.message.body) {
            const key = ++bubbleKey.current;
            setBubbles((list) => [...list.filter((b) => b.userId !== from).slice(-5), { key, userId: from, text: m.message.body! }]);
            later(() => setBubbles((list) => list.filter((b) => b.key !== key)), BUBBLE_VISIBLE_MS);
          }
        }
      } else if (m.type === 'room.message_deleted') {
        setItems((list) => list.map((item) => item.id === m.message_id ? { ...item, body: null, deleted: true, removed_by: m.removed_by } : item));
      } else if (m.type === 'room.typing' && m.user_id !== me.id) {
        const until = Date.now() + TYPING_VISIBLE_MS;
        setTyping((t) => ({ ...t, [m.user_id]: until }));
        later(() => setTyping((t) => { if (t[m.user_id] !== until) return t; const { [m.user_id]: _, ...rest } = t; return rest; }), TYPING_VISIBLE_MS);
      }
    });
    return () => { mounted.current = false; off(); timers.forEach(clearTimeout); };
  }, [client, loadLatest, me.id, readKey, roomId]);

  // Catch up after the socket comes back; poll calmly while it is away.
  const previousConnection = useRef(connection);
  useEffect(() => {
    const before = previousConnection.current;
    previousConnection.current = connection;
    if (connection === 'online' && before !== 'online' && before !== 'idle') void loadLatest();
    if (connection === 'online') return;
    const timer = setInterval(() => { void loadLatest(); }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [connection, loadLatest]);

  const deliver = useCallback(async (clientId: string, body: string) => {
    try {
      const { message } = await togetherApi.sendMessage(roomId, body, clientId);
      if (mounted.current) setItems((list) => merge(list, [message]));
    } catch (e) {
      if (mounted.current) setItems((list) => list.map((item) => item.client_id === clientId && item.status ? { ...item, status: 'failed' } : item));
      throw e;
    }
  }, [roomId]);

  const send = useCallback((text: string) => {
    const body = text.trim();
    if (!body) return Promise.resolve();
    const clientId = newIdempotencyKey();
    const item: ChatItem = { id: -(++pendingSeq.current), room_id: roomId, client_id: clientId, sender: me, body, deleted: false,
      removed_by: null, created_at: new Date().toISOString(), status: 'sending' };
    setItems((list) => [...list, item]);
    typingSentAt.current = 0;
    return deliver(clientId, body);
  }, [deliver, me, roomId]);

  const retry = useCallback((item: ChatItem) => {
    if (item.status !== 'failed' || !item.client_id || !item.body) return Promise.resolve();
    setItems((list) => list.map((x) => x.client_id === item.client_id && x.status ? { ...x, status: 'sending' } : x));
    return deliver(item.client_id, item.body);
  }, [deliver]);

  const discard = useCallback((item: ChatItem) => {
    setItems((list) => list.filter((x) => !(x.status && x.client_id === item.client_id)));
  }, []);

  const remove = useCallback(async (messageId: number) => {
    await togetherApi.deleteMessage(roomId, messageId);
    if (!mounted.current) return;
    setItems((list) => list.map((item) => item.id === messageId
      ? { ...item, body: null, deleted: true, removed_by: item.sender?.id === me.id ? 'sender' : 'host' } : item));
  }, [me.id, roomId]);

  /** Call while the user types; sends at most one "typing" signal every few seconds. */
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingSentAt.current < TYPING_SEND_EVERY_MS) return;
    typingSentAt.current = now;
    client.typing(roomId);
  }, [client, roomId]);

  const latestId = useMemo(() => items.reduce((max, m) => (m.id > max ? m.id : max), 0), [items]);
  const markRead = useCallback(() => {
    if (lastReadId === null || latestId <= lastReadId) return;
    setLastReadId(latestId);
    void AsyncStorage.setItem(readKey, String(latestId)).catch(() => {});
  }, [lastReadId, latestId, readKey]);

  const unread = lastReadId === null ? 0
    : items.filter((m) => m.id > lastReadId && !m.status && !m.deleted && m.sender?.id !== me.id).length;
  const last = [...items].reverse().find((m) => !m.status) ?? items[items.length - 1] ?? null;
  const typingIds = Object.keys(typing).map(Number);

  return { items, loaded, hasOlder: !!olderCursor, loadingOlder, loadOlder, send, retry, discard, remove, notifyTyping,
    typingIds, bubbles, unread, last, markRead };
}
