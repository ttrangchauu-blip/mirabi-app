# Brief: writing English grammar questions for Mirabi (Vietnamese learners)

You write questions for two games of a learning app for Vietnamese speakers:
- **choice** — *Chọn đáp án ngữ pháp*: a sentence with one blank `___` and 3-4 options; exactly one is right.
- **order** — *Sắp xếp câu*: the learner gets the pieces of a sentence shuffled and must put them in order; the
  Vietnamese meaning of the sentence is shown as the task.

Everything you write is stored as a **draft** and checked (automatically and by a reviewer) before release. Never pad:
a smaller number of excellent questions is better than many weak ones.

## Quality rules (most important first)
1. **One right answer.** In a choice question, every distractor must be clearly wrong *in this sentence*: grammatically
   impossible, or ruled out by an explicit clue in the sentence (a time expression, `already`, `since 2019`, `at the
   moment`, `yesterday`, a following clause...) or by `context_vi`. Think about each option: "could a native speaker
   say this sentence with this option?" If yes for two options, change the sentence or the options.
   For an order question, list **every** other natural word order in `alternatives` (e.g. a time phrase at the start or
   the end: `yesterday/I/...` and `I/.../yesterday`). If a sentence has too many possible orders, choose another one.
2. **Distractors from real learner errors**: wrong agreement (`she go`), wrong tense or form (`has went`, `did went`),
   wrong auxiliary, wrong preposition, `-ed/-ing` confusion, missing `to`, typical errors of Vietnamese speakers.
   Options are short (≤ 40 characters), all different, and the right one is in a random position.
3. **Real, varied situations**: daily life, family, school, work, travel, health, shopping, food, technology,
   environment, sports, entertainment, society... Every question is a different situation. **Never** make copies that
   only change a name, a number, he/she, or one noun. Don't reuse the same sentence frame within a point.
4. **Vocabulary matches the level**: difficulty 1-2 use very common words; 3-4 everyday intermediate words; 5-6 may use
   richer vocabulary. The grammar point is what is hard, not the words.
5. **All sentence forms**: for each point, unless the structure forbids it, about ≥ 25% negative and ≥ 25% questions,
   the rest affirmative, in both games.
6. Natural English (British or American, consistent within a sentence) and natural Vietnamese.
7. Vary the right answers of a point: don't make the answer always the same word.

## Files (TSV: tab-separated, UTF-8, one header line, no quotes, no tab inside a cell)
Write with the **Write** tool, paths relative to `backend/`:
`app/data/staging/grammar/<point>.p1.choice.tsv`, `<point>.p1.order.tsv` (use p2, p3... if you split a file).

### choice files — header (exactly; source/status are filled in later, leave them out):
```
key	point	difficulty	topic	form	context_vi	prompt	options	answer	hint_vi	explanation_vi	sentence_vi
```
- `key`: `<point>.c.001`, `<point>.c.002`, ... unique.
- `point`: the point code. `difficulty`: the point's difficulty, or ±1 for easier/harder vocabulary.
- `topic`: the situation, one code of `app/data/staging/topics.txt` (daily_life, home, family, food, school, work,
  travel, health, technology, shopping, sports, entertainment, environment, ...).
- `form`: `aff` | `neg` | `q` — the form of the complete sentence (a question ends with `?`).
- `context_vi`: short Vietnamese situation (≤ 100 chars) that removes any doubt, e.g. `Kể về việc đã xong lúc nói`.
- `prompt`: the English sentence with exactly one `___` (three underscores). Capital letter at the start, final `.`,
  `?` or `!`.
- `options`: 3-4 options separated by `|`, the answer among them, in a random position.
- `answer`: the right option, exactly as in `options`.
- `hint_vi`: a Vietnamese hint pointing to the clue or the rule (≤ 150 chars). **It must not contain the answer.**
- `explanation_vi`: why the answer is right and why the most tempting distractor is wrong (≤ 250 chars, Vietnamese,
  English words allowed).
- `sentence_vi`: natural Vietnamese translation of the complete sentence.

Example:
```
present_perfect_for_since.c.001	present_perfect_for_since	3	work	aff	Nói về thời gian làm việc kéo dài tới nay	My aunt has worked at the city hospital ___ 2015.	for|since|from|in	since	Sau chỗ trống là một mốc thời gian cụ thể.	2015 là mốc thời gian nên dùng since; for đi với khoảng thời gian (for ten years).	Dì tôi đã làm việc ở bệnh viện thành phố từ năm 2015.
```

### order files — header (exactly):
```
key	point	difficulty	topic	form	context_vi	tokens	alternatives	sentence_en	sentence_vi	hint_vi	explanation_vi
```
- `key`: `<point>.o.001`, ... unique.
- `tokens`: the pieces **in a correct order**, separated by `/`. 4-10 pieces (3-12 allowed). A piece is one word or a
  short fixed chunk (`to school`, `a lot of`, `has been`) — chunk so that the right order is clear. **No punctuation
  in pieces** (no commas, no final `.`/`?`). Write each piece as it will be shown: the first piece is lowercase
  unless it is `I` or a proper noun (so the capital letter doesn't give the order away).
- `alternatives`: every other correct order of exactly the same pieces, pieces separated by `/`, orders separated by
  `|`. Empty when the order is unique.
- `sentence_en`: the full sentence with capital letter and punctuation (commas included). The pieces in the first
  order must spell exactly this sentence (ignoring case and punctuation).
- `sentence_vi`: natural Vietnamese translation (this is the task shown to the learner).
- `hint_vi`, `explanation_vi`: as above (the hint may name the structure, e.g. `Câu hỏi: trợ động từ đứng trước chủ ngữ`).

Example:
```
present_perfect.o.001	present_perfect	3	travel	q	Hỏi bạn về trải nghiệm du lịch	have/you/ever/been/to Japan		Have you ever been to Japan?	Bạn đã từng đến Nhật Bản chưa?	Câu hỏi bắt đầu bằng trợ động từ.	Câu hỏi thì hiện tại hoàn thành: Have + chủ ngữ + ever + V3 (been)?
adverb_frequency.o.001	adverb_frequency	1	daily_life	aff	Kể về thói quen buổi sáng	I/usually/walk/to school/in the morning	in the morning/I/usually/walk/to school	I usually walk to school in the morning.	Tôi thường đi bộ đến trường vào buổi sáng.	Trạng từ tần suất đứng trước động từ thường.	usually đứng trước động từ walk; cụm thời gian có thể đứng đầu hoặc cuối câu.
```

## How to work
1. Read the rule of each of your points in `app/data/staging/grammar_points.txt`. Plan sub-structures and situations
   so the questions cover the whole point (e.g. present perfect: ever/never, already/yet, just, questions, negatives).
2. Write each file (split into parts of ≤ 70 rows if long).
3. Validate after each file (from `backend/`, Git Bash):
   `.venv/Scripts/python.exe -m app.learning_grammar_bank check app/data/staging/grammar/<point>.*.tsv | grep -E "^(error|issue)|valid questions"`
   Fix every `error` and `issue` (near-duplicates mean: rewrite that question as a really different situation).
4. Then re-read your questions once as a strict reviewer, looking only for: two possible answers, a wrong "right"
   answer, a missing alternative order, unnatural English or Vietnamese. Fix what you find.
5. Do not edit any other file in the repository.

When done, reply in a few lines: files written, number of questions per point and game, forms mix, anything unusual.
