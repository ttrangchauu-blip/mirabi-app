# Writing lessons (Học tập theo bài)

How the lesson catalog is written, checked and published. The code is `backend/app/lesson_catalog.py`; the app flow
and rules are in [LEARNING_GAMES.md](LEARNING_GAMES.md#học-theo-bài).

```
Chương trình (GDPT 2018) → Khối lớp → Môn học → Chương/Chủ đề → Bài học → Trò chơi
programme.json             grade     subject   chapters[]       lessons[]  games[]
```

- `backend/app/data/catalog/programme.json`: every subject and educational activity of grades 1–12 as named at that
  grade, its type (`compulsory` bắt buộc, `activity` hoạt động giáo dục bắt buộc, `elective` lựa chọn, `optional` tự chọn)
  and what Mirabi supports (`unsupported` explains why a subject has no lessons). Basis: Thông tư 32/2018/TT-BGDĐT as
  amended by Thông tư 20/2021, 13/2022 and 17/2025.
- `backend/app/data/catalog/lessons/<subject>.json`: one file per subject, every grade it is taught in.

**Check before committing** (from `backend/`): `python -m app.lesson_catalog check [files]` (no file: all of them, plus
the cross-file checks), and `python -m app.lesson_catalog inventory` for the per-grade table. An invalid file stops the
server, so a lesson is never served half right.

## A subject file

```json
{
  "subject": "math",                 // a code of programme.json
  "version": 1,
  "organization": "topic",           // "topic": by the curriculum's topics; "textbook": follows one textbook series
  "source_note": "Theo yêu cầu cần đạt môn Toán (CT GDPT 2018); tổ chức theo chủ đề, không theo mục lục bộ sách nào.",
  "chapters": [
    {"key": "toan2.nhan_chia", "grade": 2, "order": 3, "title": "Phép nhân và phép chia",
     "lessons": [ {lesson}, … ]}
  ]
}
```

- **Organization.** `topic` (the default): lessons follow the curriculum's content requirements in a sensible order and
  never claim to be a textbook's table of contents. `textbook` is only for a file that follows one series: it then has
  `"textbook": {"series": "…", "edition": "…"}` and every lesson a `textbook_ref` (the book's lesson). Never mix the
  order of several series.
- **Keys** are stable ids, never reused for other content: chapter and lesson keys start with the subject's short code
  and the grade (`toan2.`, `tv1.`, `ta3.`, `gd5.`, `kh4.`, `lsdl6.`, `ls10.`, `dl11.`, `vl10.`, `hh10.`, `sh10.`,
  `thcn3.`, `th7.`, `cn8.`, `an2.`, `mt4.`, `tc5.`, `qp10.`, `tn6.`), then a slug of `a–z 0–9 _` (lesson keys at most 36
  characters). Task keys: `a–z 0–9 _`, at most 16, unique in their game.
- **Order**: `order` on chapters and lessons, the order knowledge builds up.

## A lesson

```json
{"key": "toan2.bang_nhan_2", "order": 1, "title": "Bảng nhân 2",
 "description": "Thuộc bảng nhân 2 và dùng nó để tính nhanh.",          // one line shown in the list
 "status": "ready",                                                    // or "planned" (listed, no game)
 "review": {"status": "checked", "note": "…"},                          // draft | checked | teacher_reviewed
 "source": "mirabi-original",
 "objectives": ["Thuộc bảng nhân 2 từ 2 × 1 đến 2 × 10", "…"],          // "Bạn sẽ học gì?"
 "summary": ["2 × 3 nghĩa là 2 được lấy 3 lần: 2 + 2 + 2 = 6.", "…"],   // Kiến thức tóm tắt
 "examples": [{"title": "Đếm thêm 2", "lines": ["2, 4, 6, 8, 10…"]}],   // collapsible
 "requires": [], "requires_note": null,                                // an earlier lesson that must be done first, and why
 "completion": {"min_first_try": 0.8, "games": "all"},                  // optional (these are the defaults)
 "games": [ {game}, … ]}
```

- The title says what is learned ("Phân biệt s/x", "Vòng đời của cây đậu"), never only "Bài 3".
- `planned` lessons show the full catalog honestly: listed with their title and description, marked *Đang biên soạn*,
  no play button. A planned lesson has no `games`.
- `ready` needs objectives, a summary, `review.status` at least `checked`, and at least one game with enough content.
  `checked` = written for Mirabi and checked by its author and the validator; `teacher_reviewed` once a teacher has.
- **Completion** (*Đã hoàn thành*): every published game (`games: "all"`, or one: `"any"`) has a completed stage with at
  least `min_first_try` of its graded questions right at the first try. Opening a lesson or playing once is not enough.
- A lock (`requires`) is only for a real prerequisite, and `requires_note` says why.

## Games

Every game reuses one gameplay; the lesson only passes its content. A stage asks `turns` questions (default: all it
has, at most the game's maximum), each at most once, never padded with another lesson's or another grade's content.
None of these games has hearts or a clock except the vocabulary and Math games, which keep their own rules.

| `game` | Content | At least | Stage at most | For |
|---|---|---|---|---|
| `order` | `tasks`: `{key, prompt, items[] (in the right order), explanation, hint?, first_label?, last_label?}` | 4 tasks | 8 | vòng đời, dòng thời gian, quy trình, các bước giải, thứ tự động tác, sắp xếp câu |
| `match` | `tasks`: `{key, prompt, pairs[[left, right]…], explanation, hint?, left_label?, right_label?}` | 3 tasks | 6 | sự kiện–nhân vật, địa danh–đặc điểm, phép tính–kết quả, từ–nghĩa, ký hiệu–tên |
| `choice` | `style`: quiz, situation, reading, predict, reflect; `tasks`: `{key, passage?, question, options[{text, ok, why}], explanation, hint?, graded?}` | 5 tasks | 10 | tình huống đạo đức/pháp luật, đọc hiểu, dự đoán hiện tượng, nhận biết |
| `sorting` | `set`: `{title, groups[{id, label, icon}], cards[{key, text, picture, group, explanation}]}` | 8 cards | 10 | phân loại |
| `spelling_detective` | `items`: `{key, difficulty, sentence, right, wrong, options[], hints[], explanation}` (grades 2–9) | 6 | 10 | chính tả |
| `word_builder` | `items`: `{key, difficulty, unit: letter\|syllable, picture, pieces[], answer, hints[], explanation}` (grades 1–2) | 6 | 10 | ghép chữ |
| `code_path` | `levels`: keys of `data/curriculum/code_path.json` | 3 | 5 | lập trình |
| `defense`, `math_bridge` | `math`: `{topic, …generator}` (below) | — | 10 generated | phép tính, tìm số, so sánh |
| `meteor`, `word_shooter` | `words`: keys of the vocabulary bank (`data/vocabulary/*.tsv`) | 6 | 15 | từ vựng |

Every game also has a `title`: what the learner sees ("Dòng thời gian", "Vòng đời kỳ diệu", "Ghép phép tính với kết
quả"). The same game can carry a different title in each lesson.

- **order**: 3–6 cards (by grade, below), every card different, exactly one right order. Not for anything whose order
  is a matter of choice.
- **match**: 3–5 pairs; every left and every right card different, so there is exactly one pairing.
- **choice**: 2–4 options; every option has `why` (shown when chosen, right or wrong). Usually one `ok` option; for
  open, creative or practical content several options can be acceptable by stated criteria (`ok` on each, the `why`
  saying which criterion it meets), and `style: "reflect"` with `graded: false` is a self-assessment with no wrong
  answer (never counted as right or wrong, never in Cần ôn).
- **Math generator** (`learning_engine.generate_math_items`): `defense` with topic `arithmetic` (`ops` of add, sub,
  mul, div; `add_max`; `mul_min`/`mul_max`; `table` = one times table, `table_range`; `no_carry` for cộng/trừ không nhớ;
  `allow_negative`) or `order_of_operations` (`ops_count` 2 or 3, `operand_max`, `add_max`); `math_bridge` with
  `missing_number` or `compare` (`expressions`). The validator generates a stage to check the settings.
- **Vocabulary**: 15 words is a full stage; fewer (at least 6) is a short stage, shown as "Bài ngắn · n từ". The words
  must be active senses of the bank; choose them by topic and difficulty for the grade.

**By grade** (`lesson_catalog.limits`): the amount of reading and tapping a task may ask.

| Grades | Cards to order | Pairs | Options | Card text | Question | Passage |
|---|---|---|---|---|---|---|
| 1–2 | 3–4 | 3–4 | 2–3 | 40 | 140 | 350 |
| 3–5 | 3–5 | 3–5 | 2–4 | 70 | 220 | 700 |
| 6–12 | 3–6 | 3–5 | 2–4 | 110 | 320 | 1400 |

## Content rules

- **Write it yourself.** Questions, passages and explanations are written for Mirabi. Never copy a textbook's text,
  exercises or table of contents without the rights; facts are facts, the wording is ours.
- **Right grade, right lesson.** Only what the curriculum asks at that grade; never content from a higher grade.
- **Never repeat to fill.** The validator refuses the same question twice in a game; do not reword one question into
  several either.
- **Correct and unambiguous.** One right answer (or criteria stated in `why`), Vietnamese with full diacritics,
  explanations that teach. Dates and names of history are the well-established ones.
- **Current facts.** Administrative units changed in 2025 (34 provinces and cities, local government at two levels):
  do not list provinces or describe district-level government; describe regions, natural features and the state as
  the amended curriculum does (Thông tư 17/2025).
- **Practice subjects** (Giáo dục thể chất, Hoạt động trải nghiệm, Âm nhạc, Mĩ thuật, Công nghệ): the game revises
  knowledge, safety, order of steps or choices by criteria; it never replaces practice and never grades a creative
  choice arbitrarily.
