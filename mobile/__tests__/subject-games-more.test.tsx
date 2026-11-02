import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Turn } from '../src/learning/types';
import { TUTORIALS } from '../src/learning/tutorials';
import { NumberLineBridge } from '../src/games/subject/NumberLineBridge';
import { SentenceXray } from '../src/games/subject/SentenceXray';
import { StepSolver } from '../src/games/subject/StepSolver';
import { StoryDetective } from '../src/games/subject/StoryDetective';
import {
  keptPaint, keptTicks, numberLineAnswer, paintAnswer, paintWord, pickChip, stepAnswer, tickAt, typedNumber,
} from '../src/games/subject/logic';
import { TutorialArt } from '../src/screens/learning/TutorialArt';

// The math and reading gameplays (src/games/subject): Cầu trục số, Giải toán từng bước, Thám tử đọc hiểu, Soi câu. Their
// rules on the device, then each scene played by hand: what it sends, what a wrong answer keeps, what a step or a right
// answer shows.

const turn = (id: string, kind: Turn['kind'], prompt: Turn['prompt']): Turn => ({ turn_id: id, position: 0, kind, skill_label: '',
  prompt, hints_shown: [], hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 });
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });
const checkButton = () => screen.getByRole('button', { name: 'Kiểm tra' });
const press = (name: string, times = 1) => { for (let i = 0; i < times; i++) fireEvent.press(screen.getByRole('button', { name })); };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('the rules on the device', () => {
  it('a finger on the line lands on the nearest tick, never off the line', () => {
    expect(tickAt(0, 300, 10)).toBe(0);
    expect(tickAt(44, 300, 10)).toBe(1);
    expect(tickAt(46, 300, 10)).toBe(2);
    expect(tickAt(-20, 300, 10)).toBe(0);
    expect(tickAt(900, 300, 10)).toBe(10);
    expect(numberLineAnswer({ p1: 47, p2: 74 })).toEqual(['p1:47', 'p2:74']);
    expect(keptTicks(['p2:74'])).toEqual({ p2: 74 });
  });

  it('chips fill the calculation left then right, a used chip comes out; the result keeps one comma and one bar', () => {
    let calc = pickChip({ left: null, op: null, right: null }, 'n1');
    calc = pickChip(calc, 'n2');
    expect(calc).toEqual({ left: 'n1', op: null, right: 'n2' });
    expect(pickChip(calc, 'n1')).toEqual({ left: null, op: null, right: 'n2' });
    expect(typedNumber('2,5,3')).toBe('2,53');
    expect(typedNumber('3//4a')).toBe('3/4');
    expect(typedNumber('-12-')).toBe('−12');
    expect(stepAnswer({ left: 'n1', op: '−', right: 'n2' }, '36')).toEqual(['n1', '-', 'n2', '36']);
  });

  it('a piece painted with the same colour again is cleared; locked pieces never change; nothing painted is "none"', () => {
    let paint = paintWord({}, 'w1', 'c1');
    expect(paint).toEqual({ w1: 'c1' });
    paint = paintWord(paint, 'w1', 'c2');
    expect(paint).toEqual({ w1: 'c2' });
    expect(paintWord(paint, 'w1', 'c2')).toEqual({});
    expect(paintWord({ w1: 'c1' }, 'w1', 'c2', { w1: 'c1' })).toEqual({ w1: 'c1' });
    expect(paintAnswer({})).toEqual(['none']);
    expect(paintAnswer({ w1: 'c1' })).toEqual(['w1:c1']);
    expect(keptPaint(['w3:c2'])).toEqual({ w3: 'c2' });
  });
});

describe('Cầu trục số', () => {
  const line = turn('nl1', 'number_line_place', { prompt: 'Đặt các số lên trục số.', ticks: 20, major: 5,
    labels: [0, 5, 10, 15, 20].map((n) => ({ at: n, text: String(n) })), marks: [],
    points: [{ id: 'p1', label: '7' }, { id: 'p2', label: '12' }] });

  it('a number is taken from the bank and moved plank by plank; a wrong check locks the right one', () => {
    const sent: string[][] = [];
    const Scene = (props: Partial<React.ComponentProps<typeof NumberLineBridge>>) => (
      <NumberLineBridge turn={line} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion {...props} />
    );
    const view = render(<Scene />);
    expect(checkButton().props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Đang cầm: 7')).toBeTruthy();
    press('Tiến một khoảng lớn'); // on the bank: placed on tick 5
    press('Tiến một vạch', 2);
    fireEvent.press(screen.getByRole('button', { name: '12. Chạm để cầm' }));
    press('Tiến một khoảng lớn', 2);
    press('Tiến một vạch', 3); // 13: wrong
    fireEvent.press(checkButton());
    expect(sent[0].sort()).toEqual(['p1:7', 'p2:13']);
    view.rerender(<Scene feedback={{ text: '“12” đang lệch về bên phải.', tone: 'bad', kept: ['p1:7'] }} />);
    ms(50);
    expect(screen.getByText('“12” đang lệch về bên phải.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '7, đã đúng chỗ' })).toBeTruthy();
    expect(screen.getByText('Đang cầm: 12')).toBeTruthy(); // the hand goes to the one to move
    press('Lùi một vạch');
    fireEvent.press(checkButton());
    expect(sent[1].sort()).toEqual(['p1:7', 'p2:12']);
    view.rerender(<Scene solved disabled />);
    ms(3000);
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    view.unmount();
  });
});

describe('Giải toán từng bước', () => {
  const problem = 'Lan có 48 viên bi. Lan cho em 12 viên rồi chia đều số bi còn lại vào 4 hộp. Mỗi hộp có bao nhiêu viên bi?';
  const step1 = turn('ss1', 'step_solve', { problem, chips: [{ id: 'n1', text: '48' }, { id: 'n2', text: '12' }, { id: 'n3', text: '4' }],
    at_step: 1, steps: 2, ask: 'Lan còn lại bao nhiêu viên bi?', ask_unit: 'viên bi', done: [] });
  const step2 = turn('ss1', 'step_solve', { ...step1.prompt, at_step: 2, ask: 'Mỗi hộp có bao nhiêu viên bi?',
    chips: [...step1.prompt.chips!, { id: 'r1', text: '36', step: 1 }],
    done: [{ step: 1, ask: 'Lan còn lại bao nhiêu viên bi?', work: '48 − 12 = 36', result: '36 viên bi' }] });

  it('a step is built from chips, an operator and the keypad; a right calculation with a wrong result keeps the calculation', () => {
    const sent: string[][] = [];
    const Scene = (props: Partial<React.ComponentProps<typeof StepSolver>>) => (
      <StepSolver turn={step1} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion {...props} />
    );
    const view = render(<Scene />);
    expect(screen.getByText('Bước 1: Lan còn lại bao nhiêu viên bi?')).toBeTruthy();
    expect(screen.queryByText(/Mỗi hộp/)).toBeTruthy(); // in the problem only
    expect(screen.queryByText('Bước 2: Mỗi hộp có bao nhiêu viên bi?')).toBeNull(); // the next question is not shown ahead
    press('Thẻ số 48');
    press('Dấu trừ');
    press('Thẻ số 12');
    press('Số 3');
    press('Số 4');
    fireEvent.press(checkButton());
    expect(sent[0]).toEqual(['n1', '-', 'n2', '34']);
    view.rerender(<Scene feedback={{ text: 'Phép tính 48 − 12 chọn đúng rồi, nhưng kết quả chưa đúng.', tone: 'bad', kept: ['n1', '-', 'n2'] }} />);
    ms(50);
    expect(screen.getByLabelText('Phép tính: 48 trừ 12 bằng chưa điền')).toBeTruthy();
    press('Số 3');
    press('Số 6');
    fireEvent.press(checkButton());
    expect(sent[1]).toEqual(['n1', '-', 'n2', '36']);
    view.unmount();
  });

  it('a confirmed step opens the next question with the result as a new chip, starting empty', () => {
    const sent: string[][] = [];
    const view = render(<StepSolver turn={step1} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion />);
    press('Thẻ số 48');
    view.rerender(<StepSolver turn={step2} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion
      feedback={{ text: 'Bước 1 đúng: 48 − 12 = 36 viên bi.', tone: 'good' }} />);
    expect(screen.getByText('Bước 2: Mỗi hộp có bao nhiêu viên bi?')).toBeTruthy();
    expect(screen.getByLabelText('Bước 1: Lan còn lại bao nhiêu viên bi? 48 − 12 = 36, đúng')).toBeTruthy();
    expect(screen.getByLabelText('Phép tính: trống chưa có dấu trống bằng chưa điền')).toBeTruthy();
    press('Thẻ số 36, kết quả bước 1');
    press('Dấu chia');
    press('Thẻ số 4');
    press('Số 9');
    fireEvent.press(checkButton());
    expect(sent[0]).toEqual(['r1', ':', 'n3', '9']);
    view.unmount();
  });
});

describe('Thám tử đọc hiểu', () => {
  const find = turn('sd1', 'story_evidence', { question: 'How old is An?', lang: 'en', phase: 'find',
    sentences: [{ id: 's1', text: 'Hello!' }, { id: 's2', text: 'My name is An.' }, { id: 's3', text: 'I am nine years old.' },
      { id: 's4', text: 'My sister Mi is four.' }] });
  const answer = turn('sd1', 'story_evidence', { ...find.prompt, phase: 'answer', found: 's3',
    options: [{ id: 'o1', text: 'Four.' }, { id: 'o2', text: 'Nine.' }, { id: 'o3', text: 'Eight.' }] });

  it('the clue first (no answers before), a wrong clue is crossed out; then the answers, a wrong one crossed out', () => {
    const sent: string[][] = [];
    const Scene = (props: Partial<React.ComponentProps<typeof StoryDetective>>) => (
      <StoryDetective turn={find} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion {...props} />
    );
    const view = render(<Scene />);
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Câu 4: My sister Mi is four.' }));
    fireEvent.press(checkButton());
    expect(sent[0]).toEqual(['s4']);
    view.rerender(<Scene feedback={{ text: 'Câu này chưa chứng minh được câu trả lời.', tone: 'bad' }} />);
    ms(50);
    expect(screen.getByRole('button', { name: 'Câu 4: My sister Mi is four.. Không phải bằng chứng' }).props.accessibilityState.disabled).toBe(true);
    view.rerender(<Scene turn={answer} feedback={{ text: 'Đúng, câu này là manh mối!', tone: 'good' }} />);
    expect(screen.getByRole('button', { name: 'Câu 3: I am nine years old.. Manh mối' })).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: 'Four.' }));
    fireEvent.press(checkButton());
    expect(sent[1]).toEqual(['o1']);
    view.rerender(<Scene turn={answer} feedback={{ text: 'Bốn tuổi là Mi.', tone: 'bad' }} />);
    ms(50);
    expect(screen.getByRole('radio', { name: 'Four., đã loại' })).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: 'Nine.' }));
    fireEvent.press(checkButton());
    expect(sent[2]).toEqual(['o2']);
    view.rerender(<Scene turn={answer} solved disabled />);
    ms(2000);
    expect(screen.getByText('ĐÃ PHÁ ÁN')).toBeTruthy();
    view.unmount();
  });
});

describe('Soi câu', () => {
  const xray = turn('sx1', 'sentence_paint', { prompt: 'Tô từ chỉ sự vật và từ chỉ hoạt động.', lang: 'vi',
    roles: [{ id: 'c1', name: 'Sự vật' }, { id: 'c2', name: 'Hoạt động' }],
    words: [{ id: 'w1', text: 'Mẹ' }, { id: 'w2', text: 'đang' }, { id: 'w3', text: 'nấu' }, { id: 'w4', text: 'cơm' },
      { id: 'w5', text: '.', fixed: true }] });

  it('pieces are painted with the pen in hand, punctuation cannot be; a wrong check locks the right ones', () => {
    const sent: string[][] = [];
    const Scene = (props: Partial<React.ComponentProps<typeof SentenceXray>>) => (
      <SentenceXray turn={xray} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion {...props} />
    );
    const view = render(<Scene />);
    expect(screen.queryByRole('button', { name: /^\./ })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Mẹ, chưa tô' }));
    fireEvent.press(screen.getByRole('button', { name: 'nấu, chưa tô' })); // wrong colour (Sự vật)
    fireEvent.press(screen.getByRole('radio', { name: 'Bút Hoạt động' }));
    fireEvent.press(screen.getByRole('button', { name: 'cơm, chưa tô' })); // wrong colour (Hoạt động)
    fireEvent.press(checkButton());
    expect(sent[0].sort()).toEqual(['w1:c1', 'w3:c1', 'w4:c2']);
    view.rerender(<Scene feedback={{ text: '“nấu” chưa phải sự vật.', tone: 'bad', kept: ['w1:c1'] }} />);
    ms(50);
    expect(screen.getByRole('button', { name: 'Mẹ, tô Sự vật, đúng' }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'nấu, tô Sự vật' })); // the pen in hand is Hoạt động: repainted
    fireEvent.press(screen.getByRole('radio', { name: 'Bút Sự vật' }));
    fireEvent.press(screen.getByRole('button', { name: 'cơm, tô Hoạt động' }));
    fireEvent.press(checkButton());
    expect(sent[1].sort()).toEqual(['w1:c1', 'w3:c2', 'w4:c1']);
    view.unmount();
  });
});

describe('the guides', () => {
  it('each new gameplay has its three pages, drawn with its real scene', () => {
    for (const game of ['number_line', 'step_solver', 'story_detective', 'sentence_xray'] as const) {
      const pages = TUTORIALS[game];
      expect(pages).toHaveLength(3);
      for (const page of pages) {
        const view = render(<TutorialArt scene={page.scene} petId="cat" petLevel={1} reduceMotion />);
        ms(4000);
        view.unmount();
      }
    }
  });
});
