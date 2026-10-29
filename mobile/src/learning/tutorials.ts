import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IconName } from '../ui/kit';
import { learningApi } from './api';
import type { GameId } from './types';

/** What a guide page shows above its text: a small, animated copy of the real game. */
export type TutorialScene =
  /** A target falling in the sky: an English word (Anh → Việt) or a meteor carrying a Vietnamese meaning. */
  | { kind: 'fall'; variant: 'word' | 'meteor'; label: string }
  /** The answer typed letter by letter into the boxes, then (right: the pet shoots by itself) what the hit shows. */
  | { kind: 'type'; variant: 'word' | 'meteor'; label: string; answer: string; result: string }
  /** A monster carrying a sum walks toward the base. */
  | { kind: 'monster'; expression: string }
  /** The number pad: the answer is keyed in, then the submit button. */
  | { kind: 'numpad'; expression: string; answer: string; submit: string }
  /** A sentence with a gap and the gates; with `demo` the right gate is tapped and fills the gap. */
  | { kind: 'gates'; sentence: string; options: string[]; right: number; demo?: boolean }
  /** Pieces tapped in order onto the bridge; with `demo` they move one by one, then "Kiểm tra". */
  | { kind: 'planks'; meaning: string; tokens: string[]; order: number[]; demo?: boolean }
  /** The math bridge: each right answer lays one more span. */
  | { kind: 'spans'; equation: string; answer: string }
  /** A comparison: the right sign is tapped. */
  | { kind: 'compare'; left: string; right: string; signs: string[]; right_sign: number }
  /** How the stage ends: one line per rule. */
  | { kind: 'rules'; items: { icon: IconName; text: string; tone: 'good' | 'bad' | 'info' }[] };

export type TutorialPage = { tag: string; title: string; body: string; scene: TutorialScene };

// Rules shared by several games. Every game plays in Học tập: no score, no target ever lands (meteors and monsters
// stop short and wait), and the end of the time is never a loss.
const TIME_UP = { icon: 'time-outline' as IconName, tone: 'info' as const, text: 'Hết giờ không phải thua: chọn Học thêm 5 phút hoặc Kết thúc.' };
const OUT_OF_HEARTS = { icon: 'heart-dislike-outline' as IconName, tone: 'bad' as const, text: 'Hết 3 tim thì chặng dừng lại, bạn có thể chơi lại.' };
const GRAMMAR_END: TutorialPage = { tag: 'Kết thúc', title: 'Khi nào xong chặng?', body: 'Mỗi câu sai đều được làm lại, nên cứ bình tĩnh đọc kỹ.',
  scene: { kind: 'rules', items: [
    { icon: 'checkmark-circle-outline', tone: 'good', text: 'Trả lời đúng hết các câu là hoàn thành chặng.' },
    { icon: 'heart-outline', tone: 'bad', text: 'Sai mất 1 tim, xem đáp án và giải thích. Câu đó sẽ quay lại sau.' },
    OUT_OF_HEARTS, TIME_UP] } };
const VOCAB_END = (extra: { icon: IconName; text: string; tone: 'good' | 'bad' | 'info' }): TutorialPage => ({
  tag: 'Kết thúc', title: 'Khi nào xong chặng?', body: 'Ở đây không mất tim, cứ thong thả nhớ từ.',
  scene: { kind: 'rules', items: [
    { icon: 'checkmark-circle-outline', tone: 'good', text: 'Bắn vỡ hết các từ trong chặng là hoàn thành.' },
    { icon: 'pause-circle-outline', tone: 'info', text: 'Từ dừng lại trước mặt đất và chờ bạn, không bao giờ mất tim.' },
    extra, TIME_UP] } });

/** "Cách chơi" of each game, 3 short pages: goal, controls (animated), and how the stage ends. Written from the game's
 * real rules (backend learning_engine.WRONG_POLICY, hearts_for), so each game says only what it does. */
export const TUTORIALS: Record<GameId, TutorialPage[]> = {
  word_shooter: [
    { tag: 'Mục tiêu', title: 'Bắn vỡ từ đang rơi', body: 'Từ tiếng Anh rơi xuống bầu trời. Bắn vỡ từ để xem nghĩa tiếng Việt và nghe phát âm.',
      scene: { kind: 'fall', variant: 'word', label: 'cat' } },
    { tag: 'Cách thao tác', title: 'Gõ lại đúng từ', body: 'Gõ lại từ đang rơi vào các ô chữ. Gõ đúng là pet tự bắn, không cần nhấn gì. Gõ sai thì sửa lại. Bí thì nhấn Gợi ý.',
      scene: { kind: 'type', variant: 'word', label: 'cat', answer: 'cat', result: 'con mèo' } },
    VOCAB_END({ icon: 'bulb-outline', tone: 'info', text: 'Gợi ý cho biết số chữ cái, rồi cách gõ từng chữ.' }),
  ],
  meteor: [
    { tag: 'Mục tiêu', title: 'Bắn thiên thạch', body: 'Mỗi thiên thạch mang một nghĩa tiếng Việt. Nhớ ra từ tiếng Anh để pet bắn vỡ nó.',
      scene: { kind: 'fall', variant: 'meteor', label: 'con mèo' } },
    { tag: 'Cách thao tác', title: 'Gõ từ tiếng Anh', body: 'Số ô cho biết từ có mấy chữ cái. Gõ đúng từ là pet tự bắn. Bí thì nhấn Gợi ý (chữ đầu, chữ cuối) hoặc Xem đáp án.',
      scene: { kind: 'type', variant: 'meteor', label: 'con mèo', answer: 'cat', result: 'cat — con mèo' } },
    VOCAB_END({ icon: 'eye-outline', tone: 'info', text: 'Đã xem đáp án thì từ đó quay lại để bạn gõ lại.' }),
  ],
  gate: [
    { tag: 'Mục tiêu', title: 'Chọn cổng đúng', body: 'Mỗi câu có một chỗ trống. Chọn đáp án đúng để pet đi qua cổng.',
      scene: { kind: 'gates', sentence: 'She ___ a student.', options: ['is', 'are', 'am'], right: 0 } },
    { tag: 'Cách thao tác', title: 'Chạm vào một cổng', body: 'Đọc câu và tình huống, rồi chạm vào cổng có đáp án đúng. Bí thì nhấn Gợi ý.',
      scene: { kind: 'gates', sentence: 'She ___ a student.', options: ['is', 'are', 'am'], right: 0, demo: true } },
    GRAMMAR_END,
  ],
  bridge: [
    { tag: 'Mục tiêu', title: 'Xếp câu thành cầu', body: 'Ghép các mảnh từ thành câu tiếng Anh có nghĩa giống câu tiếng Việt.',
      scene: { kind: 'planks', meaning: 'Tôi thích mèo.', tokens: ['cats', 'I', 'like'], order: [1, 2, 0] } },
    { tag: 'Cách thao tác', title: 'Chạm theo thứ tự', body: 'Chạm các mảnh theo đúng thứ tự. Chạm mảnh đã đặt để gỡ ra, hoặc Xếp lại. Xong thì nhấn Kiểm tra.',
      scene: { kind: 'planks', meaning: 'Tôi thích mèo.', tokens: ['cats', 'I', 'like'], order: [1, 2, 0], demo: true } },
    GRAMMAR_END,
  ],
  grammar: [
    { tag: 'Mục tiêu', title: 'Cổng và cầu ngữ pháp', body: 'Chặng có hai kiểu câu: chọn cổng đúng cho chỗ trống, hoặc xếp mảnh từ thành câu.',
      scene: { kind: 'gates', sentence: 'They ___ happy.', options: ['is', 'are', 'am'], right: 1 } },
    { tag: 'Cách thao tác', title: 'Chọn cổng hoặc xếp mảnh', body: 'Câu có chỗ trống: chạm cổng đúng. Câu cần xếp: chạm các mảnh theo thứ tự rồi nhấn Kiểm tra.',
      scene: { kind: 'planks', meaning: 'Tôi thích mèo.', tokens: ['cats', 'I', 'like'], order: [1, 2, 0], demo: true } },
    GRAMMAR_END,
  ],
  defense: [
    { tag: 'Mục tiêu', title: 'Bảo vệ căn cứ', body: 'Quái vật mang phép tính tiến về căn cứ. Giải đúng để pet tấn công quái vật.',
      scene: { kind: 'monster', expression: '12 + 7' } },
    { tag: 'Cách thao tác', title: 'Bấm số rồi Tấn công', body: 'Bấm đáp án trên bàn phím số rồi nhấn Tấn công. Dùng ± cho số âm, mở Nháp để tính.',
      scene: { kind: 'numpad', expression: '12 + 7', answer: '19', submit: 'Tấn công' } },
    { tag: 'Kết thúc', title: 'Khi nào xong chặng?', body: 'Quái vật dừng lại trước căn cứ và chờ bạn giải.',
      scene: { kind: 'rules', items: [
        { icon: 'checkmark-circle-outline', tone: 'good', text: 'Giải đúng hết các phép tính là hoàn thành chặng.' },
        { icon: 'heart-outline', tone: 'bad', text: 'Sai mất 1 tim. Sửa đáp án rồi tấn công tiếp.' },
        OUT_OF_HEARTS, TIME_UP] } },
  ],
  math_bridge: [
    { tag: 'Mục tiêu', title: 'Xây cầu toán học', body: 'Mỗi câu đúng đặt thêm một đoạn cầu. Làm hết các câu để hoàn thành cây cầu.',
      scene: { kind: 'spans', equation: '8 + ▢ = 15', answer: '7' } },
    { tag: 'Cách thao tác', title: 'Điền số hoặc chọn dấu', body: 'Tìm số còn thiếu rồi nhấn Đặt đoạn cầu. Câu so sánh: chạm dấu >, < hoặc =.',
      scene: { kind: 'compare', left: '15', right: '9', signs: ['>', '<', '='], right_sign: 0 } },
    { tag: 'Kết thúc', title: 'Khi nào xong chặng?', body: 'Mỗi câu sai đều có cơ hội làm lại.',
      scene: { kind: 'rules', items: [
        { icon: 'checkmark-circle-outline', tone: 'good', text: 'Xây đủ các đoạn cầu là hoàn thành chặng.' },
        { icon: 'heart-outline', tone: 'bad', text: 'Sai mất 1 tim. Điền số sai thì sửa lại; chọn dấu sai thì xem đáp án, câu quay lại sau.' },
        OUT_OF_HEARTS, TIME_UP] } },
  ],
};

type Stored = { seen?: GameId[]; /** Finished while the server could not be reached: sent again on the next load. */ unsent?: GameId[] };

/**
 * Which games' guides this account has finished. The server keeps it per account (so it is skipped on every device);
 * the device keeps a copy per account, so a guide finished offline is not shown again and is sent later.
 * `seen` is null until known: the game then shows its guide (seeing it twice beats never seeing it).
 */
export function useTutorials(userId: number) {
  const key = `mirabi.learning.tutorials:${userId}`;
  const [seen, setSeen] = useState<ReadonlySet<GameId> | null>(null);
  const stored = useRef<Required<Stored>>({ seen: [], unsent: [] });
  const save = useCallback(() => { void AsyncStorage.setItem(key, JSON.stringify(stored.current)).catch(() => {}); }, [key]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        const local: Stored = raw ? JSON.parse(raw) : {};
        stored.current = { seen: [...new Set([...stored.current.seen, ...(local.seen ?? [])])], unsent: local.unsent ?? [] };
      } catch { /* a corrupt copy is ignored: the server knows */ }
      try {
        for (const game of stored.current.unsent) await learningApi.finishTutorial(game);
        const server = await learningApi.tutorials();
        stored.current = { seen: [...new Set([...stored.current.seen, ...server])], unsent: [] };
        save();
      } catch { /* offline: the device copy decides until the next load */ }
      if (active) setSeen(new Set(stored.current.seen));
    })();
    return () => { active = false; };
  }, [key, save]);

  /** "Bắt đầu" on the last page: the guide is skipped from now on. */
  const finish = useCallback((game: GameId) => {
    if (!stored.current.seen.includes(game)) stored.current = { ...stored.current, seen: [...stored.current.seen, game] };
    setSeen(new Set(stored.current.seen));
    save();
    learningApi.finishTutorial(game).catch(() => {
      if (!stored.current.unsent.includes(game)) stored.current = { ...stored.current, unsent: [...stored.current.unsent, game] };
      save();
    });
  }, [save]);

  const needs = useCallback((game: GameId) => !seen?.has(game), [seen]);
  return { needs, finish };
}
