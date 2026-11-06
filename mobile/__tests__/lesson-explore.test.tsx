import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import type { LessonExplore } from '../src/learning/types';
import { exploreLine, LessonScreen } from '../src/screens/learning/LessonScreens';
import { mockServer } from '../test/mockServer';

// Khám phá từ mới in a lesson's vocabulary games: the lesson's own words, then new words of its theme (backend
// vocab_lesson.py). The lesson screen says how far the learner is, and offers Ôn tập once nothing new is left.

beforeEach(async () => {
  await AsyncStorage.clear();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
});

const explore = (extra: Partial<LessonExplore> = {}): LessonExplore => ({ core_total: 15, core_discovered: 0, core_completed: false,
  core_completed_session: null, new_words_left: 106, exhausted: false, next_stage_words: 15, level: 1, level_name: 'Rất dễ',
  topics: ['animals'], related_topics: ['food'], ...extra });
const progress = { stages: 2, completed: 2, best: 90, passed: true, open_session: null, last: null };
const game = (e: LessonExplore, passed = true) => ({ game: 'word_shooter', title: 'Anh → Việt', gameplay: 'Bắn từ', style: null, turns: e.next_stage_words,
  short_stage: false, playable: true, review_count: 0, progress: { ...progress, passed }, explore: e });
const lesson = (e: LessonExplore, passed = true) => ({ key: 'ta1.con_vat', title: 'Từ vựng: Con vật quanh em', description: 'Gọi tên con vật.', status: 'ready',
  grade: 1, grade_id: 'grade1', grade_label: 'Lớp 1', subject: { code: 'english', name: 'Tiếng Anh' }, chapter: { key: 'ta1.ban_be', title: 'Me' },
  objectives: ['Gọi tên con vật'], summary: ['cat: con mèo'], examples: [], review: { status: 'checked', label: '' }, source_note: null,
  content_version: 'x', completion: { min_first_try: 0.8, games: 'all' }, progress: null, locked: false, requires: [], requires_note: null,
  practice_note: null, games: [game(e, passed)], next: null });

test('the line says how many of the lesson’s own words were discovered, then how many new words are left', () => {
  expect(exploreLine(explore({ core_discovered: 5 }))).toBe('Từ của bài: 5/15 · sau đó còn 96 từ mới cùng chủ đề');
  expect(exploreLine(explore({ core_discovered: 15, core_completed: true, new_words_left: 91 })))
    .toBe('Đã khám phá hết 15 từ của bài · còn 91 từ mới cùng chủ đề để khám phá');
  expect(exploreLine(explore({ exhausted: true, new_words_left: 0 }))).toMatch(/khám phá hết từ mới/);
});

test('a lesson with new words left plays again; one with none offers Ôn tập instead', async () => {
  const onPlay = jest.fn();
  const onReview = jest.fn();
  const props = { onBack: jest.fn(), onPlay, onReview, onResume: jest.fn(), onHowTo: jest.fn(), onOpenLesson: jest.fn(), starting: null };
  mockServer({ 'GET /api/learning/lesson-catalog/ta1.con_vat': { status: 200, body: lesson(explore({ core_discovered: 15, core_completed: true, new_words_left: 91 })) } });
  const first = render(<LessonScreen lessonKey="ta1.con_vat" {...props} />);
  expect(await screen.findByText(/còn 91 từ mới cùng chủ đề/)).toBeTruthy();
  fireEvent.press(screen.getByText('Chơi lại'));
  expect(onPlay).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Ôn tập từ đã học')).toBeNull();
  first.unmount();

  mockServer({ 'GET /api/learning/lesson-catalog/ta1.con_vat': { status: 200, body: lesson(explore({ core_discovered: 15, core_completed: true,
    new_words_left: 0, exhausted: true, next_stage_words: 0 })) } });
  render(<LessonScreen lessonKey="ta1.con_vat" {...props} />);
  fireEvent.press(await screen.findByText('Ôn tập từ đã học'));
  expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ game: 'word_shooter' }));
  expect(screen.queryByText('Chơi lại')).toBeNull();
  expect(onPlay).toHaveBeenCalledTimes(1);
});

test('a game not passed yet, with no new word left: the lesson’s own words again, which can still pass it', async () => {
  const onPlay = jest.fn();
  const onReview = jest.fn();
  mockServer({ 'GET /api/learning/lesson-catalog/ta1.con_vat': { status: 200, body: lesson(explore({ core_discovered: 15, core_completed: true,
    new_words_left: 0, exhausted: true, next_stage_words: 0 }), false) } });
  render(<LessonScreen lessonKey="ta1.con_vat" onBack={jest.fn()} onPlay={onPlay} onReview={onReview} onResume={jest.fn()} onHowTo={jest.fn()} onOpenLesson={jest.fn()} starting={null} />);
  fireEvent.press(await screen.findByText('Ôn tập từ của bài'));
  expect(onPlay).toHaveBeenCalledTimes(1);
  expect(onReview).not.toHaveBeenCalled();
});
