export type MockRequest = { method: string; path: string; body: any; headers: Record<string, string> };
export type MockReply = { status: number; body?: unknown } | Error;
type Route = MockReply | ((req: MockRequest) => MockReply | Promise<MockReply>);

export const USER = { id: 1, email: 'aqua@example.com', display_name: 'Aqua', level: 1, xp: 0, coins: 100, gems: 5, avatar_theme: 'aqua', pet: 'fox', pet_name: 'Aqua', daily_tasks_selected: true, onboarded: true };

export const tokens = (n = 1) => ({
  access_token: `access-${n}`, refresh_token: `refresh-token-${n}-0123456789abcdef`, token_type: 'bearer', expires_in: 900, user: USER,
});

export const networkDown = () => new TypeError('Network request failed');

/** Replaces global.fetch with a router keyed by "METHOD /path". Unknown routes get harmless defaults. */
export function mockServer(routes: Record<string, Route>) {
  const calls: MockRequest[] = [];
  const fetchMock = jest.fn(async (url: string, init: any = {}) => {
    const req: MockRequest = {
      method: init.method || 'GET',
      path: url.replace(/^https?:\/\/[^/]+/, ''),
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers || {},
    };
    calls.push(req);
    const route = routes[`${req.method} ${req.path}`];
    let reply: MockReply | undefined = typeof route === 'function' ? await route(req) : route;
    if (!reply && req.path === '/api/study/pomodoro-settings') reply = { status: 200, body: req.method === 'PUT' ? req.body : {
      timezone: 'UTC', daily_goal_minutes: 120, focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, long_break_every: 4,
    } };
    if (!reply && req.path.startsWith('/api/study/pomodoro-statistics')) reply = { status: 200, body: {
      timezone: 'UTC', today_seconds: 0, today_sessions: 0, week_seconds: 0, month_seconds: 0,
      daily_goal_minutes: 120, goal_progress: 0, current_streak: 0, longest_streak: 0,
      seconds: 0, started: 0, completed: 0, completion_rate: 0, days: [], hours: [],
    } };
    if (!reply) {
      reply = req.path === '/api/dashboard'
        ? { status: 200, body: { user: USER, study: { total_minutes: 0, today_sessions: 0, daily_goal: 3 } } }
        : { status: 200, body: [] };
    }
    if (reply instanceof Error) throw reply;
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: async () => text };
  });
  (global as any).fetch = fetchMock;
  return {
    calls,
    fetchMock,
    callsTo: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key),
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
