// Age and school grade on the profile. Mirrors backend/app/study_profile.py (keep AGE_MIN, AGE_MAX, GRADES,
// suggestGrade and gradeFitsAge in step); the server validates again and decides the learning suggestions.
import type { GameId, SubjectCode } from './learning/types';

export const AGE_MIN = 4;
export const AGE_MAX = 100;
export const AGES = Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => AGE_MIN + i);

export type GradeId = 'preschool' | `grade${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}` | 'university' | 'adult';

export const GRADES: { id: GradeId; label: string }[] = [
  { id: 'preschool', label: 'Chưa đi học' },
  ...Array.from({ length: 12 }, (_, i) => ({ id: `grade${i + 1}` as GradeId, label: `Lớp ${i + 1}` })),
  { id: 'university', label: 'Sinh viên' },
  { id: 'adult', label: 'Người đi làm/Học tự do' },
];

export const gradeLabel = (grade: string | null | undefined) => GRADES.find((g) => g.id === grade)?.label ?? '';

const schoolYear = (grade: GradeId) => (grade.startsWith('grade') ? Number(grade.slice(5)) : null);

/** A child starts grade 1 the year they turn 6. Only a suggestion: the user confirms or changes it. */
export function suggestGrade(age: number): GradeId {
  if (age < 6) return 'preschool';
  if (age <= 17) return `grade${age - 5}` as GradeId;
  return age <= 22 ? 'university' : 'adult';
}

/** Grades plausible at this age. Wide on purpose: early or late starts and repeated years are common. */
export function gradeFitsAge(grade: GradeId, age: number): boolean {
  const year = schoolYear(grade);
  if (year !== null) return year + 4 <= age && age <= year + 9;
  return grade === 'preschool' ? age <= 7 : grade === 'university' ? age >= 16 : age >= 15;
}

export const gradeChoices = (age: number) => GRADES.filter((g) => gradeFitsAge(g.id, age));

export function validateAge(age: number | null): string | undefined {
  if (age === null) return 'Vui lòng chọn độ tuổi.';
  if (!Number.isInteger(age) || age < AGE_MIN || age > AGE_MAX) return `Độ tuổi cần từ ${AGE_MIN} đến ${AGE_MAX}.`;
}

export function validateGrade(age: number | null, grade: GradeId | null): string | undefined {
  if (age === null) return undefined; // the age error says what to do first
  if (!grade) return 'Vui lòng chọn lớp học.';
  if (!gradeFitsAge(grade, age)) return 'Lớp học này không phù hợp với độ tuổi đã chọn.';
}

/** What Học tập offers first for the user's grade (backend study_profile.recommendations), or null until it is given. */
export type StudyRecommendations = {
  grade: GradeId; grade_label: string; subjects: SubjectCode[]; games: GameId[]; math_level: string;
  topics: Record<SubjectCode, string[]>;
};
