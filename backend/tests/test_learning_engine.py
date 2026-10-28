"""Pure rules of the learning games: English answer checking, number parsing and deterministic Math generation."""
from decimal import Decimal
from fractions import Fraction

import pytest

from app.learning_engine import (InvalidAnswer, MASTERED_AT, bridge_sentence, check_bridge, check_choice, check_number,
                                 check_text, compare_error_type, correct_outcome, generate_math_items, mastery_after,
                                 math_error_type, missing_solutions, normalize_text, parse_number, score_for,
                                 DEFAULT_SCORING)
from app.learning_content import lesson_definitions

GENERATORS = [(d["topic"], d["game"]["generator"]) for d in lesson_definitions()["math"]]


# --- English -----------------------------------------------------------------------------------------------------

def test_text_answers_ignore_case_spacing_and_trailing_punctuation():
    assert normalize_text("  The   CAT  ") == "the cat"
    assert normalize_text("Don’t.") == "don't"
    assert check_text("  ELEPHANT ", ["elephant"])
    assert check_text("school   bag", ["schoolbag", "school bag"])
    assert not check_text("elefant", ["elephant"])


def test_declared_equivalent_answers_are_accepted_and_nothing_else():
    assert check_text("rubber", ["eraser", "rubber"])
    assert check_text("Bunny", ["rabbit", "bunny"])
    assert not check_text("hare", ["rabbit", "bunny"])


@pytest.mark.parametrize("blank", ["", "   ", "\t", "..."])
def test_empty_text_is_invalid_not_wrong(blank):
    with pytest.raises(InvalidAnswer):
        check_text(blank, ["cat"])


def test_bridge_accepts_every_declared_order_and_needs_every_token():
    tokens = [{"id": "w1", "text": "happy"}, {"id": "w2", "text": "I"}, {"id": "w3", "text": "today"}, {"id": "w4", "text": "am"}]
    accepted = ["I am happy today", "Today I am happy"]
    assert check_bridge(["w2", "w4", "w1", "w3"], tokens, accepted)
    assert check_bridge(["w3", "w2", "w4", "w1"], tokens, accepted)
    assert not check_bridge(["w1", "w2", "w4", "w3"], tokens, accepted)
    for incomplete in (["w2", "w4", "w1"], ["w2", "w4", "w1", "w1"], ["w2", "w4", "w1", "x9"]):
        with pytest.raises(InvalidAnswer):
            check_bridge(incomplete, tokens, accepted)


def test_bridge_with_repeated_words_uses_token_ids():
    tokens = [{"id": "w1", "text": "the"}, {"id": "w2", "text": "sun"}, {"id": "w3", "text": "the"}, {"id": "w4", "text": "rises"},
              {"id": "w5", "text": "in"}, {"id": "w6", "text": "east"}]
    assert bridge_sentence(["w3", "w2", "w4", "w5", "w1", "w6"], tokens) == "the sun rises in the east"
    assert check_bridge(["w1", "w2", "w4", "w5", "w3", "w6"], tokens, ["The sun rises in the east"])


def test_choice_must_be_one_of_the_options():
    options = [{"id": "o1", "text": "am"}, {"id": "o2", "text": "is"}]
    assert check_choice("o2", options, "o2") and not check_choice("o1", options, "o2")
    with pytest.raises(InvalidAnswer):
        check_choice("o9", options, "o2")


def test_every_seeded_word_has_its_answer_and_ambiguous_words_have_context():
    from app.learning_vocab import check
    rows, report = check()
    assert report.ok, report.errors
    for r in rows:
        assert r.word in r.accepted and r.example_en and r.example_vi
    words = {r.meaning_vi: r.context_vi for r in rows}
    assert words["cái bàn"] and words["con gà"]  # "bàn" could be desk or table; "gà" could be hen, rooster, chicken
    english = lesson_definitions()["english"]
    for lesson in english:
        for q in lesson["questions"]:
            if q["kind"] == "gate_choice":
                ids = [o["id"] for o in q["prompt"]["options"]]
                assert q["answer"]["option"] in ids
            if q["kind"] == "bridge_order":
                tokens = [{"id": str(i), "text": t} for i, t in enumerate(q["prompt"]["tokens"])]
                for sentence in q["answer"]["accepted"]:  # every declared order uses exactly the given words
                    assert sorted(normalize_text(sentence).split()) == sorted(normalize_text(t["text"]) for t in tokens)
    # Vocabulary lessons draw from the bank (no fixed word list in the code).
    vocab_lessons = [l for l in english if l["game"]["game_type"] == "meteor"]
    assert len(vocab_lessons) >= 10 and all(l["game"]["generator"]["vocab_bank"] is not None and not l["questions"] for l in vocab_lessons)


# --- Numbers -----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,value", [("12", "12"), (" 12 ", "12"), ("-3", "-3"), ("−3", "-3"), ("+4", "4"),
                                       ("2,5", "2.5"), ("2.5", "2.5"), ("007", "7")])
def test_numbers_are_parsed_not_evaluated(raw, value):
    assert parse_number(raw) == Decimal(value)


@pytest.mark.parametrize("raw", ["", " ", "1+1", "2*3", "__import__('os')", "12a", "1,2,3", "--1", "."])
def test_malformed_numbers_are_invalid(raw):
    with pytest.raises(InvalidAnswer):
        parse_number(raw)


def test_exact_unless_the_question_asks_for_rounding():
    assert check_number("2,50", "2.5")
    assert not check_number("2.49", "2.5")
    assert check_number("2.49", "2.5", tolerance="0.05")


# --- Math generation ---------------------------------------------------------------------------------------------

def precedence_value(expression: str) -> Fraction:
    """Independent reference evaluator (shunting-yard) for the rendered expressions. No eval."""
    text = expression.replace("−", "-").replace("×", "*").replace(":", "/")
    tokens, i = [], 0
    while i < len(text):
        ch = text[i]
        if ch == " ":
            i += 1
        elif ch.isdigit() or (ch == "-" and (not tokens or (isinstance(tokens[-1], str) and tokens[-1] in "(+-*/"))):
            j = i + 1
            while j < len(text) and text[j].isdigit():
                j += 1
            tokens.append(Fraction(int(text[i:j])))
            i = j
        else:
            tokens.append(ch)
            i += 1
    out, ops = [], []
    prec = {"+": 1, "-": 1, "*": 2, "/": 2}
    for tok in tokens:
        if isinstance(tok, Fraction):
            out.append(tok)
        elif tok == "(":
            ops.append(tok)
        elif tok == ")":
            while ops[-1] != "(":
                out.append(ops.pop())
            ops.pop()
        else:
            while ops and ops[-1] != "(" and prec[ops[-1]] >= prec[tok]:
                out.append(ops.pop())
            ops.append(tok)
    out += reversed(ops)
    stack = []
    for tok in out:
        if isinstance(tok, Fraction):
            stack.append(tok)
        else:
            b, a = stack.pop(), stack.pop()
            stack.append(a + b if tok == "+" else a - b if tok == "-" else a * b if tok == "*" else a / b)
    return stack[0]


def test_generation_is_deterministic_for_a_seed():
    for topic, g in GENERATORS:
        first = generate_math_items(1234, topic, g, 12)
        assert first == generate_math_items(1234, topic, g, 12)
        assert len(first) == 12
    topic, g = GENERATORS[0]
    assert generate_math_items(1, topic, g, 12) != generate_math_items(2, topic, g, 12)


@pytest.mark.parametrize("seed", range(40))
def test_generated_answers_match_an_independent_evaluation(seed):
    for topic, g in GENERATORS:
        for item in generate_math_items(seed, topic, g, 12):
            answer = item["answer"]
            if item["kind"] == "math_input":
                value = precedence_value(item["prompt"]["expression"])
                assert value.denominator == 1, item  # division is always exact
                assert value == int(answer["value"]), item
                if not g.get("allow_negative"):
                    assert int(answer["value"]) >= 0, item
            elif item["kind"] == "compare":
                left = precedence_value(item["prompt"]["left"])
                right = precedence_value(item["prompt"]["right"])
                assert answer["value"] == ("<" if left < right else ">" if left > right else "="), item
            else:
                equation = item["prompt"]["equation"].replace("__", f"({answer['value']})" if int(answer["value"]) < 0 else answer["value"])
                left, right = equation.split("=")
                assert precedence_value(left) == precedence_value(right), item


@pytest.mark.parametrize("seed", range(40))
def test_no_division_by_zero_and_missing_numbers_have_one_answer(seed):
    for topic, g in GENERATORS:
        for item in generate_math_items(seed, topic, g, 12):
            text = item["prompt"].get("expression") or item["prompt"].get("equation") or item["prompt"].get("left")
            assert ": 0 " not in text + " " and ": (−0" not in text
            if item["kind"] == "missing_number":
                a = item["answer"]
                found = missing_solutions(a["op"], a["slot"], a["a"], a["b"], a["c"], range(-2 * g["add_max"], 2 * g["add_max"] + 1))
                assert found == [int(a["value"])], item


def test_order_of_operations_hints_never_give_the_result():
    _, g = next(x for x in GENERATORS if x[0] == "order_of_operations")
    for item in generate_math_items(7, "order_of_operations", g, 12):
        final = item["answer"]["value"]
        assert all(not hint.rstrip().endswith(f"= {final}") for hint in item["hints"][1:]) or len(item["hints"]) == 1, item


def test_negative_operands_are_written_in_brackets():
    _, g = next(x for x in GENERATORS if x[1].get("allow_negative"))
    expressions = [i["prompt"]["expression"] for i in generate_math_items(3, "arithmetic", g, 60)]
    assert any("−" in e for e in expressions)
    for e in expressions:
        for op in (" + −", " − −", " × −", " : −"):
            assert op not in e, e


def test_error_types_are_classified_only_when_determinable():
    order_item = {"kind": "math_input", "answer": {"value": "14", "left_to_right": 20}}  # 2 + 3 × 4
    assert math_error_type(order_item, Decimal(20)) == "order_of_operations"
    assert math_error_type(order_item, Decimal(15)) is None
    sub = {"kind": "math_input", "answer": {"value": "18", "op": "sub", "operands": [45, 27]}}
    assert math_error_type(sub, Decimal(72)) == "wrong_operation"
    assert math_error_type(sub, Decimal(28)) == "borrow_error"
    assert math_error_type(sub, Decimal(-18)) == "sign_error"
    assert math_error_type(sub, Decimal(19)) == "off_by_one"
    missing = {"kind": "missing_number", "answer": {"value": "18", "wrong_inverse": 72}}
    assert math_error_type(missing, Decimal(72)) == "wrong_inverse_operation"
    assert compare_error_type({"answer": {"value": "<"}}, ">") == "reversed_sign"


# --- Scoring and mastery -----------------------------------------------------------------------------------------

def test_outcomes_scores_and_combo():
    assert correct_outcome(0, 0) == "first_try"
    assert correct_outcome(0, 1) == "hinted"
    assert correct_outcome(2, 1) == "corrected"
    points, combo = score_for("first_try", 2, DEFAULT_SCORING, practice_turn=False)
    assert (points, combo) == (100 + 3 * 20, 3)
    assert score_for("corrected", 4, DEFAULT_SCORING, practice_turn=False) == (40, 0)
    assert score_for("first_try", 4, DEFAULT_SCORING, practice_turn=True) == (20, 4)


def test_revealed_answers_never_build_mastery():
    value = 0
    for _ in range(20):  # reveal, then answer the re-practice correctly, over and over
        value = mastery_after(value, "revealed", practice_turn=False)
        value = mastery_after(value, "first_try", practice_turn=True)
    assert value < MASTERED_AT
    assert mastery_after(70, "first_try", practice_turn=False) == 90


# --- English grammar generator ----------------------------------------------------------------------------------

from app.learning_grammar import generate_grammar_items, third_person  # noqa: E402


@pytest.mark.parametrize("verb,form,rule", [("play", "plays", "s"), ("watch", "watches", "es"), ("fix", "fixes", "es"),
                                            ("go", "goes", "es"), ("fly", "flies", "ies"),
                                            ("have", "has", "irregular"), ("do", "does", "irregular"), ("study", "studies", "ies")])
def test_third_person_forms(verb, form, rule):
    assert third_person(verb) == (form, rule)


@pytest.mark.parametrize("point", ["to_be", "present_simple"])
@pytest.mark.parametrize("seed", range(30))
def test_generated_grammar_questions_are_consistent(point, seed):
    for item in generate_grammar_items(seed, point, "mixed", 12):
        answer = item["answer"]
        if item["kind"] == "gate_choice":
            options = {o["id"]: o["text"] for o in item["prompt"]["options"]}
            assert len(set(options.values())) == 3 and answer["option"] in options
            assert item["prompt"]["sentence"].replace("___", options[answer["option"]]) == answer["display"]
        else:
            tokens = item["prompt"]["tokens"]
            for sentence in answer["accepted"]:  # every accepted order uses exactly the given words
                assert sorted(normalize_text(sentence).split()) == sorted(normalize_text(t["text"]) for t in tokens)
            ordered = []
            pool = list(tokens)
            for word in answer["accepted"][0].split():
                token = next(t for t in pool if t["text"].lower() == word.lower())
                pool.remove(token)
                ordered.append(token["id"])
            assert check_bridge(ordered, tokens, answer["accepted"])
        assert item["explanation"] and item["prompt"]["meaning_vi"] and item["question_key"].startswith(item["skill_key"])


def test_grammar_is_random_per_session_and_deterministic_per_seed():
    first = generate_grammar_items(1, "present_simple", "mixed", 12)
    assert first == generate_grammar_items(1, "present_simple", "mixed", 12)
    other = generate_grammar_items(2, "present_simple", "mixed", 12)
    assert [i["answer"]["display"] for i in first] != [i["answer"]["display"] for i in other]
    assert len({i["answer"]["display"] for i in first}) == 12  # no sentence twice in a stage


def test_grammar_review_practises_only_the_weak_rule():
    items = generate_grammar_items(4, "present_simple", "mixed", 6, only_key="en.grammar.present_simple_s.ies")
    assert {i["question_key"] for i in items} == {"en.grammar.present_simple_s.ies"}
    assert all(any(w in i["answer"]["display"] for w in ("flies", "studies", "carries")) for i in items)
