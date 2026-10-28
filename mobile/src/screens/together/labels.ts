import type { ReactionKey, RoomState } from '../../studyTogether/types';

// Keep in sync with Subject in backend/app/study_rooms.py.
export const SUBJECTS: { id: string; label: string }[] = [
  { id: 'general', label: 'Tự học' }, { id: 'math', label: 'Toán' }, { id: 'literature', label: 'Ngữ văn' },
  { id: 'english', label: 'Tiếng Anh' }, { id: 'science', label: 'Khoa học' }, { id: 'coding', label: 'Lập trình' },
  { id: 'language', label: 'Ngoại ngữ' }, { id: 'exam', label: 'Ôn thi' }, { id: 'reading', label: 'Đọc sách' },
  { id: 'work', label: 'Công việc' }, { id: 'other', label: 'Khác' },
];
export const subjectLabel = (id: string) => SUBJECTS.find((x) => x.id === id)?.label ?? 'Tự học';

export const STATE_LABELS: Record<RoomState, string> = {
  waiting: 'Đang chờ bắt đầu', focus: 'Đang tập trung', break: 'Đang nghỉ', paused: 'Tạm dừng', closed: 'Đã đóng',
};

// Fixed set (no free text), matching REACTIONS in backend/app/study_rooms.py.
export const REACTIONS: { key: ReactionKey; emoji: string; label: string }[] = [
  { key: 'cheer', emoji: '💪', label: 'Cố lên!' }, { key: 'clap', emoji: '👏', label: 'Giỏi quá!' },
  { key: 'star', emoji: '🌟', label: 'Tuyệt vời' }, { key: 'fire', emoji: '🔥', label: 'Đang vào guồng' },
  { key: 'coffee', emoji: '☕', label: 'Nghỉ chút nhé' }, { key: 'heart', emoji: '💙', label: 'Cảm ơn bạn' },
];
export const reactionEmoji = (key: ReactionKey) => REACTIONS.find((r) => r.key === key)?.emoji ?? '✨';

export const REPORT_REASONS: { id: string; label: string }[] = [
  { id: 'spam', label: 'Spam hoặc làm phiền' }, { id: 'harassment', label: 'Quấy rối, bắt nạt' },
  { id: 'inappropriate', label: 'Nội dung không phù hợp' }, { id: 'impersonation', label: 'Mạo danh người khác' },
  { id: 'other', label: 'Lý do khác' },
];
