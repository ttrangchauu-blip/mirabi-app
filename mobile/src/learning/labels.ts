import type { IconName } from '../ui/kit';
import type { GameGroupId, GameId, GameType, LessonBrief, Mode, Outcome, Reward, SessionStatus, SubjectCode, Variant } from './types';

type GameInfo = { name: string; icon: IconName; detail: string; howTo: string; gameType: GameType; variant: Variant | null;
  /** Vocabulary games: which way the words go ("Anh → Việt"). */
  direction?: string;
  /** Mode rules when they differ from MODE_INFO. */
  modes?: Record<Mode, string> };

const VOCAB_MODES: Record<Mode, string> = {
  practice: 'Từng mục tiêu đứng chờ bạn, không mất tim. Có gợi ý khi cần.',
  challenge: 'Mục tiêu rơi xuống, 3 tim: chạm mặt đất mất 1 tim. Gõ sai cứ sửa lại khi mục tiêu còn rơi.',
};

export const GAME_INFO: Record<GameId, GameInfo> = {
  word_shooter: { name: 'Bắn từ tiếng Anh', direction: 'Anh → Việt', icon: 'text-outline', gameType: 'meteor', variant: 'word_shooter',
    detail: 'Gõ lại từ tiếng Anh đang rơi, xem nghĩa tiếng Việt.',
    howTo: 'Từ tiếng Anh rơi xuống. Gõ lại đúng từ đó rồi nhấn Enter hoặc Bắn: từ vỡ ra và hiện nghĩa tiếng Việt.', modes: VOCAB_MODES },
  meteor: { name: 'Bắn thiên thạch', direction: 'Việt → Anh', icon: 'planet-outline', gameType: 'meteor', variant: 'meteor',
    detail: 'Nhìn nghĩa tiếng Việt, gõ từ tiếng Anh.',
    howTo: 'Thiên thạch mang nghĩa tiếng Việt. Gõ từ tiếng Anh rồi nhấn Enter hoặc Bắn để pet bắn vỡ nó.', modes: VOCAB_MODES },
  gate: { name: 'Chọn đáp án ngữ pháp', icon: 'git-branch-outline', gameType: 'grammar', variant: 'gate',
    detail: 'Chọn đáp án đúng cho chỗ trống trong câu.',
    howTo: 'Mỗi câu có một chỗ trống. Đọc tình huống rồi chọn đáp án đúng.' },
  bridge: { name: 'Sắp xếp câu', icon: 'reorder-four-outline', gameType: 'grammar', variant: 'bridge',
    detail: 'Ghép các mảnh từ thành câu đúng.',
    howTo: 'Chạm các mảnh theo đúng thứ tự để xếp thành câu tiếng Anh có nghĩa như gợi ý.' },
  grammar: { name: 'Cổng & cầu ngữ pháp', icon: 'git-branch-outline', gameType: 'grammar', variant: 'mixed',
    detail: 'Chọn cổng đúng và xây cầu bằng từ.',
    howTo: 'Chọn cổng có từ đúng, hoặc xếp từ thành câu để pet đi qua.' },
  defense: { name: 'Bảo vệ căn cứ', icon: 'shield-outline', gameType: 'defense', variant: null,
    detail: 'Giải phép tính để pet tấn công quái vật.',
    howTo: 'Mỗi quái vật mang một phép tính. Nhập đáp án để pet tấn công.' },
  math_bridge: { name: 'Xây cầu toán học', icon: 'construct-outline', gameType: 'math_bridge', variant: null,
    detail: 'Điền số hoặc chọn dấu so sánh để hoàn thành cầu.',
    howTo: 'Điền số còn thiếu hoặc chọn dấu đúng để hoàn thành từng đoạn cầu.' },
};

/** A game with its direction when it has one: "Bắn từ vựng (Anh → Việt)". */
export const gameTitle = (game: GameId) => {
  const info = GAME_INFO[game];
  return info.direction ? `${info.name} (${info.direction})` : info.name;
};

type GameGroup = { name: string; icon: IconName; detail: string; games: GameId[] };

/** Entries of a game list that open their own choice of games. */
export const GAME_GROUPS: Record<GameGroupId, GameGroup> = {
  vocabulary: { name: 'Từ vựng', icon: 'library-outline', detail: 'Hai trò chơi: Anh → Việt và Việt → Anh.', games: ['word_shooter', 'meteor'] },
};

/** The games (or groups of games) offered for each subject, in the order they are shown. */
export const SUBJECT_GAMES: Record<SubjectCode, (GameId | GameGroupId)[]> = {
  english: ['word_shooter', 'meteor', 'gate', 'bridge'], math: ['defense', 'math_bridge'] };

/** English games start at once ("Chơi ngay"): the backend picks the words or questions from the user's progress, so
 * there is no topic, level or setup screen. */
export const QUICK_GAMES = new Set<GameId>(['word_shooter', 'meteor', 'gate', 'bridge']);
/** Lessons the quick games play (a finished stage of one of them is replayed the same way). */
export const QUICK_LESSONS = new Set(['en.vocab.mix', 'en.grammar.bank']);

export const isGroup = (id: GameId | GameGroupId): id is GameGroupId => id in GAME_GROUPS;
/** The group a game is chosen from, if any and if that group is still listed (so "back" from its setup returns there). */
export const groupOf = (game: GameId): GameGroupId | undefined =>
  (Object.keys(GAME_GROUPS) as GameGroupId[]).find((g) => GAME_GROUPS[g].games.includes(game)
    && Object.values(SUBJECT_GAMES).some((list) => list.includes(g)));

/** The lessons a game can be played with. */
export const lessonsForGame = (lessons: LessonBrief[], game: GameId) => {
  const info = GAME_INFO[game];
  return lessons.filter((l) => l.game_type === info.gameType && (!info.variant || l.variants.includes(info.variant)));
};

/** Every game is played in Học tập (`practice`): "Thử thách" was a second way into the same games, the same lessons,
 * progress and rewards, so it is no longer offered. Sessions started in it before still open, play and show their
 * score as they were (the backend keeps both modes). */
export const PLAY_MODE: Mode = 'practice';

export const MODE_INFO = {
  practice: { name: 'Học tập', icon: 'leaf-outline' as IconName, detail: 'Không giới hạn thời gian từng câu, có gợi ý và giải thích. 3 tim: trả lời sai mất 1 tim.' },
  challenge: { name: 'Thử thách', icon: 'flame-outline' as IconName, detail: '3 tim, điểm và combo. Mục tiêu di chuyển theo độ khó.' },
};

/** The rules of a mode in a given game. */
export const modeDetail = (game: GameId, mode: Mode) => GAME_INFO[game].modes?.[mode] ?? MODE_INFO[mode].detail;

export const OUTCOME_LABEL: Record<Outcome | 'unanswered', string> = {
  first_try: 'Đúng ngay', hinted: 'Đúng nhờ gợi ý', corrected: 'Sai rồi sửa đúng', wrong: 'Sai',
  revealed: 'Đã xem đáp án', missed: 'Bỏ lỡ', unanswered: 'Chưa làm',
};

export const STATUS_TITLE: Record<SessionStatus, string> = {
  completed: 'Hoàn thành chặng!', failed: 'Hết tim rồi', abandoned: 'Đã kết thúc', active: 'Đang chơi', paused: 'Tạm dừng',
};

/** What the backend decided about EXP. Nothing is announced before the server confirms it. */
export function rewardMessage(reward: Reward | null, kind: 'lesson' | 'review'): string {
  if (!reward) return '';
  switch (reward.status) {
    case 'granted': return `+${reward.exp} EXP cho pet của bạn`;
    case 'capped': return `+${reward.exp} EXP (đã gần chạm giới hạn 60 EXP mỗi ngày)`;
    case 'daily_cap_reached': return 'Hôm nay bạn đã nhận đủ 60 EXP. Tiến độ học vẫn được lưu!';
    case 'daily_task': return `+${reward.exp} EXP · Hoàn thành nhiệm vụ “Học một điều mới”`;
    case 'already_claimed': return 'Môn này đã nhận thưởng chặng hôm nay. Tiến độ học vẫn được lưu!';
    case 'not_eligible': return kind === 'review' ? 'Luyện lại giúp nhớ lâu hơn (không tính thưởng chặng).' : 'Hoàn thành chặng để nhận EXP nhé.';
    default: return '';
  }
}

/** Parts of speech of the vocabulary bank (prompt.part_of_speech). */
export const POS_LABEL: Record<string, string> = {
  noun: 'danh từ', verb: 'động từ', adjective: 'tính từ', adverb: 'trạng từ', phrase: 'cụm từ', phrasal_verb: 'cụm động từ',
  collocation: 'kết hợp từ', idiom: 'thành ngữ',
  preposition: 'giới từ', pronoun: 'đại từ', determiner: 'từ hạn định', conjunction: 'liên từ', interjection: 'thán từ', number: 'số từ',
};

export const ERROR_TYPE_LABEL: Record<string, string> = {
  order_of_operations: 'Nhầm thứ tự phép tính', wrong_operation: 'Nhầm phép tính', carry_error: 'Quên nhớ', borrow_error: 'Quên mượn',
  sign_error: 'Nhầm dấu âm/dương', off_by_one: 'Lệch 1 đơn vị', times_table_slip: 'Nhầm bảng nhân',
  wrong_inverse_operation: 'Dùng sai phép tính ngược', reversed_sign: 'Ngược dấu so sánh', equality_confusion: 'Nhầm dấu bằng',
};

export function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
