import { RealtimeClient, socketUrl } from '../src/studyTogether/realtime';
import { anchorFor, formatClock, newerSnapshot, phaseProgress, remainingMs } from '../src/studyTogether/timer';
import type { RoomSession, RoomSnapshot } from '../src/studyTogether/types';
import { cleanCode } from '../src/screens/together/JoinRoomScreen';
import { validateRoom } from '../src/screens/together/CreateRoomScreen';

const session = (over: Partial<RoomSession> = {}): RoomSession => ({
  id: 1, status: 'active', phase: 'focus', cycle: 1, total_cycles: 2, completed_cycles: 0, focus_seconds: 1500,
  break_seconds: 300, phase_seconds: 1500, remaining_ms: 600000, started_at: '', phase_ends_at: '', ...over,
});
const snap = (version: number, server_time = '2026-10-23T10:00:00Z') => ({ id: 7, version, server_time } as RoomSnapshot);

describe('group timer', () => {
  test('counts down from the server remaining time on a monotonic clock', () => {
    const anchor = anchorFor(session(), 1000);
    expect(remainingMs(anchor, 1000)).toBe(600000);
    expect(remainingMs(anchor, 61000)).toBe(540000);
    expect(remainingMs(anchor, 10_000_000)).toBe(0);
    expect(phaseProgress(anchor, 1000)).toBeCloseTo(0.6);
  });

  test('a paused session stays put and an ended one has no timer', () => {
    const paused = anchorFor(session({ status: 'paused', remaining_ms: 120000 }), 0);
    expect(remainingMs(paused, 999999)).toBe(120000);
    expect(anchorFor(session({ status: 'completed' }))).toBeNull();
    expect(anchorFor(null)).toBeNull();
  });

  test('formats rounding up so 00:00 shows only at the end', () => {
    expect(formatClock(1500000)).toBe('25:00');
    expect(formatClock(59001)).toBe('01:00');
    expect(formatClock(400)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-50)).toBe('00:00');
  });

  test('keeps the newest snapshot and drops late or duplicate events', () => {
    expect(newerSnapshot(null, snap(1))).toBe(true);
    expect(newerSnapshot(snap(3), snap(2))).toBe(false);
    expect(newerSnapshot(snap(3), snap(3))).toBe(false);
    expect(newerSnapshot(snap(3), snap(3, '2026-10-23T10:00:05Z'))).toBe(true);  // same state, fresher timing
    expect(newerSnapshot(snap(3), snap(4, '2026-10-23T09:00:00Z'))).toBe(true);
  });
});

describe('form helpers', () => {
  test('room codes are cleaned the way the backend reads them', () => {
    expect(cleanCode(' k7p2-qx9m ')).toBe('K7P2QX9M');
    expect(cleanCode('abcdefghijk')).toBe('ABCDEFGH');
  });

  test('room names and goals are validated before sending', () => {
    expect(validateRoom('   ', '')).toEqual({ name: 'Hãy đặt tên cho phòng học.' });
    expect(validateRoom('x'.repeat(61), 'y'.repeat(161))).toEqual({ name: 'Tên phòng tối đa 60 ký tự.', goal: 'Mục tiêu tối đa 160 ký tự.' });
    expect(validateRoom(' Toán ', 'Chương 3')).toEqual({});
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

describe('realtime client', () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  beforeEach(() => { FakeSocket.instances = []; jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('connects with a fresh ticket, subscribes, and re-subscribes after a reconnect', async () => {
    let n = 0;
    const tickets = jest.fn(async () => ({ ticket: `t${++n}`, path: '/api/realtime/ws', heartbeat_seconds: 25 }));
    const client = new RealtimeClient(tickets, (url) => new FakeSocket(url) as any, () => 'https://api.mirabi.app');
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    const received: any[] = [];
    client.onMessage((m) => received.push(m));
    client.subscribe(5);
    client.start();
    await flush();
    const first = FakeSocket.instances[0];
    expect(first.url).toBe('wss://api.mirabi.app/api/realtime/ws?ticket=t1');
    first.open();
    expect(first.sent).toEqual([{ type: 'subscribe', room_id: 5 }]);
    jest.advanceTimersByTime(25000);
    expect(first.sent[1]).toEqual({ type: 'ping' });
    first.receive({ type: 'pong' });
    expect(received).toEqual([{ type: 'pong' }]);

    first.drop();
    expect(client.status).toBe('reconnecting');
    jest.advanceTimersByTime(1300);
    await flush();
    const second = FakeSocket.instances[1];
    expect(second.url).toContain('ticket=t2');  // tickets are single use
    second.open();
    expect(second.sent).toEqual([{ type: 'subscribe', room_id: 5 }]);
    expect(statuses).toEqual(['connecting', 'online', 'reconnecting', 'online']);
    first.receive({ type: 'pong' });  // the old socket is ignored
    expect(received).toHaveLength(1);
    client.stop();
    expect(client.status).toBe('idle');
  });

  test('backs off and reports offline when the server stays unreachable', async () => {
    const tickets = jest.fn(async () => { throw new Error('offline'); });
    const client = new RealtimeClient(tickets, (url) => new FakeSocket(url) as any, () => 'http://localhost:8001');
    client.start();
    await flush();
    expect(client.status).toBe('reconnecting');
    for (const wait of [1300, 2500, 5000]) { jest.advanceTimersByTime(wait); await flush(); }
    expect(client.status).toBe('offline');
    expect(tickets.mock.calls.length).toBeLessThanOrEqual(4);
    tickets.mockResolvedValue({ ticket: 'ok', path: '/api/realtime/ws', heartbeat_seconds: 25 } as never);
    client.wake();  // back to the foreground: try at once
    await flush();
    FakeSocket.instances[0].open();
    expect(client.status).toBe('online');
    client.stop();
  });

  test('builds ws:// URLs for local development', () => {
    expect(socketUrl('http://192.168.1.20:8001', '/api/realtime/ws', 'a b')).toBe('ws://192.168.1.20:8001/api/realtime/ws?ticket=a%20b');
  });
});
