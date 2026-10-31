import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Turn } from '../src/learning/types';
import { TUTORIALS } from '../src/learning/tutorials';
import { EquationBalance } from '../src/games/subject/EquationBalance';
import { GeometryWorkshop } from '../src/games/subject/GeometryWorkshop';
import { SentenceTrain } from '../src/games/subject/SentenceTrain';
import { TimelineQuest } from '../src/games/subject/TimelineQuest';
import {
  angleAt, atomCounts, balanced, equationText, formulaParts, keptPlacement, placeEvent, placeTile, rectAt, removeTile, tilt,
  timelineAnswer, timelineFull, type Species,
} from '../src/games/subject/logic';
import { TutorialArt } from '../src/screens/learning/TutorialArt';

// The subject gameplays (src/games/subject): Dòng thời gian, Xây câu, Xưởng hình học, Cân bằng phương trình. Their rules
// on the device, then each scene played by hand: what it sends, what a wrong answer keeps, what a right one shows.

const turn = (id: string, kind: Turn['kind'], prompt: Turn['prompt']): Turn => ({ turn_id: id, position: 0, kind, skill_label: '',
  prompt, hints_shown: [], hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 });
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });
const checkButton = () => screen.getByRole('button', { name: 'Kiểm tra' });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('the rules on the device', () => {
  const markers = [{ id: 'm1', label: '1945', slots: 2 }, { id: 'm2', label: '1954', slots: 1 }];

  it('a timeline marker never takes more events than its places; an event placed again moves', () => {
    let placed = placeEvent({}, markers, 'e1', 'm1');
    placed = placeEvent(placed, markers, 'e2', 'm1');
    expect(placeEvent(placed, markers, 'e3', 'm1')).toBe(placed); // full: unchanged
    placed = placeEvent(placed, markers, 'e3', 'm2');
    expect(timelineFull(placed, markers)).toBe(true);
    expect(placeEvent(placed, markers, 'e3', 'm1')).toBe(placed); // m1 is full, e3 stays on m2
    expect(placeEvent({ e1: 'm1' }, markers, 'e1', 'm2')).toEqual({ e1: 'm2' });
    expect(placeEvent({}, markers, 'e1', 'nowhere')).toEqual({});
    expect(timelineAnswer({ e1: 'm1', e3: 'm2' })).toEqual(['m1:e1', 'm2:e3']);
    expect(keptPlacement(['m2:e3', 'bad'])).toEqual({ e3: 'm2' });
  });

  it('a sentence tile goes on the first empty wagon once; taking one off leaves its wagon empty, never a locked one', () => {
    let line: (string | null)[] = [null, null, null];
    line = placeTile(placeTile(line, 't2'), 't1');
    expect(placeTile(line, 't2')).toEqual(['t2', 't1', null]);
    expect(removeTile(['t2', 't1', 't3'], 1, 0)).toEqual(['t2', null, 't3']);
    expect(removeTile(['t2', 't1', 't3'], 0, 1)).toEqual(['t2', 't1', 't3']);
  });

  it('an angle follows the finger above the baseline, snaps to the steps and stays at an end below it', () => {
    expect(angleAt(100, 0, 5)).toBe(0);
    expect(angleAt(0, -100, 5)).toBe(90);
    expect(angleAt(-100, -1, 5)).toBe(180);
    expect(angleAt(100, -100, 5)).toBe(45);
    expect(angleAt(100, -58, 5)).toBe(30); // 30.1° snaps to 30
    expect(angleAt(50, 40, 5)).toBe(0); // below, on the right
    expect(angleAt(-50, 40, 5)).toBe(180); // below, on the left
    expect(rectAt(95, 61, 30, 10, 8)).toEqual([3, 2]);
    expect(rectAt(-10, 900, 30, 10, 8)).toEqual([1, 8]);
  });

  it('atoms are counted per element on each side; the balance is level only when every element matches', () => {
    const species: Species[] = [{ id: 's1', formula: 'H2', side: 'left' as const, atoms: { H: 2 } }, { id: 's2', formula: 'O2', side: 'left' as const, atoms: { O: 2 } },
      { id: 's3', formula: 'H2O', side: 'right' as const, atoms: { H: 2, O: 1 } }];
    expect(atomCounts(species, [1, 1, 1])).toEqual({ H: [2, 2], O: [2, 1] });
    expect(balanced(atomCounts(species, [2, 1, 2]))).toBe(true);
    expect(tilt(atomCounts(species, [2, 1, 2]))).toBe(0);
    expect(tilt(atomCounts(species, [1, 1, 1]))).toBeLessThan(0); // the left is heavier
    expect(tilt(atomCounts(species, [1, 1, 3]))).toBeGreaterThan(0);
    expect(equationText(species, [2, 1, 2])).toBe('2H₂ + O₂ → 2H₂O');
    expect(formulaParts('Ca(OH)2')).toEqual([{ text: 'Ca(OH)', sub: false }, { text: '2', sub: true }]);
  });
});

describe('Hành trình dòng thời gian', () => {
  const timeline = turn('tl1', 'timeline_place', { prompt: 'Đặt các sự kiện lên dòng thời gian.', years: 'shown',
    markers: [{ id: 'm1', label: '938', slots: 1 }, { id: 'm2', label: '1010', slots: 1 }, { id: 'm3', label: '1070', slots: 1 }],
    events: [{ id: 'e1', text: 'Nhà Lý dời đô' }, { id: 'e2', text: 'Xây Văn Miếu' }, { id: 'e3', text: 'Ngô Quyền thắng Nam Hán' }] });

  it('events are placed on their markers by tapping, checked, and a wrong one goes back while the right ones lock', () => {
    const sent: string[][] = [];
    const Scene = (props: Partial<React.ComponentProps<typeof TimelineQuest>>) => (
      <TimelineQuest turn={timeline} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion {...props} />
    );
    const view = render(<Scene />);
    expect(checkButton().props.accessibilityState.disabled).toBe(true);
    const put = (event: string, marker: string) => {
      fireEvent.press(screen.getByRole('button', { name: `Sự kiện: ${event}` }));
      fireEvent.press(screen.getByRole('button', { name: `Đặt “${event}” vào mốc ${marker}` }));
    };
    put('Ngô Quyền thắng Nam Hán', '938');
    put('Xây Văn Miếu', '1010'); // wrong
    put('Nhà Lý dời đô', '1070'); // wrong (the only place left is 1070)
    fireEvent.press(checkButton());
    expect(sent[0].sort()).toEqual(['m1:e3', 'm2:e2', 'm3:e1']);
    view.rerender(<Scene feedback={{ text: 'Có 1/3 sự kiện đúng mốc.', tone: 'bad', kept: ['m1:e3'] }} />);
    expect(screen.getByText('Có 1/3 sự kiện đúng mốc.')).toBeTruthy();
    ms(50);
    expect(screen.getByRole('button', { name: 'Ngô Quyền thắng Nam Hán, đúng mốc 938' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sự kiện: Xây Văn Miếu' })).toBeTruthy(); // back on the pile
    expect(screen.getByRole('button', { name: 'Sự kiện: Nhà Lý dời đô' })).toBeTruthy();
    view.unmount();
  });

  it('the same year is one marker with two places; hidden dates show once the timeline is complete', () => {
    const hidden = turn('tl2', 'timeline_place', { prompt: 'Đặt các kinh đô.', years: 'hidden',
      markers: [{ id: 'm1', label: 'Thời Văn Lang', slots: 2 }, { id: 'm2', label: 'Từ năm 1010', slots: 1 }],
      events: [{ id: 'e1', text: 'A' }, { id: 'e2', text: 'B' }, { id: 'e3', text: 'C' }] });
    const view = render(<TimelineQuest turn={hidden} disabled={false} onSubmit={() => {}} reduceMotion />);
    expect(screen.getAllByLabelText('Chỗ trống ở mốc thứ 1')).toHaveLength(2);
    expect(screen.queryByText('Thời Văn Lang')).toBeTruthy(); // drawn but transparent until solved
    view.rerender(<TimelineQuest turn={hidden} disabled onSubmit={() => {}} reduceMotion solved />);
    ms(50);
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull(); // solved: nothing more to check
    view.unmount();
  });
});

describe('Xây câu', () => {
  const sentence = turn('s1', 'sentence_build', { prompt: 'Xếp câu.', vi: 'Họ không đi bảo tàng.', length: 4, lang: 'en',
    tiles: [{ id: 't1', text: 'go' }, { id: 't2', text: 'They' }, { id: 't3', text: 'went' }, { id: 't4', text: 'to the museum.' },
      { id: 't5', text: "didn't" }] });

  it('tiles load the wagons in order, the distractor stays in the yard, a wrong check locks the right start', () => {
    const sent: string[][] = [];
    const Scene = (props: Partial<React.ComponentProps<typeof SentenceTrain>>) => (
      <SentenceTrain turn={sentence} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion {...props} />
    );
    const view = render(<Scene />);
    expect(screen.getByText('Họ không đi bảo tàng.')).toBeTruthy();
    for (const word of ['They', "didn't", 'to the museum.', 'go']) fireEvent.press(screen.getByRole('button', { name: `Thẻ ${word}` }));
    expect(screen.getByRole('button', { name: 'Thẻ went' })).toBeTruthy(); // left in the yard
    fireEvent.press(checkButton());
    expect(sent).toEqual([['t2', 't5', 't4', 't1']]);
    view.rerender(<Scene feedback={{ text: 'Từ vị trí 3 (“to the museum.”) chưa đúng chỗ.', tone: 'bad', kept: ['t2', 't5'] }} />);
    expect(screen.getByRole('button', { name: "Toa 2: didn't, đúng" })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: "Toa 2: didn't, đúng" })); // locked: stays
    expect(screen.getByRole('button', { name: "Toa 2: didn't, đúng" })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Toa 3: to the museum.. Chạm để dỡ xuống' }));
    fireEvent.press(screen.getByRole('button', { name: 'Toa 4: go. Chạm để dỡ xuống' }));
    fireEvent.press(screen.getByRole('button', { name: 'Thẻ go' }));
    fireEvent.press(screen.getByRole('button', { name: 'Thẻ to the museum.' }));
    fireEvent.press(checkButton());
    expect(sent[1]).toEqual(['t2', 't5', 't1', 't4']);
    view.unmount();
  });

  it('a right sentence is read aloud once', () => {
    const speak = jest.fn();
    const Scene = (props: Partial<React.ComponentProps<typeof SentenceTrain>>) => (
      <SentenceTrain turn={sentence} disabled={false} onSubmit={() => {}} reduceMotion speak={speak} {...props} />
    );
    const view = render(<Scene />);
    for (const word of ['They', "didn't", 'go', 'to the museum.']) fireEvent.press(screen.getByRole('button', { name: `Thẻ ${word}` }));
    view.rerender(<Scene solved disabled />);
    view.rerender(<Scene solved disabled />);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith("They didn't go to the museum.");
    view.unmount();
  });
});

describe('Xưởng hình học', () => {
  it('an angle is turned on the protractor’s steps and sent as it is; its kind shows once right', () => {
    const sent: string[][] = [];
    const angle = turn('g1', 'geometry_build', { prompt: 'Tạo một góc tù.', shape: 'angle', angle_step: 5, readout: true, initial: 30 });
    const view = render(<GeometryWorkshop turn={angle} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion />);
    expect(screen.getByText('Góc: 30°')).toBeTruthy();
    for (let i = 0; i < 18; i++) fireEvent.press(screen.getByRole('button', { name: 'Tăng góc' }));
    expect(screen.getByText('Góc: 120°')).toBeTruthy();
    fireEvent.press(checkButton());
    expect(sent).toEqual([['angle:120']]);
    view.rerender(<GeometryWorkshop turn={angle} disabled onSubmit={() => {}} reduceMotion solved />);
    ms(50);
    expect(screen.getByText('Góc tù · 120°')).toBeTruthy();
    view.unmount();
  });

  it('without a readout the measure is read on the protractor', () => {
    const angle = turn('g2', 'geometry_build', { prompt: 'Tạo góc 45°.', shape: 'angle', angle_step: 5, readout: false, initial: 120 });
    const view = render(<GeometryWorkshop turn={angle} disabled={false} onSubmit={() => {}} reduceMotion />);
    expect(screen.getByText('Đọc số đo trên thước')).toBeTruthy();
    expect(screen.queryByText(/Góc: /)).toBeNull();
    view.unmount();
  });

  it('a rectangle is sized on the grid; once right its area and perimeter are written in', () => {
    const sent: string[][] = [];
    const rect = turn('g3', 'geometry_build', { prompt: 'Vẽ hình chữ nhật có diện tích 12 cm².', shape: 'rect', cols: 10, rows: 8,
      measure_unit: 'cm', initial: [1, 1] });
    const view = render(<GeometryWorkshop turn={rect} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion />);
    for (let i = 0; i < 3; i++) fireEvent.press(screen.getByRole('button', { name: 'Tăng cạnh ngang' }));
    for (let i = 0; i < 2; i++) fireEvent.press(screen.getByRole('button', { name: 'Tăng cạnh dọc' }));
    fireEvent.press(checkButton());
    expect(sent).toEqual([['rect:4x3']]);
    view.rerender(<GeometryWorkshop turn={rect} disabled onSubmit={() => {}} reduceMotion solved />);
    ms(50);
    expect(screen.getByText('Diện tích 12 cm² · Chu vi 14 cm')).toBeTruthy();
    view.unmount();
  });
});

describe('Cân bằng phương trình', () => {
  const equation = turn('b1', 'equation_balance', { prompt: 'Cân bằng.', max: 12, condition: 't°', elements: ['H', 'O'],
    species: [{ id: 's1', formula: 'H2', side: 'left', atoms: { H: 2 } }, { id: 's2', formula: 'O2', side: 'left', atoms: { O: 2 } },
      { id: 's3', formula: 'H2O', side: 'right', atoms: { H: 2, O: 1 } }] });

  it('the coefficients change the atoms on each pan; the balance levels only when every element matches', () => {
    const sent: string[][] = [];
    const view = render(<EquationBalance turn={equation} disabled={false} onSubmit={(a) => sent.push(a)} reduceMotion />);
    expect(screen.getByLabelText('O: vế trái 2, vế phải 1')).toBeTruthy();
    expect(screen.getByLabelText('Cân đang lệch: số nguyên tử hai vế chưa bằng nhau')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tăng hệ số của H2O' }));
    expect(screen.getByLabelText('H: vế trái 2, vế phải 4')).toBeTruthy();
    expect(screen.getByLabelText('Cân đang lệch: số nguyên tử hai vế chưa bằng nhau')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tăng hệ số của H2' }));
    expect(screen.getByLabelText('Cân thăng bằng: hai vế có số nguyên tử bằng nhau')).toBeTruthy();
    fireEvent.press(checkButton());
    expect(sent).toEqual([['2', '1', '2']]);
    fireEvent.press(screen.getByRole('button', { name: 'Đặt lại' }));
    expect(screen.getByLabelText('H: vế trái 2, vế phải 2')).toBeTruthy();
    view.unmount();
  });

  it('a coefficient never goes below 1', () => {
    const view = render(<EquationBalance turn={equation} disabled={false} onSubmit={() => {}} reduceMotion />);
    const down = screen.getByRole('button', { name: 'Giảm hệ số của H2' });
    expect(down.props.accessibilityState?.disabled ?? down.props.disabled).toBeTruthy();
    view.unmount();
  });
});

describe('the guides', () => {
  it('each subject gameplay has its three pages, drawn with its real scene', () => {
    for (const game of ['timeline', 'sentence', 'geometry', 'balance'] as const) {
      const pages = TUTORIALS[game];
      expect(pages.map((p) => p.tag)).toEqual(['Mục tiêu', 'Cách thao tác', 'Kết thúc']);
      for (const page of pages.slice(0, 2)) {
        const view = render(<TutorialArt scene={page.scene} petId="cat" petLevel={1} reduceMotion />);
        expect(screen.getByRole('image')).toBeTruthy();
        view.unmount();
      }
    }
  });
});
