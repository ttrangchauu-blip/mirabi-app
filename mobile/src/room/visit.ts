import { create } from 'qrcode/lib/core/qrcode';
import type { StudyInviteInput, VisitAction } from './types';

/** Preset cheers, same keys and texts as CHEERS in backend/app/room_visits.py (the backend only accepts these). */
export const CHEERS: { key: string; text: string }[] = [
  { key: 'study_well', text: 'Học tốt nhé!' },
  { key: 'keep_going', text: 'Cùng cố gắng nào!' },
  { key: 'take_break', text: 'Nhớ nghỉ ngơi nhé!' },
  { key: 'believe', text: 'Mình tin bạn làm được!' },
  { key: 'proud', text: 'Bạn đang làm rất tốt!' },
];
export const cheerText = (key: string | null | undefined) => CHEERS.find((c) => c.key === key)?.text ?? null;

/** Rhythms offered by "Rủ học"; each is a Pomodoro setting the study rooms support (RoomCreate limits). */
export const STUDY_PRESETS: { id: string; label: string; detail: string; input: Omit<StudyInviteInput, 'subject'> }[] = [
  { id: 'short', label: 'Học nhanh', detail: '25 phút × 2 lượt', input: { focus_minutes: 25, break_minutes: 5, cycles: 2 } },
  { id: 'classic', label: 'Pomodoro', detail: '25 phút × 4 lượt', input: { focus_minutes: 25, break_minutes: 5, cycles: 4 } },
  { id: 'deep', label: 'Tập trung sâu', detail: '50 phút × 2 lượt', input: { focus_minutes: 50, break_minutes: 10, cycles: 2 } },
];

/** Seconds until `action` can be sent again (0: now). */
export function waitSeconds(availableAt: Partial<Record<VisitAction, string | null>>, action: VisitAction, now = Date.now()) {
  const at = availableAt[action];
  return at ? Math.max(0, Math.ceil((Date.parse(at) - now) / 1000)) : 0;
}

// ------------------------------------------------------------------------------------------------ friend QR codes
/** What a friend QR code holds; the backend lookup accepts it as is (friends.QR_PREFIX). */
export const QR_PREFIX = 'MIRABI-FRIEND:';
export const friendQrPayload = (code: string) => `${QR_PREFIX}${code}`;

/** The friend code in a scanned text (a Mirabi friend QR code, or a bare 8-character code), else null. */
export function parseFriendCode(text: string): string | null {
  const raw = text.trim().toUpperCase();
  const code = (raw.startsWith(QR_PREFIX) ? raw.slice(QR_PREFIX.length) : raw).replace(/[\s-]/g, '');
  return /^[A-Z2-9]{8}$/.test(code) ? code : null;
}

/** The dark modules of a QR code as one SVG path on a `size` × `size` grid (no quiet zone). */
export function qrPath(text: string): { size: number; d: string } {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  let d = '';
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
  }
  return { size: modules.size, d };
}
