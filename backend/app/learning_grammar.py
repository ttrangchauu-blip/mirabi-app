"""Generated English grammar questions, like the Math generator: every session draws new sentences from a seed.

Sentences are built from word pools (subject × verb/complement × time phrase), and the right form is computed by
rules in this module (am/is/are, third-person -s/-es/-ies, has/does), so no question bank has to be stored and no
two sessions are the same. Each item names the rule it practises (`question_key`), which the review list uses to
generate fresh practice for exactly the rules a learner got wrong.
"""
from __future__ import annotations

import random

# (English, Vietnamese, person: "1s" I | "3s" he/she/it | "pl" you/we/they, note, is a name?)
SUBJECTS = [
    ("I", "Tôi", "1s", "I luôn đi với am", False),
    ("You", "Bạn", "pl", "You luôn dùng như số nhiều", False),
    ("We", "Chúng tôi", "pl", "We là số nhiều", False),
    ("They", "Họ", "pl", "They là số nhiều", False),
    ("He", "Anh ấy", "3s", "He là ngôi thứ ba số ít", False),
    ("She", "Cô ấy", "3s", "She là ngôi thứ ba số ít", False),
    ("My mother", "Mẹ tôi", "3s", "My mother = she, ngôi thứ ba số ít", False),
    ("My father", "Bố tôi", "3s", "My father = he, ngôi thứ ba số ít", False),
    ("My brother", "Anh trai tôi", "3s", "My brother = he, ngôi thứ ba số ít", False),
    ("Our teacher", "Cô giáo của chúng tôi", "3s", "Our teacher = she, ngôi thứ ba số ít", False),
    ("Tom", "Tom", "3s", "Tom = he, ngôi thứ ba số ít", True),
    ("Lan", "Lan", "3s", "Lan = she, ngôi thứ ba số ít", True),
    ("The cat", "Con mèo", "3s", "The cat = it, ngôi thứ ba số ít", False),
    ("My friends", "Các bạn tôi", "pl", "My friends = they, số nhiều", False),
    ("Tom and Lan", "Tom và Lan", "pl", "Tom and Lan là hai người (= they), số nhiều", True),
    ("The students", "Các học sinh", "pl", "The students = they, số nhiều", False),
]

# to be: complements that fit singular and plural subjects.
BE_COMPLEMENTS = [
    ("happy", "vui"), ("tired", "mệt"), ("hungry", "đói"), ("busy", "bận"), ("ready", "đã sẵn sàng"),
    ("at school", "ở trường"), ("at home", "ở nhà"), ("in the garden", "ở trong vườn"),
    ("in the classroom", "ở trong lớp học"), ("very kind", "rất tốt bụng"), ("in the library", "ở thư viện"),
]
BE_FORM = {"1s": "am", "3s": "is", "pl": "are"}
BE_RULE = {
    "am": ("Động từ to be: am", "I đi với am."),
    "is": ("Động từ to be: is", "He, she, it và một người/vật đi với is."),
    "are": ("Động từ to be: are", "You, we, they và nhiều người/vật đi với are."),
}

# present simple: (base verb, rest of the phrase, Vietnamese verb phrase)
VERB_PHRASES = [
    ("play", "football", "chơi bóng đá"), ("watch", "TV", "xem ti vi"), ("go", "to school", "đi học"),
    ("read", "books", "đọc sách"), ("drink", "milk", "uống sữa"), ("study", "English", "học tiếng Anh"),
    ("have", "breakfast", "ăn sáng"), ("wash", "the dishes", "rửa bát"), ("fix", "the bike", "sửa xe đạp"),
    ("catch", "the bus", "bắt xe buýt"), ("do", "homework", "làm bài tập về nhà"), ("cook", "dinner", "nấu bữa tối"),
    ("fly", "a kite", "thả diều"), ("like", "ice cream", "thích kem"), ("ride", "a bike", "đi xe đạp"),
    ("brush", "the dog", "chải lông cho chó"), ("carry", "the bag", "xách túi"), ("mix", "the paint", "pha màu"),
]
TIMES = [
    ("every day", "mỗi ngày"), ("in the evening", "vào buổi tối"), ("on Mondays", "vào các ngày thứ Hai"),
    ("after school", "sau giờ học"), ("at the weekend", "vào cuối tuần"), ("every morning", "mỗi sáng"),
]
SIMPLE_RULE = {
    "base": ("Hiện tại đơn: giữ nguyên động từ", "Với I, you, we, they và chủ ngữ số nhiều, động từ giữ nguyên."),
    "s": ("Hiện tại đơn: thêm -s", "Với he, she, it và chủ ngữ số ít, động từ thêm -s."),
    "es": ("Hiện tại đơn: thêm -es", "Động từ tận cùng bằng -s, -sh, -ch, -x, -z, -o thì thêm -es."),
    "ies": ("Hiện tại đơn: -y thành -ies", "Động từ tận cùng bằng phụ âm + y thì đổi y thành i rồi thêm -es."),
    "irregular": ("Hiện tại đơn: has, does", "Với he/she/it: have → has, do → does."),
}

TO_BE_KEY = "en.grammar.to_be"
SIMPLE_KEY = "en.grammar.present_simple_s"
SKILL_LABEL = {TO_BE_KEY: "Động từ to be", SIMPLE_KEY: "Hiện tại đơn ngôi thứ ba"}


def third_person(verb: str) -> tuple[str, str]:
    """(form, rule) of a verb after he/she/it."""
    if verb in ("have", "do"):
        return ("has" if verb == "have" else "does"), "irregular"
    if verb.endswith(("s", "sh", "ch", "x", "z", "o")):
        return verb + "es", "es"
    if verb.endswith("y") and verb[-2:-1] not in "aeiou":
        return verb[:-1] + "ies", "ies"
    return verb + "s", "s"


def _misspelled(verb: str, rule: str) -> str:
    """The typical wrong form learners write (watchs, flys, haves, ...), used as a distractor."""
    if rule == "irregular":
        return "haves" if verb == "have" else "dos"
    if rule in ("es", "ies"):
        return verb + "s"
    return verb + "ing"


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def _vi_subject(subject: tuple) -> str:
    """The Vietnamese subject in the middle of a sentence (names keep their capital)."""
    return subject[1] if subject[4] else subject[1][:1].lower() + subject[1][1:]


def _en_subject(subject: tuple) -> str:
    """The English subject in the middle of a sentence ("I" and names keep their capital)."""
    return subject[0] if subject[4] or subject[0] == "I" else subject[0][:1].lower() + subject[0][1:]


def _tokens(words: list[str], rng: random.Random) -> list[dict]:
    shuffled = list(words)
    rng.shuffle(shuffled)
    # Ids follow the shuffled order, so they say nothing about the right order.
    return [{"id": f"w{i + 1}", "text": text} for i, text in enumerate(shuffled)]


def _bridge_words(core: str, subject: tuple) -> list[str]:
    """Words of the sentence; only the sentence's first word loses its capital (unless it is "I" or a name), so
    capitals don't give away which word comes first."""
    words = core.split()
    if not (subject[4] or words[0] == "I"):
        words[0] = words[0].lower()
    return words


def _sentence_item(rng, *, point: str, rule: str, subject, verb_form: str, rest: str, time: tuple | None,
                   kind: str, options: list[str] | None, vi: str, why: str) -> dict:
    rule_title, rule_text = (BE_RULE if point == TO_BE_KEY else SIMPLE_RULE)[rule]
    core = f"{subject[0]} {verb_form} {rest}".strip()
    sentence = f"{core} {time[0]}" if time else core
    common = {"question_key": f"{point}.{rule}", "skill_key": point, "skill_label": SKILL_LABEL[point],
              "explanation": f"{why}. {rule_text}"}
    if kind == "gate_choice":
        blank = f"{subject[0]} ___ {rest}".strip() + (f" {time[0]}" if time else "") + "."
        ids = [f"o{i + 1}" for i in range(len(options))]
        shuffled = list(options)
        rng.shuffle(shuffled)
        return {**common, "kind": "gate_choice",
                "prompt": {"sentence": blank, "options": [{"id": ids[i], "text": t} for i, t in enumerate(shuffled)], "meaning_vi": vi},
                "answer": {"option": ids[shuffled.index(verb_form)], "display": sentence + "."},
                "hints": [f"Chủ ngữ là “{subject[0]}”: {subject[3]}.", rule_text]}
    words = _bridge_words(core, subject)
    accepted = [sentence]
    if time:
        words += time[0].split()
        accepted.append(f"{_cap(time[0])} {_en_subject(subject)} {verb_form} {rest}".strip())
    return {**common, "kind": "bridge_order",
            "prompt": {"tokens": _tokens(words, rng), "meaning_vi": vi},
            "answer": {"accepted": accepted, "display": sentence + "."},
            "hints": [f"Câu bắt đầu bằng: “{accepted[0].split()[0]}”" + (" (hoặc cụm chỉ thời gian)" if time else ""), f"{subject[3]}: {verb_form}."]}


def gen_to_be(rng: random.Random, kind: str, rule: str | None = None) -> dict:
    pool = [s for s in SUBJECTS if rule is None or BE_FORM[s[2]] == rule]
    subject = rng.choice(pool)
    form = BE_FORM[subject[2]]
    complement = rng.choice(BE_COMPLEMENTS)
    time = rng.choice([("today", "hôm nay"), ("now", "bây giờ")]) if kind == "bridge_order" and rng.random() < 0.5 else None
    vi = f"{_cap(time[1])}, {_vi_subject(subject)} {complement[1]}." if time else f"{subject[1]} {complement[1]}."
    return _sentence_item(rng, point=TO_BE_KEY, rule=form, subject=subject, verb_form=form, rest=complement[0], time=time,
                          kind=kind, options=["am", "is", "are"], vi=vi, why=f"{subject[3]} → {form}")


def gen_present_simple(rng: random.Random, kind: str, rule: str | None = None) -> dict:
    people = [s for s in SUBJECTS if s[0] != "The cat"]  # a cat doesn't do homework
    pool = [s for s in people if s[2] != "3s"] if rule == "base" else [s for s in people if s[2] == "3s"] if rule else people
    for _ in range(200):
        subject = rng.choice(pool)
        verb, rest, verb_vi = rng.choice(VERB_PHRASES)
        third, third_rule = third_person(verb)
        actual = "base" if subject[2] != "3s" else third_rule
        if rule is None or actual == rule:
            break
    form = third if subject[2] == "3s" else verb
    time = rng.choice(TIMES)
    vi = f"{subject[1]} {verb_vi} {time[1]}."
    why = f"{subject[3]} → {form}" if subject[2] == "3s" else f"“{subject[0]}” không phải ngôi thứ ba số ít → giữ nguyên {verb}"
    options = [verb, third, _misspelled(verb, third_rule)]
    return _sentence_item(rng, point=SIMPLE_KEY, rule=actual, subject=subject, verb_form=form, rest=rest, time=time,
                          kind=kind, options=options, vi=vi, why=why)


GENERATORS = {"to_be": gen_to_be, "present_simple": gen_present_simple}


def generate_grammar_items(seed: int, point: str, variant: str, count: int,
                           weights: dict[str, float] | None = None, only_key: str | None = None) -> list[dict]:
    """Deterministic for a seed. `variant`: mixed (half gates, half bridges), gate or bridge. `weights` (question_key ->
    weight) favour rules the learner is weak at; `only_key` practises one rule (review)."""
    rng = random.Random(seed)
    generate = GENERATORS[point]
    rules = list(BE_RULE) if point == "to_be" else list(SIMPLE_RULE)
    prefix = TO_BE_KEY if point == "to_be" else SIMPLE_KEY
    kinds = (["gate_choice"] * (count // 2) + ["bridge_order"] * (count - count // 2)) if variant == "mixed" else \
        ["gate_choice" if variant == "gate" else "bridge_order"] * count
    items, seen = [], set()
    for kind in kinds:
        for attempt in range(30):
            rule = only_key.rsplit(".", 1)[1] if only_key else \
                rng.choices(rules, weights=[max(0.05, (weights or {}).get(f"{prefix}.{r}", 1.0)) for r in rules])[0]
            item = generate(rng, kind, rule)
            signature = item["answer"]["display"]
            if signature not in seen or attempt == 29:
                seen.add(signature)
                items.append(item)
                break
    return items
