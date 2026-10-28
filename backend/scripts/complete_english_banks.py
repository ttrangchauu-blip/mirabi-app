"""Complete the bundled English banks without duplicating existing content.

Vocabulary is selected from Skypedia's CC BY-SA 4.0 English-Vietnamese
dictionary. Grammar is generated deterministically from reviewed elementary
patterns and varied situations. Output is draft TSV; the normal QA/publish
commands remain the only way content can become playable.
"""
from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
import unicodedata
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.learning_engine import normalize_text  # noqa: E402
from app.learning_vocab import COLUMNS as VOCAB_COLUMNS, check as check_vocab  # noqa: E402
from app.learning_grammar_bank import (  # noqa: E402
    CHOICE_COLUMNS, ORDER_COLUMNS, check as check_grammar,
)

DATA = ROOT / "app" / "data"
SOURCE = "skypedia-en-vi-cc-by-sa-4.0"
WORD_RE = re.compile(r"^[A-Za-z]+(?:[-'][A-Za-z]+)*(?: [A-Za-z]+(?:[-'][A-Za-z]+)*){0,4}$")
VI_RE = re.compile(r"[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]", re.I)

POS_MAP = {
    "N": "noun", "V": "verb", "A": "adjective", "ADJ": "adjective",
    "D": "adverb", "ADV": "adverb", "PHR V": "phrasal_verb",
    "PHRASAL VERB": "phrasal_verb", "IDIOM": "idiom",
}


def clean(value: str | None, limit: int) -> str:
    value = re.sub(r"<[^>]+>|\s+", " ", value or "").strip(" ;,-")
    return value[:limit].rsplit(" ", 1)[0] if len(value) > limit else value


def key_for(word: str, number: int) -> str:
    key = unicodedata.normalize("NFKD", word).encode("ascii", "ignore").decode().lower()
    key = re.sub(r"[^a-z0-9]+", "_", key).strip("_")[:40]
    return f"open_{key}_{number}"


def topic_for(word: str, pos: str, meaning: str) -> str:
    text = normalize_text(f"{word} {meaning}")
    rules = [
        ("technology", ("computer", "internet", "digital", "software", "máy tính", "mạng")),
        ("health", ("medicine", "disease", "body", "health", "bệnh", "sức khỏe")),
        ("food", ("food", "cook", "drink", "meal", "món", "thức ăn")),
        ("travel", ("travel", "hotel", "tour", "journey", "du lịch", "chuyến đi")),
        ("school", ("school", "student", "learn", "study", "trường", "học")),
        ("work", ("office", "job", "work", "career", "công việc", "nghề")),
        ("environment", ("nature", "climate", "pollution", "môi trường", "thiên nhiên")),
        ("animals", ("animal", "bird", "fish", "insect", "động vật", "con vật")),
        ("sports", ("sport", "game", "player", "thể thao", "thi đấu")),
        ("business", ("business", "market", "company", "kinh doanh", "công ty")),
    ]
    for topic, needles in rules:
        if any(n in text for n in needles):
            return topic
    return "actions" if pos in {"verb", "phrasal_verb"} else "describing" if pos in {"adjective", "adverb"} else "daily_life"


def add_vocabulary(database: Path, wanted: int) -> Path:
    existing, _ = check_vocab()
    words = {normalize_text(r.word) for r in existing}
    families = {re.sub(r"(?:s|es|ed|ing|ly)$", "", w) for w in words if " " not in w}
    senses = {(normalize_text(r.word), normalize_text(r.meaning_vi)) for r in existing}
    query = """
      SELECT w.word, d.definition, d.pos, wd.example,
             (SELECT p.ipa FROM pronunciations p WHERE p.word_id=w.id ORDER BY p.region='UK' DESC LIMIT 1)
      FROM words w JOIN word_definitions wd ON wd.word_id=w.id
      JOIN definitions d ON d.id=wd.definition_id
      WHERE w.lang_code IN ('en','vi') ORDER BY length(w.word), w.word, d.id
    """
    rows = []
    with sqlite3.connect(database) as conn:
        for word, meaning, raw_pos, example, ipa in conn.execute(query):
            word, meaning, example = clean(word, 40), clean(meaning, 70), clean(example, 120)
            normalized = normalize_text(word)
            if len(rows) >= wanted or not WORD_RE.fullmatch(word) or not VI_RE.search(meaning):
                continue
            if normalized in words or (normalized, normalize_text(meaning)) in senses:
                continue
            family = re.sub(r"(?:s|es|ed|ing|ly)$", "", normalized)
            if " " not in word and family in families:
                continue
            pos = POS_MAP.get((raw_pos or "").upper())
            if not pos:
                pos = "phrase" if " " in word else "noun"
            if not example or normalized not in normalize_text(example):
                continue
            number = len(rows) + 1
            topic = topic_for(word, pos, meaning)
            difficulty = min(6, max(2, 1 + len(word.replace(" ", "")) // 4))
            context = f"Dùng trong ngữ cảnh {topic.replace('_', ' ')}; nghĩa cụ thể: {meaning}"[:90]
            example_vi = f"Câu ví dụ dùng “{word}” với nghĩa “{meaning}”."[:120]
            phonetic = clean(ipa, 80)
            if phonetic and not phonetic.startswith("/"):
                phonetic = f"/{phonetic.strip('/')} /".replace(" /", "/")
            row = [key_for(word, number), word, pos, str(difficulty), topic, meaning, context,
                   example, example_vi, "", phonetic, SOURCE, "draft", "", ""]
            rows.append(row)
            words.add(normalized); senses.add((normalized, normalize_text(meaning)))
            if " " not in word:
                families.add(family)
    if len(rows) < wanted:
        raise SystemExit(f"Only {len(rows)} suitable unique vocabulary rows found; need {wanted}")
    path = DATA / "vocabulary" / "open_dictionary.tsv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(VOCAB_COLUMNS); writer.writerows(rows)
    return path


SUBJECTS = [
    ("I", "me", "my", "am"), ("you", "you", "your", "are"),
    ("he", "him", "his", "is"), ("she", "her", "her", "is"),
    ("we", "us", "our", "are"), ("they", "them", "their", "are"),
]
ACTIVITIES = [
    ("check", "checks", "the train timetable", "kiểm tra lịch tàu"),
    ("clean", "cleans", "the kitchen window", "lau cửa sổ bếp"),
    ("carry", "carries", "the sports equipment", "mang dụng cụ thể thao"),
    ("review", "reviews", "the science notes", "xem lại ghi chú khoa học"),
    ("prepare", "prepares", "the evening meal", "chuẩn bị bữa tối"),
    ("repair", "repairs", "the garden gate", "sửa cổng vườn"),
    ("organise", "organises", "the project files", "sắp xếp hồ sơ dự án"),
    ("water", "waters", "the balcony plants", "tưới cây ban công"),
    ("answer", "answers", "the customer emails", "trả lời email khách hàng"),
    ("collect", "collects", "the library books", "thu gom sách thư viện"),
    ("wash", "washes", "the football shirts", "giặt áo bóng đá"),
    ("pack", "packs", "the camping supplies", "đóng gói đồ cắm trại"),
    ("update", "updates", "the class calendar", "cập nhật lịch lớp"),
    ("compare", "compares", "the market prices", "so sánh giá thị trường"),
    ("measure", "measures", "the room temperature", "đo nhiệt độ phòng"),
    ("label", "labels", "the storage boxes", "dán nhãn hộp lưu trữ"),
    ("charge", "charges", "the camera battery", "sạc pin máy ảnh"),
    ("sort", "sorts", "the recycling bins", "phân loại thùng tái chế"),
    ("print", "prints", "the meeting agenda", "in chương trình họp"),
    ("record", "records", "the rainfall data", "ghi dữ liệu lượng mưa"),
]
TIMES = [
    ("before breakfast", "trước bữa sáng"), ("after the morning meeting", "sau cuộc họp sáng"),
    ("during the lunch break", "trong giờ nghỉ trưa"), ("before the shop closes", "trước khi cửa hàng đóng cửa"),
    ("after the final lesson", "sau tiết học cuối"), ("on quiet Sunday mornings", "vào sáng Chủ nhật yên tĩnh"),
    ("whenever the weather changes", "mỗi khi thời tiết thay đổi"), ("before the guests arrive", "trước khi khách tới"),
    ("at the end of each month", "vào cuối mỗi tháng"), ("after the team practice", "sau buổi tập đội"),
    ("before the evening journey", "trước chuyến đi tối"), ("during the weekly inspection", "trong đợt kiểm tra tuần"),
    ("after the computer restarts", "sau khi máy tính khởi động lại"), ("before the museum opens", "trước khi bảo tàng mở cửa"),
    ("during the community event", "trong sự kiện cộng đồng"),
]
PLACES = [
    ("near the main entrance", "gần lối vào chính"),
    ("inside the shared workspace", "trong khu làm việc chung"),
    ("beside the information desk", "bên quầy thông tin"),
    ("under the covered walkway", "dưới lối đi có mái che"),
]
MODIFIERS = [(f"{time} {place}", f"{time_vi} {place_vi}")
             for time, time_vi in TIMES for place, place_vi in PLACES]


def sentence_parts(index: int):
    subject = SUBJECTS[index % len(SUBJECTS)]
    # Every activity/modifier pair is used once per grammar point. A change of
    # subject is therefore never the only difference between two questions.
    activity = ACTIVITIES[index % len(ACTIVITIES)]
    modifier = MODIFIERS[(index // len(ACTIVITIES)) % len(MODIFIERS)]
    return subject, activity, modifier


def phrase_chunks(text: str, limit: int = 24) -> list[str]:
    chunks: list[str] = []
    for word in text.split():
        if chunks and len(chunks[-1]) + len(word) + 1 <= limit:
            chunks[-1] += f" {word}"
        else:
            chunks.append(word)
    return chunks


def grammar_rows(per_game_point: int = 1200):
    choice, order = [], []
    points = ["pronoun_subject", "pronoun_object", "possessive_adjective", "be_present"]
    for point in points:
        for i in range(per_game_point):
            (subj, obj, poss, be), (base, third, thing, thing_vi), (mod, mod_vi) = sentence_parts(i)
            mod_tokens = phrase_chunks(mod)
            verb = third if subj in {"he", "she"} else base
            n = i + 1001
            if point == "pronoun_subject":
                answer, options = subj, [subj, obj, poss, "it"]
                options = list(dict.fromkeys(options + ["they", "we"]))[:4]
                prompt = f"___ {verb} {thing} {mod}."
                sentence = prompt.replace("___", answer)
                vi = f"{subj} {thing_vi} {mod_vi}."
                tokens = [subj, verb, thing, *mod_tokens]
            elif point == "pronoun_object":
                answer, options = obj, [obj, subj, poss, "them"]
                options = list(dict.fromkeys(options + ["us", "him"]))[:4]
                prompt = f"The coordinator asks ___ to {base} {thing} {mod}."
                sentence = prompt.replace("___", answer)
                vi = f"Điều phối viên nhờ {obj} {thing_vi} {mod_vi}."
                tokens = ["the coordinator", "asks", obj, f"to {base}", thing, *mod_tokens]
            elif point == "possessive_adjective":
                answer, options = poss, [poss, subj, obj, "their"]
                options = list(dict.fromkeys(options + ["our", "his"]))[:4]
                prompt = f"{subj.capitalize()} {verb} ___ notes about {thing} {mod}."
                sentence = prompt.replace("___", answer)
                vi = f"{subj} {thing_vi} trong ghi chú của mình {mod_vi}."
                tokens = [subj, verb, poss, "notes about", thing, *mod_tokens]
            else:
                answer, options = be, [be, "am", "is", "are"]
                options = list(dict.fromkeys(options + ["be"]))[:4]
                adjective = ["ready", "careful", "busy", "patient", "quiet"][i % 5]
                prompt = f"{subj.capitalize()} ___ {adjective} while we {base} {thing} {mod}."
                sentence = prompt.replace("___", answer)
                vi = f"{subj} {adjective} khi chúng tôi {thing_vi} {mod_vi}."
                tokens = [subj, be, adjective, "while we", base, thing, *mod_tokens]
            topic = ["daily_life", "school", "work", "technology", "environment"][i % 5]
            context = f"Tình huống {thing_vi} {mod_vi}."
            hint = "Chọn dạng phù hợp với vai trò của từ và chủ ngữ trong câu."
            explanation = "Đáp án đúng phù hợp với chủ ngữ và vị trí ngữ pháp; các lựa chọn còn lại dùng sai vai trò hoặc hòa hợp."
            choice.append([f"{point}.auto.c.{n}", point, "1", topic, "aff", context, prompt,
                           "|".join(options), answer, hint, explanation, vi, "mirabi-patterns-2026-10", "draft"])
            order.append([f"{point}.auto.o.{n}", point, "1", topic, "aff", context, "/".join(tokens), "",
                          sentence[0].upper() + sentence[1:], vi, hint, explanation, "mirabi-patterns-2026-10", "draft"])
    return choice, order


def add_grammar(per_game_point: int) -> list[Path]:
    choice, order = grammar_rows(per_game_point)
    paths = [DATA / "grammar" / "auto_complete.choice.tsv", DATA / "grammar" / "auto_complete.order.tsv"]
    for path, columns, rows in ((paths[0], CHOICE_COLUMNS, choice), (paths[1], ORDER_COLUMNS, order)):
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
            writer.writerow(columns); writer.writerows(rows)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--vocabulary", type=int, default=1900)
    parser.add_argument("--grammar-per-game-point", type=int, default=1200)
    args = parser.parse_args()
    vocab_path = add_vocabulary(args.database, args.vocabulary)
    grammar_paths = add_grammar(args.grammar_per_game_point)
    _, vocab_report = check_vocab()
    _, grammar_report = check_grammar()
    print(f"wrote {vocab_path.name} and {', '.join(p.name for p in grammar_paths)}")
    print(f"vocabulary errors={len(vocab_report.errors)} issues={len(vocab_report.issues)}")
    print(f"grammar errors={len(grammar_report.errors)} issues={len(grammar_report.issues)}")
    if vocab_report.errors or grammar_report.errors:
        raise SystemExit("Generated content has structural errors")


if __name__ == "__main__":
    main()
