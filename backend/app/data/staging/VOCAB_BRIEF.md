# Brief: writing English vocabulary entries for Mirabi (Vietnamese learners)

You write **new entries** for the vocabulary bank of a learning app for Vietnamese speakers. Two games use it:
- *Bắn từ tiếng Anh*: the English word falls, the learner types it; afterwards the Vietnamese meaning is shown.
- *Bắn thiên thạch Việt → Anh*: the Vietnamese meaning (+ context) falls, the learner must type the English word.
  So the Vietnamese meaning + context must point to **one** clear English answer (or list true equivalents in `accepted`).

Everything you write is stored as a **draft** and checked before release. Quality over speed; never pad.

## What to write
- Only real, useful English: single words AND multi-word items: phrasal verbs (`pick up`), collocations
  (`make a decision`, `heavy traffic`), everyday communication phrases (`no problem`, `I'm afraid not`), and a few idioms
  at difficulty 5-6.
- Per topic aim for roughly: 55% single words, 45% multi-word. Single words must include nouns, verbs, adjectives AND
  adverbs (verbs ≥ 15% of the topic, adjectives ≥ 15%, adverbs ≥ 4% where the topic allows).
- **Difficulty** (internal, not CEFR) — distribute about: 1: 15%, 2: 20%, 3: 22%, 4: 20%, 5: 15%, 6: 8%.
  1 = the very common words a beginner meets first (`cup`, `eat`, `happy`); 3 = everyday intermediate
  (`appointment`, `borrow`); 5-6 = advanced/academic/rare-but-useful (`meticulous`, `come to terms with`).
  Within each difficulty, put the more common words first.
- **No padding**: never add plural or inflected forms as separate entries (`cats`, `went`, `running`, `bigger`), never a
  spelling variant (`color` next to `colour`: put the variant in `accepted`), never the same word+meaning twice.
  A distinct lexeme is fine (`building` noun, `interested` adjective, `well-known`).
- **Several meanings**: one row per meaning, each with its own key `word.sense` (e.g. `bank.money`, `bank.river`) and
  a `context_vi` that makes the sense clear. Include common polysemous words relevant to your topic.
- Do not repeat words listed in `app/data/staging/existing_words.txt` (already in the bank) unless it is a genuinely
  different sense (then key `word.sense` + context_vi). Stay inside your topic so other writers don't write the same
  words; very generic words (`good`, `make`, `thing`) belong to the `describing`/`actions` writers only.

## File format (TSV: tab-separated, UTF-8, one header line, no quotes, no tab inside a cell)
Header (exactly; the last two columns are filled in later, leave them out):
```
key	word	pos	difficulty	topic	meaning_vi	context_vi	example_en	example_vi	accepted	phonetic
```
- `key`: unique, lowercase ascii; spaces → `_`, drop apostrophes; add `.sense` for a word with several senses.
  Examples: `kettle`, `make_a_decision`, `im_afraid_not`, `bank.river`. Max 50 characters.
- `word`: the English word/phrase exactly as it must be typed: letters, apostrophes inside words (`I'm`), hyphens,
  single spaces; max 40 characters, max 5 words; lowercase except proper nouns and `I`.
- `pos`: one of noun, verb, adjective, adverb, phrasal_verb, collocation, phrase (communication phrase), idiom,
  preposition, pronoun, determiner, conjunction, interjection, number.
- `difficulty`: 1..6. `topic`: your topic code.
- `meaning_vi`: short, natural Vietnamese meaning **in this context** (usually ≤ 40 characters). It is what the meteor
  shows: make it precise, e.g. `ấm đun nước`, not `ấm`. Never just copy the English word.
- `context_vi`: short Vietnamese context (≤ 90 characters) saying when/how it is used, e.g. `đồ dùng nhà bếp để đun
  sôi nước`; for verbs/collocations you can say the situation (`khi phải chọn một phương án`). **Fill it for every row.**
  If another common English word has the same Vietnamese meaning (big/large = lớn; begin/start = bắt đầu), the
  context must separate them, or list the other word in `accepted` if it is truly interchangeable here.
- `example_en`: one natural sentence (≤ 120 chars) that really uses the word (an inflected form is fine). Starts with
  a capital letter, ends with `.`, `?` or `!`. Its other words must be easier than the word itself.
- `example_vi`: a natural Vietnamese translation of the example.
- `accepted`: other answers that are equally correct for this meaning AND context, separated by `|`
  (spelling variants `colour|color`, true equivalents `rubbish|garbage|trash`). Leave empty when there are none.
  Never put loose synonyms here.
- `phonetic`: IPA between slashes for single words (British style, as in `/ˈwɔːtə/`, `/ˈketl/`). Leave empty for
  multi-word items, and when you are not sure.

Example rows:
```
kettle	kettle	noun	2	home	ấm đun nước	đồ dùng nhà bếp để đun sôi nước	Can you put the kettle on?	Bạn bắc ấm nước lên được không?		/ˈketl/
make_a_decision	make a decision	collocation	3	work	đưa ra quyết định	khi phải chọn một phương án sau khi cân nhắc	We need to make a decision by Friday.	Chúng ta cần đưa ra quyết định trước thứ Sáu.
tidy	tidy	adjective	2	home	gọn gàng, ngăn nắp	nói về phòng ốc, đồ đạc được sắp xếp	Her room is always tidy.	Phòng của cô ấy lúc nào cũng gọn gàng.		/ˈtaɪdi/
bank.river	bank	noun	3	environment	bờ sông	phần đất dọc hai bên dòng sông	We had a picnic on the bank of the river.	Chúng tôi đã đi dã ngoại bên bờ sông.		/bæŋk/
```

## How to work
1. Plan your list of headwords per topic first (breadth: cover the whole topic, all difficulties).
2. Write the entries with the **Write** tool in parts of about 100 rows, each part a separate file with the header:
   `app/data/staging/vocabulary/<topic>.p1.tsv`, `<topic>.p2.tsv`, ... (paths relative to `backend/`).
3. After each part, validate (from `backend/`, Git Bash):
   `.venv/Scripts/python.exe -m app.learning_vocab check app/data/staging/vocabulary/<topic>.p*.tsv | grep -E "^(error|issue)|valid entries"`
   Fix every `error` and every `issue` (edit the part file). Warnings about phonetics may stay.
4. Do not edit any other file in the repository.

When done, reply in a few lines: files written, number of rows per topic and per difficulty, and anything unusual.
