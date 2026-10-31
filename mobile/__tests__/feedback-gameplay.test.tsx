import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import type { LearningSession, Turn } from '../src/learning/types';
import { GameScreen } from '../src/screens/learning/GameScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer } from '../test/mockServer';

// The visual feedback loop in a real game screen (games/engine/feedback.ts): a right answer is seen in the world before
// the next challenge comes, nothing can be sent while the world reacts, the same wrong answer is not sent twice, and
// "Bỏ qua" jumps to the end of the reaction.

const ms = (n: number) => act(async () => { jest.advanceTimersByTime(n); });

describe('visual feedback in Math Battle', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
  });
  afterEach(() => { jest.useRealTimers(); });

  const ref = (id: number, code: string, name: string) => ({ id, code, name });
  const problem = (id: string, expression: string): Turn => ({ turn_id: id, position: 0, kind: 'math_input', skill_label: 'Tính', prompt: { expression },
    hints_shown: [], hints_total: 1, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0, on_screen_ms: 0 });
  const session = (over: Partial<LearningSession> = {}): LearningSession => ({
    id: 7, status: 'active', kind: 'lesson', mode: 'practice', game_type: 'defense', variant: null, game: 'defense',
    subject: ref(2, 'math', 'Toán'), topic: ref(2, 'arithmetic', 'Cộng, trừ'), level: ref(2, 'grade3', 'Lớp 3'), lesson: ref(9, 'math.x', 'Bài'),
    duration_seconds: 600, active_ms: 0, remaining_ms: 600_000, time_up: false, timed: true, hearts: 3, hearts_max: 3, score: 0, combo: 0,
    max_combo: 0, required_count: 12, resolved_count: 0, pending_practice: 0, open_turns: [problem('m1', '12 + 7')], can_complete: false,
    end_reason: null, reward: null, version: 1, server_time: '2026-11-01T10:00:00Z', ...over });
  const result = (over: Record<string, unknown>) => ({ turn_id: 'm1', event: 'answer', correct: false, outcome: null, resolved: false,
    retry_allowed: false, error_type: null, score_delta: 0, hearts_delta: 0, combo: 0, hint: null, correct_answer: null, explanation: null,
    practice_added: false, feedback: null, ...over });
  const prefs = { sound: false, volume: 'mid' as const, reduceMotion: false, setSound: jest.fn(), setVolume: jest.fn(), setReduceMotion: jest.fn() };

  async function play(start: LearningSession, routes: Record<string, unknown>) {
    const server = mockServer({ 'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: start, replayed: false } },
      ...routes } as never);
    render(<ToastProvider><ConfirmProvider>
      <GameScreen initial={start} petId="fox" petLevel={1} prefs={prefs} onEnded={jest.fn()} />
    </ConfirmProvider></ToastProvider>);
    for (let i = 0; i < 5; i++) await ms(1000);
    fireEvent(screen.getByLabelText(/pet đấu với/), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 230 } } });
    return server;
  }
  const typeAnswer = (digits: string) => {
    for (const d of digits) fireEvent.press(screen.getByRole('button', { name: d }));
    fireEvent.press(screen.getByRole('button', { name: 'Tấn công' }));
  };
  const attack = () => screen.getByRole('button', { name: 'Tấn công' });

  it('a right answer: the solved problem stays while the pet strikes; the pad is locked; then the next problem', async () => {
    const after = session({ resolved_count: 1, open_turns: [problem('m2', '9 + 4')], version: 2 });
    const server = await play(session(), {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ correct: true, resolved: true, outcome: 'first_try', correct_answer: '19' }),
        session: after, replayed: false } },
    });
    typeAnswer('19');
    await ms(50);
    // The world reacts first: the problem just solved is still on its card, the next one waits, nothing can be sent.
    expect(screen.getByLabelText('Đã giải: 12 + 7')).toBeTruthy();
    expect(screen.queryByLabelText('Bài toán: 9 + 4 bằng mấy?')).toBeNull();
    expect(attack().props.accessibilityState?.disabled).toBe(true);
    await ms(400);
    expect(screen.getByText('−1')).toBeTruthy(); // the bolt hit
    expect(screen.getByLabelText('Máu của Slime: 1 trên 2')).toBeTruthy();
    await ms(1500);
    expect(screen.getByLabelText('Bài toán: 9 + 4 bằng mấy?')).toBeTruthy();
    expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(1);
  });

  it('a wrong answer: the monster strikes back, the pet says a hint; the same wrong answer is not sent again', async () => {
    const hurt = session({ hearts: 2, version: 2 });
    const server = await play(session(), {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ retry_allowed: true, error_type: 'carry_error', hearts_delta: -1 }),
        session: hurt, replayed: false } },
    });
    typeAnswer('29');
    await ms(50);
    expect(screen.getByLabelText('Máu của pet: 2 trên 3')).toBeTruthy();
    expect(attack().props.accessibilityState?.disabled).toBe(true); // the counter-attack plays
    await ms(1200);
    expect(screen.getByLabelText('Gợi ý của pet: Nhớ sang hàng bên trái nhé!')).toBeTruthy();
    expect(attack().props.accessibilityState?.disabled).toBeFalsy();
    fireEvent.press(attack()); // "29" again: not sent, it would only cost another heart
    await ms(50);
    expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(1);
    expect(screen.getByText('Đáp án này vừa chưa đúng, hãy thử cách khác nhé!')).toBeTruthy();
  });

  it('"Bỏ qua" jumps a long strike (a monster defeated, the next walking in) to its end: the next problem comes at once', async () => {
    const after = session({ resolved_count: 2, open_turns: [problem('m2', '9 + 4')], version: 2 });
    await play(session({ resolved_count: 1 }), {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ correct: true, resolved: true, outcome: 'first_try' }),
        session: after, replayed: false } },
    });
    typeAnswer('19');
    for (let t = 0; t < 10 && !screen.queryByRole('button', { name: 'Bỏ qua hiệu ứng' }); t++) await ms(100);
    expect(screen.getByLabelText('Đã giải: 12 + 7')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bỏ qua hiệu ứng' }));
    await ms(20);
    expect(screen.getByLabelText('Bài toán: 9 + 4 bằng mấy?')).toBeTruthy();
    expect(screen.getByLabelText('Rừng phép thuật: pet đấu với Nấm phép thuật')).toBeTruthy(); // the next foe already on stage
    expect(screen.getByRole('button', { name: '1' }).props.accessibilityState?.disabled).toBeFalsy(); // the pad is open again
  });
});
