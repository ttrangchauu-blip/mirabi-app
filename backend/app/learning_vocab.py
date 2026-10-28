"""The English vocabulary bank: data files, validation and quality gate, bulk import (upsert) and how a stage picks its words.

Data lives in app/data/vocabulary/*.tsv, one row per *sense* (tab-separated, UTF-8, header row):

    key  word  pos  difficulty  topic  meaning_vi  context_vi  example_en  example_vi  accepted  phonetic  source  status  cefr  audio

- key: stable id of the sense, e.g. `bank.money` and `bank.river`; progress is kept per key (en.word.<key> for
  Việt → Anh, en.spell.<key> for Anh → Việt), so a key is never reused for another meaning.
- difficulty: internal difficulty 1 (most common, beginners) .. 6 (rare, advanced). Not a CEFR label.
- cefr: only filled when a licensed, citable source gives the level (A1..C2); empty otherwise.
- accepted: other valid English answers for Việt → Anh, separated by "|" (the word itself is always accepted).
  Anh → Việt only accepts the word shown.
- context_vi: required when the same word has several senses, so every prompt says which one is meant.
- status: draft -> checked -> active (-> retired). Only `active` entries are ever served to a game. A row reaches
  `checked` only through `qa --apply` (automated quality gate + reviewer flags), and `active` through `publish --apply`.
- the last columns (accepted .. audio) may be left out; files in the first format (with `level` A1..C2, an editorial
  estimate) are still read: their level becomes the difficulty and no CEFR label is claimed.

CLI (run from backend/):
    python -m app.learning_vocab check  [files...]            validate; counts per status, topic, difficulty
    python -m app.learning_vocab qa      [--apply] [files...]  quality gate: draft -> checked (rewrites the files)
    python -m app.learning_vocab publish [--apply] [files...]  checked -> active (rewrites the files)
    python -m app.learning_vocab import  [files...] [--retire-missing]
    python -m app.learning_vocab report                        entries in the database per status, topic, difficulty
The bundled files are also imported at startup (idempotent: unchanged rows are skipped).
"""
from __future__ import annotations

import csv
import hashlib
import json
import logging
import random
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable

from .learning_engine import normalize_text

log = logging.getLogger("refmi.vocab")

DATA_DIR = Path(__file__).resolve().parent / "data" / "vocabulary"
FLAGS_FILE = Path(__file__).resolve().parent / "data" / "review_flags.tsv"
COLUMNS = ("key", "word", "pos", "difficulty", "topic", "meaning_vi", "context_vi", "example_en", "example_vi", "accepted",
           "phonetic", "source", "status", "cefr", "audio")
REQUIRED_COLUMNS = 9  # key .. example_vi; the others may be left out at the end of a row
LEGACY_COLUMNS = ("key", "word", "pos", "level", "topic", "meaning_vi", "context_vi", "example_en", "example_vi", "accepted",
                  "phonetic", "source")
LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")  # CEFR labels, only when a source states them
DIFFICULTIES = (1, 2, 3, 4, 5, 6)
DIFFICULTY_NAMES = {1: "Cơ bản", 2: "Sơ cấp", 3: "Trung cấp", 4: "Trung cao", 5: "Nâng cao", 6: "Chuyên sâu"}
STATUSES = ("draft", "checked", "active", "retired")
POS = {"noun", "verb", "adjective", "adverb", "phrase", "phrasal_verb", "collocation", "idiom", "preposition", "pronoun",
       "determiner", "conjunction", "interjection", "number"}
POS_VI = {"noun": "danh từ", "verb": "động từ", "adjective": "tính từ", "adverb": "trạng từ", "phrase": "cụm từ",
          "phrasal_verb": "cụm động từ", "collocation": "kết hợp từ", "idiom": "thành ngữ", "preposition": "giới từ",
          "pronoun": "đại từ", "determiner": "từ hạn định", "conjunction": "liên từ", "interjection": "thán từ",
          "number": "số từ"}
# The topics of the bank: (code, name, description). "vocab_mix" is not a topic of its own: it draws from all of them.
TOPICS = [
    ("daily_life", "Đời sống", "Sinh hoạt và việc hằng ngày"),
    ("home", "Nhà cửa", "Phòng ốc, đồ đạc và việc nhà"),
    ("family", "Gia đình", "Người thân, các mối quan hệ và việc nhà"),
    ("relationships", "Các mối quan hệ", "Bạn bè, tình cảm và ứng xử xã hội"),
    ("food", "Ăn uống", "Món ăn, đồ uống, nấu nướng và nhà hàng"),
    ("countryside", "Nông thôn", "Đồng ruộng, cây trồng, vật nuôi và làng quê"),
    ("school", "Học tập", "Trường lớp, đồ dùng và việc học"),
    ("thinking", "Tư duy và lập luận", "Ý kiến, phân tích và ngôn ngữ học thuật"),
    ("work", "Công việc", "Văn phòng, đồng nghiệp và công việc hằng ngày"),
    ("careers", "Nghề nghiệp", "Tên nghề, kỹ năng, tuyển dụng và sự nghiệp"),
    ("technology", "Công nghệ", "Máy tính, điện thoại và Internet"),
    ("science", "Khoa học", "Thí nghiệm, tự nhiên, vật lý, hóa học, sinh học, vũ trụ"),
    ("health", "Sức khỏe", "Cơ thể, bệnh tật và lối sống lành mạnh"),
    ("safety", "An toàn và khẩn cấp", "Tai nạn, cứu hộ và phòng tránh rủi ro"),
    ("travel", "Du lịch", "Chuyến đi, khách sạn và tham quan"),
    ("transport", "Giao thông", "Phương tiện, đường sá và đi lại"),
    ("emotions", "Cảm xúc", "Tâm trạng và cảm nhận"),
    ("personality", "Tính cách", "Tính cách, thái độ và hành vi"),
    ("environment", "Môi trường", "Thiên nhiên, ô nhiễm và bảo vệ môi trường"),
    ("weather", "Thời tiết", "Thời tiết, mùa, khí hậu và hiện tượng tự nhiên"),
    ("animals", "Động vật", "Các con vật và thế giới tự nhiên"),
    ("appearance", "Ngoại hình", "Dáng người, khuôn mặt và cách miêu tả người"),
    ("communication", "Giao tiếp", "Cụm từ và cách nói thông dụng"),
    ("time", "Thời gian", "Ngày tháng, tần suất, lịch trình và dịp đặc biệt"),
    ("shopping", "Mua sắm", "Cửa hàng, giá cả và thanh toán"),
    ("clothes", "Trang phục", "Quần áo, giày dép và phụ kiện"),
    ("money", "Tiền bạc", "Ngân hàng, chi tiêu, tiết kiệm và đầu tư"),
    ("business", "Kinh doanh", "Công ty, thị trường, bán hàng và marketing"),
    ("law", "Pháp luật", "Luật lệ, tòa án, chính quyền và bầu cử"),
    ("society", "Xã hội", "Cộng đồng, vấn đề xã hội và đời sống công dân"),
    ("media", "Truyền thông", "Báo chí, mạng xã hội và quảng cáo"),
    ("entertainment", "Giải trí", "Phim ảnh, âm nhạc, trò chơi và sở thích"),
    ("sports", "Thể thao", "Môn thể thao, luyện tập và thi đấu"),
    ("actions", "Hành động", "Động từ chỉ cử động và thao tác thường ngày"),
    ("describing", "Miêu tả", "Kích thước, hình dạng, màu sắc và tính chất"),
    ("arts_culture", "Nghệ thuật và văn hóa", "Hội họa, văn học, lễ hội và truyền thống"),
    ("city_places", "Thành phố", "Công trình, khu phố và dịch vụ công cộng"),
]
TOPIC_CODES = {code for code, _, _ in TOPICS}
DEFAULT_SOURCE = "mirabi-original"

_KEY = re.compile(r"^(?!spell\.)[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)?$")
# Letters, apostrophes inside a word ("I'm"), single spaces and hyphens: every answer can be typed on a phone keyboard
# and shown as letter boxes.
_PART = r"[A-Za-z]+(?:['-][A-Za-z]+)*"
_WORD = re.compile(rf"^{_PART}(?: {_PART})*$")


@dataclass
class Row:
    key: str
    word: str
    pos: str
    difficulty: int
    topic: str
    meaning_vi: str
    context_vi: str | None
    example_en: str
    example_vi: str
    accepted: list[str]
    phonetic: str | None
    source: str
    status: str = "active"
    cefr: str | None = None
    audio: str | None = None
    origin: str = ""  # file:line, for messages

    def values(self) -> dict:
        """The content stored in the database (the status is not content: changing it is not a new version)."""
        return {"word": self.word, "part_of_speech": self.pos, "level": f"D{self.difficulty}", "difficulty": self.difficulty,
                "cefr": self.cefr, "topic": self.topic, "meaning_vi": self.meaning_vi, "context_vi": self.context_vi,
                "example_en": self.example_en, "example_vi": self.example_vi,
                "accepted_json": json.dumps(self.accepted, ensure_ascii=False), "phonetic": self.phonetic,
                "audio_ref": self.audio, "source": self.source}

    def content_hash(self) -> str:
        return hashlib.sha256(json.dumps(self.values(), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)  # the row is not imported at all
    warnings: list[str] = field(default_factory=list)  # informative only
    issues: dict[str, list[str]] = field(default_factory=dict)  # key -> quality problems: the row stays a draft

    @property
    def ok(self) -> bool:
        return not self.errors

    def flag(self, row: "Row", problem: str) -> None:
        self.issues.setdefault(row.key, [])
        if problem not in self.issues[row.key]:
            self.issues[row.key].append(problem)


# ---------------------------------------------------------------------------------------------------------------
# Reading and validating data files
# ---------------------------------------------------------------------------------------------------------------

def bundled_files() -> list[Path]:
    return sorted(DATA_DIR.glob("*.tsv"))


def _difficulty(value: str) -> int | None:
    value = value.strip().upper()
    if value in LEVELS:
        return LEVELS.index(value) + 1
    return int(value) if value.isdigit() and int(value) in DIFFICULTIES else None


def read_rows(paths: Iterable[Path], report: Report) -> list[Row]:
    rows: list[Row] = []
    for path in paths:
        with open(path, encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
            header = tuple(h.strip() for h in next(reader, None) or ())
            legacy = header == LEGACY_COLUMNS
            columns = LEGACY_COLUMNS if legacy else COLUMNS
            if not legacy and header != COLUMNS[:len(header)] or len(header) < REQUIRED_COLUMNS:
                report.errors.append(f"{path.name}: the header must be: {' '.join(COLUMNS)}")
                continue
            for number, cells in enumerate(reader, start=2):
                if not any(c.strip() for c in cells) or cells[0].startswith("#"):
                    continue
                origin = f"{path.name}:{number}"
                if REQUIRED_COLUMNS <= len(cells) < len(columns):
                    cells = cells + [""] * (len(columns) - len(cells))  # editors often drop trailing tabs
                if len(cells) != len(columns):
                    report.errors.append(f"{origin}: {len(cells)} columns instead of {len(columns)}")
                    continue
                c = dict(zip(columns, (x.strip() for x in cells)))
                word = re.sub(r"\s+", " ", c["word"]).replace("’", "'")
                extra = [re.sub(r"\s+", " ", a.strip()).replace("’", "'") for a in c["accepted"].split("|") if a.strip()]
                accepted = [word] + [a for a in extra if normalize_text(a) != normalize_text(word)]
                level = c["level"] if legacy else c["difficulty"]
                rows.append(Row(key=c["key"], word=word, pos=c["pos"], difficulty=_difficulty(level) or 0, topic=c["topic"],
                                meaning_vi=c["meaning_vi"], context_vi=c["context_vi"] or None, example_en=c["example_en"],
                                example_vi=c["example_vi"], accepted=list(dict.fromkeys(accepted)),
                                phonetic=c["phonetic"] or None, source=c["source"] or DEFAULT_SOURCE,
                                # Files in the first format were already in use; a new row without status is a draft.
                                status=(c.get("status") or ("active" if legacy else "draft")).lower(), cefr=(c.get("cefr") or "").upper() or None,
                                audio=c.get("audio") or None, origin=origin))
    return rows


def read_flags(bank: str, path: Path | None = None) -> dict[str, str]:
    """Reviewer flags (app/data/review_flags.tsv: bank, key, reason): a flagged row never leaves the draft state."""
    path = path or FLAGS_FILE
    if not path.exists():
        return {}
    flags = {}
    with open(path, encoding="utf-8-sig", newline="") as handle:
        for cells in csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE):
            if len(cells) >= 3 and cells[0].strip() == bank and not cells[0].startswith("#"):
                flags[cells[1].strip()] = cells[2].strip()
    return flags


def _stems(word: str) -> set[str]:
    """Rough stems of a word, enough to recognise it in an example: study → studies/studied, give up → gave up isn't."""
    w = word.lower()
    stems = {w[:max(3, len(w) - 2)]}
    if w.endswith("y"):
        stems.add(w[:-1])
    if w.endswith("e"):
        stems.add(w[:-1])
    return stems


IRREGULAR = {"go": "went|gone|goes", "be": "was|were|been|is|are|am", "have": "has|had", "do": "did|done|does",
             "make": "made", "take": "took|taken", "get": "got|gotten", "give": "gave|given", "come": "came",
             "see": "saw|seen", "know": "knew|known", "think": "thought", "bring": "brought", "buy": "bought",
             "catch": "caught", "teach": "taught", "feel": "felt", "keep": "kept", "leave": "left", "meet": "met",
             "pay": "paid", "say": "said", "sell": "sold", "tell": "told", "find": "found", "hold": "held",
             "stand": "stood", "understand": "understood", "lose": "lost", "send": "sent", "spend": "spent",
             "build": "built", "lend": "lent", "write": "wrote|written", "ride": "rode|ridden", "drive": "drove|driven",
             "eat": "ate|eaten", "fall": "fell|fallen", "fly": "flew|flown|flies", "grow": "grew|grown",
             "throw": "threw|thrown", "draw": "drew|drawn", "wear": "wore|worn", "tear": "tore|torn",
             "break": "broke|broken", "speak": "spoke|spoken", "choose": "chose|chosen", "steal": "stole|stolen",
             "wake": "woke|woken", "forget": "forgot|forgotten", "begin": "began|begun", "drink": "drank|drunk",
             "swim": "swam|swum", "sing": "sang|sung", "ring": "rang|rung", "run": "ran", "sit": "sat", "win": "won",
             "lie": "lay|lain|lying|lied", "die": "dying|died", "tie": "tying", "fight": "fought", "seek": "sought",
             "sleep": "slept", "sweep": "swept", "feed": "fed", "lead": "led", "hang": "hung", "dig": "dug",
             "stick": "stuck", "strike": "struck", "shake": "shook|shaken", "hide": "hid|hidden", "bite": "bit|bitten",
             "rise": "rose|risen", "freeze": "froze|frozen", "shoot": "shot", "bend": "bent", "deal": "dealt",
             "mean": "meant", "hear": "heard", "light": "lit", "child": "children", "man": "men", "woman": "women",
             "mouse": "mice", "foot": "feet", "tooth": "teeth", "person": "people", "goose": "geese"}


def _uses(example: str, words: list[str]) -> bool:
    """Whether the example uses the word (or an accepted form), allowing regular and common irregular inflections."""
    text = example.lower().replace("’", "'")
    for candidate in words:
        parts = candidate.lower().split()
        if all(any(s in text for s in _stems(p)) or any(f in re.findall(r"[a-z']+", text) for f in IRREGULAR.get(p, "").split("|") if f)
               for p in parts):
            return True
    return False


def _bases(word: str) -> set[str]:
    """Possible base forms of an inflected word: cats → cat, boxes → box, cities → city, played → play, making → make."""
    w = word.lower()
    out = set()
    for suffix, repl in (("ies", "y"), ("es", ""), ("s", ""), ("ied", "y"), ("ed", ""), ("ed", "e"), ("ing", ""), ("ing", "e")):
        if w.endswith(suffix) and len(w) - len(suffix) >= 3:
            base = w[: -len(suffix)] + repl
            out.add(base)
            if suffix in ("ed", "ing") and len(base) >= 4 and base[-1] == base[-2]:  # stopped → stop, running → run
                out.add(base[:-1])
    return out - {w}


_SPELLING = [("our", "or"), ("ise", "ize"), ("isation", "ization"), ("yse", "yze"), ("tre", "ter"), ("ogue", "og"),
             ("ll", "l"), ("ence", "ense")]


def _variants(word: str) -> set[str]:
    """British/American spellings of a word (colour/color, organise/organize, centre/center)."""
    w = word.lower()
    out = set()
    for a, b in _SPELLING:
        if a in w:
            out.add(w.replace(a, b))
        if b in w:
            out.add(w.replace(b, a))
    return out - {w}


_POS_FAMILY = {"noun": "noun", "verb": "verb", "phrasal_verb": "verb", "adjective": "adjective", "adverb": "adverb"}


def validate(rows: list[Row], report: Report, flags: dict[str, str] | None = None) -> list[Row]:
    """Structural problems are errors (the row is dropped). Quality problems are `issues`: the row is imported but stays
    a draft and is never served. Returns the rows without errors."""
    good: list[Row] = []
    keys: dict[str, str] = {}
    for r in rows:
        problems = []
        for name in ("key", "word", "pos", "topic", "meaning_vi", "example_en", "example_vi"):
            if not getattr(r, name):
                problems.append(f"missing {name}")
        if r.key and not _KEY.match(r.key):
            problems.append(f"key “{r.key}” must be lowercase letters/digits, optionally “word.sense”")
        if r.key in keys:
            problems.append(f"key “{r.key}” already used at {keys[r.key]}")
        if r.word and (not _WORD.match(r.word) or len(r.word) > 40):
            problems.append(f"word “{r.word}”: letters, apostrophes, single spaces and hyphens only (max 40)")
        bad = [a for a in r.accepted if not _WORD.match(a) or len(a) > 40]
        if bad:
            problems.append(f"accepted answers with other characters: {bad}")
        if r.difficulty not in DIFFICULTIES:
            problems.append("level/difficulty must be 1..6 (or A1..C2 in the first file format)")
        if r.cefr and r.cefr not in LEVELS:
            problems.append(f"cefr “{r.cefr}” is not one of {', '.join(LEVELS)}")
        if r.topic and r.topic not in TOPIC_CODES:
            problems.append(f"unknown topic “{r.topic}”")
        if r.pos and r.pos not in POS:
            problems.append(f"unknown part of speech “{r.pos}”")
        if r.status not in STATUSES:
            problems.append(f"status “{r.status}” is not one of {', '.join(STATUSES)}")
        for name, limit in (("meaning_vi", 120), ("context_vi", 160), ("example_en", 200), ("example_vi", 200),
                            ("phonetic", 80), ("audio", 200)):
            if len(getattr(r, name) or "") > limit:
                problems.append(f"{name} longer than {limit}")
        if problems:
            report.errors.extend(f"{r.origin}: {p}" for p in problems)
            continue
        keys[r.key] = r.origin
        good.append(r)

    # The same sense twice is a duplicate record: only the first one is kept.
    seen_sense: dict[tuple, Row] = {}
    unique: list[Row] = []
    for r in good:
        sense = (normalize_text(r.word), normalize_text(r.meaning_vi))
        if sense in seen_sense:
            report.errors.append(f"{r.origin}: duplicate of {seen_sense[sense].key} ({seen_sense[sense].origin}): "
                                 f"“{r.word}” = “{r.meaning_vi}”")
            continue
        seen_sense[sense] = r
        unique.append(r)
    good = unique

    for r in good:
        if not _uses(r.example_en, r.accepted):
            report.flag(r, "example_missing_word: the example does not use the word")
        if normalize_text(r.meaning_vi) == normalize_text(r.word):
            report.flag(r, "untranslated: the meaning is the English word itself")
        if not re.match(r"^[\"“‘'(]?[A-Z0-9]", r.example_en) or not re.search(r"[.!?…\"”’)]$", r.example_en):
            report.flag(r, "example_format: the example must be a full sentence (capital letter, final punctuation)")
        if not r.phonetic and " " not in r.word:
            report.warnings.append(f"{r.origin}: no phonetic for “{r.word}”")
        if flags and r.key in flags:
            report.flag(r, f"reviewer_flag: {flags[r.key]}")

    # Several senses of one word: each must say which one it is; two senses must not be near-copies of each other.
    by_word: dict[str, list[Row]] = defaultdict(list)
    for r in good:
        by_word[normalize_text(r.word)].append(r)
    for senses in by_word.values():
        if len(senses) < 2:
            continue
        for r in senses:
            if not r.context_vi:
                report.flag(r, f"senses_need_context: “{r.word}” has {len(senses)} senses; each needs context_vi")
        for i, r in enumerate(senses):
            for other in senses[:i]:
                if SequenceMatcher(None, normalize_text(r.meaning_vi), normalize_text(other.meaning_vi)).ratio() >= 0.8:
                    report.flag(r, f"near_duplicate_sense: almost the same meaning as {other.key}")

    # Inflected forms and spelling variants are not new words (no "cats" next to "cat", no "colour" next to "color").
    by_family: dict[tuple, Row] = {}
    position = {r.key: i for i, r in enumerate(good)}
    for r in good:
        if " " not in r.word:
            by_family.setdefault((r.word.lower(), _POS_FAMILY.get(r.pos, r.pos)), r)
    for r in good:
        if " " in r.word:
            continue
        family = _POS_FAMILY.get(r.pos, r.pos)
        for base in _bases(r.word):
            other = by_family.get((base, family))
            if other is not None and other is not r:
                report.flag(r, f"inflected_duplicate: an inflected form of {other.key}")
        for variant in _variants(r.word):
            other = by_family.get((variant, family))
            # The first spelling met stays; a later one should be accepted by it instead of being a word of its own.
            if other is not None and other is not r and position[other.key] < position[r.key] and                     normalize_text(other.word) not in {normalize_text(a) for a in r.accepted}:
                report.flag(r, f"spelling_variant: another spelling of {other.key}; accept it instead")

    # Việt → Anh shows the meaning: two entries with the same meaning and context must accept each other's word,
    # otherwise the right answer is a guess. The first one stays playable, the others wait for a context.
    by_meaning: dict[tuple, list[Row]] = defaultdict(list)
    for r in good:
        by_meaning[(normalize_text(r.meaning_vi), normalize_text(r.context_vi or ""))].append(r)
    for same in by_meaning.values():
        for i, r in enumerate(same):
            for other in same[:i]:
                accepted = {normalize_text(a) for a in r.accepted}
                if normalize_text(other.word) not in accepted or normalize_text(r.word) not in {normalize_text(a) for a in other.accepted}:
                    report.flag(r, f"ambiguous_meaning: “{r.meaning_vi}” is also the meaning of {other.key}; "
                                   "add context_vi or accept both answers")
                    break
    return good


_CACHE: dict[tuple, tuple[list[Row], Report]] = {}


def check(paths: Iterable[Path] | None = None, *, flags_path: Path | None = None) -> tuple[list[Row], Report]:
    """Read and validate data files (cached per file version: startup imports run once per change, not per request)."""
    files = list(paths) if paths else bundled_files()
    flags = flags_path or FLAGS_FILE
    stamp = tuple((str(p), p.stat().st_mtime_ns, p.stat().st_size) for p in [*files, *([flags] if flags.exists() else [])])
    if stamp not in _CACHE:
        report = Report()
        rows = validate(read_rows(files, report), report, read_flags("vocabulary", flags))
        _CACHE.clear()
        _CACHE[stamp] = (rows, report)
    rows, report = _CACHE[stamp]
    return [replace(r) for r in rows], report


def effective_status(row: Row, report: Report) -> str:
    """Only rows without quality issues may be checked or active: anything else is served to nobody."""
    if row.status in ("checked", "active") and report.issues.get(row.key):
        return "draft"
    return row.status


# ---------------------------------------------------------------------------------------------------------------
# Lifecycle in the files: qa (draft -> checked) and publish (checked -> active)
# ---------------------------------------------------------------------------------------------------------------

def set_statuses(paths: Iterable[Path], changes: dict[str, str], columns: tuple[str, ...] = COLUMNS) -> int:
    """Rewrite the status column of the given keys in place, keeping every other cell (and the line order) as is."""
    status_at = columns.index("status")
    changed = 0
    for path in paths:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        header = lines[0].split("\t")
        if "status" not in header:
            continue
        out = [lines[0]]
        for line in lines[1:]:
            cells = line.split("\t")
            if cells and cells[0].strip() in changes and not cells[0].startswith("#"):
                cells += [""] * max(0, status_at + 1 - len(cells))
                cells[status_at] = changes[cells[0].strip()]
                changed += 1
                line = "\t".join(cells)
            out.append(line)
        path.write_text("\n".join(out) + "\n", encoding="utf-8")
    _CACHE.clear()
    return changed


def promote(rows: list[Row], report: Report, source: str, target: str) -> dict[str, str]:
    """Keys that may move from `source` to `target` status: a quality issue keeps a row where it is."""
    return {r.key: target for r in rows if r.status == source and not report.issues.get(r.key)}


# ---------------------------------------------------------------------------------------------------------------
# Import (upsert by key, in bulk)
# ---------------------------------------------------------------------------------------------------------------

def import_rows(db, rows: list[Row], *, retire_missing: bool = False, report: Report | None = None) -> dict[str, int]:
    """Insert new keys, update changed ones (a content change is a new `content_version`), leave unchanged ones.
    Never deletes: a key missing from the files is only retired with retire_missing (it stays for old sessions).
    Bulk statements: importing the whole bank again is a few hundred milliseconds and changes nothing."""
    from sqlalchemy import insert, select, update
    from .models import LearningVocabEntry, utcnow

    report = report or Report()
    existing = {key: (id_, digest, status, version) for key, id_, digest, status, version in db.execute(select(
        LearningVocabEntry.entry_key, LearningVocabEntry.id, LearningVocabEntry.content_hash, LearningVocabEntry.status,
        LearningVocabEntry.content_version))}
    counts = Counter()
    inserts, updates = [], []
    now = utcnow()
    for r in rows:
        digest, status = r.content_hash(), effective_status(r, report)
        notes = "; ".join(report.issues.get(r.key, [])) or None
        current = existing.get(r.key)
        if current is None:
            inserts.append({"entry_key": r.key, "content_hash": digest, "status": status, "content_version": 1,
                            "review_notes": notes, "created_at": now, "updated_at": now, **r.values()})
            counts["inserted"] += 1
        elif current[1] != digest:
            updates.append({"id": current[0], "content_hash": digest, "status": status, "content_version": (current[3] or 1) + 1,
                            "review_notes": notes, "updated_at": now, **r.values()})
            counts["updated"] += 1
        elif current[2] != status:
            updates.append({"id": current[0], "status": status, "review_notes": notes, "updated_at": now})
            counts["status_changed"] += 1
        else:
            counts["unchanged"] += 1
    if inserts:
        db.execute(insert(LearningVocabEntry), inserts)
    if updates:
        db.execute(update(LearningVocabEntry), updates)
    if retire_missing:
        present = {r.key for r in rows}
        gone = [{"id": id_, "status": "retired", "updated_at": now} for key, (id_, _, status, _) in existing.items()
                if key not in present and status != "retired"]
        if gone:
            db.execute(update(LearningVocabEntry), gone)
        counts["retired"] = len(gone)
    db.flush()
    return {k: v for k, v in counts.items() if v}


def files_hash(paths: Iterable[Path]) -> str:
    """The hash of data files (and the reviewer flags), to know whether they were already imported."""
    digest = hashlib.sha256()
    for path in [*paths, FLAGS_FILE]:
        if path.exists():
            digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def import_once(db, bank: str, files: list[Path], run) -> dict[str, int]:
    """Run an import of bundled files unless these very files were imported before (recorded in
    learning_content_imports); a changed file, a new file or new reviewer flags import again."""
    from sqlalchemy import select
    from .models import LearningContentImport
    digest = files_hash(files)
    if db.scalar(select(LearningContentImport.id).where(LearningContentImport.bank == bank,
                                                        LearningContentImport.files_hash == digest).limit(1)) is not None:
        return {"already_imported": 1}
    counts = run()
    db.add(LearningContentImport(bank=bank, files_hash=digest, counts_json=json.dumps(counts)))
    db.flush()
    return counts


def import_bundled(db, *, force: bool = False) -> dict[str, int]:
    """Startup: import the bundled files. Rows with errors are skipped (and logged), the rest are imported."""
    def run():
        rows, report = check()
        for error in report.errors[:20]:
            log.error("Vocabulary data: %s", error)
        counts = import_rows(db, rows, report=report)
        if counts.get("inserted") or counts.get("updated") or counts.get("status_changed"):
            log.info("Vocabulary bank: %s", counts)
        return counts
    return run() if force else import_once(db, "vocabulary", bundled_files(), run)


# ---------------------------------------------------------------------------------------------------------------
# Picking the words of a stage (pure: unit-tested in tests/test_learning_vocab.py)
# ---------------------------------------------------------------------------------------------------------------

PASS_SEEN = 20  # words of a difficulty seen (at most all of them) before moving on
PASS_RATE = 0.8  # share of first-try correct answers at that difficulty to move on
RECENT_SESSIONS = 3  # words of the last stages are not drawn again as "learned" or "new"


@dataclass(frozen=True)
class Entry:
    key: str
    word: str
    difficulty: int


@dataclass(frozen=True)
class Seen:
    attempts: int
    first_try: int
    mastery: int
    last_seen: float = 0.0  # timestamp; older first when reinforcing learned words


def working_level(bank: list[Entry], seen: dict[str, Seen]) -> int:
    """The user's difficulty for one game: the first one not yet mastered, starting at 1. A difficulty is passed once
    enough of its words were seen (PASS_SEEN, or all of them) and at least 80% of those answers were right at the first
    try."""
    by_level: dict[int, list[Entry]] = defaultdict(list)
    for e in bank:
        by_level[e.difficulty].append(e)
    levels = [lv for lv in DIFFICULTIES if by_level[lv]]
    for lv in levels:
        stats = [seen[e.key] for e in by_level[lv] if e.key in seen]
        attempts = sum(s.attempts for s in stats)
        first = sum(s.first_try for s in stats)
        if len(stats) < min(PASS_SEEN, len(by_level[lv])) or not attempts or first / attempts < PASS_RATE:
            return lv
    return levels[-1] if levels else DIFFICULTIES[0]


def travel_for(word: str, base: int) -> int:
    """Long words and phrases fall slower: +1.5 s per letter over 7 and +2 s per extra word, at most 40 s."""
    if not base:
        return 0
    letters = len(re.sub(r"[ '-]", "", word))
    return int(min(40, round(base + max(0, letters - 7) * 1.5 + 2 * word.count(" "))))


def pick_entries(pool: list[Entry], *, level: int, seen: dict[str, Seen], review: set[str], recent: set[str],
                 count: int, rng: random.Random) -> list[tuple[Entry, str]]:
    """The words of a stage, each at most once (and never two senses of the same word: the same answer twice would be
    a guess): words to review (on the "cần ôn" list: missed, wrong, hinted or revealed, until answered right at the
    first try in a later stage), some learned words (not seen in the last stages) and new words at the user's level.
    When there are not enough new words left, the stage becomes a purposeful review instead of coming back empty.
    Words of the next difficulty only fill a stage the user's level can't fill, never two levels up."""
    top = level
    eligible = [e for e in pool if e.difficulty <= top]
    if not eligible and pool:  # a topic whose words are all above the user's level: start with its easiest ones
        top = min(e.difficulty for e in pool)
        eligible = [e for e in pool if e.difficulty == top]
    stretch = [e for e in pool if e.difficulty == top + 1 and e.key not in seen] if len(eligible) < count * 2 else []
    stretch.sort(key=lambda e: (e.key in recent, rng.random()))
    weak = [e for e in eligible if e.key in review]
    weak.sort(key=lambda e: (seen[e.key].mastery if e.key in seen else 0, rng.random()))
    weak_keys = {e.key for e in weak}
    learned = [e for e in eligible if e.key in seen and e.key not in weak_keys]
    learned.sort(key=lambda e: (e.key in recent, seen[e.key].last_seen, rng.random()))
    fresh = [e for e in eligible if e.key not in seen]
    # New words of the user's own level first, then words left over from easier levels; recently shown ones last.
    fresh.sort(key=lambda e: (e.key in recent, e.difficulty != top, rng.random()))

    picked: list[tuple[Entry, str]] = []
    used: set[str] = set()
    words: set[str] = set()

    def take(items: list[Entry], reason: str, limit: int) -> None:
        for e in items:
            if len(picked) >= count or limit <= 0:
                return
            word = normalize_text(e.word)
            if e.key not in used and word not in words:
                used.add(e.key)
                words.add(word)
                picked.append((e, reason))
                limit -= 1

    take(weak, "review", max(1, count // 4))
    take([e for e in learned if e.key not in recent], "learned", max(1, count // 6))
    take([e for e in fresh if e.key not in recent], "new", count)
    # Not enough new words: review on purpose (weakest first, then learned words, the least recent first).
    take(weak, "review", count)
    take(learned, "learned", count)
    take(fresh, "new", count)
    take(stretch, "new", count)
    rng.shuffle(picked)
    return picked


# ---------------------------------------------------------------------------------------------------------------
# Building the turns of a stage from the bank (frozen as snapshots on the session)
# ---------------------------------------------------------------------------------------------------------------

def level_label(difficulty: int | None, cefr: str | None) -> str:
    """What the app shows: a CEFR label only when the source gives one, otherwise the internal difficulty."""
    return cefr or (f"Mức {difficulty}" if difficulty else "")


def snapshot(lesson_code: str, e, kind: str, reason: str) -> dict:
    """One turn: Việt → Anh (vocab_typing) recalls the word from its meaning; Anh → Việt (word_spelling) types the
    word shown and only then sees its meaning. Everything is frozen, so editing the bank never changes a session."""
    from .learning_engine import spelling_hints, vocab_hints
    spelled = kind == "word_spelling"
    letters = [len(p) for p in e.word.split()]
    context = f" ({e.context_vi})" if e.context_vi else ""
    phonetic = f" {e.phonetic}" if e.phonetic else ""
    difficulty = getattr(e, "difficulty", None)
    cefr = getattr(e, "cefr", None)
    label = level_label(difficulty, cefr) or e.level
    answer = {"accepted": [e.word] if spelled else json.loads(e.accepted_json), "display": e.word,
              "meaning_vi": e.meaning_vi, "context_vi": e.context_vi, "phonetic": e.phonetic,
              "part_of_speech": e.part_of_speech, "level": label, "difficulty": difficulty, "cefr": cefr, "topic": e.topic,
              "example_en": e.example_en, "example_vi": e.example_vi, "entry_key": e.entry_key, "pick": reason,
              "content_version": getattr(e, "content_version", None) or 1}
    if spelled:
        prompt = {"word": e.word, "part_of_speech": e.part_of_speech, "letters": letters, "level": label}
        explanation = f"“{e.word}”{phonetic} nghĩa là “{e.meaning_vi}”{context}. Ví dụ: {e.example_en} — {e.example_vi}"
    else:
        prompt = {"meaning_vi": e.meaning_vi, "context_vi": e.context_vi, "part_of_speech": e.part_of_speech,
                  "letters": letters, "level": label}
        explanation = f"“{e.meaning_vi}” là “{e.word}”{phonetic}. Ví dụ: {e.example_en} — {e.example_vi}"
    return {"kind": kind, "question_id": None,
            "question_key": f"{lesson_code}.{'spell.' if spelled else ''}{e.entry_key}",
            "skill_key": f"en.{'spell' if spelled else 'word'}.{e.entry_key}",
            "skill_label": f"{'Mặt chữ: ' if spelled else ''}{e.word} – {e.meaning_vi}"[:120],
            "prompt": prompt, "answer": answer,
            "hints": spelling_hints(e.word) if spelled else vocab_hints(e.word), "explanation": explanation}


def recent_keys(db, user_id: int, game: str, prefix: str) -> set[str]:
    """The words of the user's last stages of this game (they are not drawn again as "new" or "learned")."""
    from sqlalchemy import select
    from .models import LearningSession, LearningSessionItem
    ids = list(db.scalars(select(LearningSession.id).where(LearningSession.user_id == user_id, LearningSession.game == game)
                          .order_by(LearningSession.id.desc()).limit(RECENT_SESSIONS)))
    if not ids:
        return set()
    keys = db.scalars(select(LearningSessionItem.skill_key).where(LearningSessionItem.session_id.in_(ids)))
    return {k[len(prefix):] for k in keys if k.startswith(prefix)}


def bank_items(db, user, lesson, game: dict, variant: str | None, seed: int, review_keys: list[str] | None) -> list[dict]:
    """The turns of a vocabulary stage, picked for this user from the active entries of the bank (see pick_entries)."""
    from sqlalchemy import select
    from .models import LearningReviewItem, LearningSkillProgress, LearningVocabEntry, as_utc
    rng = random.Random(seed)
    if review_keys is not None:
        # "Luyện lại": the open review items of this lesson, each as the game it was missed in (retired words included:
        # the user met them).
        wanted = {}
        for question_key in review_keys:
            rest = question_key[len(lesson.code) + 1:] if question_key.startswith(lesson.code + ".") else ""
            wanted[question_key] = ("word_spelling" if rest.startswith("spell.") else "vocab_typing", rest.removeprefix("spell."))
        entries = {e.entry_key: e for e in db.scalars(select(LearningVocabEntry).where(
            LearningVocabEntry.entry_key.in_({k for _, k in wanted.values()}), LearningVocabEntry.status.in_(("active", "retired"))))}
        out = []
        for kind, key in wanted.values():
            if key in entries and len(out) < 12:
                out.append(snapshot(lesson.code, entries[key], kind, "review"))
        rng.shuffle(out)
        return out

    spelled = variant == "word_shooter"
    kind, prefix = ("word_spelling", "en.spell.") if spelled else ("vocab_typing", "en.word.")
    topic = (game.get("generator") or {}).get("vocab_bank", {}).get("topic")
    active = db.execute(select(LearningVocabEntry.entry_key, LearningVocabEntry.word, LearningVocabEntry.difficulty,
                               LearningVocabEntry.level, LearningVocabEntry.topic)
                        .where(LearningVocabEntry.status == "active").order_by(LearningVocabEntry.entry_key)).all()
    if not active:
        return []
    seen = {row.skill_key[len(prefix):]: Seen(row.attempts, row.first_try, row.mastery,
                                              as_utc(row.last_seen_at).timestamp() if row.last_seen_at else 0.0)
            for row in db.scalars(select(LearningSkillProgress).where(LearningSkillProgress.user_id == user.id,
                                                                     LearningSkillProgress.skill_key.startswith(prefix)))}
    review = {row.skill_key[len(prefix):] for row in db.scalars(select(LearningReviewItem).where(
        LearningReviewItem.user_id == user.id, LearningReviewItem.status == "open",
        LearningReviewItem.skill_key.startswith(prefix)))}
    recent = recent_keys(db, user.id, "word_shooter" if spelled else "meteor", prefix)

    def entry(row) -> Entry:
        return Entry(row.entry_key, row.word, row.difficulty or _difficulty(row.level) or 1)
    # The level comes from the whole bank (all topics): a topic only narrows which words are drawn.
    level = working_level([entry(e) for e in active], seen)
    pool = [entry(e) for e in active if topic is None or e.topic == topic]
    picked = pick_entries(pool, level=level, seen=seen, review=review, recent=recent, count=game["turns"], rng=rng)
    rows = {e.entry_key: e for e in db.scalars(select(LearningVocabEntry).where(
        LearningVocabEntry.entry_key.in_([e.key for e, _ in picked])))}
    return [snapshot(lesson.code, rows[e.key], kind, reason) for e, reason in picked]


# ---------------------------------------------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------------------------------------------

def _print_table(cells: Counter, rows: list[str], label: str = "topic") -> None:
    print(label.ljust(15) + "".join(f"d{d}".rjust(6) for d in DIFFICULTIES) + "total".rjust(8))
    for name in rows:
        line = [cells[(name, d)] for d in DIFFICULTIES]
        if sum(line):
            print(name.ljust(15) + "".join(str(c).rjust(6) for c in line) + str(sum(line)).rjust(8))
    totals = [sum(cells[(t, d)] for t in rows) for d in DIFFICULTIES]
    print("total".ljust(15) + "".join(str(c).rjust(6) for c in totals) + str(sum(totals)).rjust(8))


def summary(rows: list[Row], report: Report) -> dict:
    """Numbers for the hand-over report: unique words vs senses, by status, part of speech, topic and difficulty."""
    statuses = Counter(effective_status(r, report) for r in rows)
    active = [r for r in rows if effective_status(r, report) == "active"]
    issue_types = Counter(p.split(":")[0] for problems in report.issues.values() for p in problems)
    return {"senses": len(rows), "unique_words": len({normalize_text(r.word) for r in rows}),
            "active_senses": len(active), "active_unique_words": len({normalize_text(r.word) for r in active}),
            "by_status": dict(statuses), "by_pos": dict(Counter(r.pos for r in rows)),
            "multi_word": sum(1 for r in rows if " " in r.word),
            "topics": len({r.topic for r in rows}), "issues": dict(issue_types)}


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "check"
    paths = [Path(a) for a in argv[1:] if not a.startswith("--")] or None
    apply = "--apply" in argv
    if command in ("check", "qa", "publish", "import"):
        rows, report = check(paths)
        if "--quiet" not in argv:
            for w in report.warnings[:50]:
                print("warning:", w)
            for key, problems in list(report.issues.items())[:200]:
                print("issue:", key, "—", "; ".join(problems))
        for e in report.errors:
            print("error:", e)
        print(f"{len(rows)} valid entries, {len(report.errors)} error(s), {len(report.issues)} with quality issues, "
              f"{len(report.warnings)} warning(s)")
        print(json.dumps(summary(rows, report), ensure_ascii=False))
        if command == "check":
            _print_table(Counter((r.topic, r.difficulty) for r in rows), [c for c, _, _ in TOPICS])
            return 0 if report.ok else 1
        if command in ("qa", "publish"):
            changes = promote(rows, report, "draft", "checked") if command == "qa" else promote(rows, report, "checked", "active")
            print(f"{len(changes)} row(s) can move to “{'checked' if command == 'qa' else 'active'}'”.")
            if apply and changes:
                print("Rewritten:", set_statuses(paths or bundled_files(), changes))
            return 0
        if not report.ok:
            print("Rows with errors are skipped.")
        from .db import SessionLocal, engine
        from . import models  # noqa: F401 (every table, for upgrade_schema)
        from .migrations import upgrade_schema
        upgrade_schema(engine)
        with SessionLocal() as db:
            counts = import_rows(db, rows, retire_missing="--retire-missing" in argv, report=report)
            db.commit()
        print("Imported:", counts)
        return 0
    if command == "report":
        from sqlalchemy import select
        from .db import SessionLocal
        from .models import LearningVocabEntry
        with SessionLocal() as db:
            data = db.execute(select(LearningVocabEntry.topic, LearningVocabEntry.difficulty, LearningVocabEntry.status,
                                     LearningVocabEntry.word)).all()
        print("status:", dict(Counter(s for _, _, s, _ in data)))
        active = [(t, d, w) for t, d, s, w in data if s == "active"]
        print(f"active: {len(active)} senses, {len({normalize_text(w) for _, _, w in active})} unique words")
        _print_table(Counter((t, d) for t, d, _ in active), [c for c, _, _ in TOPICS])
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":  # python -m app.learning_vocab check|qa|publish|import|report
    logging.basicConfig(level=logging.INFO)
    sys.exit(main(sys.argv[1:]))
