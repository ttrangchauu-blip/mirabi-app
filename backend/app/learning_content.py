"""Learning content (English and Math) and the seeder that publishes it.

The definitions below are the source of truth for the built-in lessons. `seed_learning_content` runs at startup
(and as `python -m app.learning_content`); it is idempotent and never edits a published version: when a lesson's
definition changes it publishes a new version, and sessions keep the version they started with.

Answers live here and in the database only. The mobile app never bundles them; it receives each answer from the API
once the user is allowed to see it.
"""
import hashlib
import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import curriculum_games as cg
from . import learning_grammar_bank as grammar_bank
from . import lesson_catalog as lc
from .learning_vocab import import_bundled
from .models import (LearningLesson, LearningLessonVersion, LearningLevel, LearningQuestion, LearningSubject,
                     LearningTopic, LearningVocabItem)

log = logging.getLogger("refmi.learning")

SUBJECTS = [("english", "Tiếng Anh", 0), ("math", "Toán", 1), ("vietnamese", "Tiếng Việt", 2),
            ("science", "Tự nhiên và Khoa học", 3), ("informatics", "Tin học", 4)]

LEVELS = {
    # Vocabulary has no level to pick: it starts at A1 and follows the user's results (learning_vocab.working_level).
    "english": [("auto", "Tự điều chỉnh", "Bắt đầu từ A1 và nâng dần theo kết quả của bạn"),
                ("starter", "Khởi đầu", "Lớp 3–4"), ("basic", "Cơ bản", "Lớp 5–6")],
    "math": [("grade2", "Lớp 2", "Cộng trừ trong phạm vi 100, bảng nhân 2–5"),
             ("grade3", "Lớp 3", "Phạm vi 1000, bảng nhân chia 2–9"),
             ("grade4", "Lớp 4", "Phạm vi 10 000, nhân số có hai chữ số"),
             ("grade6", "Lớp 6", "Số nguyên âm")],
}

# Vocabulary topics that have a lesson of their own (from before the "chơi ngay" flow, kept for their progress and
# review items). The bank has more topics; the games draw from all of them through "Tổng hợp".
VOCAB_TOPICS = [
    ("daily_life", "Đời sống", "Nhà cửa, sinh hoạt và việc hằng ngày"),
    ("family", "Gia đình", "Người thân, các mối quan hệ và việc nhà"),
    ("food", "Ăn uống", "Món ăn, đồ uống, nấu nướng và nhà hàng"),
    ("school", "Học tập", "Trường lớp, đồ dùng và việc học"),
    ("work", "Công việc", "Nghề nghiệp, văn phòng và kinh doanh"),
    ("technology", "Công nghệ", "Máy tính, điện thoại và Internet"),
    ("health", "Sức khỏe", "Cơ thể, bệnh tật và lối sống lành mạnh"),
    ("travel", "Du lịch", "Đi lại, khách sạn và tham quan"),
    ("emotions", "Cảm xúc", "Tâm trạng, tính cách và cảm nhận"),
    ("environment", "Môi trường", "Thiên nhiên, thời tiết và bảo vệ môi trường"),
    ("animals", "Động vật", "Các con vật quen thuộc và thế giới tự nhiên"),
    ("communication", "Giao tiếp", "Cụm từ và cách nói thông dụng"),
]

TOPICS = {
    "english": [
        ("vocab_mix", "Tổng hợp", "vocabulary", "Mọi chủ đề, trình độ tự điều chỉnh"),
        *[(code, name, "vocabulary", description) for code, name, description in VOCAB_TOPICS],
        ("grammar_mix", "Ngữ pháp tổng hợp", "grammar", "Mọi cấu trúc, trình độ tự điều chỉnh"),
        ("to_be", "Động từ to be", "grammar", "am / is / are theo chủ ngữ"),
        ("present_simple", "Thì hiện tại đơn", "grammar", "Ngôi thứ ba số ít thêm -s / -es"),
    ],
    "math": [
        ("arithmetic", "Cộng, trừ, nhân, chia", "arithmetic", "Tính nhanh và chính xác"),
        ("missing_number", "Tìm số còn thiếu", "missing_number", "Dùng phép tính ngược để tìm số"),
        ("compare", "So sánh số", "compare", "Chọn dấu >, < hoặc ="),
        ("order_of_operations", "Thứ tự thực hiện phép tính", "order_of_operations", "Trong ngoặc, nhân chia, rồi cộng trừ"),
    ],
}

# ---------------------------------------------------------------------------------------------------------------
# English grammar. Questions are generated per session (learning_grammar.py); a lesson holds its explanation.
# ---------------------------------------------------------------------------------------------------------------

TO_BE_INTRO = {
    "kind": "grammar", "title": "Động từ to be: am / is / are",
    "explanation": [
        "“To be” nghĩa là “thì, là, ở”. Nó đổi dạng theo chủ ngữ đứng trước.",
        "I đi với am. He, she, it và một người/vật đi với is. You, we, they và nhiều người/vật đi với are.",
    ],
    "rules": [{"form": "I + am", "example": "I am a student."}, {"form": "He / She / It + is", "example": "She is my sister."},
              {"form": "You / We / They + are", "example": "They are my friends."}],
    "examples": [{"en": "My father is a doctor.", "vi": "Bố tôi là bác sĩ. (My father = he → is)"},
                 {"en": "Tom and Lan are in the garden.", "vi": "Tom và Lan đang ở trong vườn. (hai người = they → are)"}],
}

PRESENT_INTRO = {
    "kind": "grammar", "title": "Thì hiện tại đơn: thêm -s / -es",
    "explanation": [
        "Thì hiện tại đơn nói về thói quen hoặc sự thật: I play, she plays.",
        "Khi chủ ngữ là he, she, it hoặc một người/vật, động từ thêm -s.",
        "Động từ tận cùng bằng -sh, -ch, -s, -x, -o thì thêm -es (watch → watches, go → goes). "
        "Have đổi thành has.",
    ],
    "rules": [{"form": "I / You / We / They + V", "example": "They play football."},
              {"form": "He / She / It + V-s / V-es", "example": "He plays football."},
              {"form": "-sh, -ch, -s, -x, -o + es", "example": "She watches TV. He goes to school."}],
    "examples": [{"en": "My mother cooks dinner.", "vi": "Mẹ tôi nấu bữa tối."},
                 {"en": "Lan brushes her teeth.", "vi": "Lan đánh răng."}],
}

# ---------------------------------------------------------------------------------------------------------------
# Math: lessons are generator settings; problems are generated per session from a stored seed.
# ---------------------------------------------------------------------------------------------------------------

ARITH_INTRO = {
    "kind": "math", "title": "Cộng, trừ, nhân, chia",
    "explanation": ["Đọc kỹ dấu phép tính trước khi làm.", "Phép chia trong bài luôn chia hết; không bao giờ chia cho 0."],
    "examples": [{"problem": "47 + 8", "steps": ["47 + 3 = 50", "50 + 5 = 55"], "answer": "55"},
                 {"problem": "56 : 7", "steps": ["7 × 8 = 56"], "answer": "8"}],
    "tips": ["Nhập đáp án bằng bàn phím số rồi nhấn Bắn."],
}
INTEGER_INTRO = {
    "kind": "math", "title": "Cộng, trừ, nhân, chia số nguyên",
    "explanation": ["Cộng với số âm là trừ đi số đối của nó: 5 + (−3) = 2.", "Trừ đi số âm là cộng với số đối: 5 − (−3) = 8.",
                    "Nhân, chia hai số cùng dấu được số dương; khác dấu được số âm."],
    "examples": [{"problem": "−4 × 3", "steps": ["4 × 3 = 12", "khác dấu → −12"], "answer": "−12"}],
    "tips": ["Dùng nút ± để nhập số âm."],
}
MISSING_INTRO = {
    "kind": "math", "title": "Tìm số còn thiếu",
    "explanation": ["Dùng phép tính ngược: số hạng = tổng − số hạng kia; thừa số = tích : thừa số kia.",
                    "Số bị trừ = hiệu + số trừ; số bị chia = thương × số chia."],
    "examples": [{"problem": "__ + 27 = 45", "steps": ["45 − 27 = 18"], "answer": "18"},
                 {"problem": "72 : __ = 8", "steps": ["72 : 8 = 9"], "answer": "9"}],
    "tips": ["Thử lại bằng cách điền số vào ô trống."],
}
COMPARE_INTRO = {
    "kind": "math", "title": "So sánh số",
    "explanation": ["Tính giá trị mỗi vế trước, rồi so sánh.", "Dấu > và < luôn mở về phía số lớn hơn."],
    "examples": [{"problem": "36 + 8 __ 45", "steps": ["36 + 8 = 44", "44 < 45"], "answer": "<"}],
    "tips": [],
}
COMPARE_NEG_INTRO = {
    "kind": "math", "title": "So sánh số nguyên",
    "explanation": ["Trên trục số, số bên phải luôn lớn hơn.", "Mọi số âm đều nhỏ hơn 0 và nhỏ hơn mọi số dương.",
                    "Hai số âm: số nào xa 0 hơn thì nhỏ hơn (−7 < −3)."],
    "examples": [{"problem": "−7 __ −3", "steps": ["−7 nằm bên trái −3 trên trục số"], "answer": "<"}],
    "tips": [],
}
ORDER_INTRO = {
    "kind": "math", "title": "Thứ tự thực hiện phép tính",
    "explanation": ["1. Trong ngoặc làm trước.", "2. Nhân, chia từ trái sang phải.", "3. Cộng, trừ từ trái sang phải."],
    "examples": [{"problem": "20 − 3 × 4 + 2", "steps": ["3 × 4 = 12", "20 − 12 = 8", "8 + 2 = 10"], "answer": "10"},
                 {"problem": "(12 − 4) : 2", "steps": ["12 − 4 = 8", "8 : 2 = 4"], "answer": "4"}],
    "tips": ["Dùng khu vực nháp để ghi kết quả từng bước."],
}

MATH_LESSONS = [
    # (topic, level, title, intro, game_type, travel seconds in Challenge, generator)
    ("arithmetic", "grade2", "Tính nhẩm trong phạm vi 100", ARITH_INTRO, "defense", 18,
     {"ops": ["add", "sub", "mul", "div"], "add_max": 100, "mul_min": 2, "mul_max": 5}),
    ("arithmetic", "grade3", "Tính trong phạm vi 1000", ARITH_INTRO, "defense", 18,
     {"ops": ["add", "sub", "mul", "div"], "add_max": 1000, "mul_min": 2, "mul_max": 9}),
    ("arithmetic", "grade4", "Tính trong phạm vi 10 000", ARITH_INTRO, "defense", 20,
     {"ops": ["add", "sub", "mul", "div"], "add_max": 10000, "mul_min": 2, "mul_max": 9, "big_mul": True}),
    ("arithmetic", "grade6", "Cộng trừ nhân chia số nguyên", INTEGER_INTRO, "defense", 18,
     {"ops": ["add", "sub", "mul", "div"], "add_max": 50, "mul_min": 2, "mul_max": 9, "allow_negative": True}),
    ("missing_number", "grade2", "Tìm số còn thiếu (phạm vi 100)", MISSING_INTRO, "math_bridge", 0,
     {"ops": ["add", "sub", "mul", "div"], "add_max": 100, "mul_min": 2, "mul_max": 5}),
    ("missing_number", "grade3", "Tìm số còn thiếu (phạm vi 1000)", MISSING_INTRO, "math_bridge", 0,
     {"ops": ["add", "sub", "mul", "div"], "add_max": 1000, "mul_min": 2, "mul_max": 9}),
    ("missing_number", "grade4", "Tìm số còn thiếu (phạm vi 10 000)", MISSING_INTRO, "math_bridge", 0,
     {"ops": ["add", "sub", "mul", "div"], "add_max": 10000, "mul_min": 2, "mul_max": 9}),
    ("compare", "grade2", "So sánh trong phạm vi 100", COMPARE_INTRO, "math_bridge", 0,
     {"ops": ["add", "sub"], "add_max": 100, "expressions": True}),
    ("compare", "grade3", "So sánh biểu thức", COMPARE_INTRO, "math_bridge", 0,
     {"ops": ["add", "sub", "mul"], "add_max": 1000, "mul_min": 2, "mul_max": 9, "expressions": True}),
    ("compare", "grade6", "So sánh số nguyên", COMPARE_NEG_INTRO, "math_bridge", 0,
     {"ops": ["add", "sub"], "add_max": 50, "allow_negative": True, "expressions": True}),
    ("order_of_operations", "grade3", "Biểu thức hai phép tính", ORDER_INTRO, "defense", 24,
     {"ops_count": 2, "operand_max": 10, "add_max": 100}),
    ("order_of_operations", "grade4", "Biểu thức ba phép tính", ORDER_INTRO, "defense", 30,
     {"ops_count": 3, "operand_max": 12, "add_max": 200}),
]


def _game(game_type: str, travel: int, **extra) -> dict:
    return {"game_type": game_type, "turns": 12, "travel_seconds": travel,
            "max_targets": {"practice": 1, "challenge": 2 if game_type in ("meteor", "defense") else 1}, **extra}


# ---------------------------------------------------------------------------------------------------------------
# English vocabulary: the words live in the vocabulary bank (app/data/vocabulary/*.tsv, imported by learning_vocab).
# A lesson only says which part of the bank it draws from; every stage picks its words for the user
# (learning_vocab.bank_items): new, to review and learned words, at the user's level, never twice in a stage.
# ---------------------------------------------------------------------------------------------------------------

VOCAB_TIP = ("Mỗi chặng có các từ khác nhau, chọn theo trình độ của bạn: bắt đầu từ A1 và nâng dần khi bạn trả lời "
             "đúng ngay. Từ cần ôn được lặp lại có chủ đích. Đọc to, nghe phát âm rồi nhớ nghĩa.")


def bank_lesson(code: str, topic: str, title: str, bank_topic: str | None) -> dict:
    return {"code": code, "topic": topic, "level": "auto", "title": title,
            "intro": {"kind": "vocabulary", "title": title, "tip": VOCAB_TIP},
            "game": _game("meteor", 24, variants=["meteor", "word_shooter"], generator={"vocab_bank": {"topic": bank_topic}}),
            "vocab": [], "questions": []}


# Lesson codes of the first two topics are kept, so their progress and review items carry on.
BANK_LESSON_CODES = {"animals": "en.animals.starter", "school": "en.school.starter"}


def grammar_lesson(code: str, topic: str, level: str, title: str, intro: dict, point: str) -> dict:
    return {"code": code, "topic": topic, "level": level, "title": title, "intro": intro,
            "game": _game("grammar", 0, variants=["mixed", "gate", "bridge"], generator={"grammar": point}),
            "vocab": [], "questions": []}


GRAMMAR_BANK_INTRO = {"kind": "grammar", "title": "Ngữ pháp tổng hợp", "explanation": [
    "Mỗi chặng chọn câu theo trình độ của bạn, bắt đầu từ cấu trúc cơ bản và nâng dần khi bạn trả lời đúng ngay.",
    "Câu sai, câu dùng gợi ý hoặc đã xem đáp án sẽ quay lại để ôn."], "rules": [], "examples": []}


def grammar_bank_lesson() -> dict:
    """"Chọn đáp án ngữ pháp" (gate) and "Sắp xếp câu" (bridge): questions from the grammar bank, picked per stage."""
    return {"code": "en.grammar.bank", "topic": "grammar_mix", "level": "auto", "title": "Ngữ pháp tổng hợp",
            "intro": GRAMMAR_BANK_INTRO,
            "game": _game("grammar", 0, variants=["gate", "bridge", "mixed"], generator={"grammar_bank": {}}),
            "vocab": [], "questions": []}


# ---------------------------------------------------------------------------------------------------------------
# Curriculum games (Tiếng Việt, Tự nhiên và Xã hội / Khoa học, Tin học): reviewed content in app/data/curriculum,
# one lesson per game and grade (Lập trình đường đi: per level). A content change publishes a new lesson version.
# ---------------------------------------------------------------------------------------------------------------

CURRICULUM_SUBJECT = {"word_builder": "vietnamese", "spelling_detective": "vietnamese", "sorting": "science",
                      "code_path": "informatics"}
CURRICULUM_TOPICS = {
    "vietnamese": [("ghep_chu", "Ghép chữ", "word_building", "Ghép chữ cái, tiếng thành từ theo hình"),
                   ("chinh_ta", "Chính tả", "spelling", "Tìm và sửa tiếng viết sai chính tả")],
    "science": [("phan_loai", "Phân loại", "classification", "Xếp sự vật vào đúng nhóm")],
    "informatics": [("lap_trinh", "Lập trình đường đi", "programming", "Xếp lệnh để đưa pet tới đích")],
}
CURRICULUM_TOPIC = {"word_builder": "ghep_chu", "spelling_detective": "chinh_ta", "sorting": "phan_loai", "code_path": "lap_trinh"}
CURRICULUM_TITLE = {"word_builder": "Ghép chữ", "spelling_detective": "Thám tử chính tả", "sorting": "Phân loại cùng pet",
                    "code_path": "Lập trình đường đi"}
LEVELS.update({
    "vietnamese": [(f"g{g}", f"Lớp {g}", None) for g in range(1, 6)],
    "science": [(f"g{g}", f"Lớp {g}", None) for g in range(1, 6)],
    "informatics": [("basic", "Cơ bản", "Lớp 3–5: tiến và rẽ"), ("intermediate", "Trung cấp", "Lớp 6–9: thêm khối Lặp lại"),
                    ("advanced", "Nâng cao", "Lớp 10–12: chương trình ngắn gọn")],
})
TOPICS.update(CURRICULUM_TOPICS)


def curriculum_lessons(subject: str) -> list[dict]:
    lessons = []
    for game, owner in CURRICULUM_SUBJECT.items():
        if owner != subject:
            continue
        for band in cg.lesson_bands(game):
            level = band if isinstance(band, str) else f"g{band}"
            lessons.append({"code": cg.lesson_code(game, band), "topic": CURRICULUM_TOPIC[game], "level": level,
                            "title": CURRICULUM_TITLE[game],
                            "intro": {"kind": "guide", "title": CURRICULUM_TITLE[game]},
                            "game": {"game_type": game, "turns": cg.STAGE_TURNS[game], "travel_seconds": 0,
                                     "max_targets": {"practice": 1, "challenge": 1},
                                     "generator": {"curriculum": game, "band": band, "content": cg.bank_hash(game)}},
                            "vocab": [], "questions": []})
    return lessons


def lesson_definitions() -> dict[str, list[dict]]:
    english = [
        bank_lesson("en.vocab.mix", "vocab_mix", "Từ vựng tổng hợp", None),
        *[bank_lesson(BANK_LESSON_CODES.get(code, f"en.vocab.{code}"), code, f"Từ vựng: {name}", code)
          for code, name, _ in VOCAB_TOPICS],
        grammar_bank_lesson(),
        grammar_lesson("en.to_be.basic", "to_be", "basic", "am / is / are", TO_BE_INTRO, "to_be"),
        grammar_lesson("en.present_simple.basic", "present_simple", "basic", "He plays, she watches", PRESENT_INTRO, "present_simple"),
    ]
    math = [{"code": f"math.{topic}.{level}", "topic": topic, "level": level, "title": title, "intro": intro,
             "game": _game(game_type, travel, generator=generator), "vocab": [], "questions": []}
            for topic, level, title, intro, game_type, travel, generator in MATH_LESSONS]
    return {"english": english, "math": math, **{code: curriculum_lessons(code) for code in ("vietnamese", "science", "informatics")}}


# ---------------------------------------------------------------------------------------------------------------
# Học tập by lesson (lesson_catalog.py): every game of a ready lesson is a lesson here ("cat.<lesson>.<game>"), in the
# subject's chapter (topic) and grade (level g1–g12). A lesson that is no longer ready, or a game it no longer publishes,
# is retired: its sessions and results stay, no new stage starts.
# ---------------------------------------------------------------------------------------------------------------

def catalog_subject_name(code: str) -> str:
    names: list[str] = []
    for offer in lc.subject_meta(code)["offers"]:
        if offer["name"] not in names:
            names.append(offer["name"])
    return " / ".join(names)[:60]


def catalog_definitions() -> dict[str, dict]:
    """subject -> {"levels", "topics", "lessons"} of the lesson catalog."""
    out: dict[str, dict] = {}
    for code, data in lc.catalog()["subjects"].items():
        grades = sorted({c["grade"] for c in data["chapters"]})
        topics = [(c["key"], c["title"][:80], "lesson", None) for g in grades for c in lc.chapters(code, g)]
        lessons = []
        for chapter_key, *_ in topics:
            for entry in (lc.lesson(lsn["key"]) for c in data["chapters"] if c["key"] == chapter_key for lsn in c["lessons"]):
                if entry["lesson"]["status"] != "ready":
                    continue
                for spec in entry["lesson"]["games"]:
                    lessons.append({"code": lc.lesson_code(entry["lesson"]["key"], spec["game"]), "topic": chapter_key,
                                    "level": f"g{entry['grade']}", "title": f"{entry['lesson']['title']} · {spec['title']}"[:120],
                                    "intro": lc.intro(entry, spec), "game": lc.game_config(entry, spec), "vocab": [], "questions": []})
        out[code] = {"levels": [(f"g{g}", f"Lớp {g}", None) for g in grades], "topics": topics, "lessons": lessons}
    return out


def content_hash(lesson: dict) -> str:
    return hashlib.sha256(json.dumps(lesson, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _sync(db: Session, rows: dict, key, model, where: dict, values: dict):
    """Create or update a row against rows already read (`rows`, by their natural key); a new row is added, not flushed."""
    row = rows.get(key)
    if row is None:
        row = model(**where, **values)
        db.add(row)
        rows[key] = row
    else:
        for name, value in values.items():
            if getattr(row, name) != value:
                setattr(row, name, value)
    return row


def publish_version(db: Session, lesson: LearningLesson, definition: dict, version: int) -> LearningLessonVersion:
    row = LearningLessonVersion(lesson_id=lesson.id, version=version, intro_json=json.dumps(definition["intro"], ensure_ascii=False),
                                game_config_json=json.dumps(definition["game"], ensure_ascii=False),
                                content_hash=content_hash(definition))
    db.add(row)
    db.flush()
    vocab_ids = {}
    for word in definition["vocab"]:
        item = LearningVocabItem(lesson_version_id=row.id, item_key=word["item_key"], word=word["word"],
                                 meaning_vi=word["meaning_vi"], context_vi=word["context_vi"],
                                 part_of_speech=word["part_of_speech"], phonetic=word["phonetic"],
                                 example_en=word["example_en"], example_vi=word["example_vi"],
                                 accepted_json=json.dumps(word["accepted"], ensure_ascii=False), sort_order=word["sort_order"])
        db.add(item)
        db.flush()
        vocab_ids[word["item_key"]] = item.id
    for q in definition["questions"]:
        db.add(LearningQuestion(lesson_version_id=row.id, question_key=q["question_key"], skill_key=q["skill_key"],
                                skill_label=q["skill_label"], kind=q["kind"], vocab_item_id=vocab_ids.get(q.get("vocab_key")),
                                prompt_json=json.dumps(q["prompt"], ensure_ascii=False),
                                answer_json=json.dumps(q["answer"], ensure_ascii=False),
                                hints_json=json.dumps(q["hints"], ensure_ascii=False), explanation=q["explanation"],
                                sort_order=q["sort_order"]))
    db.flush()
    return row


def seed_learning_content(db: Session) -> int:
    """Create or update the catalog; publish a new lesson version only when its content changed. Returns versions published.
    The vocabulary and grammar banks are imported (upserted) from their data files first."""
    import_bundled(db)
    grammar_bank.import_bundled(db)
    for bank in ("vocabulary", "grammar"):
        grammar_bank.record_release(db, bank)
    published = 0
    definitions = lesson_definitions()
    subjects = list(SUBJECTS)
    levels_of, topics_of = dict(LEVELS), dict(TOPICS)
    catalog = catalog_definitions()
    known = {code for code, _, _ in SUBJECTS}
    for i, meta in enumerate(lc.programme()["subjects"]):
        code = meta["code"]
        if code not in catalog:
            continue
        if code not in known:
            subjects.append((code, catalog_subject_name(code), 10 + i))
        have = {lcode for lcode, *_ in levels_of.get(code, [])}
        levels_of[code] = [*levels_of.get(code, []), *[lv for lv in catalog[code]["levels"] if lv[0] not in have]]
        topics_of[code] = [*topics_of.get(code, []), *catalog[code]["topics"]]
        definitions[code] = [*definitions.get(code, []), *catalog[code]["lessons"]]
    published_codes = {d["code"] for lessons in definitions.values() for d in lessons}
    # Hundreds of lessons: every existing row is read once and new rows are flushed together, never one query per row.
    have_subjects = {r.code: r for r in db.scalars(select(LearningSubject))}
    for code, name, order in subjects:
        _sync(db, have_subjects, code, LearningSubject, {"code": code}, {"name": name, "sort_order": order})
    db.flush()
    have_levels = {(r.subject_id, r.code): r for r in db.scalars(select(LearningLevel))}
    have_topics = {(r.subject_id, r.code): r for r in db.scalars(select(LearningTopic))}
    for code, _, _ in subjects:
        sid = have_subjects[code].id
        for i, (lcode, lname, ldesc) in enumerate(levels_of[code]):
            _sync(db, have_levels, (sid, lcode), LearningLevel, {"subject_id": sid, "code": lcode},
                  {"name": lname, "description": ldesc, "sort_order": i})
        for i, (tcode, tname, skill, tdesc) in enumerate(topics_of[code]):
            _sync(db, have_topics, (sid, tcode), LearningTopic, {"subject_id": sid, "code": tcode},
                  {"name": tname, "skill_type": skill, "description": tdesc, "sort_order": i})
    db.flush()
    have_lessons = {r.code: r for r in db.scalars(select(LearningLesson))}
    for code, _, _ in subjects:
        sid = have_subjects[code].id
        for i, definition in enumerate(definitions.get(code, [])):
            _sync(db, have_lessons, definition["code"], LearningLesson, {"code": definition["code"]},
                  {"topic_id": have_topics[(sid, definition["topic"])].id, "level_id": have_levels[(sid, definition["level"])].id,
                   "title": definition["title"], "sort_order": i, "status": "published"})
    db.flush()
    hashes = {(lid, v): h for lid, v, h in db.execute(select(LearningLessonVersion.lesson_id, LearningLessonVersion.version,
                                                             LearningLessonVersion.content_hash))}
    latest: dict[int, int] = {}
    for lid, v in hashes:
        latest[lid] = max(latest.get(lid, 0), v)
    for code, _, _ in subjects:
        for definition in definitions.get(code, []):
            lesson = have_lessons[definition["code"]]
            digest = content_hash(definition)
            if hashes.get((lesson.id, lesson.current_version)) == digest:
                continue
            version = latest.get(lesson.id, 0) + 1
            if definition["vocab"] or definition["questions"]:
                publish_version(db, lesson, definition, version)
            else:  # most lessons hold only their settings: no item rows, so no flush is needed per lesson
                db.add(LearningLessonVersion(lesson_id=lesson.id, version=version, content_hash=digest,
                                             intro_json=json.dumps(definition["intro"], ensure_ascii=False),
                                             game_config_json=json.dumps(definition["game"], ensure_ascii=False)))
            lesson.current_version = version
            published += 1
    for retired in db.scalars(select(LearningLesson).where(LearningLesson.code.startswith("cat."),
                                                         LearningLesson.status == "published")):
        if retired.code not in published_codes:
            retired.status = "retired"
    db.flush()
    if published:
        log.info("Published %d learning lesson version(s)", published)
    return published


if __name__ == "__main__":  # python -m app.learning_content
    from .db import SessionLocal, engine
    from .migrations import upgrade_schema

    logging.basicConfig(level=logging.INFO)
    upgrade_schema(engine)
    with SessionLocal() as session:
        count = seed_learning_content(session)
        session.commit()
    print(f"Learning content up to date ({count} new lesson version(s) published).")
