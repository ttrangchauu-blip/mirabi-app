import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IconName } from '../ui/kit';
import { learningApi } from './api';
import type { Block } from './codePath';
import type { CurriculumGameId, GameId, LessonGameId, SubjectGameId } from './types';

/**
 * The version of the guides. Raise it when a guide changes enough to be shown again once to everyone who finished the
 * last one (the backend keeps the version each guide was finished at: learning.TUTORIAL_VERSION, keep both in step).
 * 2: the falling words shoot by themselves (no "Bắn"), several fall at once, and every game's rules were re-checked.
 * 3: the vocabulary games have VOCAB_HEARTS hearts and VOCAB_STAGE_WORDS words a stage; their words fall to the ground.
 */
export const TUTORIAL_VERSION = 3;

/** The vocabulary games' rules, as the backend applies them (learning_engine.VOCAB_HEARTS, VOCAB_STAGE_WORDS: keep in
 * step): every stage has this many different words, and a word that lands unbroken costs one of these hearts. */
export const VOCAB_HEARTS = 5;
export const VOCAB_STAGE_WORDS = 15;
/** The curriculum games' questions per stage (backend curriculum_games.STAGE_TURNS: keep in step). */
export const CURRICULUM_STAGE: Record<Exclude<CurriculumGameId, LessonGameId>, number> = { word_builder: 10, spelling_detective: 10, sorting: 10, code_path: 5 };

/** A target in a guide's sky: the word (or the meaning on a meteor) and how many letters its answer has, per word. */
export type TutorialTarget = { label: string; letters?: number[] };

/** What a guide page shows above its text: a small, animated copy of the real game. */
export type TutorialScene =
  /** Words falling in the sky, the pet at the bottom. The first one is aimed: the answer boxes ride under it, as in the
   * game; the others carry small empty boxes. */
  | { kind: 'fall'; variant: 'word' | 'meteor'; targets: TutorialTarget[] }
  /** The answer typed letter by letter into the boxes under the aimed word; right, the pet shoots by itself, the bullet
   * follows the falling word, it breaks and shows `result` (and `sub`) where it was hit. */
  | { kind: 'type'; variant: 'word' | 'meteor'; target: TutorialTarget; answer: string; result: string; sub?: string }
  /** A monster carrying a sum walks toward the base and stops before it. */
  | { kind: 'monster'; expression: string }
  /** The number pad: the answer is keyed in, then the submit button. */
  | { kind: 'numpad'; expression: string; answer: string; submit: string }
  /** A sentence with a gap and the gates; with `demo` the right gate is tapped and fills the gap. */
  | { kind: 'gates'; sentence: string; options: string[]; right: number; demo?: boolean }
  /** Pieces tapped in order onto the bridge; with `demo` they move one by one, then "Kiểm tra". */
  | { kind: 'planks'; meaning: string; tokens: string[]; order: number[]; demo?: boolean }
  /** The math bridge: each question done lays one more span. */
  | { kind: 'spans'; equation: string; answer: string }
  /** A comparison: the right sign is tapped. */
  | { kind: 'compare'; left: string; right: string; signs: string[]; right_sign: number }
  /** How the stage ends: one line per rule. */
  | { kind: 'rules'; items: { icon: IconName; text: string; tone: 'good' | 'bad' | 'info' }[] }
  // The curriculum games draw their real play area (games/CurriculumGames.tsx); `demo` plays the move step by step.
  /** Ghép chữ: the picture and its pieces; with `demo` they are tapped in order, then "Kiểm tra". */
  | { kind: 'word_build'; picture: string; unit: 'letter' | 'syllable'; pieces: string[]; shuffled: number[]; demo?: boolean }
  /** Thám tử chính tả: the sentence; with `demo` the misspelled word is tapped and the right spelling chosen. */
  | { kind: 'spell_fix'; words: string[]; wrong: number; options: string[]; right: number; demo?: boolean }
  /** Phân loại cùng pet: the groups and a card; with `demo` the card goes over its group and is placed. */
  | { kind: 'sort'; title: string; groups: { id: string; label: string; icon: string }[]; card: { text: string; picture: string }; right: string; demo?: boolean }
  /** Sắp xếp thứ tự: the cards; with `demo` they are tapped in order, then "Kiểm tra". */
  | { kind: 'order'; prompt: string; items: string[]; shuffled: number[]; first?: string; last?: string; demo?: boolean }
  /** Ghép cặp: the two columns; with `demo` a left card is chosen, then its partner, pair by pair. */
  | { kind: 'match'; prompt: string; pairs: [string, string][]; rightOrder: number[]; demo?: boolean }
  /** Chọn đáp án có giải thích: a question; with `demo` a wrong option is tried (its reason shows), then the right one. */
  | { kind: 'choice'; style: 'situation' | 'quiz'; question: string; options: string[]; right: number; wrong: number; demo?: boolean }
  /** Lập trình đường đi: a small map; `build` adds the blocks one by one, `run` walks the pet along them. */
  | { kind: 'code'; cols: number; rows: number; start: { x: number; y: number; dir: 'N' | 'E' | 'S' | 'W' }; goal: { x: number; y: number };
      walls: [number, number][]; program: Block[]; mode: 'build' | 'run' }
  /** Phòng thí nghiệm: the circuit on the bench; `build` with its parts placed, `run` with the switch on (the bulb lit). */
  | { kind: 'lab'; mode: 'empty' | 'build' | 'run' }
  /** The subject gameplays (games/subject): the real scene; `demo` plays the move (empty → half done → solved). */
  | { kind: 'subject'; game: SubjectGameId; mode: 'empty' | 'demo' };

export type TutorialPage = { tag: string; title: string; body: string; scene: TutorialScene };
type Rule = { icon: IconName; text: string; tone: 'good' | 'bad' | 'info' };

// Every game is played in Học tập (labels.PLAY_MODE). The rules below are the backend's for that mode
// (learning_engine.WRONG_POLICY, HEART_ON_WRONG, hearts_for; learning.falls, answer_event, reveal_event, miss_event,
// completion_state):
// - vocabulary: 15 different words a stage, falling to the ground; one that lands unbroken costs 1 of 5 hearts, a wrong
//   answer costs none (it is fixed while the word falls); a revealed or missed word is not asked again in the stage;
// - every other game: 3 hearts, every wrong answer costs one; at 0 the stage stops (it can be played again);
// - "Xem đáp án" never costs a heart; outside vocabulary that question comes back until it is answered right;
// - a wrong choice (gates, sentence order, comparison) shows the answer and its explanation, and comes back later;
// - the end of the time is never a loss.
const TIME_UP: Rule = { icon: 'time-outline', tone: 'info', text: 'Hết giờ không phải thua: chọn Học thêm 5 phút hoặc Kết thúc.' };
const OUT_OF_HEARTS: Rule = { icon: 'heart-dislike-outline', tone: 'bad', text: 'Hết 3 tim thì chặng dừng lại, bạn có thể chơi lại.' };
const end = (body: string, items: Rule[]): TutorialPage => ({ tag: 'Kết thúc', title: 'Khi nào xong chặng?', body, scene: { kind: 'rules', items } });

/** "Cách chơi" of each game, 3 short pages: goal, controls (animated like the real screen), and how the stage ends.
 * Each says only what its game does: check the rules above (and the game) before changing a word. */
export const TUTORIALS = {
  word_shooter: [
    { tag: 'Mục tiêu', title: 'Bắn vỡ từ tiếng Anh',
      body: `Mỗi chặng có ${VOCAB_STAGE_WORDS} từ tiếng Anh lần lượt rơi xuống, có lúc vài từ cùng lúc. Gõ lại đúng từ để pet bắn vỡ trước khi từ chạm đất, và xem nghĩa tiếng Việt.`,
      scene: { kind: 'fall', variant: 'word', targets: [{ label: 'cat', letters: [3] }, { label: 'apple', letters: [5] }, { label: 'dog', letters: [3] }] } },
    { tag: 'Cách thao tác', title: 'Gõ lại từ, pet tự bắn',
      body: 'Ô chữ nằm ngay dưới từ gần mặt đất nhất. Gõ đúng từ là từ dừng lại, pet tự bắn, không cần nhấn gì, và ô chữ trống lại để gõ tiếp. Đạn trúng thì từ phát sáng, nứt rồi vỡ, hiện nghĩa (và đọc phát âm khi bật Âm thanh). Muốn gõ từ khác thì chạm vào từ đó.',
      scene: { kind: 'type', variant: 'word', target: { label: 'cat', letters: [3] }, answer: 'cat', result: 'con mèo', sub: 'cat /kæt/' } },
    end(`Bạn có ${VOCAB_HEARTS} tim. Thanh trên cùng cho biết số tim và “Đã xử lý” bao nhiêu từ.`, [
      { icon: 'checkmark-circle-outline', tone: 'good', text: `Xử lý đủ ${VOCAB_STAGE_WORDS} từ (bắn vỡ hoặc để rơi) là xong chặng.` },
      { icon: 'heart-outline', tone: 'bad', text: `Mỗi từ chạm đất mất 1 tim. Hết ${VOCAB_HEARTS} tim thì chặng dừng lại, bạn có thể chơi lại.` },
      { icon: 'create-outline', tone: 'info', text: 'Gõ sai không mất tim: sửa lại khi từ còn rơi. Gợi ý cho biết số chữ cái, rồi từng chữ.' },
      TIME_UP]),
  ],
  meteor: [
    { tag: 'Mục tiêu', title: 'Bắn thiên thạch',
      body: `Mỗi chặng có ${VOCAB_STAGE_WORDS} thiên thạch, mỗi cái mang một nghĩa tiếng Việt, có khi kèm ngữ cảnh. Nhớ ra từ tiếng Anh để pet bắn vỡ trước khi nó chạm đất.`,
      scene: { kind: 'fall', variant: 'meteor', targets: [{ label: 'con mèo', letters: [3] }, { label: 'quả táo', letters: [5] }] } },
    { tag: 'Cách thao tác', title: 'Gõ từ tiếng Anh, pet tự bắn',
      body: 'Số ô dưới thiên thạch là số chữ cái (cụm từ có nhiều nhóm ô). Gõ đúng là pet tự bắn, ô chữ trống lại để gõ tiếp. Đạn trúng thì thiên thạch vỡ và hiện cặp từ Anh – Việt.',
      scene: { kind: 'type', variant: 'meteor', target: { label: 'con mèo', letters: [3] }, answer: 'cat', result: 'cat — con mèo', sub: '/kæt/' } },
    end(`Bạn có ${VOCAB_HEARTS} tim. Thanh trên cùng cho biết số tim và “Đã xử lý” bao nhiêu từ.`, [
      { icon: 'checkmark-circle-outline', tone: 'good', text: `Xử lý đủ ${VOCAB_STAGE_WORDS} thiên thạch (bắn vỡ hoặc để rơi) là xong chặng.` },
      { icon: 'heart-outline', tone: 'bad', text: `Mỗi thiên thạch chạm đất mất 1 tim. Hết ${VOCAB_HEARTS} tim thì chặng dừng lại, bạn có thể chơi lại.` },
      { icon: 'bulb-outline', tone: 'info', text: 'Gõ sai không mất tim: sửa lại. Gợi ý: chữ cái đầu, rồi chữ cuối. Xem đáp án không mất tim, từ đó tính là đã xử lý.' },
      TIME_UP]),
  ],
  gate: [
    { tag: 'Mục tiêu', title: 'Chọn đáp án đúng', body: 'Mỗi câu tiếng Anh có một chỗ trống, có khi kèm tình huống bằng tiếng Việt. Chọn đáp án đúng để điền vào chỗ trống.',
      scene: { kind: 'gates', sentence: 'She ___ a student.', options: ['is', 'are', 'am'], right: 0 } },
    { tag: 'Cách thao tác', title: 'Chạm vào một cổng', body: 'Chạm một cổng là câu được chấm ngay, không cần nhấn thêm. Bí thì nhấn Gợi ý, hoặc Xem đáp án (không mất tim, câu đó quay lại sau).',
      scene: { kind: 'gates', sentence: 'She ___ a student.', options: ['is', 'are', 'am'], right: 0, demo: true } },
    end('Đọc kỹ câu và tình huống trước khi chọn.', [
      { icon: 'checkmark-circle-outline', tone: 'good', text: 'Làm hết các câu, kể cả câu được hỏi lại, là xong chặng.' },
      { icon: 'heart-outline', tone: 'bad', text: 'Chọn sai mất 1 tim, xem đáp án và giải thích. Câu đó quay lại sau.' },
      OUT_OF_HEARTS, TIME_UP]),
  ],
  bridge: [
    { tag: 'Mục tiêu', title: 'Xếp câu thành cầu', body: 'Ghép các mảnh từ thành câu tiếng Anh có nghĩa như câu tiếng Việt. Phải dùng hết các mảnh.',
      scene: { kind: 'planks', meaning: 'Tôi thích mèo.', tokens: ['cats', 'I', 'like'], order: [1, 2, 0] } },
    { tag: 'Cách thao tác', title: 'Chạm theo thứ tự rồi Kiểm tra',
      body: 'Chạm các mảnh theo đúng thứ tự. Chạm mảnh đã đặt để gỡ ra, hoặc nhấn Xếp lại. Dùng hết mảnh thì nhấn Kiểm tra.',
      scene: { kind: 'planks', meaning: 'Tôi thích mèo.', tokens: ['cats', 'I', 'like'], order: [1, 2, 0], demo: true } },
    end('Dấu câu cuối đã có sẵn, chỉ cần xếp các từ.', [
      { icon: 'checkmark-circle-outline', tone: 'good', text: 'Làm hết các câu, kể cả câu được hỏi lại, là xong chặng.' },
      { icon: 'heart-outline', tone: 'bad', text: 'Xếp sai mất 1 tim, xem câu đúng và giải thích. Câu đó quay lại sau.' },
      OUT_OF_HEARTS, TIME_UP]),
  ],
  grammar: [
    { tag: 'Mục tiêu', title: 'Cổng và cầu ngữ pháp', body: 'Chặng có hai kiểu câu: chọn cổng đúng cho chỗ trống, hoặc xếp mảnh từ thành câu.',
      scene: { kind: 'gates', sentence: 'They ___ happy.', options: ['is', 'are', 'am'], right: 1 } },
    { tag: 'Cách thao tác', title: 'Chọn cổng hoặc xếp mảnh',
      body: 'Câu có chỗ trống: chạm cổng đúng. Câu cần xếp: chạm các mảnh theo thứ tự rồi nhấn Kiểm tra. Bí thì nhấn Gợi ý hoặc Xem đáp án.',
      scene: { kind: 'planks', meaning: 'Tôi thích mèo.', tokens: ['cats', 'I', 'like'], order: [1, 2, 0], demo: true } },
    end('Đọc kỹ từng câu trước khi trả lời.', [
      { icon: 'checkmark-circle-outline', tone: 'good', text: 'Làm hết các câu, kể cả câu được hỏi lại, là xong chặng.' },
      { icon: 'heart-outline', tone: 'bad', text: 'Sai mất 1 tim, xem đáp án và giải thích. Câu đó quay lại sau.' },
      OUT_OF_HEARTS, TIME_UP]),
  ],
  defense: [
    { tag: 'Mục tiêu', title: 'Bảo vệ căn cứ', body: 'Quái vật mang phép tính kéo đến theo từng đợt, cuối chặng có trùm. Giải đúng để pet lao lên tấn công; đúng 3 câu liền, pet tung kỹ năng nguyên tố của mình.',
      scene: { kind: 'monster', expression: '12 + 7' } },
    { tag: 'Cách thao tác', title: 'Bấm số rồi Tấn công',
      body: 'Bấm đáp án trên bàn phím số rồi nhấn Tấn công. Nút ± hiện khi đáp án có thể âm; mở Nháp để tính. Bí thì nhấn Gợi ý, hoặc Xem đáp án (không mất tim, phép tính quay lại sau).',
      scene: { kind: 'numpad', expression: '12 + 7', answer: '19', submit: 'Tấn công' } },
    end('Quái vật không bao giờ vào căn cứ, cứ tính cẩn thận.', [
      { icon: 'checkmark-circle-outline', tone: 'good', text: 'Hạ hết các đợt quái vật và trùm (mỗi câu đúng trừ 1 máu của trùm) là hoàn thành chặng.' },
      { icon: 'heart-outline', tone: 'bad', text: 'Sai mất 1 tim: sửa đáp án rồi tấn công tiếp.' },
      OUT_OF_HEARTS, TIME_UP]),
  ],
  math_bridge: [
    { tag: 'Mục tiêu', title: 'Xây cầu toán học', body: 'Mỗi câu làm xong đặt thêm một đoạn cầu. Có hai kiểu câu: tìm số còn thiếu, hoặc so sánh hai số.',
      scene: { kind: 'spans', equation: '8 + ▢ = 15', answer: '7' } },
    { tag: 'Cách thao tác', title: 'Điền số hoặc chọn dấu',
      body: 'Tìm số còn thiếu: bấm số rồi nhấn Đặt đoạn cầu. So sánh: chạm dấu >, < hoặc =. Bí thì nhấn Gợi ý hoặc Xem đáp án.',
      scene: { kind: 'compare', left: '15', right: '9', signs: ['>', '<', '='], right_sign: 0 } },
    end('Đọc kỹ từng câu trước khi trả lời.', [
      { icon: 'checkmark-circle-outline', tone: 'good', text: 'Làm hết các câu là hoàn thành cây cầu.' },
      { icon: 'heart-outline', tone: 'bad', text: 'Sai mất 1 tim. Điền số sai thì sửa lại; chọn dấu sai thì xem đáp án, câu đó quay lại sau.' },
      OUT_OF_HEARTS, TIME_UP]),
  ],
} as Record<GameId, TutorialPage[]>;

// The curriculum games (backend curriculum_games.py): no hearts and no clock; a wrong answer is explained, then fixed
// and tried again, and an answer right only after a mistake is recorded as such (never as right at the first try).
const NO_CLOCK: Rule = { icon: 'time-outline', tone: 'info', text: 'Không tính giờ, không mất tim: cứ làm từ từ.' };
const SORT_GROUPS = [{ id: 'dong_vat', label: 'Động vật', icon: '🐾' }, { id: 'thuc_vat', label: 'Thực vật', icon: '🌱' }];
const CODE_LEVEL = { cols: 4, rows: 3, start: { x: 0, y: 2, dir: 'E' as const }, goal: { x: 3, y: 0 }, walls: [[2, 2], [2, 1]] as [number, number][] };
const CODE_PROGRAM: Block[] = ['forward', 'left', 'forward', 'forward', 'right', 'forward', 'forward'];

Object.assign(TUTORIALS, {
  word_builder: [
    { tag: 'Mục tiêu', title: 'Nhìn hình và đoán từ.', body: 'Mỗi câu có một hình. Hãy đoán xem hình đó là gì.',
      scene: { kind: 'word_build', picture: '🐱', unit: 'letter', pieces: ['m', 'è', 'o'], shuffled: [2, 0, 1] } },
    { tag: 'Cách thao tác', title: 'Chọn các chữ theo đúng thứ tự.',
      body: 'Kéo các chữ (lớp 2: các tiếng) đang phát sáng trên mặt đất vào từng ô của ổ khóa, hoặc chạm để đặt vào ô trống đầu tiên, rồi nhấn Mở cổng. Chạm vào chữ đã đặt để gỡ ra.',
      scene: { kind: 'word_build', picture: '🐱', unit: 'letter', pieces: ['m', 'è', 'o'], shuffled: [2, 0, 1], demo: true } },
    end(`Ghép đủ ${CURRICULUM_STAGE.word_builder} từ để hoàn thành.`, [
      { icon: 'book-outline', tone: 'good', text: `Mỗi từ đúng, cổng mở, pet nhận một mảnh sách rồi đi tiếp tới cổng sau. Ghép đủ các từ của chặng là xong (thường ${CURRICULUM_STAGE.word_builder} từ, bài học có thể ít hơn).` },
      { icon: 'refresh-outline', tone: 'info', text: 'Ghép sai thì cổng rung lên, các chữ vẫn ở đó: đổi chỗ rồi mở cổng lại. Gợi ý cho biết chữ đầu tiên.' },
      NO_CLOCK]),
  ],
  spelling_detective: [
    { tag: 'Mục tiêu', title: 'Đọc câu và tìm từ viết sai.', body: 'Mỗi câu có đúng một tiếng viết sai chính tả.',
      scene: { kind: 'spell_fix', words: ['Bé', 'uống', 'một', 'cốc', 'lước', 'cam.'], wrong: 4, options: ['nước', 'lước', 'nướt'], right: 0 } },
    { tag: 'Cách thao tác', title: 'Chạm vào từ đó, chọn cách viết đúng.',
      body: 'Chạm vào tiếng viết sai. Khi tìm đúng, các cách viết mới hiện ra: chọn cách viết đúng.',
      scene: { kind: 'spell_fix', words: ['Bé', 'uống', 'một', 'cốc', 'lước', 'cam.'], wrong: 4, options: ['nước', 'lước', 'nướt'], right: 0, demo: true } },
    end('Xem giải thích rồi chuyển câu tiếp theo.', [
      { icon: 'checkmark-circle-outline', tone: 'good', text: `Làm đúng các câu của chặng là xong (thường ${CURRICULUM_STAGE.spelling_detective} câu, bài học có thể ít hơn). Sau mỗi câu có lời giải thích, nhấn Câu tiếp theo.` },
      { icon: 'refresh-outline', tone: 'info', text: 'Chạm nhầm tiếng hay chọn sai cách viết: đọc lời nhắc rồi thử lại.' },
      NO_CLOCK]),
  ],
  sorting: [
    { tag: 'Mục tiêu', title: 'Nhìn tên các nhóm.', body: 'Mỗi chặng có một chủ đề với các nhóm ở dưới, như Động vật và Thực vật.',
      scene: { kind: 'sort', title: 'Động vật hay thực vật?', groups: SORT_GROUPS, card: { text: 'Con mèo', picture: '🐱' }, right: 'dong_vat' } },
    { tag: 'Cách thao tác', title: 'Kéo từng hình vào nhóm phù hợp.', body: 'Kéo thẻ hình thả vào nhóm của nó. Bạn cũng có thể chạm vào tên nhóm.',
      scene: { kind: 'sort', title: 'Động vật hay thực vật?', groups: SORT_GROUPS, card: { text: 'Con mèo', picture: '🐱' }, right: 'dong_vat', demo: true } },
    end('Xếp đúng tất cả thẻ để hoàn thành.', [
      { icon: 'checkmark-circle-outline', tone: 'good', text: `Xếp đúng các thẻ của chặng là xong (thường ${CURRICULUM_STAGE.sorting} thẻ, bài học có thể ít hơn).` },
      { icon: 'arrow-undo-outline', tone: 'info', text: 'Xếp nhầm nhóm thì thẻ quay về chỗ cũ kèm lời giải thích: hãy xếp lại.' },
      NO_CLOCK]),
  ],
  code_path: [
    { tag: 'Mục tiêu', title: 'Xếp các lệnh vào thanh chương trình.',
      body: 'Chạm Tiến, Rẽ trái, Rẽ phải để thêm lệnh. Từ trình độ Trung cấp có khối Lặp lại: các lệnh đặt trong đó được làm nhiều lần.',
      scene: { kind: 'code', ...CODE_LEVEL, program: CODE_PROGRAM, mode: 'build' } },
    { tag: 'Cách thao tác', title: 'Nhấn Chạy để robot thực hiện.', body: 'Pet lái robot làm lần lượt từng lệnh, lệnh đang chạy sáng lên. Tới cờ đích là qua màn.',
      scene: { kind: 'code', ...CODE_LEVEL, program: CODE_PROGRAM, mode: 'run' } },
    end('Nếu chưa tới đích, xem bước bị sai (khối đỏ), sửa lệnh và thử lại.', [
      { icon: 'flag-outline', tone: 'good', text: `Đưa pet tới đích ở mọi màn của chặng là xong (thường ${CURRICULUM_STAGE.code_path} màn, bài học có thể ít hơn).` },
      { icon: 'build-outline', tone: 'info', text: 'Thử lại bao nhiêu lần cũng được. Dừng để ngừng chạy, Đặt lại để đưa pet về chỗ cũ.' },
      { icon: 'git-commit-outline', tone: 'info', text: 'Mỗi màn có số lệnh tối đa: dùng khối Lặp lại để chương trình ngắn hơn.' },
      NO_CLOCK]),
  ],
} satisfies Record<Exclude<CurriculumGameId, LessonGameId>, TutorialPage[]>);

// The lesson games: the number of questions comes from the lesson (shown on the lesson screen and in the game).
const LIFE = ['Hạt đậu', 'Hạt nảy mầm', 'Cây con', 'Cây ra hoa'];
const MATCH: [string, string][] = [['2 × 3', '6'], ['2 × 5', '10'], ['2 × 7', '14']];
const KEEP_RIGHT = (text: string): Rule => ({ icon: 'lock-closed-outline', tone: 'info', text });
const READ_WHY: Rule = { icon: 'reader-outline', tone: 'good', text: 'Làm đúng: xem kết quả hiện ra, đọc giải thích ngay dưới câu, rồi nhấn Câu tiếp theo.' };
// The subject gameplays: each its own world and its own move.
const SUBJECT_TUTORIALS: Record<SubjectGameId, TutorialPage[]> = {
  timeline: [
    { tag: 'Mục tiêu', title: 'Đưa từng sự kiện về đúng mốc thời gian.', body: 'Con đường lịch sử đi từ trên (sớm hơn) xuống dưới (muộn hơn). Mỗi mốc ghi năm; sự kiện cùng năm đứng chung một mốc.',
      scene: { kind: 'subject', game: 'timeline', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Kéo sự kiện lên mốc của nó.', body: 'Kéo thẻ sự kiện vào chỗ trống ở mốc (hoặc chạm thẻ rồi chạm mốc). Chạm thẻ đã đặt để gỡ ra. Đủ thẻ thì nhấn Kiểm tra.',
      scene: { kind: 'subject', game: 'timeline', mode: 'demo' } },
    end('Đúng hết là hoàn thành dòng thời gian.', [READ_WHY,
      KEEP_RIGHT('Đặt sai: sự kiện đúng mốc được giữ lại (khoá xanh), sự kiện sai rung lên rồi quay về để đặt lại.'), NO_CLOCK]),
  ],
  sentence: [
    { tag: 'Mục tiêu', title: 'Xếp thẻ thành một câu đúng.', body: 'Mỗi toa tàu chở một thẻ của câu. Có thẻ không thuộc câu: để nó lại bãi.',
      scene: { kind: 'subject', game: 'sentence', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Chất thẻ lên toa theo thứ tự.', body: 'Kéo thẻ lên toa (hoặc chạm: thẻ lên toa trống đầu tiên). Chạm toa để dỡ thẻ xuống. Đủ toa thì nhấn Kiểm tra.',
      scene: { kind: 'subject', game: 'sentence', mode: 'demo' } },
    end('Câu đúng: tàu sáng đèn và câu được đọc lên.', [READ_WHY,
      KEEP_RIGHT('Sai: các toa đúng từ đầu câu được khoá, toa sai đầu tiên viền đỏ để em sửa đúng chỗ đó.'), NO_CLOCK]),
  ],
  geometry: [
    { tag: 'Mục tiêu', title: 'Tự tay tạo hình theo yêu cầu.', body: 'Trên bản vẽ có thước đo góc hoặc lưới ô vuông 1 cm. Đọc yêu cầu: góc bao nhiêu độ, hình có diện tích, chu vi bao nhiêu.',
      scene: { kind: 'subject', game: 'geometry', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Kéo tay cầm màu vàng.', body: 'Kéo đầu cạnh góc (hoặc góc hình chữ nhật), hay dùng nút − / +. Xong thì nhấn Kiểm tra: máy đo hình em tạo.',
      scene: { kind: 'subject', game: 'geometry', mode: 'demo' } },
    end('Đúng: hình được tô và ghi số đo.', [READ_WHY,
      { icon: 'calculator-outline', tone: 'info', text: 'Sai: lời nhắc cho biết hình em tạo đo được bao nhiêu và còn thiếu gì; sửa rồi kiểm tra lại.' }, NO_CLOCK]),
  ],
  balance: [
    { tag: 'Mục tiêu', title: 'Làm cho cân thăng bằng.', body: 'Mỗi đĩa cân chứa các phân tử của một vế. Cân chỉ thăng bằng khi mỗi nguyên tố có số nguyên tử bằng nhau ở hai vế.',
      scene: { kind: 'subject', game: 'balance', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Đặt hệ số bằng nút − / +.', body: 'Hệ số đứng trước mỗi chất. Bảng bên dưới đếm số nguyên tử từng nguyên tố. Chỉ đổi hệ số, không đổi công thức. Cân bằng rồi nhấn Kiểm tra.',
      scene: { kind: 'subject', game: 'balance', mode: 'demo' } },
    end('Hệ số phải là các số nhỏ nhất.', [READ_WHY,
      { icon: 'git-compare-outline', tone: 'info', text: 'Chưa cân bằng hoặc chưa tối giản: lời nhắc chỉ ra nguyên tố còn lệch hoặc số cần chia.' },
      { icon: 'shield-checkmark-outline', tone: 'info', text: 'Đây là mô phỏng để học lập phương trình, không phải thí nghiệm để tự làm.' }, NO_CLOCK]),
  ],
  number_line: [
    { tag: 'Mục tiêu', title: 'Đưa mỗi số về đúng vạch trên cầu.', body: 'Cây cầu là một trục số: số bé ở bên trái, số lớn ở bên phải. Chỉ một vài vạch có ghi số, các vạch còn lại em tự đếm.',
      scene: { kind: 'subject', game: 'number_line', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Cầm một số rồi đặt lên cầu.', body: 'Chạm một lá cờ số để cầm nó, rồi chạm hoặc kéo trên cầu để cắm cờ. Dùng ◀ ▶ để dịch đúng một vạch. Đặt đủ các số thì nhấn Kiểm tra.',
      scene: { kind: 'subject', game: 'number_line', mode: 'demo' } },
    end('Đúng hết: pet đi qua cầu, dừng ở từng số.', [READ_WHY,
      KEEP_RIGHT('Sai: số đúng vạch được khoá xanh; lời nhắc cho biết số nào đang lệch sang trái hay phải.'), NO_CLOCK]),
  ],
  step_solver: [
    { tag: 'Mục tiêu', title: 'Giải bài toán từng bước một.', body: 'Mỗi bậc thang là một bước, có một câu hỏi nhỏ. Trả lời đúng bước này thì câu hỏi của bước sau mới hiện ra.',
      scene: { kind: 'subject', game: 'step_solver', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Chọn hai số, một dấu, điền kết quả.', body: 'Chạm hai thẻ số lấy từ đề (hoặc kết quả bước trước), chạm dấu + − × :, rồi bấm bàn phím để điền kết quả. Nhấn Kiểm tra.',
      scene: { kind: 'subject', game: 'step_solver', mode: 'demo' } },
    end('Bước cuối đúng là giải xong bài toán.', [READ_WHY,
      { icon: 'construct-outline', tone: 'info', text: 'Chọn sai phép tính: lời nhắc gợi ý đọc lại đề. Phép tính đúng mà kết quả sai: phép tính được giữ lại, chỉ cần tính lại.' },
      NO_CLOCK]),
  ],
  story_detective: [
    { tag: 'Mục tiêu', title: 'Tìm bằng chứng trước, trả lời sau.', body: 'Câu hỏi là vụ án, mỗi câu trong bài đọc là một manh mối. Em phải chỉ ra câu chứng minh được câu trả lời.',
      scene: { kind: 'subject', game: 'story_detective', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Chạm câu bằng chứng, rồi chọn đáp án.', body: 'Chạm vào câu em cho là bằng chứng rồi nhấn Kiểm tra. Đúng manh mối thì các đáp án mới hiện ra: chọn một đáp án và nhấn Kiểm tra.',
      scene: { kind: 'subject', game: 'story_detective', mode: 'demo' } },
    end('Đúng đáp án: hồ sơ được đóng dấu “Đã phá án”.', [READ_WHY,
      { icon: 'close-circle-outline', tone: 'info', text: 'Chọn sai câu hay sai đáp án: lựa chọn đó bị gạch đi, kèm gợi ý nên tìm ở đâu.' }, NO_CLOCK]),
  ],
  sentence_xray: [
    { tag: 'Mục tiêu', title: 'Tô màu mỗi từ theo vai trò của nó.', body: 'Mỗi bút màu là một vai trò (ví dụ: sự vật, hoạt động). Từ không thuộc vai trò nào thì để trống.',
      scene: { kind: 'subject', game: 'sentence_xray', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Chọn bút, chạm vào từ.', body: 'Chạm một bút màu, rồi chạm các từ để tô. Chạm lại từ đã tô (cùng màu) để xoá. Tô xong nhấn Kiểm tra.',
      scene: { kind: 'subject', game: 'sentence_xray', mode: 'demo' } },
    end('Đúng hết: tia soi quét qua và các từ sáng lên.', [READ_WHY,
      KEEP_RIGHT('Sai: từ tô đúng được khoá; lời nhắc chỉ ra một từ tô chưa đúng hoặc còn thiếu.'), NO_CLOCK]),
  ],
};
const LESSON_END: Rule = { icon: 'checkmark-circle-outline', tone: 'good',
  text: 'Làm đúng mọi câu của chặng là xong: số câu hiện ở màn bài học và trên thanh tiến độ.' };
Object.assign(TUTORIALS, {
  order: [
    { tag: 'Mục tiêu', title: 'Xếp các thẻ theo đúng thứ tự.', body: 'Vòng đời, dòng thời gian, các bước làm: mỗi câu là một nhóm thẻ có đúng một thứ tự.',
      scene: { kind: 'order', prompt: 'Sắp xếp vòng đời cây đậu', items: LIFE, shuffled: [2, 0, 3, 1], first: 'Đầu tiên', last: 'Cuối cùng' } },
    { tag: 'Cách thao tác', title: 'Chạm từng thẻ, rồi nhấn Kiểm tra.',
      body: 'Mỗi thẻ chạm vào được đặt vào chỗ trống tiếp theo. Chạm thẻ đã đặt để gỡ ra. Đủ thẻ thì nhấn Kiểm tra.',
      scene: { kind: 'order', prompt: 'Sắp xếp vòng đời cây đậu', items: LIFE, shuffled: [2, 0, 3, 1], first: 'Đầu tiên', last: 'Cuối cùng', demo: true } },
    end('Sai thì giữ thẻ đúng, sửa thẻ sai.', [
      LESSON_END,
      { icon: 'lock-closed-outline', tone: 'info', text: 'Xếp sai: thẻ nào đúng vị trí được giữ lại (có khoá xanh), xếp lại các thẻ còn lại.' },
      NO_CLOCK]),
  ],
  match: [
    { tag: 'Mục tiêu', title: 'Ghép các thẻ thành từng cặp.', body: 'Sự kiện với nhân vật, phép tính với kết quả, từ với nghĩa: mỗi thẻ bên trái có đúng một thẻ bên phải.',
      scene: { kind: 'match', prompt: 'Ghép phép tính với kết quả', pairs: MATCH, rightOrder: [2, 0, 1] } },
    { tag: 'Cách thao tác', title: 'Chạm thẻ trái, rồi thẻ phải.', body: 'Hai thẻ ghép với nhau cùng màu. Chạm thẻ đã ghép để gỡ ra. Ghép đủ thì nhấn Kiểm tra.',
      scene: { kind: 'match', prompt: 'Ghép phép tính với kết quả', pairs: MATCH, rightOrder: [2, 0, 1], demo: true } },
    end('Sai thì giữ cặp đúng, ghép lại cặp sai.', [
      LESSON_END,
      { icon: 'lock-closed-outline', tone: 'info', text: 'Ghép sai: các cặp đúng được giữ lại, chỉ ghép lại những cặp còn sai.' },
      NO_CLOCK]),
  ],
  choice: [
    { tag: 'Mục tiêu', title: 'Đọc kĩ rồi chọn.', body: 'Có câu là tình huống, có câu là đoạn văn hoặc hiện tượng cần dự đoán. Mỗi lựa chọn đều có lời giải thích.',
      scene: { kind: 'choice', style: 'situation', question: 'Bạn cùng lớp quên bút. Em làm gì?', options: ['Cười bạn', 'Cho bạn mượn bút'], right: 1, wrong: 0 } },
    { tag: 'Cách thao tác', title: 'Chạm một lựa chọn.', body: 'Chọn chưa phù hợp: đọc lý do, lựa chọn đó bị gạch đi, thử lựa chọn khác. Chọn đúng: đọc giải thích rồi sang câu tiếp.',
      scene: { kind: 'choice', style: 'situation', question: 'Bạn cùng lớp quên bút. Em làm gì?', options: ['Cười bạn', 'Cho bạn mượn bút'], right: 1, wrong: 0, demo: true } },
    end('Câu tự đánh giá không có đáp án sai.', [
      LESSON_END,
      { icon: 'chatbubble-ellipses-outline', tone: 'info', text: 'Câu “Tự đánh giá” không chấm đúng sai: em chọn điều đúng với mình và đọc lời nhắn.' },
      NO_CLOCK]),
  ],
  lab: [
    { tag: 'Mục tiêu', title: 'Tự tay làm thí nghiệm.', body: 'Pet là trợ lý của em. Mỗi thí nghiệm có một nhiệm vụ: lắp mạch cho đèn sáng, tạo bóng trên màn, làm nước chuyển thể, gieo hạt.',
      scene: { kind: 'lab', mode: 'empty' } },
    { tag: 'Cách thao tác', title: 'Kéo dụng cụ vào đúng chỗ.', body: 'Kéo từng dụng cụ trên bàn vào chỗ trống trên thiết bị (hoặc chạm để đặt vào chỗ trống đầu tiên). Chạm dụng cụ đã đặt để lấy ra.',
      scene: { kind: 'lab', mode: 'build' } },
    end('Bật thí nghiệm và quan sát.', [
      { icon: 'flash-outline', tone: 'good', text: 'Đặt đủ dụng cụ thì bật thí nghiệm: đèn sáng, bóng hiện ra, đá tan, cây lớn lên… rồi đọc giải thích.' },
      { icon: 'refresh-outline', tone: 'info', text: 'Lắp chưa đúng thì thí nghiệm không chạy và có lời giải thích; dụng cụ đúng được giữ lại, thử vật khác.' },
      { icon: 'shield-checkmark-outline', tone: 'info', text: 'Đây là thí nghiệm mô phỏng: không tự làm với điện, lửa hay nước nóng khi không có người lớn.' },
      NO_CLOCK]),
  ],
  ...SUBJECT_TUTORIALS,
} satisfies Record<LessonGameId, TutorialPage[]>);

type Stored = { seen?: GameId[]; /** Finished while the server could not be reached: sent again on the next load. */ unsent?: GameId[] };

/**
 * Which games' guides (of this TUTORIAL_VERSION) this account has finished. The server keeps it per account (so it is
 * skipped on every device);
 * the device keeps a copy per account, so a guide finished offline is not shown again and is sent later.
 * `seen` is null until known: the game then shows its guide (seeing it twice beats never seeing it).
 */
export function useTutorials(userId: number) {
  // Per guide version: a copy from an older version is not read, so the new guides show once again.
  const key = `mirabi.learning.tutorials.v${TUTORIAL_VERSION}:${userId}`;
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
        for (const game of stored.current.unsent) await learningApi.finishTutorial(game, TUTORIAL_VERSION);
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
    learningApi.finishTutorial(game, TUTORIAL_VERSION).catch(() => {
      if (!stored.current.unsent.includes(game)) stored.current = { ...stored.current, unsent: [...stored.current.unsent, game] };
      save();
    });
  }, [save]);

  const needs = useCallback((game: GameId) => !seen?.has(game), [seen]);
  return { needs, finish };
}
