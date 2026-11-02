// Shapes returned by /api/learning (backend/app/learning.py). The backend decides answers, score, combo, hearts,
// completion and EXP; the app only renders them.

import type { StudyRecommendations } from '../studyProfile';

export type SubjectCode = 'english' | 'math' | 'vietnamese' | 'science' | 'informatics';
/** Every subject of the lesson catalog (backend data/catalog/programme.json): the five above and the others. */
export type CatalogSubjectCode = SubjectCode | string;
export type Mode = 'practice' | 'challenge';
export type Variant = 'mixed' | 'gate' | 'bridge' | 'meteor' | 'word_shooter';
export type GameType = 'meteor' | 'grammar' | 'defense' | 'math_bridge' | CurriculumGameId;
/** The curriculum games (backend curriculum_games.py): reviewed content per grade, no hearts and no clock. */
export type CurriculumGameId = 'word_builder' | 'spelling_detective' | 'sorting' | 'code_path' | LessonGameId;
/** The lesson games (backend lesson_catalog.py): one gameplay each, the content comes from the lesson played. */
export type LessonGameId = 'order' | 'match' | 'choice' | 'lab' | SubjectGameId;
/** The subject gameplays (backend lesson_games*.py): a timeline, a sentence line, a geometry workshop, an equation, a
 * number line, a word problem solved step by step, a reading detective, a sentence painted by roles. */
export type SubjectGameId = 'timeline' | 'sentence' | 'geometry' | 'balance' | 'number_line' | 'step_solver' | 'story_detective'
  | 'sentence_xray';
/** The game the user picked. Grammar lessons offer two games (gate, bridge); "grammar" is both mixed. Vocabulary
 * lessons offer "word_shooter" (Anh → Việt) and "meteor" (Việt → Anh). */
export type GameId = 'word_shooter' | 'meteor' | 'gate' | 'bridge' | 'grammar' | 'defense' | 'math_bridge' | CurriculumGameId;
/** An entry of the game list that opens a choice of games, e.g. "Từ vựng" → Anh → Việt | Việt → Anh. */
export type GameGroupId = 'vocabulary';
/** vocab_typing: Việt → Anh (recall the word); word_spelling: Anh → Việt (type the word shown). */
export type TurnKind = 'vocab_typing' | 'word_spelling' | 'gate_choice' | 'bridge_order' | 'math_input' | 'missing_number' | 'compare'
  | 'word_build' | 'spell_fix' | 'sort_card' | 'code_path' | 'order_steps' | 'match_pairs' | 'choice_explain' | 'lab_experiment'
  | 'timeline_place' | 'sentence_build' | 'geometry_build' | 'equation_balance' | 'number_line_place' | 'step_solve' | 'story_evidence'
  | 'sentence_paint';
export type SessionStatus = 'active' | 'paused' | 'completed' | 'failed' | 'abandoned';
export type Outcome = 'first_try' | 'hinted' | 'corrected' | 'wrong' | 'revealed' | 'missed';
export type RewardStatus = 'granted' | 'capped' | 'daily_cap_reached' | 'daily_task' | 'already_claimed' | 'not_eligible' | 'none';

export type Ref = { id: number; code: string; name: string };
export type Level = Ref & { description: string | null };
export type Topic = Ref & { skill_type: string; description: string | null; review_count: number };
export type LessonBrief = { id: number; code: string; title: string; topic_id: number; level_id: number; game_type: GameType;
  turns: number; variants: Variant[]; version: number };
export type Subject = Ref & { code: SubjectCode; levels: Level[]; topics: Topic[]; lessons: LessonBrief[] };
/** `study_profile`: what to offer first for the user's grade; null until the user gives their age and grade. */
export type Catalog = { subjects: Subject[]; default_duration_minutes: number; study_profile?: StudyRecommendations | null;
  /** What the grade being studied offers (only subjects and games with content for it); null without a grade. */
  programme?: Programme | null };

export type FreeLevel = 'basic' | 'intermediate' | 'advanced';
/** backend curriculum.programme: the subjects of the curriculum, named as at that grade, with their games. */
export type Programme = { curriculum: string; grade: string | null; level: FreeLevel | null; outside_school: boolean; label: string;
  subjects: { code: SubjectCode; name: string; games: { id: GameId; grades: string }[] }[]; note: string | null;
  /** Sinh viên / Người đi làm: the levels to choose from. */ levels: { id: FreeLevel; label: string }[] };
/** Which grade (or level, outside school) a curriculum game is played for. */
/** Outside school (Sinh viên, Người đi làm): the level chosen. A school grade is never chosen by the app: the backend
 * uses the learner's locked grade (src/learning/education.ts). */
export type Band = { level?: FreeLevel | null };

export type VocabWord = { word: string; meaning_vi: string; context_vi: string | null; part_of_speech: string | null;
  phonetic: string | null; example_en: string | null; example_vi: string | null;
  /** Vocabulary bank: CEFR level, and why the word is in this stage ("Từ mới", "Cần ôn", "Ôn lại"). */
  level?: string | null; pick?: string | null };
export type Intro =
  | { kind: 'vocabulary'; title: string; tip?: string; words: VocabWord[] }
  | { kind: 'grammar'; title: string; explanation: string[]; rules: { form: string; example: string }[]; examples: { en: string; vi: string }[] }
  | { kind: 'math'; title: string; explanation: string[]; examples: { problem: string; steps: string[]; answer: string }[]; tips: string[] }
  /** A lesson of the catalog: what is learned, the summary and examples (the same as its lesson screen). */
  | { kind: 'lesson'; title: string; objectives: string[]; summary: string[]; examples: { title: string; lines: string[] }[]; game: string };
export type LessonDetail = LessonBrief & { intro: Intro };

export type Option = { id: string; text: string };
export type Prompt = {
  meaning_vi?: string; context_vi?: string | null; part_of_speech?: string | null; // vocab_typing
  letters?: number[]; // vocab_typing, word_spelling: letters per word of the answer
  word?: string; // word_spelling: the English word shown
  /** word_spelling of stages created while the meaning was asked: 'vi' = type the word's Vietnamese meaning (no letter
   * boxes, tone marks optional). Otherwise the English word itself is typed again. */
  answer_lang?: 'vi';
  phonetic?: string | null; // word_spelling of those same stages: how the shown word reads
  answer_keys?: string[]; // vocab_typing, word_spelling: keys of the accepted answers (learning/answerKey.ts), to shoot when right
  level?: string; // vocabulary bank: CEFR level of the word
  sentence?: string; options?: Option[]; // gate_choice, compare
  tokens?: Option[]; // bridge_order: pieces with their own ids (the same word twice has two ids)
  end?: string; // bridge_order: the final punctuation, shown after the pieces
  form?: 'aff' | 'neg' | 'q'; // grammar bank: the form of the sentence
  expression?: string; equation?: string; allow_negative?: boolean; // math
  left?: string; right?: string; // compare
  // Ghép chữ: the picture and its pieces (letters or syllables), shuffled
  picture?: string; unit?: 'letter' | 'syllable'; tiles?: Option[];
  // Thám tử chính tả: the sentence's words; once the misspelled one is found, the spellings to choose from
  step?: 'find' | 'fix'; found?: string;
  // Phân loại cùng pet: the groups and the card to place
  title?: string; groups?: { id: string; label: string; icon: string }[]; card?: { text: string; picture: string };
  // Lập trình đường đi: the map, the blocks offered and how many fit
  number?: number; cols?: number; rows?: number; start?: { x: number; y: number; dir: Facing }; goal?: { x: number; y: number };
  walls?: [number, number][]; blocks?: string[]; max_blocks?: number;
  // Sắp xếp thứ tự: the cards, shuffled, and what the two ends mean ("Đầu tiên", "Cuối cùng")
  prompt?: string; cards?: Option[]; first?: string | null; last?: string | null;
  // Ghép cặp: the two columns, each shuffled
  lefts?: Option[]; rights?: Option[]; left_label?: string | null; right_label?: string | null;
  // Chọn đáp án có giải thích: a passage to read (optional), the question, and whether it is graded (tự đánh giá: no)
  passage?: string | null; question?: string; style?: 'quiz' | 'situation' | 'reading' | 'predict' | 'reflect'; graded?: boolean;
  // Phòng thí nghiệm (lab): the scene, what to do, the places to fill and the parts on the bench (shuffled, ids say
  // nothing); water: the state the beaker starts in and the one asked for; shadow: the shadow asked for.
  scene?: 'circuit' | 'shadow' | 'water' | 'plant' | 'magnet'; aim?: string; slots?: { id: string; label: string }[];
  parts?: { id: string; name: string; art: string }[]; from?: string; to?: string;
  // Hành trình dòng thời gian: the markers in time order (how many events each holds) and the events, shuffled;
  // 'hidden': the markers' dates show once the timeline is complete.
  markers?: { id: string; label: string; slots: number }[]; events?: Option[]; years?: 'shown' | 'hidden';
  // Xây câu: the tiles (`tiles`, with the ones that do not belong), how many make the sentence, its meaning, its language
  length?: number; vi?: string | null; lang?: 'en' | 'vi';
  // Xưởng hình học: an angle on a protractor (its step, whether the measure shows) or a rectangle on a grid (cols × rows)
  shape?: 'angle' | 'rect'; angle_step?: number; readout?: boolean; initial?: number | [number, number]; measure_unit?: string;
  context?: string | null;
  // Cân bằng phương trình: the substances in order with their atoms, the elements, the largest coefficient
  species?: { id: string; formula: string; side: 'left' | 'right'; atoms: Record<string, number> }[]; elements?: string[];
  max?: number; condition?: string | null;
  // Cầu trục số: ticks 0..`ticks` (every `major`-th one long), the labels at their ticks, numbers already marked (`at`:
  // 0..1 along the line) and the points to place
  ticks?: number; major?: number; labels?: { at: number; text: string }[]; marks?: { at: number; text: string }[];
  points?: { id: string; label: string }[];
  // Giải toán từng bước: the problem, its numbers (and earlier results) as chips, the current step's question
  problem?: string; chips?: { id: string; text: string; step?: number }[]; at_step?: number; steps?: number; ask?: string;
  ask_unit?: string | null; done?: { step: number; ask: string; work: string; result: string }[];
  // Thám tử đọc hiểu: the passage as tappable sentences; 'find' (the clue) then 'answer' (the options come)
  sentences?: Option[]; phase?: 'find' | 'answer';
  // Soi câu: the highlighters and the sentence's pieces (punctuation `fixed`: not paintable)
  roles?: { id: string; name: string }[]; words?: { id: string; text: string; fixed?: boolean }[];
};
export type Facing = 'N' | 'E' | 'S' | 'W';

export type Turn = { turn_id: string; position: number; kind: TurnKind; skill_label: string; prompt: Prompt; hints_shown: string[];
  hints_total: number; attempts: number; wrong_attempts: number; practice: boolean; travel_seconds: number;
  /** Play time since the turn was issued (server clock): a reopened game puts the target back where it was. */
  on_screen_ms?: number };

export type Reward = { status: RewardStatus; exp: number };

export type LearningSession = {
  id: number; status: SessionStatus; kind: 'lesson' | 'review' | 'archive'; mode: Mode; game_type: GameType; variant: Variant | null; game: GameId;
  subject: Ref; topic: Ref; level: Ref; lesson: Ref;
  duration_seconds: number; active_ms: number; remaining_ms: number; time_up: boolean;
  /** False for games with no clock (the curriculum games); missing from older backends. */ timed?: boolean;
  hearts: number; hearts_max: number; score: number; combo: number; max_combo: number;
  required_count: number; resolved_count: number; pending_practice: number;
  open_turns: Turn[]; can_complete: boolean; end_reason: string | null; reward: Reward | null; version: number; server_time: string;
  /** A stage of a lesson (Học tập theo bài): the lesson, its other games and the next lesson. Missing on older backends. */
  catalog?: SessionLesson | null;
  /** kind 'archive': the finished school year reviewed from Kho lưu trữ (its results stay as they were). */
  archive_year?: number | null;
};

/** A vocabulary turn's word and meaning, sent once the turn is resolved (hit, missed or revealed). */
export type WordPair = { en: string; vi: string; phonetic: string | null };
/** `turn_id` is the turn this event resolved: a typed shot may hit another falling word than the aimed one. */
export type TurnResult = { turn_id: string; event: string; correct: boolean | null; outcome: Outcome | null; resolved: boolean;
  retry_allowed: boolean; error_type: string | null; score_delta: number; hearts_delta: number; combo: number;
  hint: string | null; correct_answer: string | null; explanation: string | null; practice_added: boolean; word?: WordPair | null;
  /** Curriculum games: why a wrong answer is wrong (it is fixed and tried again), or what to do next. */ feedback?: string | null;
  /** Sắp xếp / Ghép cặp, after a wrong answer: the cards in the right place or the right pairs, kept in place. */ kept?: string[] | null;
  /** Multiple-choice games, once the turn is resolved or revealed: the ids of the right options (marked in green). */
  correct_options?: string[] | null };
export type EventResponse = { result: TurnResult | null; session: LearningSession; replayed: boolean;
  /** `complete` of a lesson's stage: what is open and not celebrated yet (older servers: missing). */ unlocked?: UnlockedContent[] };

export type ResultItem = { turn_id: string; position: number; kind: TurnKind; skill_label: string; prompt: Prompt; outcome: Outcome | null;
  practice: boolean; attempts: number; hints_used: number; error_type: string | null; correct_answer: string; explanation: string | null;
  word?: WordPair | null };
export type SessionResult = { session: LearningSession; counts: Record<Outcome | 'unanswered', number>; items: ResultItem[]; open_review_count: number };

export type ReviewItem = { id: number; label: string; reason: Outcome; skill_key: string; times_flagged: number; updated_at: string };
export type ReviewGroup = { topic: Ref; subject: Ref; items: ReviewItem[] };

/** "Từ đã học" (/api/learning/vocabulary/history): read from the turns of both vocabulary games, one entry per sense. */
export type VocabDirection = 'en_vi' | 'vi_en';
/** correct: right without seeing the answer (at once or after a letter hint); wrong: fixed after a mistake, wrong,
 * "Xem đáp án" or reached the ground; unanswered: on screen when the stage stopped. */
export type VocabResult = 'correct' | 'wrong' | 'unanswered';
/** Sổ tay từ vựng: review (chưa nhớ, answered wrong), learned (đã học), mastered (thành thạo); correct = learned or mastered. */
export type VocabFilter = 'all' | 'correct' | 'review' | 'learned' | 'mastered';
export type VocabMemory = 'review' | 'learned' | 'mastered';
export type VocabDirectionStats = { correct: number; wrong: number; unanswered: number; last_result: VocabResult; last_at: string | null };
export type VocabHistoryItem = { entry_key: string; word: string; meaning_vi: string; context_vi: string | null; part_of_speech: string | null;
  first_seen_at: string | null; last_seen_at: string | null; status: 'correct' | 'review';
  /** Newer servers: the topic and level (1..5) of the word, and how well it is remembered. */
  topic?: string | null; level?: number; memory?: VocabMemory; mastery?: number;
  correct: number; wrong: number; unanswered: number; directions: Partial<Record<VocabDirection, VocabDirectionStats>> };
/** One page of the history: `total` words match the filter and search; `counts` and `due` are for the whole history. */
export type VocabHistory = { items: VocabHistoryItem[]; total: number; limit: number; offset: number;
  counts: Partial<Record<VocabFilter, number>> & Record<'all' | 'correct' | 'review', number>; due: Record<VocabDirection, number>;
  /** The topics of the whole history (the topic filter); newer servers only. */
  topics?: { code: string; name: string; count: number }[] };
/** Filters of Sổ tay từ vựng besides the tab: a topic, a level, a school year. */
export type VocabQuery = { topic?: string | null; level?: number | null; year?: number | null };

/** Khám phá từ mới (/api/learning/vocabulary/progress): one vocabulary game's levels, new words left and reviews due. */
export type VocabGame = 'meteor' | 'word_shooter';
export type VocabLevelStatus = 'completed' | 'unlocked' | 'locked' | 'above_grade';
export type VocabLevel = { level: number; name: string; status: VocabLevelStatus; total: number; discovered: number };
/** A completed level not celebrated yet: shown once, then POST …/celebrated. */
export type VocabCelebrationInfo = { level: number; name: string; words: number; next_level: number | null; title: string; message: string };
export type VocabProgress = { game: VocabGame; game_name: string; grade: string | null; grade_label: string; academic_year: number | null;
  levels: VocabLevel[]; current_level: number; max_level: number; discovered: number; discovered_this_year: number | null;
  new_words_left: number; challenge: number; review_due: number;
  topics: { code: string; name: string; total: number; new_words_left: number }[]; celebration: VocabCelebrationInfo | null };
/** How a vocabulary game is played: new words only (optionally of one topic), or a review of words met before. */
export type VocabPlay = { vocab: 'discover' | 'review'; topic?: string | null };
export type VocabAttempt = { turn_id: string; session_id: number; at: string | null; direction: VocabDirection; result: VocabResult;
  outcome: Outcome | null; /** A re-practice right after "Xem đáp án": shown, never counted. */ practice: boolean; session_open: boolean };
export type VocabWordDetail = VocabHistoryItem & { phonetic: string | null; example_en: string | null; example_vi: string | null;
  /** False for a word of an older lesson that is not in the word bank: it cannot be served again. */ can_practice: boolean;
  attempts: VocabAttempt[] };

export type StartOptions = { lessonId: number; mode: Mode; durationMinutes: number; variant?: Variant | null };

// --- Học tập theo bài (backend lesson_api.py, lesson_catalog.py) -----------------------------------------------------

export type SubjectType = 'compulsory' | 'activity' | 'elective' | 'optional';
/** A game of a lesson, as offered on the result screen ("Trò khác trong bài"). */
export type LessonGameRef = { game: GameId; title: string };
/** The drawn world a lesson's games are played in (backend lesson_catalog.WORLDS). */
export type GameWorld = 'kingdom' | 'space' | 'forest' | 'lab' | 'time' | 'map';
export type SessionLesson = { lesson: string; title: string | null; grade: number; game: GameId; game_title: string | null;
  short_stage: boolean; subject_name: string | null; other_games: LessonGameRef[];
  next: { key: string; title: string; ready: boolean; /** Not open yet: the result does not lead there (older servers: missing). */ locked?: boolean } | null;
  /** None for a subject without a world yet; missing on older backends (the app then goes by the subject). */ world?: GameWorld | null };

/** ready: every lesson can be played; partial: some; planned: listed, none ready yet; empty: no lessons written;
 * unsupported: depends on the school or region (`unsupported` says why). */
export type SubjectSupport = 'ready' | 'partial' | 'planned' | 'empty' | 'unsupported';
export type ProgrammeSubject = { code: CatalogSubjectCode; name: string; type: SubjectType; type_label: string; note: string | null;
  unsupported: string | null; practice_note: string | null; icon: string; bg: string; color: string;
  chapters: number; lessons: number; ready: number; completed: number; in_progress: number; status: SubjectSupport;
  /** THPT electives: chosen by the learner (null for the other subjects). */ selected: boolean | null };
export type ResumeLesson = { lesson: string; title: string; grade: number; grade_id: string; subject: CatalogSubjectCode;
  subject_name: string; game: GameId | null; game_title: string | null; open_session: number | null };
export type LessonProgramme = { curriculum: string; legal_basis: string[]; notes: string[]; types: Record<SubjectType, string>;
  main_grade: string | null; resume: ResumeLesson | null;
  /** The school year of the grade ("2027–2028"); null outside school. */ academic_year?: number | null; academic_year_label?: string | null;
  /** null: no school grade (outside school, or not given yet). */ grade: string | null; number: number | null; label: string;
  is_main: boolean; subjects: ProgrammeSubject[];
  selection: { available: CatalogSubjectCode[]; chosen: CatalogSubjectCode[]; count: number; note: string } | null; note: string | null };

export type LessonStatus = 'not_started' | 'in_progress' | 'completed';
export type LessonProgress = { status: LessonStatus; label: string; games_passed: number; games_total: number; percent: number };
/** Why a lesson is not open yet: a prerequisite lesson (this school year), the chapter before it, or content still being written. */
export type UnlockRequirement = { type: 'lesson'; lesson_id: string; title: string; done: boolean }
  | { type: 'chapter'; chapter_key: string; title: string; done: boolean; remaining: number } | { type: 'content'; note: string };
/** Where a chapter or lesson stands for this learner (backend learning_unlocks.py). */
export type ContentStatus = 'LOCKED' | 'UNLOCKED' | 'IN_PROGRESS' | 'COMPLETED';
/** A chapter or lesson the rules opened, not celebrated yet. `lesson`: where "Khám phá ngay" leads. */
export type UnlockedContent = { id: number; type: 'chapter' | 'lesson'; key: string; title: string; subject: string; subject_name: string;
  grade: number; chapter_key: string; chapter_title: string; lesson: string | null; source: string; trigger: string | null; unlocked_at: string };
/** Where a lesson sits in its subject's list (backend lesson_api.sort_lessons): Đang học → Đã mở → Đã hoàn thành → Chưa mở. */
export type LessonGroup = 'in_progress' | 'unlocked' | 'completed' | 'locked';
/** A lesson of a subject's list, as the backend decides it for this learner and school year. Being open (`unlock_status`)
 * and being done (`progress_status`) are separate. The fields after `games` are missing on older servers. */
export type LessonListItem = { key: string; title: string; description: string; status: 'ready' | 'planned';
  progress: LessonProgress | null; games: LessonGameRef[]; locked: boolean; requires_note: string | null;
  lesson_id?: string; subject_id?: string; grade_id?: string; academic_year?: number | null;
  chapter_key?: string; chapter_title?: string; chapter_order?: number; lesson_order?: number;
  unlock_status?: 'unlocked' | 'locked'; progress_status?: LessonStatus; progress_percent?: number;
  unlock_requirements?: UnlockRequirement[]; unlock_note?: string | null; group?: LessonGroup;
  content_status?: ContentStatus; /** Optional lessons never hold the next one back. */ required?: boolean;
  /** Opened and not celebrated yet. */ celebrate?: boolean };
export type SubjectLessons = { subject: ProgrammeSubject; grade: string; number: number; label: string;
  academic_year?: number | null; academic_year_label?: string | null;
  organization: 'topic' | 'textbook'; source_note: string | null; textbook: { series: string; edition?: string } | null;
  chapters: { key: string; title: string; order?: number; lessons: LessonListItem[];
    /** Missing on older servers. */ content_status?: ContentStatus; required_total?: number; required_completed?: number;
    unlock_note?: string | null; celebrate?: boolean }[];
  /** What opened and is not celebrated yet (missing on older servers). */ unlocked?: UnlockedContent[];
  /** Every lesson once, sorted by the learner's state (missing on older servers: the app sorts `chapters` itself). */
  lessons?: LessonListItem[];
  /** Lessons completed / ready this school year. */ progress?: { completed: number; ready: number; total: number; percent: number } };

export type LessonGameProgress = { stages: number; completed: number; best: number | null; passed: boolean; open_session: number | null;
  last: { session_id: number; status: SessionStatus; first_try: number; total: number; attempts: number; hints: number;
    to_review: number; content_version: string | null } | null };
/** Khám phá từ mới of a lesson's vocabulary game (backend vocab_lesson.status): its own words, then new words beyond. */
export type LessonExplore = { core_total: number; core_discovered: number; core_completed: boolean;
  /** The stage that discovered the lesson's last own word (its result says so). */ core_completed_session: number | null;
  new_words_left: number; exhausted: boolean; next_stage_words: number; level: number; level_name: string;
  topics: string[]; related_topics: string[] };
export type LessonGame = LessonGameRef & { gameplay: string; style: string | null; turns: number; short_stage: boolean; playable: boolean;
  review_count: number; progress: LessonGameProgress; /** Vocabulary games only (older servers: missing). */ explore?: LessonExplore | null;
  /** An optional game never holds the lesson back (older servers: missing). */ required?: boolean; status?: ContentStatus };
export type CatalogLesson = { key: string; title: string; description: string; status: 'ready' | 'planned'; grade: number; grade_id: string;
  grade_label: string; subject: { code: CatalogSubjectCode; name: string }; chapter: { key: string; title: string };
  objectives: string[]; summary: string[]; examples: { title: string; lines: string[] }[];
  review: { status: string; label: string }; source_note: string | null; content_version: string;
  completion: { min_first_try: number; games: 'all' | 'any' }; progress: LessonProgress | null; locked: boolean;
  requires: { key: string; title: string; done: boolean }[]; requires_note: string | null; practice_note: string | null;
  games: LessonGame[]; next: { key: string; title: string; ready: boolean } | null };
