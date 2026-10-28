"""The English grammar bank: the curriculum of grammar points, data files, validation and quality gate, bulk import,
and how a stage of "Chọn đáp án ngữ pháp" (game `choice`) or "Sắp xếp câu" (game `order`) picks its questions.

Data lives in app/data/grammar/<point>.<game>.tsv (tab-separated, UTF-8, header row, one question per row):

  choice: key point difficulty topic form context_vi prompt options answer hint_vi explanation_vi sentence_vi source status
  order:  key point difficulty topic form context_vi tokens alternatives sentence_en sentence_vi hint_vi explanation_vi
          source status

- point: a code of POINTS below; difficulty: 1..6 (internal, at most one away from the point's own difficulty).
- topic: the situation, a vocabulary topic code (learning_vocab.TOPICS); form: aff | neg | q.
- choice: `prompt` has exactly one "___"; `options` are 3-4 answers separated by "|", one of them `answer`.
- order: `tokens` are the pieces of the sentence in a right order, separated by "/", without the final punctuation and
  written as they are shown (the first piece only keeps its capital for "I" and names). `alternatives` are the other
  valid orders of the same pieces ("/" between pieces, "|" between orders). `sentence_en` is the full sentence.
- status: draft -> checked -> active (-> retired), as in the vocabulary bank: only `active` questions are served.

Answers are checked against the stored answers only (never by AI): a choice by option id (positions are shuffled per
session and the mapping is stored server-side), an order by the text of the pieces (case, spacing and punctuation
ignored, so the same word twice can be placed either way).

CLI (run from backend/):
    python -m app.learning_grammar_bank check   [files...]
    python -m app.learning_grammar_bank qa      [--apply] [files...]
    python -m app.learning_grammar_bank publish [--apply] [files...]
    python -m app.learning_grammar_bank import  [files...] [--retire-missing]
    python -m app.learning_grammar_bank report
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
from pathlib import Path
from typing import Iterable

from .learning_engine import normalize_sentence, normalize_text
from .learning_vocab import DIFFICULTIES, FLAGS_FILE, STATUSES, TOPIC_CODES, import_once, read_flags, set_statuses

log = logging.getLogger("refmi.grammar")

DATA_DIR = Path(__file__).resolve().parent / "data" / "grammar"
GAMES = ("choice", "order")
FORMS = ("aff", "neg", "q")
CHOICE_COLUMNS = ("key", "point", "difficulty", "topic", "form", "context_vi", "prompt", "options", "answer", "hint_vi",
                  "explanation_vi", "sentence_vi", "source", "status")
ORDER_COLUMNS = ("key", "point", "difficulty", "topic", "form", "context_vi", "tokens", "alternatives", "sentence_en",
                 "sentence_vi", "hint_vi", "explanation_vi", "source", "status")
COLUMNS = {"choice": CHOICE_COLUMNS, "order": ORDER_COLUMNS}
DEFAULT_SOURCE = "mirabi-original"

# The curriculum: (code, difficulty, name, rule). Difficulty 1 = beginners ... 6 = advanced. The rule is shown in the
# lesson of a stage and as the second hint; it explains the structure without giving away any question's answer.
POINTS: list[tuple[str, int, str, str]] = [
    # 1 — cơ bản
    ("pronoun_subject", 1, "Đại từ nhân xưng chủ ngữ", "I, you, he, she, it, we, they đứng trước động từ, làm chủ ngữ."),
    ("pronoun_object", 1, "Đại từ tân ngữ", "me, you, him, her, it, us, them đứng sau động từ hoặc giới từ."),
    ("possessive_adjective", 1, "Tính từ sở hữu", "my, your, his, her, its, our, their đứng trước danh từ."),
    ("be_present", 1, "Động từ to be ở hiện tại", "I am; he/she/it is; you/we/they are. Phủ định thêm not, câu hỏi đảo be lên trước."),
    ("article_a_an", 1, "Mạo từ a / an", "a trước âm phụ âm, an trước âm nguyên âm (theo cách đọc, không theo chữ viết)."),
    ("noun_plural", 1, "Danh từ số nhiều", "Thường thêm -s; -s/-sh/-ch/-x/-o thêm -es; phụ âm + y → -ies; có dạng bất quy tắc."),
    ("demonstratives", 1, "This / that / these / those", "this/that + số ít, these/those + số nhiều; this/these ở gần, that/those ở xa."),
    ("there_is_are", 1, "There is / There are", "There is + danh từ số ít hoặc không đếm được; There are + danh từ số nhiều."),
    ("have_has", 1, "Have / has", "I/you/we/they have; he/she/it has. Phủ định và câu hỏi dùng do/does + have."),
    ("present_simple_affirmative", 1, "Hiện tại đơn: câu khẳng định",
     "Thói quen, sự thật: I/you/we/they + V; he/she/it + V-s/es."),
    ("present_simple_negative_question", 1, "Hiện tại đơn: phủ định và câu hỏi",
     "don't/doesn't + V nguyên mẫu; Do/Does + chủ ngữ + V nguyên mẫu?"),
    ("imperative", 1, "Câu mệnh lệnh", "Dùng V nguyên mẫu để yêu cầu; Don't + V để cấm; Let's + V để rủ."),
    ("can_cannot", 1, "Can / can't", "can + V nguyên mẫu: khả năng, xin phép; không thêm -s, không dùng to."),
    ("prep_place", 1, "Giới từ chỉ nơi chốn", "in (trong), on (trên bề mặt), under, next to, behind, in front of, between."),
    ("prep_time", 1, "Giới từ chỉ thời gian", "at + giờ; on + ngày, thứ; in + tháng, năm, mùa, buổi."),
    ("wh_questions", 1, "Câu hỏi Wh-", "Từ để hỏi + trợ động từ/be + chủ ngữ + động từ? (What, Where, When, Who, Why, How...)."),
    ("possessive_s", 1, "Sở hữu cách 's", "người/vật sở hữu + 's + vật bị sở hữu; danh từ số nhiều tận cùng -s chỉ thêm '."),
    ("adverb_frequency", 1, "Trạng từ chỉ tần suất", "always, usually, often, sometimes, never đứng trước động từ thường, sau be."),
    # 2 — sơ cấp
    ("present_continuous", 2, "Hiện tại tiếp diễn", "am/is/are + V-ing: việc đang diễn ra lúc nói hoặc quanh thời điểm hiện tại."),
    ("present_simple_vs_continuous", 2, "Hiện tại đơn và hiện tại tiếp diễn",
     "Thói quen, sự thật → hiện tại đơn; việc đang xảy ra → hiện tại tiếp diễn. Động từ trạng thái ít dùng V-ing."),
    ("past_simple_be", 2, "Quá khứ của to be: was / were", "I/he/she/it was; you/we/they were."),
    ("past_simple_affirmative", 2, "Quá khứ đơn: câu khẳng định", "V-ed với động từ có quy tắc; động từ bất quy tắc dùng cột 2."),
    ("past_simple_negative_question", 2, "Quá khứ đơn: phủ định và câu hỏi",
     "didn't + V nguyên mẫu; Did + chủ ngữ + V nguyên mẫu?"),
    ("countable_uncountable", 2, "Danh từ đếm được và không đếm được",
     "many + danh từ đếm được số nhiều, much + không đếm được; some ở câu khẳng định, any ở phủ định và câu hỏi."),
    ("quantifier_few_little", 2, "A few / a little / few / little",
     "a few/few + danh từ đếm được; a little/little + không đếm được; có a = một ít (đủ), không a = rất ít."),
    ("comparative", 2, "So sánh hơn", "tính từ ngắn + -er + than; more + tính từ dài + than; good → better, bad → worse."),
    ("superlative", 2, "So sánh nhất", "the + tính từ ngắn + -est; the most + tính từ dài; good → the best, bad → the worst."),
    ("possessive_pronoun", 2, "Đại từ sở hữu", "mine, yours, his, hers, ours, theirs thay cho tính từ sở hữu + danh từ."),
    ("future_going_to", 2, "Tương lai với be going to", "am/is/are going to + V: dự định đã có, hoặc dự đoán có dấu hiệu."),
    ("future_will", 2, "Tương lai với will", "will + V: quyết định lúc nói, lời hứa, dự đoán; won't = will not."),
    ("article_the_zero", 2, "Mạo từ the và không dùng mạo từ",
     "the cho vật đã xác định hoặc duy nhất; không dùng mạo từ khi nói chung chung với danh từ số nhiều/không đếm được."),
    ("conjunction_basic", 2, "Liên từ cơ bản", "and (thêm ý), but (đối lập), or (lựa chọn), so (kết quả), because (nguyên nhân)."),
    ("prep_movement", 2, "Giới từ chỉ chuyển động", "into, out of, across, through, along, up, down, over, towards."),
    ("adverb_manner", 2, "Trạng từ chỉ cách thức", "tính từ + -ly (slow → slowly); good → well; fast, hard giữ nguyên."),
    ("modal_must_have_to_should", 2, "Must / have to / should", "must, have to: bắt buộc; should: lời khuyên; sau đó là V nguyên mẫu."),
    ("verb_like_want", 2, "Like / want / would like", "like, love, enjoy, hate + V-ing; want, would like + to V."),
    # 3 — trung cấp
    ("present_perfect", 3, "Hiện tại hoàn thành", "have/has + V3: trải nghiệm, kết quả còn liên quan tới hiện tại; ever, never, already, yet, just."),
    ("present_perfect_for_since", 3, "Hiện tại hoàn thành với for / since", "for + khoảng thời gian; since + mốc thời gian."),
    ("present_perfect_vs_past_simple", 3, "Hiện tại hoàn thành và quá khứ đơn",
     "Thời điểm cụ thể đã qua (yesterday, in 2019, ago) → quá khứ đơn; không nêu thời điểm, liên quan hiện tại → hiện tại hoàn thành."),
    ("past_continuous", 3, "Quá khứ tiếp diễn", "was/were + V-ing: việc đang diễn ra trong quá khứ; when + quá khứ đơn cắt ngang, while + tiếp diễn."),
    ("future_arrangements", 3, "Các cách nói về tương lai",
     "Lịch hẹn đã sắp xếp → hiện tại tiếp diễn; dự định → be going to; quyết định tức thì → will; lịch trình → hiện tại đơn."),
    ("conditional_zero_first", 3, "Câu điều kiện loại 0 và loại 1",
     "Loại 0: If + hiện tại đơn, hiện tại đơn (sự thật). Loại 1: If + hiện tại đơn, will + V (có thể xảy ra)."),
    ("modal_possibility", 3, "May / might / could", "may, might, could + V: có thể, có lẽ (không chắc chắn)."),
    ("modal_obligation", 3, "Mustn't / don't have to / needn't",
     "mustn't = không được phép; don't have to / needn't = không cần thiết."),
    ("gerund_infinitive", 3, "Danh động từ và động từ nguyên mẫu",
     "Có động từ theo sau là V-ing (enjoy, avoid, finish), có động từ theo sau là to V (decide, hope, plan); sau giới từ dùng V-ing."),
    ("relative_clause_defining", 3, "Mệnh đề quan hệ xác định",
     "who cho người, which cho vật, that cho cả hai, where cho nơi chốn; mệnh đề đứng ngay sau danh từ nó bổ nghĩa."),
    ("passive_simple", 3, "Câu bị động hiện tại đơn và quá khứ đơn", "am/is/are + V3; was/were + V3; by + người làm (nếu cần)."),
    ("comparison_as_as", 3, "So sánh bằng as ... as", "as + tính từ/trạng từ + as; not as/so ... as; the same as."),
    ("too_enough", 3, "Too và enough", "too + tính từ (quá ... đến mức không); tính từ + enough, enough + danh từ (đủ)."),
    ("used_to", 3, "Used to", "used to + V: thói quen trong quá khứ nay không còn; didn't use to; Did ... use to?"),
    ("question_tag", 3, "Câu hỏi đuôi", "Khẳng định → đuôi phủ định, phủ định → đuôi khẳng định; dùng lại trợ động từ và đại từ."),
    ("indefinite_pronoun", 3, "Đại từ bất định", "some-/any-/no-/every- + one/body/thing/where; động từ chia số ít."),
    ("reflexive_pronoun", 3, "Đại từ phản thân", "myself, yourself, himself, herself, itself, ourselves, yourselves, themselves."),
    ("dependent_preposition", 3, "Giới từ đi kèm", "Nhiều tính từ, động từ đi với giới từ cố định: interested in, good at, depend on, afraid of."),
    ("so_neither", 3, "So / Neither (đồng tình)", "So + trợ động từ + chủ ngữ (khẳng định); Neither/Nor + trợ động từ + chủ ngữ (phủ định)."),
    ("adjective_ed_ing", 3, "Tính từ đuôi -ed và -ing", "-ed: cảm xúc của người (bored); -ing: tính chất gây ra cảm xúc (boring)."),
    # 4 — trung cao
    ("present_perfect_continuous", 4, "Hiện tại hoàn thành tiếp diễn",
     "have/has been + V-ing: hành động kéo dài từ quá khứ tới nay, nhấn mạnh quá trình."),
    ("past_perfect", 4, "Quá khứ hoàn thành", "had + V3: việc xảy ra trước một việc/thời điểm khác trong quá khứ."),
    ("conditional_second", 4, "Câu điều kiện loại 2", "If + quá khứ đơn, would + V: không có thật hoặc khó xảy ra ở hiện tại; If I were..."),
    ("passive_advanced", 4, "Câu bị động nâng cao",
     "Bị động ở các thì hoàn thành, tiếp diễn và sau động từ khuyết thiếu: has been done, is being done, can be done."),
    ("reported_statement", 4, "Câu tường thuật: câu kể", "said (that) + lùi thì: am → was, will → would, have done → had done; đổi đại từ, trạng từ."),
    ("reported_question_command", 4, "Câu tường thuật: câu hỏi và mệnh lệnh",
     "asked + if/whether hoặc từ để hỏi + chủ ngữ + động từ (không đảo); told/asked + tân ngữ + (not) to V."),
    ("relative_clause_non_defining", 4, "Mệnh đề quan hệ không xác định; whose, whom",
     "Thêm thông tin, có dấu phẩy, không dùng that; whose + danh từ (sở hữu), whom làm tân ngữ."),
    ("modal_deduction", 4, "Suy luận với must / can't / might",
     "must (chắc chắn đúng), can't (chắc chắn không), might/could (có thể); về quá khứ: + have V3."),
    ("wish_present", 4, "Wish / If only (hiện tại)", "wish + quá khứ đơn: ước điều trái với hiện tại; wish + could/would."),
    ("contrast_linkers", 4, "Từ nối chỉ sự tương phản",
     "although/even though + mệnh đề; despite/in spite of + danh từ/V-ing; however đứng đầu câu, sau dấu phẩy."),
    ("verb_pattern_meaning", 4, "Động từ + to V / V-ing đổi nghĩa",
     "remember/forget + to V (việc phải làm) và + V-ing (việc đã làm); stop to V / stop V-ing; try to V / try V-ing."),
    ("causative", 4, "Thể nhờ bảo: have/get something done", "have/get + vật + V3: nhờ người khác làm; have someone do, get someone to do."),
    ("so_such_so_that", 4, "So / such ... that; so that; in order to",
     "so + tính từ/trạng từ + that; such (a/an) + tính từ + danh từ + that; so that / in order to chỉ mục đích."),
    ("future_continuous_perfect", 4, "Tương lai tiếp diễn và tương lai hoàn thành",
     "will be + V-ing: đang diễn ra tại một thời điểm tương lai; will have + V3: hoàn thành trước một thời điểm tương lai."),
    ("time_clauses", 4, "Mệnh đề thời gian và phối hợp thì",
     "Sau when, after, before, as soon as, until nói về tương lai dùng hiện tại (không dùng will); phối hợp thì theo trình tự sự việc."),
    ("adjective_order", 4, "Trật tự tính từ", "Ý kiến → kích thước → tuổi → hình dạng → màu sắc → nguồn gốc → chất liệu → mục đích + danh từ."),
    # 5 — nâng cao
    ("conditional_third", 5, "Câu điều kiện loại 3", "If + had V3, would have V3: điều không có thật trong quá khứ."),
    ("conditional_mixed", 5, "Câu điều kiện hỗn hợp", "If + had V3, would + V (quá khứ → hiện tại); If + quá khứ đơn, would have V3."),
    ("wish_past_would_rather", 5, "Wish (quá khứ), would rather, it's time",
     "wish + had V3: tiếc về quá khứ; would rather + chủ ngữ + quá khứ đơn; It's (high) time + chủ ngữ + quá khứ đơn."),
    ("inversion", 5, "Đảo ngữ", "Never/Rarely/Seldom/Not only/Hardly/Only then... đứng đầu câu → trợ động từ đứng trước chủ ngữ."),
    ("cleft_sentence", 5, "Câu chẻ (nhấn mạnh)", "It is/was + phần nhấn mạnh + that/who ...; What + mệnh đề + is/was ..."),
    ("participle_clause", 5, "Mệnh đề phân từ", "V-ing (chủ động), V3 (bị động), Having V3 (xảy ra trước) để rút gọn mệnh đề cùng chủ ngữ."),
    ("passive_reporting", 5, "Bị động với động từ tường thuật",
     "It is said/believed that + mệnh đề; chủ ngữ + is said/believed + to V / to have V3."),
    ("modal_perfect", 5, "Động từ khuyết thiếu + have V3", "should have V3 (lẽ ra nên), could have V3 (đã có thể), needn't have V3 (lẽ ra không cần)."),
    ("reporting_verbs", 5, "Động từ tường thuật", "advise/warn/remind + tân ngữ + to V; deny/admit/suggest + V-ing; apologise for + V-ing."),
    ("subjunctive", 5, "Thức giả định", "suggest/insist/recommend that + chủ ngữ + V nguyên mẫu; It is essential/vital that + chủ ngữ + V nguyên mẫu."),
    # 6 — chuyên sâu
    ("inversion_conditional", 6, "Đảo ngữ câu điều kiện", "Should you + V (loại 1); Were + chủ ngữ + to V / Were it not for (loại 2); Had + chủ ngữ + V3 (loại 3)."),
    ("advanced_relative", 6, "Mệnh đề quan hệ nâng cao", "giới từ + which/whom (in which, by whom); all/some/most of which/whom; whereby."),
    ("emphasis_fronting", 6, "Nhấn mạnh và đảo thành phần", "do/does/did + V để nhấn mạnh; đưa thành phần lên đầu câu; so/such đứng đầu kèm đảo ngữ."),
    ("future_in_past", 6, "Tương lai trong quá khứ", "was/were going to, would, was/were about to + V: điều sắp/định xảy ra khi nhìn từ quá khứ."),
    ("advanced_linkers", 6, "Liên từ nâng cao", "whereas, nevertheless, provided that, as long as, unless, otherwise, given that, in case."),
]
POINT = {code: {"code": code, "difficulty": d, "name": name, "rule": rule, "order": i}
         for i, (code, d, name, rule) in enumerate(POINTS)}

_KEY = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,58}$")
_PIECE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9'’-]*(?: [A-Za-z0-9][A-Za-z0-9'’-]*)*$")  # words of one piece, no punctuation
_BLANK = "___"


@dataclass
class Item:
    key: str
    game: str
    point: str
    difficulty: int
    topic: str
    form: str
    context_vi: str | None
    sentence_en: str
    sentence_vi: str
    hint_vi: str
    explanation_vi: str
    source: str
    status: str
    prompt: str | None = None  # choice
    options: list[str] = field(default_factory=list)  # choice
    answer: str | None = None  # choice
    tokens: list[str] = field(default_factory=list)  # order
    alternatives: list[list[str]] = field(default_factory=list)  # order, besides `tokens`
    origin: str = ""

    def accepted(self) -> list[str]:
        """Every valid order of an order question, as the text the user's pieces must make."""
        return list(dict.fromkeys(order_text(o) for o in [self.tokens, *self.alternatives]))

    def pattern(self) -> str:
        """The structure a question practises: no two questions with one pattern in a stage, few in nearby stages."""
        if self.game == "choice":
            return f"{self.point}|{normalize_text(self.answer or '')}"[:120]
        return f"{self.point}|{self.form}"

    def values(self) -> dict:
        return {"game": self.game, "point": self.point, "difficulty": self.difficulty, "topic": self.topic, "form": self.form,
                "context_vi": self.context_vi, "prompt": self.prompt, "options_json": json.dumps(self.options, ensure_ascii=False),
                "answer": self.answer, "tokens_json": json.dumps(self.tokens, ensure_ascii=False),
                "accepted_json": json.dumps(self.accepted() if self.game == "order" else [self.answer], ensure_ascii=False),
                "sentence_en": self.sentence_en, "sentence_vi": self.sentence_vi, "hint_vi": self.hint_vi,
                "explanation_vi": self.explanation_vi, "pattern": self.pattern(), "source": self.source}

    def content_hash(self) -> str:
        return hashlib.sha256(json.dumps(self.values(), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    issues: dict[str, list[str]] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors

    def flag(self, item: Item, problem: str) -> None:
        self.issues.setdefault(item.key, [])
        if problem not in self.issues[item.key]:
            self.issues[item.key].append(problem)


# ---------------------------------------------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------------------------------------------

def order_text(pieces: Iterable[str]) -> str:
    """The comparable text of pieces in an order: lower case, single spaces, no punctuation."""
    return normalize_order(" ".join(pieces))


def normalize_order(text: str) -> str:
    return normalize_sentence(text)


def end_mark(sentence: str) -> str:
    match = re.search(r"[.?!]$", sentence.strip())
    return match.group(0) if match else "."


_SAME_PERSON = {"he": "P3", "she": "P3", "him": "O3", "her": "X3", "his": "X3", "himself": "R3", "herself": "R3"}


def _signature(sentence: str, names: set[str] = frozenset()) -> str:
    """The sentence with names, numbers and he/she masked: two questions that only differ by a name, a number or the
    person's gender are copies. `names` are words seen capitalised inside sentences (a name at the start is masked too)."""
    words = re.findall(r"[A-Za-z0-9'’]+", sentence)
    out = []
    for i, w in enumerate(words):
        if re.fullmatch(r"\d+(st|nd|rd|th|s)?", w):
            out.append("#")
        elif w[0].isupper() and w not in ("I", "I'm", "I've", "I'll", "I'd") and (i > 0 or w in names or w in NAMES):
            out.append("P3")  # a name is a third person, like he or she
        else:
            out.append(_SAME_PERSON.get(w.lower(), w.lower()))
    return " ".join(out)


# First names often used in examples: at the start of a sentence they are recognised even if never seen elsewhere.
NAMES = set("""Tom Lan Minh Anna John Mary Nam Linh Mai Hoa Peter Sarah David Emma Lucy Ben Jack Kate Mike Hung Huong Trang
Duc An Binh Chi Dung Giang Ha Hai Hanh Hieu Hoang Huy Khanh Khoa Long Ly My Nga Ngoc Nhung Phong Phuong Quan Quang Son
Tam Thao Thu Thuy Tien Trung Tuan Tung Van Viet Vy Yen Alice Bob Chris Daniel Emily George Harry James Jane Jenny Jim
Laura Lisa Mark Max Nick Olivia Paul Rachel Sam Sophie Steve Susan Tim Tony Amy Leo Mia Noah Ella Ryan Zoe Kevin Helen
Linda Maria Carlos Yuki Ken Ali Omar Lily Rose Jake Adam Anne Bill Carol Dan Eric Fred Gary Jill Joe Karen Lee Liz
Meg Ned Pam Ray Rita Ted Tina""".split())


def _names(items: list["Item"]) -> set[str]:
    """Capitalised words found inside sentences (Tom, Hanoi, Monday): when one starts a sentence, it is still a name."""
    names = set()
    for it in items:
        for w in re.findall(r"[A-Za-z'’]+", it.sentence_en)[1:]:
            if w[0].isupper() and w.lower() not in COMMON_WORDS and w not in ("I", "I'm", "I've", "I'll", "I'd"):
                names.add(w)
    return names


def _content_words(sentence: str) -> set[str]:
    stop = {"a", "an", "the", "to", "of", "in", "on", "at", "and", "is", "are", "was", "were", "be", "i", "you", "he", "she",
            "it", "we", "they", "my", "your", "his", "her", "our", "their", "for", "with", "this", "that", "do", "does", "did"}
    return {w for w in re.findall(r"[a-z']+", _signature(sentence)) if w not in stop}


# ---------------------------------------------------------------------------------------------------------------
# Reading and validating data files
# ---------------------------------------------------------------------------------------------------------------

def bundled_files() -> list[Path]:
    return sorted(DATA_DIR.glob("*.tsv"))


def game_of_file(path: Path) -> str | None:
    for game in GAMES:
        if path.name.endswith(f".{game}.tsv"):
            return game
    return None


def read_items(paths: Iterable[Path], report: Report) -> list[Item]:
    items: list[Item] = []
    for path in paths:
        game = game_of_file(path)
        if game is None:
            report.errors.append(f"{path.name}: the file name must end with .choice.tsv or .order.tsv")
            continue
        columns = COLUMNS[game]
        with open(path, encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
            header = tuple(h.strip() for h in next(reader, None) or ())
            if header not in (columns, columns[:-2]):  # source and status may be left out
                report.errors.append(f"{path.name}: the header must be: {' '.join(columns)}")
                continue
            for number, cells in enumerate(reader, start=2):
                if not any(c.strip() for c in cells) or cells[0].startswith("#"):
                    continue
                origin = f"{path.name}:{number}"
                if len(columns) - 2 <= len(cells) < len(columns):
                    cells = cells + [""] * (len(columns) - len(cells))  # source and status may be left out
                if len(cells) != len(columns):
                    report.errors.append(f"{origin}: {len(cells)} columns instead of {len(columns)}")
                    continue
                c = {k: re.sub(r"\s+", " ", v).strip() for k, v in zip(columns, cells)}
                common = dict(key=c["key"], game=game, point=c["point"], difficulty=int(c["difficulty"]) if c["difficulty"].isdigit() else 0,
                              topic=c["topic"], form=c["form"].lower(), context_vi=c["context_vi"] or None,
                              sentence_vi=c["sentence_vi"], hint_vi=c["hint_vi"], explanation_vi=c["explanation_vi"],
                              source=c["source"] or DEFAULT_SOURCE, status=(c["status"] or "draft").lower(), origin=origin)
                if game == "choice":
                    options = [o.strip() for o in c["options"].split("|") if o.strip()]
                    prompt = c["prompt"]
                    sentence = prompt.replace(_BLANK, c["answer"], 1) if _BLANK in prompt else prompt
                    items.append(Item(**common, prompt=prompt, options=options, answer=c["answer"], sentence_en=sentence))
                else:
                    tokens = [t.strip() for t in c["tokens"].split("/") if t.strip()]
                    alternatives = [[t.strip() for t in alt.split("/") if t.strip()] for alt in c["alternatives"].split("|") if alt.strip()]
                    items.append(Item(**common, tokens=tokens, alternatives=alternatives, sentence_en=c["sentence_en"]))
    return items


def validate(items: list[Item], report: Report, flags: dict[str, str] | None = None) -> list[Item]:
    """Structural problems are errors (the question is dropped); quality problems are issues (it stays a draft)."""
    good: list[Item] = []
    keys: dict[str, str] = {}
    for it in items:
        problems = []
        for name in ("key", "point", "topic", "form", "sentence_en", "sentence_vi", "hint_vi", "explanation_vi"):
            if not getattr(it, name):
                problems.append(f"missing {name}")
        if it.key and not _KEY.match(it.key):
            problems.append(f"key “{it.key}”: lowercase letters, digits, “_”, “-”, “.” (3-59 characters)")
        if it.key in keys:
            problems.append(f"key “{it.key}” already used at {keys[it.key]}")
        point = POINT.get(it.point)
        if point is None:
            problems.append(f"unknown grammar point “{it.point}”")
        elif abs(it.difficulty - point["difficulty"]) > 1 or it.difficulty not in DIFFICULTIES:
            problems.append(f"difficulty {it.difficulty} is too far from the point's difficulty {point['difficulty']}")
        if it.topic and it.topic not in TOPIC_CODES and it.topic != "general":
            problems.append(f"unknown topic “{it.topic}”")
        if it.form not in FORMS:
            problems.append(f"form “{it.form}” is not one of {', '.join(FORMS)}")
        if it.status not in STATUSES:
            problems.append(f"status “{it.status}” is not one of {', '.join(STATUSES)}")
        for name, limit in (("context_vi", 200), ("prompt", 300), ("sentence_en", 300), ("sentence_vi", 300), ("hint_vi", 300),
                            ("explanation_vi", 500)):
            if len(getattr(it, name) or "") > limit:
                problems.append(f"{name} longer than {limit}")
        if it.game == "choice":
            problems += _choice_problems(it)
        else:
            problems += _order_problems(it)
        if problems:
            report.errors.extend(f"{it.origin}: {p}" for p in problems)
            continue
        keys[it.key] = it.origin
        good.append(it)

    # Copies: the same sentence, or the same sentence with only a name or a number changed.
    seen: dict[tuple, Item] = {}
    unique: list[Item] = []
    for it in good:
        exact = (it.game, normalize_order(it.sentence_en))
        if exact in seen:
            report.errors.append(f"{it.origin}: duplicate of {seen[exact].key} ({seen[exact].origin})")
            continue
        seen[exact] = it
        unique.append(it)
    good = unique
    by_signature: dict[tuple, Item] = {}
    names = _names(good)
    for it in good:
        sig = (it.game, _signature(it.sentence_en, names))
        if sig in by_signature:
            report.flag(it, f"near_duplicate: only a name or a number differs from {by_signature[sig].key}")
        else:
            by_signature[sig] = it
    by_point: dict[tuple, list[tuple[Item, set]]] = defaultdict(list)
    for it in good:
        words = _content_words(it.sentence_en)
        for other, other_words in by_point[(it.game, it.point)]:
            if len(words) >= 3 and len(words & other_words) / len(words | other_words) >= 0.85:
                report.flag(it, f"near_duplicate: almost the same sentence as {other.key}")
                break
        by_point[(it.game, it.point)].append((it, words))

    for it in good:
        _quality(it, report)
        if flags and it.key in flags:
            report.flag(it, f"reviewer_flag: {flags[it.key]}")
    return good


def _choice_problems(it: Item) -> list[str]:
    problems = []
    if not it.prompt or it.prompt.count(_BLANK) != 1:
        problems.append("the prompt must contain exactly one “___”")
    if not 3 <= len(it.options) <= 4:
        problems.append("a question needs 3 or 4 options")
    normalized = [normalize_text(o) for o in it.options]
    if len(set(normalized)) != len(normalized):
        problems.append("two options are the same")
    if not it.answer or normalize_text(it.answer) not in normalized:
        problems.append("the answer must be one of the options")
    if any(len(o) > 40 for o in it.options):
        problems.append("options longer than 40 characters")
    return problems


def _order_problems(it: Item) -> list[str]:
    problems = []
    if not 3 <= len(it.tokens) <= 12:
        problems.append("an order question needs 3 to 12 pieces")
    bad = [t for t in it.tokens if not _PIECE.match(t) or len(t) > 30]
    if bad:
        problems.append(f"pieces may only hold words (no punctuation): {bad}")
    if order_text(it.tokens) != normalize_order(it.sentence_en):
        problems.append("the pieces in their order must make sentence_en")
    if not re.search(r"[.?!]$", it.sentence_en):
        problems.append("sentence_en must end with . ? or !")
    base = Counter(normalize_order(t) for t in it.tokens)
    for alt in it.alternatives:
        if Counter(normalize_order(t) for t in alt) != base:
            problems.append(f"an alternative order does not use exactly the same pieces: {'/'.join(alt)}")
    if len(set(order_text(t) for t in it.tokens)) < 2:
        problems.append("the pieces can't be shuffled into a wrong order")
    return problems


_VI_LETTERS = re.compile(r"[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]", re.I)


def _quality(it: Item, report: Report) -> None:
    for name in ("sentence_vi", "hint_vi", "explanation_vi"):
        if not _VI_LETTERS.search(getattr(it, name) or ""):
            report.flag(it, f"not_vietnamese: {name} does not look like Vietnamese")
    if (it.form == "q") != it.sentence_en.rstrip().endswith("?"):
        report.flag(it, "form_mismatch: a question (form q) ends with “?”, and only a question does")
    if it.form == "neg" and not re.search(r"\b(not|n't|never|no|nobody|nothing|neither|nor|none|hardly|rarely|seldom)\b|n't",
                                          it.sentence_en, re.I):
        report.flag(it, "form_mismatch: a negative sentence has no negative word")
    if it.game == "choice":
        answer = normalize_text(it.answer or "")
        # A hint that names the answer gives it away (short answers like "a", "in" are only checked as whole words).
        if answer and re.search(rf"(?<![\w']){re.escape(answer)}(?![\w'])", normalize_text(it.hint_vi)):
            report.flag(it, "hint_gives_answer: the hint contains the answer")
        if not re.match(r"^[\"“‘'(]?[A-Z0-9_]", it.prompt or "") and not (it.prompt or "").startswith(_BLANK):
            report.flag(it, "prompt_format: the sentence must start with a capital letter")
        if not re.search(r"[.?!\"”]$", it.prompt or ""):
            report.flag(it, "prompt_format: the sentence must end with . ? or !")
    else:
        first = it.tokens[0] if it.tokens else ""
        if first[:1].isupper() and not re.match(r"^(I|I'm|I've|I'll|I'd)\b", first) and first.split()[0].lower() in COMMON_WORDS:
            report.flag(it, "capital_gives_order: the first piece keeps its capital letter")
        for alt in it.alternatives:
            if order_text(alt) == order_text(it.tokens):
                report.flag(it, "alternative_repeats_order: an alternative is the main order")


# Common function words: a piece starting with one of them in capitals would show which piece comes first.
COMMON_WORDS = {"a", "an", "the", "he", "she", "it", "we", "they", "you", "my", "your", "his", "her", "our", "their", "this",
                "that", "these", "those", "there", "do", "does", "did", "is", "are", "was", "were", "have", "has", "had", "will",
                "would", "can", "could", "should", "must", "may", "might", "what", "where", "when", "who", "why", "how",
                "which", "if", "although", "never", "not", "only", "hardly", "rarely", "had", "were", "should", "please",
                "let's", "don't", "doesn't", "didn't", "it's", "some", "many", "much", "every", "each", "all", "no", "our",
                "after", "before", "when", "while", "as", "because", "so", "but", "and", "yesterday", "today", "tomorrow",
                "last", "next", "in", "on", "at", "she's", "he's", "they're", "we're", "you're", "isn't", "aren't",
                "wasn't", "weren't", "haven't", "hasn't", "won't", "can't", "whose", "whom", "seldom", "not", "little",
                "despite", "unless", "however", "having", "being", "nobody", "everyone", "someone", "nothing", "everything"}


_CACHE: dict[tuple, tuple[list[Item], Report]] = {}


def check(paths: Iterable[Path] | None = None, *, flags_path: Path | None = None) -> tuple[list[Item], Report]:
    files = list(paths) if paths else bundled_files()
    flags = flags_path or FLAGS_FILE
    stamp = tuple((str(p), p.stat().st_mtime_ns, p.stat().st_size) for p in [*files, *([flags] if flags.exists() else [])])
    if stamp not in _CACHE:
        report = Report()
        items = validate(read_items(files, report), report, read_flags("grammar", flags))
        _CACHE.clear()
        _CACHE[stamp] = (items, report)
    items, report = _CACHE[stamp]
    return [replace(i) for i in items], report


def effective_status(item: Item, report: Report) -> str:
    if item.status in ("checked", "active") and report.issues.get(item.key):
        return "draft"
    return item.status


def promote(items: list[Item], report: Report, source: str, target: str) -> dict[str, str]:
    return {i.key: target for i in items if i.status == source and not report.issues.get(i.key)}


# ---------------------------------------------------------------------------------------------------------------
# Import (upsert by key, in bulk) and content releases
# ---------------------------------------------------------------------------------------------------------------

def import_items(db, items: list[Item], *, retire_missing: bool = False, report: Report | None = None) -> dict[str, int]:
    """Insert new keys, update changed ones (a content change is a new `content_version`), leave unchanged ones; never
    deletes (retire_missing only retires keys missing from the files: old sessions keep their frozen copies)."""
    from sqlalchemy import insert, select, update
    from .models import LearningGrammarItem, utcnow

    report = report or Report()
    existing = {key: (id_, digest, status, version) for key, id_, digest, status, version in db.execute(select(
        LearningGrammarItem.item_key, LearningGrammarItem.id, LearningGrammarItem.content_hash, LearningGrammarItem.status,
        LearningGrammarItem.content_version))}
    counts = Counter()
    inserts, updates = [], []
    now = utcnow()
    for it in items:
        digest, status = it.content_hash(), effective_status(it, report)
        notes = "; ".join(report.issues.get(it.key, [])) or None
        current = existing.get(it.key)
        if current is None:
            inserts.append({"item_key": it.key, "content_hash": digest, "status": status, "content_version": 1,
                            "review_notes": notes, "created_at": now, "updated_at": now, **it.values()})
            counts["inserted"] += 1
        elif current[1] != digest:
            updates.append({"id": current[0], "content_hash": digest, "status": status, "content_version": (current[3] or 1) + 1,
                            "review_notes": notes, "updated_at": now, **it.values()})
            counts["updated"] += 1
        elif current[2] != status:
            updates.append({"id": current[0], "status": status, "review_notes": notes, "updated_at": now})
            counts["status_changed"] += 1
        else:
            counts["unchanged"] += 1
    if inserts:
        db.execute(insert(LearningGrammarItem), inserts)
    if updates:
        db.execute(update(LearningGrammarItem), updates)
    if retire_missing:
        present = {it.key for it in items}
        gone = [{"id": id_, "status": "retired", "updated_at": now} for key, (id_, _, status, _) in existing.items()
                if key not in present and status != "retired"]
        if gone:
            db.execute(update(LearningGrammarItem), gone)
        counts["retired"] = len(gone)
    db.flush()
    return {k: v for k, v in counts.items() if v}


def import_bundled(db, *, force: bool = False) -> dict[str, int]:
    """Startup: import the bundled files (rows with errors are skipped and logged), once per version of the files."""
    def run():
        items, report = check()
        for error in report.errors[:20]:
            log.error("Grammar data: %s", error)
        counts = import_items(db, items, report=report)
        if counts.get("inserted") or counts.get("updated") or counts.get("status_changed"):
            log.info("Grammar bank: %s", counts)
        return counts
    return run() if force else import_once(db, "grammar", bundled_files(), run)


def record_release(db, bank: str) -> int | None:
    """Record the current published state of a bank (vocabulary or grammar) once; returns its id. A session keeps the
    release it was built from, next to the frozen copies of its questions."""
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError
    from .models import LearningContentRelease, LearningGrammarItem, LearningVocabEntry

    model, key = (LearningGrammarItem, LearningGrammarItem.item_key) if bank == "grammar" else \
        (LearningVocabEntry, LearningVocabEntry.entry_key)
    rows = db.execute(select(key, model.content_hash).where(model.status == "active").order_by(key)).all()
    digest = hashlib.sha256("\n".join(f"{k}:{h}" for k, h in rows).encode()).hexdigest()
    existing = db.scalar(select(LearningContentRelease.id).where(LearningContentRelease.bank == bank,
                                                                 LearningContentRelease.release_hash == digest))
    if existing is not None:
        return existing
    release = LearningContentRelease(bank=bank, release_hash=digest, counts_json=json.dumps({"active": len(rows)}))
    try:
        with db.begin_nested():
            db.add(release)
            db.flush()
    except IntegrityError:  # recorded by another process at the same moment
        return db.scalar(select(LearningContentRelease.id).where(LearningContentRelease.bank == bank,
                                                                 LearningContentRelease.release_hash == digest))
    return release.id


def current_release(db, bank: str) -> int | None:
    from sqlalchemy import select
    from .models import LearningContentRelease
    return db.scalar(select(LearningContentRelease.id).where(LearningContentRelease.bank == bank)
                     .order_by(LearningContentRelease.id.desc()).limit(1))


# ---------------------------------------------------------------------------------------------------------------
# Picking the questions of a stage (pure: unit-tested in tests/test_learning_grammar_bank.py)
# ---------------------------------------------------------------------------------------------------------------

PASS_SEEN = 24  # questions of a difficulty seen (or all of them) before moving on
PASS_RATE = 0.8  # first-try share needed to move on
MAX_PER_POINT = 3  # questions of one grammar point in a stage
MASTERED_ITEMS = 5  # different questions of a point answered right at the first try before it counts as mastered
MASTERED_SESSIONS = 2  # ...in at least this many different stages
RECENT_SESSIONS = 3  # questions and patterns of the last stages are not drawn again while others are left
STAGE_TURNS = {"choice": 12, "order": 10}


@dataclass(frozen=True)
class Question:
    key: str
    point: str
    difficulty: int
    pattern: str


@dataclass(frozen=True)
class History:
    attempts: int
    first_try: int
    last_seen: float = 0.0
    session: int = 0  # the stage it was last answered in


def working_difficulty(pool: list[Question], history: dict[str, History]) -> int:
    """The user's grammar level in one game: the first difficulty not yet passed, starting at 1. A difficulty is passed
    once enough of its questions were seen (PASS_SEEN, or all of them) with ≥ 80% right at the first try."""
    by_level: dict[int, list[Question]] = defaultdict(list)
    for q in pool:
        by_level[q.difficulty].append(q)
    levels = [d for d in DIFFICULTIES if by_level[d]]
    for d in levels:
        stats = [history[q.key] for q in by_level[d] if q.key in history]
        attempts = sum(h.attempts for h in stats)
        first = sum(h.first_try for h in stats)
        if len(stats) < min(PASS_SEEN, len(by_level[d])) or not attempts or first / attempts < PASS_RATE:
            return d
    return levels[-1] if levels else 1


def mastered_points(pool: list[Question], history: dict[str, History]) -> set[str]:
    """A grammar point is mastered once several *different* questions of it were answered right at the first try, in
    more than one stage, and most of its answers were right: one right sentence (or one good stage) is never mastery."""
    by_point: dict[str, list[History]] = defaultdict(list)
    for q in pool:
        if q.key in history:
            by_point[q.point].append(history[q.key])
    out = set()
    for point, stats in by_point.items():
        attempts = sum(h.attempts for h in stats)
        right = [h for h in stats if h.first_try]
        if len(right) >= MASTERED_ITEMS and len({h.session for h in right}) >= MASTERED_SESSIONS and attempts and \
                sum(h.first_try for h in stats) / attempts >= PASS_RATE:
            out.add(point)
    return out


def pick_questions(pool: list[Question], *, level: int, history: dict[str, History], review: set[str],
                   recent_items: set[str], recent_patterns: set[str], recent_points: Counter, mastered: set[str],
                   count: int, rng: random.Random) -> list[tuple[Question, str]]:
    """The questions of a stage: each at most once, one question per pattern, at most MAX_PER_POINT per grammar point.
    A few questions to review (wrong, hinted, revealed or missed before), one or two learned questions not seen for a
    while, then new questions at the user's difficulty, favouring points not yet mastered and not practised in the last
    stages. When new questions run out the stage becomes a purposeful review, never an empty stage; questions of the
    next difficulty only fill what the user's level can't, never two levels up."""
    eligible = [q for q in pool if q.difficulty <= level]
    if not eligible and pool:
        level = min(q.difficulty for q in pool)
        eligible = [q for q in pool if q.difficulty == level]
    unseen = [q for q in eligible if q.key not in history]
    stretch = [q for q in pool if q.difficulty == level + 1 and q.key not in history] if len(unseen) < count * 2 else []
    stretch.sort(key=lambda q: (q.pattern in recent_patterns, rng.random()))
    weak = [q for q in eligible if q.key in review]
    weak.sort(key=lambda q: (q.key in recent_items, history[q.key].last_seen if q.key in history else 0, rng.random()))
    weak_keys = {q.key for q in weak}
    learned = [q for q in eligible if q.key in history and q.key not in weak_keys and history[q.key].first_try]
    learned.sort(key=lambda q: (q.key in recent_items, history[q.key].last_seen, rng.random()))
    seen_rest = [q for q in eligible if q.key in history and q.key not in weak_keys and not history[q.key].first_try]
    seen_rest.sort(key=lambda q: (q.key in recent_items, history[q.key].last_seen, rng.random()))
    unseen.sort(key=lambda q: (q.pattern in recent_patterns, q.difficulty != level, q.point in mastered,
                               min(recent_points[q.point], 2), rng.random()))

    picked: list[tuple[Question, str]] = []
    used, patterns, per_point = set(), set(), Counter()

    def take(items: list[Question], reason: str, limit: int, strict: bool = True) -> None:
        for q in items:
            if len(picked) >= count or limit <= 0:
                return
            if q.key in used or (strict and (q.pattern in patterns or per_point[q.point] >= MAX_PER_POINT)):
                continue
            used.add(q.key)
            patterns.add(q.pattern)
            per_point[q.point] += 1
            picked.append((q, reason))
            limit -= 1

    take(weak, "review", max(1, count // 4))
    take([q for q in learned if q.key not in recent_items], "learned", max(1, count // 6))
    take([q for q in unseen if q.key not in recent_items], "new", count)
    take(weak, "review", count)  # not enough new questions: review on purpose
    take(seen_rest + learned, "learned", count)
    take(stretch, "new", count)
    for items, reason in ((weak, "review"), (unseen, "new"), (seen_rest + learned, "learned"), (stretch, "new")):
        take(items, reason, count, strict=False)  # a small bank: relax the variety rules, never repeat a question
    rng.shuffle(picked)
    return picked


# ---------------------------------------------------------------------------------------------------------------
# Building the turns of a stage (frozen as snapshots on the session)
# ---------------------------------------------------------------------------------------------------------------

def shuffled_tokens(tokens: list[str], accepted: list[str], rng: random.Random) -> list[str]:
    """The pieces in an order that is not already a right answer (when another order exists at all)."""
    out = list(tokens)
    right = set(accepted)
    for _ in range(50):
        rng.shuffle(out)
        if order_text(out) not in right:
            return out
    return out


def snapshot(lesson_code: str, row, reason: str, rng: random.Random) -> dict:
    """One turn from a bank row (a LearningGrammarItem). Option positions and piece order are shuffled here and the
    answer is stored as the id of the right option / the valid orders: the app only receives prompt and option ids."""
    point = POINT.get(row.point, {"name": row.point, "rule": ""})
    level = f"Mức {row.difficulty}"
    common_answer = {"display": row.sentence_en, "sentence_vi": row.sentence_vi, "item_key": row.item_key,
                     "point": row.point, "pattern": row.pattern, "difficulty": row.difficulty, "game": row.game,
                     "content_version": row.content_version or 1, "pick": reason}
    hints = [row.hint_vi, f"Cấu trúc: {point['rule']}"] if point["rule"] else [row.hint_vi]
    explanation = f"{row.explanation_vi} Nghĩa: {row.sentence_vi}"
    base = {"question_id": None, "question_key": f"{lesson_code}.{row.item_key}",
            "skill_key": f"en.grammar.{row.game}.{row.point}", "skill_label": point["name"][:120], "hints": hints,
            "explanation": explanation}
    if row.game == "choice":
        options = list(json.loads(row.options_json))
        rng.shuffle(options)
        ids = [f"o{i + 1}" for i in range(len(options))]
        right = next(ids[i] for i, text in enumerate(options) if normalize_text(text) == normalize_text(row.answer))
        prompt = {"sentence": row.prompt, "context_vi": row.context_vi, "level": level, "form": row.form,
                  "options": [{"id": ids[i], "text": text} for i, text in enumerate(options)]}
        return {**base, "kind": "gate_choice", "prompt": prompt,
                "answer": {**common_answer, "option": right, "text": row.answer}}
    accepted = json.loads(row.accepted_json)
    pieces = shuffled_tokens(json.loads(row.tokens_json), accepted, rng)
    prompt = {"tokens": [{"id": f"w{i + 1}", "text": text} for i, text in enumerate(pieces)], "meaning_vi": row.sentence_vi,
              "context_vi": row.context_vi, "end": end_mark(row.sentence_en), "level": level, "form": row.form}
    return {**base, "kind": "bridge_order", "prompt": prompt, "answer": {**common_answer, "accepted": accepted}}


def _recent(db, user_id: int, session_game: str, lesson_code: str) -> tuple[set[str], set[str], Counter]:
    """Questions, patterns and points of the user's last stages of this game."""
    from sqlalchemy import select
    from .models import LearningSession, LearningSessionItem
    ids = list(db.scalars(select(LearningSession.id).where(LearningSession.user_id == user_id, LearningSession.game == session_game)
                          .order_by(LearningSession.id.desc()).limit(RECENT_SESSIONS)))
    items, patterns, points = set(), set(), Counter()
    if ids:
        for answer_json in db.scalars(select(LearningSessionItem.answer_json).where(LearningSessionItem.session_id.in_(ids))):
            answer = json.loads(answer_json or "{}")
            if answer.get("item_key"):
                items.add(answer["item_key"])
                patterns.add(answer.get("pattern", ""))
                points[answer.get("point", "")] += 1
    return items, patterns, points


SESSION_GAME = {"choice": "gate", "order": "bridge"}


def stage_items(db, user_id: int, lesson_code: str, game: str, seed: int, count: int | None = None,
                review_keys: list[str] | None = None) -> list[dict]:
    """The turns of a grammar stage for this user, drawn from the active questions of the bank (see pick_questions).
    `review_keys` (question keys of the "cần ôn" list) builds a review stage of exactly those questions instead."""
    from sqlalchemy import select
    from .models import LearningGrammarItem, LearningItemHistory, LearningReviewItem, as_utc
    rng = random.Random(seed)
    count = count or STAGE_TURNS[game]
    prefix = lesson_code + "."
    if review_keys is not None:
        keys = [k[len(prefix):] for k in review_keys if k.startswith(prefix)]
        rows = {r.item_key: r for r in db.scalars(select(LearningGrammarItem).where(
            LearningGrammarItem.item_key.in_(keys), LearningGrammarItem.status.in_(("active", "retired"))))}
        out = [snapshot(lesson_code, rows[k], "review", rng) for k in keys if k in rows][:12]
        rng.shuffle(out)
        return out

    pool = [Question(k, p, d, pat) for k, p, d, pat in db.execute(
        select(LearningGrammarItem.item_key, LearningGrammarItem.point, LearningGrammarItem.difficulty, LearningGrammarItem.pattern)
        .where(LearningGrammarItem.game == game, LearningGrammarItem.status == "active").order_by(LearningGrammarItem.item_key))]
    if not pool:
        return []
    history = {h.item_key: History(h.attempts, h.first_try, as_utc(h.last_seen_at).timestamp() if h.last_seen_at else 0.0,
                                   h.last_session_id or 0)
               for h in db.scalars(select(LearningItemHistory).where(LearningItemHistory.user_id == user_id,
                                                                     LearningItemHistory.game == game))}
    review = {k[len(prefix):] for k in db.scalars(select(LearningReviewItem.question_key).where(
        LearningReviewItem.user_id == user_id, LearningReviewItem.status == "open",
        LearningReviewItem.skill_key.startswith(f"en.grammar.{game}.")))}
    recent_items, recent_patterns, recent_points = _recent(db, user_id, SESSION_GAME[game], lesson_code)
    picked = pick_questions(pool, level=working_difficulty(pool, history), history=history, review=review,
                            recent_items=recent_items, recent_patterns=recent_patterns, recent_points=recent_points,
                            mastered=mastered_points(pool, history), count=count, rng=rng)
    rows = {r.item_key: r for r in db.scalars(select(LearningGrammarItem).where(
        LearningGrammarItem.item_key.in_([q.key for q, _ in picked])))}
    return [snapshot(lesson_code, rows[q.key], reason, rng) for q, reason in picked]


def record_history(db, user_id: int, session_id: int, answer: dict, outcome: str, practice: bool, now) -> None:
    """Item history of a bank question, written with the confirmed answer. A re-practice after a mistake or a reveal
    only counts as corrected."""
    from sqlalchemy import select
    from .models import LearningItemHistory
    row = db.scalar(select(LearningItemHistory).where(LearningItemHistory.user_id == user_id,
                                                      LearningItemHistory.game == answer["game"],
                                                      LearningItemHistory.item_key == answer["item_key"]))
    if row is None:
        row = LearningItemHistory(user_id=user_id, game=answer["game"], item_key=answer["item_key"], point=answer["point"],
                                  difficulty=answer.get("difficulty") or 1, attempts=0, first_try=0, corrected=0, hinted=0,
                                  revealed=0, missed=0, wrong=0, first_session_id=session_id)
        db.add(row)
    row.attempts += 1
    counted = "corrected" if practice and outcome in ("first_try", "hinted", "corrected") else outcome
    if counted in ("first_try", "corrected", "hinted", "revealed", "missed", "wrong"):
        setattr(row, counted, getattr(row, counted) + 1)
    row.last_outcome, row.last_session_id, row.last_seen_at = counted, session_id, now


def point_progress(db, user_id: int) -> dict[str, dict]:
    """Per grammar point and game: different questions seen and right at the first try, and whether it is mastered."""
    from sqlalchemy import select
    from .models import LearningItemHistory
    stats: dict[str, dict] = defaultdict(lambda: {"questions": 0, "first_try_questions": 0, "attempts": 0, "first_try": 0,
                                                  "sessions": set()})
    for h in db.scalars(select(LearningItemHistory).where(LearningItemHistory.user_id == user_id)):
        s = stats[f"en.grammar.{h.game}.{h.point}"]
        s["questions"] += 1
        s["attempts"] += h.attempts
        s["first_try"] += h.first_try
        if h.first_try:
            s["first_try_questions"] += 1
            s["sessions"].add(h.last_session_id)
    for s in stats.values():
        s["mastered"] = (s["first_try_questions"] >= MASTERED_ITEMS and len(s.pop("sessions")) >= MASTERED_SESSIONS
                         and s["attempts"] > 0 and s["first_try"] / s["attempts"] >= PASS_RATE)
    return dict(stats)


def lesson_intro(snapshots: list[dict]) -> dict:
    """The lesson of a grammar stage: the rule of each point it practises (never a question or an answer)."""
    seen, rules = set(), []
    for snap in snapshots:
        point = POINT.get(snap.get("point") or "")
        if point and point["code"] not in seen:
            seen.add(point["code"])
            rules.append({"form": point["name"], "example": point["rule"]})
    return {"kind": "grammar", "title": "Ngữ pháp trong chặng này", "explanation": [
        "Mỗi chặng chọn câu hỏi theo trình độ của bạn: câu mới, câu cần ôn và câu đã học lâu chưa gặp lại."],
            "rules": rules, "examples": []}


# ---------------------------------------------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------------------------------------------

def summary(items: list[Item], report: Report) -> dict:
    status = Counter((i.game, effective_status(i, report)) for i in items)
    return {"items": len(items), "by_game": dict(Counter(i.game for i in items)),
            "by_game_status": {f"{g}.{s}": n for (g, s), n in sorted(status.items())},
            "by_form": dict(Counter((i.game + "." + i.form) for i in items)),
            "by_difficulty": dict(sorted(Counter(i.difficulty for i in items).items())),
            "points": len({i.point for i in items}), "topics": len({i.topic for i in items}),
            "issues": dict(Counter(p.split(":")[0] for problems in report.issues.values() for p in problems))}


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "check"
    paths = [Path(a) for a in argv[1:] if not a.startswith("--")] or None
    if command in ("check", "qa", "publish", "import"):
        items, report = check(paths)
        if "--quiet" not in argv:
            for key, problems in list(report.issues.items())[:300]:
                print("issue:", key, "—", "; ".join(problems))
        for e in report.errors:
            print("error:", e)
        print(f"{len(items)} valid questions, {len(report.errors)} error(s), {len(report.issues)} with quality issues")
        print(json.dumps(summary(items, report), ensure_ascii=False))
        if command == "check":
            per_point = Counter((i.point, i.game) for i in items)
            for code, d, name, _ in POINTS:
                if per_point[(code, "choice")] or per_point[(code, "order")]:
                    print(f"  d{d} {code:34} choice {per_point[(code, 'choice')]:4}  order {per_point[(code, 'order')]:4}")
            return 0 if report.ok else 1
        if command in ("qa", "publish"):
            changes = promote(items, report, "draft", "checked") if command == "qa" else promote(items, report, "checked", "active")
            print(f"{len(changes)} question(s) can move on.")
            if "--apply" in argv and changes:
                files = paths or bundled_files()
                for game in GAMES:
                    print(game, "rewritten:", set_statuses([p for p in files if game_of_file(p) == game], changes, COLUMNS[game]))
                _CACHE.clear()
            return 0
        from .db import SessionLocal, engine
        from . import models  # noqa: F401 (every table, for upgrade_schema)
        from .migrations import upgrade_schema
        upgrade_schema(engine)
        with SessionLocal() as db:
            counts = import_items(db, items, retire_missing="--retire-missing" in argv, report=report)
            db.commit()
        print("Imported:", counts)
        return 0
    if command == "report":
        from sqlalchemy import select
        from .db import SessionLocal
        from .models import LearningGrammarItem
        with SessionLocal() as db:
            data = db.execute(select(LearningGrammarItem.game, LearningGrammarItem.status, LearningGrammarItem.difficulty)).all()
        print("by game and status:", dict(Counter((g, s) for g, s, _ in data)))
        print("active by difficulty:", dict(sorted(Counter((g, d) for g, s, d in data if s == "active").items())))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":  # python -m app.learning_grammar_bank check|qa|publish|import|report
    logging.basicConfig(level=logging.INFO)
    sys.exit(main(sys.argv[1:]))
