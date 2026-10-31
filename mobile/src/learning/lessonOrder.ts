// The order of a subject's lesson list (backend lesson_api.sort_lessons): Đang học → Đã mở → Đã hoàn thành → Chưa mở,
// and within each group the curriculum's chapter then lesson order (never ids or dates). The backend decides every
// state; the app only reads it, and sorts again with the same rule so the list stays right as the states change.
import type { LessonGroup, LessonStatus, SubjectLessons, UnlockRequirement } from './types';

export const GROUP_ORDER: LessonGroup[] = ['in_progress', 'unlocked', 'completed', 'locked'];
export const GROUP_LABEL: Record<LessonGroup, string> = {
  in_progress: 'Đang học', unlocked: 'Đã mở', completed: 'Đã hoàn thành', locked: 'Chưa mở',
};

export type LessonCard = { id: string; title: string; chapterKey: string; chapterTitle: string; chapterOrder: number; lessonOrder: number;
  unlocked: boolean; progress: LessonStatus; percent: number; group: LessonGroup;
  /** Still being written: listed, never playable. */ planned: boolean;
  requirements: UnlockRequirement[]; note: string | null };

export type LessonFilter = 'all' | 'open' | 'locked';

/** The group of a lesson from its two states: a locked lesson is "Chưa mở" whatever it has done. */
export const groupOf = (unlocked: boolean, progress: LessonStatus): LessonGroup =>
  (!unlocked ? 'locked' : progress === 'not_started' ? 'unlocked' : progress);

export const sortLessons = (cards: LessonCard[]): LessonCard[] => [...cards].sort((a, b) =>
  GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.chapterOrder - b.chapterOrder || a.lessonOrder - b.lessonOrder);

/** Every lesson of the subject as a card, sorted. Read from `chapters`, which every server sends, using the states the
 * server decided (`unlock_status`, `progress_status`…) and, from an older server, its `locked` and `progress`. */
export function lessonCards(data: SubjectLessons): LessonCard[] {
  const cards = data.chapters.flatMap((chapter, ci) => chapter.lessons.map((l, li): LessonCard => {
    const planned = l.status === 'planned';
    const unlocked = l.unlock_status ? l.unlock_status === 'unlocked' : !planned && !l.locked;
    const progress = l.progress_status ?? l.progress?.status ?? 'not_started';
    const requirements = l.unlock_requirements ?? (planned ? [{ type: 'content' as const, note: 'Bài học đang được biên soạn.' }] : []);
    return {
      id: l.lesson_id ?? l.key, title: l.title, chapterKey: l.chapter_key ?? chapter.key, chapterTitle: l.chapter_title ?? chapter.title,
      chapterOrder: l.chapter_order ?? chapter.order ?? ci + 1, lessonOrder: l.lesson_order ?? li + 1,
      unlocked, progress, percent: l.progress_percent ?? l.progress?.percent ?? 0, group: l.group ?? groupOf(unlocked, progress),
      planned, requirements, note: unlocked ? null : l.unlock_note ?? (planned ? 'Bài học đang được biên soạn.' : l.requires_note),
    };
  }));
  return sortLessons(cards);
}

export const filterLessons = (cards: LessonCard[], filter: LessonFilter): LessonCard[] =>
  (filter === 'all' ? cards : cards.filter((c) => (filter === 'open' ? c.unlocked : !c.unlocked)));

/** Lessons completed out of those ready this school year. */
export function subjectProgress(data: SubjectLessons, cards: LessonCard[]): { completed: number; ready: number; percent: number } {
  if (data.progress) return data.progress;
  const ready = cards.filter((c) => !c.planned);
  const completed = ready.filter((c) => c.progress === 'completed').length;
  return { completed, ready: ready.length, percent: ready.length ? Math.round((100 * completed) / ready.length) : 0 };
}

/** The lessons that were locked before and are open now (they glow once). */
export const newlyUnlocked = (before: LessonCard[], after: LessonCard[]): string[] => {
  const was = new Map(before.map((c) => [c.id, c.unlocked]));
  return after.filter((c) => c.unlocked && was.get(c.id) === false).map((c) => c.id);
};

/** The order changed (or a card changed group): the list moves its cards rather than redrawing. */
export const orderChanged = (before: LessonCard[], after: LessonCard[]) =>
  before.length !== after.length || before.some((c, i) => c.id !== after[i].id || c.group !== after[i].group);

/** What to say about a locked lesson when it is tapped. */
export function unlockHint(card: LessonCard): string {
  const lessons = card.requirements.filter((r): r is Extract<UnlockRequirement, { type: 'lesson' }> => r.type === 'lesson' && !r.done);
  if (lessons.length) return `Hoàn thành ${lessons.map((r) => `“${r.title}”`).join(', ')} để mở bài này.`;
  return card.note ?? 'Bài này chưa mở.';
}
