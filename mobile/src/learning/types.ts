// Shapes returned by /api/learning (backend/app/learning.py). The backend decides answers, score, combo, hearts,
// completion and EXP; the app only renders them.

export type SubjectCode = 'english' | 'math';
export type Mode = 'practice' | 'challenge';
export type Variant = 'mixed' | 'gate' | 'bridge' | 'meteor' | 'word_shooter';
export type GameType = 'meteor' | 'grammar' | 'defense' | 'math_bridge';
/** The game the user picked. Grammar lessons offer two games (gate, bridge); "grammar" is both mixed. Vocabulary
 * lessons offer "word_shooter" (Anh → Việt) and "meteor" (Việt → Anh). */
export type GameId = 'word_shooter' | 'meteor' | 'gate' | 'bridge' | 'grammar' | 'defense' | 'math_bridge';
/** An entry of the game list that opens a choice of games, e.g. "Từ vựng" → Anh → Việt | Việt → Anh. */
export type GameGroupId = 'vocabulary';
/** vocab_typing: Việt → Anh (recall the word); word_spelling: Anh → Việt (type the word shown). */
export type TurnKind = 'vocab_typing' | 'word_spelling' | 'gate_choice' | 'bridge_order' | 'math_input' | 'missing_number' | 'compare';
export type SessionStatus = 'active' | 'paused' | 'completed' | 'failed' | 'abandoned';
export type Outcome = 'first_try' | 'hinted' | 'corrected' | 'wrong' | 'revealed' | 'missed';
export type RewardStatus = 'granted' | 'capped' | 'daily_cap_reached' | 'daily_task' | 'already_claimed' | 'not_eligible' | 'none';

export type Ref = { id: number; code: string; name: string };
export type Level = Ref & { description: string | null };
export type Topic = Ref & { skill_type: string; description: string | null; review_count: number };
export type LessonBrief = { id: number; code: string; title: string; topic_id: number; level_id: number; game_type: GameType;
  turns: number; variants: Variant[]; version: number };
export type Subject = Ref & { code: SubjectCode; levels: Level[]; topics: Topic[]; lessons: LessonBrief[] };
export type Catalog = { subjects: Subject[]; default_duration_minutes: number };

export type VocabWord = { word: string; meaning_vi: string; context_vi: string | null; part_of_speech: string | null;
  phonetic: string | null; example_en: string | null; example_vi: string | null;
  /** Vocabulary bank: CEFR level, and why the word is in this stage ("Từ mới", "Cần ôn", "Ôn lại"). */
  level?: string | null; pick?: string | null };
export type Intro =
  | { kind: 'vocabulary'; title: string; tip?: string; words: VocabWord[] }
  | { kind: 'grammar'; title: string; explanation: string[]; rules: { form: string; example: string }[]; examples: { en: string; vi: string }[] }
  | { kind: 'math'; title: string; explanation: string[]; examples: { problem: string; steps: string[]; answer: string }[]; tips: string[] };
export type LessonDetail = LessonBrief & { intro: Intro };

export type Option = { id: string; text: string };
export type Prompt = {
  meaning_vi?: string; context_vi?: string | null; part_of_speech?: string | null; // vocab_typing
  letters?: number[]; // vocab_typing, word_spelling: letters per word of the answer
  word?: string; // word_spelling: the English word to type (its meaning only comes with the hit)
  level?: string; // vocabulary bank: CEFR level of the word
  sentence?: string; options?: Option[]; // gate_choice, compare
  tokens?: Option[]; // bridge_order: pieces with their own ids (the same word twice has two ids)
  end?: string; // bridge_order: the final punctuation, shown after the pieces
  form?: 'aff' | 'neg' | 'q'; // grammar bank: the form of the sentence
  expression?: string; equation?: string; allow_negative?: boolean; // math
  left?: string; right?: string; // compare
};

export type Turn = { turn_id: string; position: number; kind: TurnKind; skill_label: string; prompt: Prompt; hints_shown: string[];
  hints_total: number; attempts: number; wrong_attempts: number; practice: boolean; travel_seconds: number;
  /** Play time since the turn was issued (server clock): a reopened game puts the target back where it was. */
  on_screen_ms?: number };

export type Reward = { status: RewardStatus; exp: number };

export type LearningSession = {
  id: number; status: SessionStatus; kind: 'lesson' | 'review'; mode: Mode; game_type: GameType; variant: Variant | null; game: GameId;
  subject: Ref; topic: Ref; level: Ref; lesson: Ref;
  duration_seconds: number; active_ms: number; remaining_ms: number; time_up: boolean;
  hearts: number; hearts_max: number; score: number; combo: number; max_combo: number;
  required_count: number; resolved_count: number; pending_practice: number;
  open_turns: Turn[]; can_complete: boolean; end_reason: string | null; reward: Reward | null; version: number; server_time: string;
};

/** A vocabulary turn's word and meaning, sent once the turn is resolved (hit, missed or revealed). */
export type WordPair = { en: string; vi: string; phonetic: string | null };
/** `turn_id` is the turn this event resolved: a typed shot may hit another falling word than the aimed one. */
export type TurnResult = { turn_id: string; event: string; correct: boolean | null; outcome: Outcome | null; resolved: boolean;
  retry_allowed: boolean; error_type: string | null; score_delta: number; hearts_delta: number; combo: number;
  hint: string | null; correct_answer: string | null; explanation: string | null; practice_added: boolean; word?: WordPair | null };
export type EventResponse = { result: TurnResult | null; session: LearningSession; replayed: boolean };

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
export type VocabFilter = 'all' | 'correct' | 'review';
export type VocabDirectionStats = { correct: number; wrong: number; unanswered: number; last_result: VocabResult; last_at: string | null };
export type VocabHistoryItem = { entry_key: string; word: string; meaning_vi: string; context_vi: string | null; part_of_speech: string | null;
  first_seen_at: string | null; last_seen_at: string | null; status: 'correct' | 'review';
  correct: number; wrong: number; unanswered: number; directions: Partial<Record<VocabDirection, VocabDirectionStats>> };
/** One page of the history: `total` words match the filter and search; `counts` and `due` are for the whole history. */
export type VocabHistory = { items: VocabHistoryItem[]; total: number; limit: number; offset: number;
  counts: Record<VocabFilter, number>; due: Record<VocabDirection, number> };
export type VocabAttempt = { turn_id: string; session_id: number; at: string | null; direction: VocabDirection; result: VocabResult;
  outcome: Outcome | null; /** A re-practice right after "Xem đáp án": shown, never counted. */ practice: boolean; session_open: boolean };
export type VocabWordDetail = VocabHistoryItem & { phonetic: string | null; example_en: string | null; example_vi: string | null;
  /** False for a word of an older lesson that is not in the word bank: it cannot be served again. */ can_practice: boolean;
  attempts: VocabAttempt[] };

export type StartOptions = { lessonId: number; mode: Mode; durationMinutes: number; variant?: Variant | null };
