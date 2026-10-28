import { resolveApiUrl } from '../config';
import type { RealtimeMessage } from './types';

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';
type Ticket = { ticket: string; path: string; heartbeat_seconds: number };
type SocketLike = { readyState: number; send(data: string): void; close(code?: number): void;
  onopen: (() => void) | null; onclose: ((e: { code?: number }) => void) | null; onerror: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null };
type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;
const MAX_BACKOFF_MS = 30000;
/** After this many failed attempts in a row the screen switches to its polling fallback (it keeps retrying). */
export const OFFLINE_AFTER_FAILURES = 3;

export function socketUrl(base: string, path: string, ticket: string) {
  return `${base.replace(/^http/, 'ws')}${path}?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * One WebSocket for Study Together (see backend/app/realtime.py). It fetches a fresh single-use ticket for every
 * connection, re-subscribes to the wanted rooms after a reconnect, pings as the presence heartbeat and backs off
 * exponentially when the network is gone. Screens fall back to REST polling while `status` is 'offline'.
 */
export class RealtimeClient {
  status: ConnectionStatus = 'idle';
  private socket: SocketLike | null = null;
  private rooms = new Set<number>();
  private listeners = new Set<(m: RealtimeMessage) => void>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private generation = 0;

  constructor(
    private fetchTicket: () => Promise<Ticket>,
    private createSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike,
    private baseUrl: () => string = () => resolveApiUrl(),
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.setStatus('idle');
  }

  /** Reconnect right away, e.g. when the app returns to the foreground. */
  wake() {
    if (!this.running || this.status === 'online' || this.status === 'connecting') return;
    this.failures = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.connect();
  }

  subscribe(roomId: number) {
    this.rooms.add(roomId);
    this.send({ type: 'subscribe', room_id: roomId });
  }

  unsubscribe(roomId: number) {
    this.rooms.delete(roomId);
    this.send({ type: 'unsubscribe', room_id: roomId });
  }

  /** "I'm typing" for the room chat; relayed to the other members, never stored. Dropped while offline. */
  typing(roomId: number) {
    this.send({ type: 'typing', room_id: roomId });
  }

  onMessage(listener: (m: RealtimeMessage) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onStatus(listener: (s: ConnectionStatus) => void) {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  private send(message: object) {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private async connect() {
    const generation = ++this.generation;
    this.setStatus(this.failures === 0 ? 'connecting' : this.failures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting');
    let ticket: Ticket;
    try {
      ticket = await this.fetchTicket();
    } catch {
      if (generation === this.generation) this.scheduleRetry();
      return;
    }
    if (generation !== this.generation || !this.running) return;
    let socket: SocketLike;
    try {
      socket = this.createSocket(socketUrl(this.baseUrl(), ticket.path, ticket.ticket));
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.failures = 0;
      this.setStatus('online');
      this.rooms.forEach((roomId) => this.send({ type: 'subscribe', room_id: roomId }));
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), Math.max(5, ticket.heartbeat_seconds) * 1000);
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation || typeof event.data !== 'string') return;
      let message: RealtimeMessage;
      try { message = JSON.parse(event.data); } catch { return; }
      this.listeners.forEach((l) => l(message));
    };
    socket.onerror = () => { /* onclose follows and handles the retry */ };
    socket.onclose = () => {
      if (generation !== this.generation) return;
      this.socket = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.running) this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (!this.running) return;
    this.failures += 1;
    this.setStatus(this.failures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.failures - 1)) * (0.8 + Math.random() * 0.4);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(); }, delay);
  }
}
