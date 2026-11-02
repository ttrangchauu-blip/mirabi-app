import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Block, fault, trace, walk } from '../src/learning/codePath';
import type { Turn } from '../src/learning/types';
import { ForestQuest, vinesLeft } from '../src/games/ForestQuest';
import { labAnswer, MagicLab, placePart } from '../src/games/MagicLab';
import { zoneAt } from '../src/games/engine/drag';
import { CodePath } from '../src/screens/learning/games/CurriculumGames';
import { battleFoe, MathBattle, skillLevel } from '../src/screens/learning/games/MathBattle';
import { placeTile, scatter, WordForest } from '../src/screens/learning/games/WordForest';

// The visual games: Math Battle (Toán), Magic Lab (Khoa học), Word Forest (Tiếng Việt: the bridge, the door, the
// rescue), Robot Adventure (Tin học). Their rules and how they play, as a learner would.

const turn = (id: string, kind: Turn['kind'], prompt: Turn['prompt'], position = 0): Turn => ({ turn_id: id, position, kind, skill_label: '',
  prompt, hints_shown: [], hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 });
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });

describe('the interaction manager', () => {
  it('drops on the zone under the finger, the smallest one when zones overlap', () => {
    const zones = { bench: { x: 0, y: 0, width: 300, height: 200 }, slot: { x: 100, y: 50, width: 60, height: 60 } };
    expect(zoneAt({ x: 120, y: 70 }, zones)).toBe('slot');
    expect(zoneAt({ x: 20, y: 20 }, zones)).toBe('bench');
    expect(zoneAt({ x: 320, y: 20 }, zones)).toBeNull();
  });
});

describe('Math Battle (pure)', () => {
  it('monsters of two hit points through the forest, the cave and the castle, then the boss in its arena', () => {
    expect(battleFoe(12, 0)).toMatchObject({ index: 0, count: 5, id: 'slime', zone: 'forest', hp: 2, max: 2, boss: false });
    expect(battleFoe(12, 1)).toMatchObject({ index: 0, hp: 1 });
    expect(battleFoe(12, 2)).toMatchObject({ index: 1, id: 'mushroom', hp: 2 });
    expect(battleFoe(12, 4)).toMatchObject({ index: 2, id: 'golem', zone: 'cave' });
    expect(battleFoe(12, 6)).toMatchObject({ index: 3, zone: 'castle' });
    expect(battleFoe(12, 8)).toMatchObject({ index: 4, id: 'boss', zone: 'boss', hp: 4, max: 4, boss: true, phase: 1 });
    expect(battleFoe(12, 9)).toMatchObject({ boss: true, hp: 3, phase: 2 }); // the crystal shield
    expect(battleFoe(12, 11)).toMatchObject({ boss: true, hp: 1, phase: 3 }); // rage
    expect(battleFoe(12, 12)).toMatchObject({ boss: true, hp: 1 }); // never 0 while a question is open
    expect(battleFoe(3, 0)).toMatchObject({ boss: false, count: 2 }); // a short stage: no boss
  });

  it('powers the element skill at three right answers in a row, stronger with longer runs', () => {
    expect([0, 1, 2, 3, 5, 6, 9, 20].map(skillLevel)).toEqual([0, 0, 0, 1, 1, 2, 3, 3]);
  });
});

describe('Math Battle (play)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });
  const problem = (id: string, expression: string) => turn(id, 'math_input', { expression });
  const Battle = (props: Partial<React.ComponentProps<typeof MathBattle>>) => (
    <MathBattle problem={problem('m1', '12 + 7')} required={12} resolved={0} hearts={3} heartsMax={3} flash={null} wrongKey={0} petId="fox"
      petLevel={2} reduceMotion={false} running {...props} />
  );

  it('pet on the left, a monster on the right, bars for both, the problem under them', () => {
    const view = render(<Battle />);
    expect(screen.getByLabelText('Rừng phép thuật: pet đấu với Slime')).toBeTruthy();
    expect(screen.getByLabelText('Máu của pet: 3 trên 3')).toBeTruthy();
    expect(screen.getByLabelText('Máu của Slime: 2 trên 2')).toBeTruthy();
    expect(screen.getByLabelText('Màn 1 trên 5')).toBeTruthy();
    expect(screen.getByLabelText('Bài toán: 12 + 7 bằng mấy?')).toBeTruthy();
    view.unmount();
  });

  it('a right answer: the bolt hits (−1); at zero the monster is defeated and the next one walks in', () => {
    const view = render(<Battle />);
    view.rerender(<Battle problem={problem('m2', '9 − 4')} resolved={1} flash={{ turnId: 'm1', kind: 'hit' }} />);
    ms(520); // the fire pet's drawn attack winds up, and the bolt leaves as it lunges
    expect(screen.getByText('−1')).toBeTruthy();
    expect(screen.getByLabelText('Máu của Slime: 1 trên 2')).toBeTruthy();
    expect(screen.getByLabelText('Combo 1')).toBeTruthy();
    view.rerender(<Battle problem={problem('m3', '6 + 6')} resolved={2} flash={{ turnId: 'm2', kind: 'hit' }} />);
    ms(520);
    expect(screen.getByLabelText('Máu của Slime: 0 trên 2')).toBeTruthy(); // defeated
    ms(3000);
    expect(screen.getByLabelText('Rừng phép thuật: pet đấu với Nấm phép thuật')).toBeTruthy();
    expect(screen.getByLabelText('Máu của Nấm phép thuật: 2 trên 2')).toBeTruthy();
    expect(screen.getByLabelText('Màn 2 trên 5')).toBeTruthy();
    view.unmount();
  });

  it('three right in a row fire the pet\'s element skill; a wrong answer breaks the run', () => {
    const view = render(<Battle />);
    for (let i = 1; i <= 3; i++) {
      view.rerender(<Battle problem={problem(`m${i + 1}`, `${i} + ${i}`)} resolved={i} flash={{ turnId: `m${i}`, kind: 'hit' }} />);
      ms(4000);
    }
    expect(screen.getByLabelText('Combo 3: kỹ năng Cầu lửa')).toBeTruthy(); // fox: fire
    view.rerender(<Battle problem={problem('m4', '3 + 3')} resolved={3} hearts={2} flash={{ turnId: 'm3', kind: 'hit' }} wrongKey={1} />);
    ms(800);
    expect(screen.getByLabelText('Combo 0')).toBeTruthy();
    expect(screen.getByLabelText('Máu của pet: 2 trên 3')).toBeTruthy();
    view.unmount();
  });

  it('the boss fight: a crystal shield, then rage on its last point', () => {
    const view = render(<Battle resolved={9} problem={problem('b2', '7 × 8')} />);
    expect(screen.getByLabelText('Đấu trường trùm: pet đấu với Vua Pha Lê')).toBeTruthy();
    expect(screen.getByText('Trùm có khiên pha lê: giải đúng để phá khiên!')).toBeTruthy();
    view.rerender(<Battle resolved={11} problem={problem('b4', '9 × 9')} />);
    expect(screen.getByText('Trùm nổi giận: một câu đúng nữa là thắng!')).toBeTruthy();
    view.unmount();
  });
});

describe('Magic Lab', () => {
  const circuit = turn('lab1', 'lab_experiment', { title: 'Phòng thí nghiệm: lắp mạch', scene: 'circuit', aim: 'Lắp mạch để đèn sáng.',
    slots: [{ id: 'power', label: 'Nguồn điện' }, { id: 'lamp', label: 'Bóng đèn' }, { id: 'link', label: 'Chỗ nối' }],
    parts: [{ id: 'p1', name: 'Sợi len', art: 'wool' }, { id: 'p2', name: 'Viên pin', art: 'battery' }, { id: 'p3', name: 'Bóng đèn', art: 'bulb' },
      { id: 'p4', name: 'Dây đồng', art: 'copper' }] });

  it('a part goes to its place (or the first free one); one there goes back to the bench', () => {
    const slots = ['power', 'lamp', 'link'];
    expect(placePart({}, slots, 'p2')).toEqual({ power: 'p2' });
    expect(placePart({ power: 'p2' }, slots, 'p4', 'link')).toEqual({ power: 'p2', link: 'p4' });
    expect(placePart({ power: 'p2', link: 'p4' }, slots, 'p1', 'link')).toEqual({ power: 'p2', link: 'p1' });
    expect(placePart({ power: 'p2' }, slots, 'p2', 'lamp')).toEqual({ lamp: 'p2' }); // moved, never twice
    expect(placePart({ power: 'p2' }, slots, 'p3', 'nowhere')).toEqual({ power: 'p2' });
    expect(labAnswer({ power: 'p2', lamp: 'p3', link: 'p4' }, slots)).toEqual(['power:p2', 'lamp:p3', 'link:p4']);
  });

  it('set up by hand and switched on; a wrong part says why and goes back; done right, the result shows until the next one', () => {
    jest.useFakeTimers();
    const sent: string[][] = [];
    const Lab = (props: Partial<React.ComponentProps<typeof MagicLab>>) => (
      <MagicLab turn={circuit} disabled={false} onSubmit={(a) => sent.push(a)} petId="cat" petLevel={1}
        reduceMotion={false} {...props} />
    );
    const view = render(<Lab />);
    expect(screen.getByText('Lắp mạch để đèn sáng.')).toBeTruthy(); // the pet gives the task
    expect(screen.getByRole('button', { name: 'Bật công tắc' }).props.accessibilityState.disabled).toBe(true);
    for (const name of ['Viên pin', 'Bóng đèn', 'Sợi len']) fireEvent.press(screen.getByRole('button', { name: `Đặt ${name}` }));
    expect(screen.getByLabelText('Chỗ nối: Sợi len')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bật công tắc' }));
    expect(sent).toEqual([['power:p2', 'lamp:p3', 'link:p1']]);
    view.rerender(<Lab feedback={{ text: 'Len là vật cách điện: mạch bị hở, đèn không sáng.', tone: 'bad', kept: ['power', 'lamp'] }} />);
    expect(screen.getByText('Len là vật cách điện: mạch bị hở, đèn không sáng.')).toBeTruthy();
    ms(1200);
    expect(screen.getByLabelText('Chỗ nối: trống')).toBeTruthy(); // the wool is back on the bench…
    expect(screen.getByLabelText('Nguồn điện: Viên pin')).toBeTruthy(); // …the right parts stayed
    fireEvent.press(screen.getByRole('button', { name: 'Đặt Dây đồng' }));
    fireEvent.press(screen.getByRole('button', { name: 'Bật công tắc' }));
    expect(sent[1]).toEqual(['power:p2', 'lamp:p3', 'link:p4']);
    // The server counted it: this one still shows, working (the game screen's card explains it and moves on).
    const next = turn('lab2', 'lab_experiment', { ...circuit.prompt, aim: 'Thí nghiệm thứ hai.' });
    view.rerender(<Lab solved={{ turnId: 'lab1' }} />);
    expect(screen.getByText('Lắp mạch để đèn sáng.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bật công tắc' })).toBeNull();
    view.rerender(<Lab turn={next} solved={null} />);
    expect(screen.getByText('Thí nghiệm thứ hai.')).toBeTruthy();
    expect(screen.getByLabelText('Nguồn điện: trống')).toBeTruthy(); // a clean bench
    view.unmount();
    jest.useRealTimers();
  });

  it('the magnet: done right, the magnetic objects fly up and stick, what was left on the bench stays put; a wrong one fizzles', () => {
    jest.useFakeTimers();
    const magnet = turn('mg1', 'lab_experiment', { scene: 'magnet', aim: 'Đặt vật bị nam châm hút vào vùng hút.',
      slots: [{ id: 'pull', label: 'Vùng hút' }],
      parts: [{ id: 'p1', name: 'Dây đồng', art: 'copper' }, { id: 'p2', name: 'Đinh sắt', art: 'nail' }, { id: 'p3', name: 'Thước nhựa', art: 'ruler' }] });
    const sent: string[][] = [];
    const Lab = (props: Partial<React.ComponentProps<typeof MagicLab>>) => (
      <MagicLab turn={magnet} disabled={false} onSubmit={(a) => sent.push(a)} petId="cat" petLevel={1}
        reduceMotion={false} {...props} />
    );
    const view = render(<Lab />);
    expect(screen.getByLabelText('Nam châm')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đặt Dây đồng' }));
    fireEvent.press(screen.getByRole('button', { name: 'Đưa nam châm lại gần' }));
    view.rerender(<Lab feedback={{ text: 'Đồng là kim loại nhưng không có từ tính.', tone: 'bad', kept: [] }} />);
    expect(screen.getByLabelText('Thí nghiệm chưa thành công')).toBeTruthy(); // a grey puff, drawn
    ms(1200);
    expect(screen.getByLabelText('Vùng hút: trống')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đặt Đinh sắt' }));
    fireEvent.press(screen.getByRole('button', { name: 'Đưa nam châm lại gần' }));
    expect(sent).toEqual([['pull:p1'], ['pull:p2']]);
    view.rerender(<Lab solved={{ turnId: 'mg1' }} />);
    ms(2000);
    expect(screen.getByLabelText('Nam châm đã hạ xuống')).toBeTruthy();
    expect(screen.getByLabelText('Đinh sắt bị nam châm hút')).toBeTruthy();
    expect(screen.getByLabelText('Dây đồng đứng yên')).toBeTruthy();
    expect(screen.getByLabelText('Thước nhựa đứng yên')).toBeTruthy();
    view.unmount();
    jest.useRealTimers();
  });

  it('the seed is watered (the soil darkens) before it grows', () => {
    jest.useFakeTimers();
    const plant = turn('pl1', 'lab_experiment', { scene: 'plant', aim: 'Xếp các giai đoạn.', slots: [{ id: 's1', label: 'Bước 1' }, { id: 's2', label: 'Bước 2' }],
      parts: [{ id: 'p1', name: 'Hạt', art: 'stage:1' }, { id: 'p2', name: 'Cây ra hoa', art: 'stage:5' }] });
    const Lab = (props: Partial<React.ComponentProps<typeof MagicLab>>) => (
      <MagicLab turn={plant} disabled={false} onSubmit={() => {}} petId="cat" petLevel={1} reduceMotion={false} {...props} />
    );
    const view = render(<Lab />);
    fireEvent.press(screen.getByRole('button', { name: 'Đặt Hạt' }));
    fireEvent.press(screen.getByRole('button', { name: 'Đặt Cây ra hoa' }));
    fireEvent.press(screen.getByRole('button', { name: 'Gieo hạt và quan sát' }));
    view.rerender(<Lab solved={{ turnId: 'pl1' }} />);
    expect(screen.getByLabelText('Chậu cây, giai đoạn 0')).toBeTruthy();
    ms(900);
    expect(screen.getByLabelText('Chậu cây, giai đoạn 1, đất đã được tưới ẩm')).toBeTruthy(); // watered: the seed is sown
    ms(2200);
    expect(screen.getByLabelText('Chậu cây, giai đoạn 5, đất đã được tưới ẩm')).toBeTruthy(); // in flower
    view.unmount();
    jest.useRealTimers();
  });

  it('draws every scene of the bundled labs', () => {
    for (const scene of ['circuit', 'shadow', 'water', 'plant', 'magnet'] as const) {
      const slots = scene === 'plant' ? [{ id: 's1', label: 'Bước 1' }, { id: 's2', label: 'Bước 2' }] : scene === 'circuit'
        ? [{ id: 'link', label: 'Chỗ nối' }] : scene === 'magnet' ? [{ id: 'pull', label: 'Vùng hút 1' }, { id: 'pull2', label: 'Vùng hút 2' }]
          : [{ id: scene === 'water' ? 'tool' : 'between', label: 'Chỗ đặt' }];
      const parts = scene === 'plant' ? [{ id: 'p1', name: 'Hạt', art: 'stage:1' }, { id: 'p2', name: 'Cây mầm', art: 'stage:3' }]
        : scene === 'water' ? [{ id: 'p1', name: 'Làm nóng', art: 'hot' }, { id: 'p2', name: 'Làm lạnh', art: 'cold' }]
          : [{ id: 'p1', name: 'Tấm kính', art: 'glass' }, { id: 'p2', name: 'Quyển sách', art: 'book' }];
      const view = render(<MagicLab turn={turn(`x-${scene}`, 'lab_experiment', { scene, aim: 'Thử', slots, parts, from: 'ice', to: scene === 'shadow' ? 'dark' : 'water' })}
        disabled={false} onSubmit={() => {}} petId="dolphin" petLevel={1} reduceMotion />);
      expect(screen.getByRole('button', { name: `Đặt ${parts[0].name}` })).toBeTruthy();
      view.unmount();
    }
  });
});

describe('Word Forest', () => {
  it('a piece goes to the first free plank, or the plank it is dropped on (the piece there goes back)', () => {
    expect(placeTile([null, null, null], 'a')).toEqual(['a', null, null]);
    expect(placeTile(['a', null, null], 'b', 2)).toEqual(['a', null, 'b']);
    expect(placeTile(['a', null, 'b'], 'c', 0)).toEqual(['c', null, 'b']); // "a" is back on the floor
    expect(placeTile(['a', null, 'b'], 'a', 1)).toEqual([null, 'a', 'b']); // moved, never twice
    expect(placeTile(['a', 'b'], 'c')).toEqual(['a', 'b']); // no free plank
  });

  it('scatters the pieces on the floor without any two touching, the same way each time', () => {
    for (const width of [180, 320, 390]) {
      const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
      const spots = scatter(ids, width, 'turn-1');
      expect(scatter(ids, width, 'turn-1')).toEqual(spots);
      for (const a of spots) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x + 54).toBeLessThanOrEqual(width + 0.001);
        for (const b of spots) {
          if (a === b) continue;
          expect(Math.abs(a.x - b.x) >= 54 || Math.abs(a.y - b.y) >= 54).toBe(true);
        }
      }
    }
  });

  it('a right word builds the bridge, the pet runs across and waits; "Tiếp theo" moves the forest on to the next brook', () => {
    jest.useFakeTimers();
    const cat = turn('w1', 'word_build', { picture: '🐱', unit: 'letter', tiles: [{ id: 'a', text: 'm' }, { id: 'b', text: 'è' }, { id: 'c', text: 'o' }] });
    const dog = turn('w2', 'word_build', { picture: '🐶', unit: 'letter', tiles: [{ id: 'd', text: 'ch' }, { id: 'e', text: 'ó' }] });
    const sent: string[][] = [];
    const Forest = ({ at, collected, solved }: { at: Turn; collected: number; solved?: boolean }) => (
      <WordForest turn={at} disabled={false} solved={solved} onSubmit={(ids) => sent.push(ids)} collected={collected} total={10} petId="cat" petLevel={1} reduceMotion={false} />
    );
    const view = render(<Forest at={cat} collected={0} />);
    for (const x of ['m', 'è', 'o']) fireEvent.press(screen.getByRole('button', { name: `Chữ ${x}` }));
    expect(screen.getByLabelText('Cây cầu: mèo')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Xây cầu' }));
    expect(sent).toEqual([['a', 'b', 'c']]);
    view.rerender(<Forest at={cat} collected={1} solved />);
    expect(screen.getByLabelText('Cây cầu: mèo')).toBeTruthy(); // the bridge stays while the pet runs over it
    expect(screen.getByRole('button', { name: 'Xây cầu' }).props.accessibilityState?.disabled).toBe(true);
    ms(2600);
    expect(screen.getByLabelText('Cây cầu: mèo')).toBeTruthy(); // and until the next word
    view.rerender(<Forest at={dog} collected={1} />);
    expect(screen.getByLabelText('Cây cầu: mèo')).toBeTruthy(); // the forest scrolls it away
    ms(1000);
    expect(screen.getByLabelText('Cây cầu: __')).toBeTruthy(); // the next brook: two planks missing ("ch", "ó")
    expect(screen.getByLabelText('Pet đã nhận 1 trên 10 mảnh sách')).toBeTruthy();
    view.unmount();
    jest.useRealTimers();
  });

  it('the rescue: every right answer breaks a layer of vines; the last frees the creature and opens the chest', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => vinesLeft(d, 6))).toEqual([3, 3, 2, 2, 1, 1, 0]);
    jest.useFakeTimers();
    const Quest = ({ done, wrong = 0, quest = 'rescue' as const }: { done: number; wrong?: number; quest?: 'rescue' | 'door' }) => (
      <ForestQuest quest={quest} done={done} total={6} wrongKey={wrong} petId="bunny" petLevel={1} reduceMotion={false} running />
    );
    const view = render(<Quest done={0} />);
    expect(screen.getByLabelText('Sinh vật bị mắc kẹt, còn 3 lớp dây gai')).toBeTruthy();
    view.rerender(<Quest done={2} />);
    expect(screen.getByLabelText('Sinh vật bị mắc kẹt, còn 2 lớp dây gai')).toBeTruthy();
    view.rerender(<Quest done={6} />);
    expect(screen.getByLabelText('Sinh vật đã được giải cứu, rương kho báu mở')).toBeTruthy();
    view.rerender(<Quest quest="door" done={2} />);
    expect(screen.getByLabelText('Cánh cửa bí mật thứ 3 trên 6')).toBeTruthy();
    ms(3000);
    view.unmount();
    jest.useRealTimers();
  });
});

describe('Robot Adventure', () => {
  const level = { cols: 5, rows: 3, start: { x: 0, y: 1, dir: 'E' as const }, goal: { x: 4, y: 1 }, walls: [[2, 1]] as [number, number][],
    blocks: ['forward', 'left', 'right', 'repeat'], max_blocks: 6 };

  it('knows which block each move comes from, and where a program goes wrong', () => {
    const program: Block[] = ['left', 'repeat:2', 'forward', 'end', 'right'];
    expect(trace(program)).toEqual([0, 2, 2, 4]);
    expect(trace(['repeat:2', 'forward'])).toBeNull(); // an open loop
    const bumped: Block[] = ['forward', 'forward', 'forward'];
    expect(fault(bumped, walk(level, bumped)!)).toEqual({ reason: 'wall', move: 2, block: 1, blocked: { x: 2, y: 1 } });
    const short: Block[] = ['left'];
    expect(fault(short, walk(level, short)!)).toMatchObject({ reason: 'short', block: null });
    const way: Block[] = ['right', 'forward', 'left', 'repeat:4', 'forward', 'end', 'left', 'forward'];
    expect(fault(way, walk(level, way)!)).toBeNull();
  });

  it('runs the robot step by step, then names the step that went wrong and lights its block', () => {
    jest.useFakeTimers();
    const runs: Block[][] = [];
    render(<CodePath turn={turn('lv1', 'code_path', level)} disabled={false} onRun={(p) => runs.push(p)} petId="dolphin" petLevel={1} reduceMotion={false} />);
    for (let i = 0; i < 3; i++) fireEvent.press(screen.getByRole('button', { name: 'Thêm lệnh Tiến' }));
    fireEvent.press(screen.getByRole('button', { name: 'Chạy' }));
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeTruthy(); // it is rolling
    expect(runs).toHaveLength(0); // checked once the run is over
    ms(3000);
    expect(runs).toEqual([['forward', 'forward', 'forward']]);
    expect(screen.getByText('Bước 2 (Tiến): robot đụng tảng đá.')).toBeTruthy();
    expect(screen.getByLabelText('Tảng đá chặn đường')).toBeTruthy(); // the drawn boulder it bumped
    expect(screen.getByRole('button', { name: 'Gỡ lệnh Tiến, bước sai' })).toBeTruthy();
    expect(screen.getByLabelText(/Robot ở cột 2, hàng 2/)).toBeTruthy(); // stopped before the rock
    // Fixing the program clears the mark.
    fireEvent.press(screen.getByRole('button', { name: 'Gỡ lệnh Tiến, bước sai' }));
    expect(screen.queryByText(/robot đụng tảng đá/)).toBeNull();
    jest.useRealTimers();
  });
});

describe('Stars on the result', () => {
  it('give 3 from 90% right at the first try, 2 from 70%, else 1; none for a stage not completed', () => {
    const { stageStars } = require('../src/screens/learning/ResultScreen');
    expect(stageStars('completed', 9, 10)).toBe(3);
    expect(stageStars('completed', 7, 10)).toBe(2);
    expect(stageStars('completed', 2, 10)).toBe(1);
    expect(stageStars('abandoned', 10, 10)).toBe(0);
    expect(stageStars('failed', 10, 10)).toBe(0);
  });
});
