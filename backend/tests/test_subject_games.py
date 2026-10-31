"""The subject gameplays (app/lesson_games.py): Hành trình dòng thời gian, Xây câu, Xưởng hình học, Cân bằng phương trình;
the game registry and audit (app/game_registry.py, app/game_audit.py); and the lessons that moved to them keep the
learners who had completed them (credit_from). Whole stages through the API: test_lesson_catalog.py plays every
published game, these included."""
import random
from fractions import Fraction

import pytest

from app import curriculum_games as cg, game_audit as ga, game_registry as gr, lesson_api, lesson_catalog as lc, lesson_games as lg
from app.learning_engine import InvalidAnswer

KINDS = lg.KINDS
GRADE7 = lc.limits(7)


def right(kind: str, prompt: dict, expected: dict):
    """A right answer to a frozen question, as the app sends it."""
    if kind == "timeline_place":
        return [f"{m}:{e}" for e, m in expected["marker_of"].items()]
    if kind == "sentence_build":
        ids: dict[str, list[str]] = {}
        for t in prompt["tiles"]:
            ids.setdefault(lg.normalize_text(t["text"]), []).append(t["id"])
        return [ids[lg.normalize_text(w)].pop(0) for w in expected["accepted"][0]]
    if kind == "geometry_build":
        target = expected["target"]
        if prompt["shape"] == "angle":
            return [f"angle:{target.get('degrees') or {'acute': 45, 'right': 90, 'obtuse': 120, 'straight': 180}[target['class']]}"]
        w, h = lg.rect_solutions(prompt["cols"], prompt["rows"], target)[0]
        return [f"rect:{w}x{h}"]
    if kind == "number_line_place":
        return [f"{p}:{t}" for p, t in expected["tick_of"].items()]
    if kind == "step_solve":  # the current step: the chips holding its numbers, the operator, the result
        values = {f"n{i + 1}": Fraction(lg.number(n)) for i, n in enumerate(expected["numbers"])}
        values.update({f"r{i + 1}": Fraction(p["result"]) for i, p in enumerate(expected["plan"][:prompt["at_step"] - 1])})
        plan = expected["plan"][prompt["at_step"] - 1]
        a, op, b = plan["expr"]
        chip = lambda v: next(c for c, x in values.items() if x == Fraction(v))  # noqa: E731
        return [chip(a), op, chip(b), lg.show(Fraction(plan["result"])).replace(" ", "")]
    if kind == "story_evidence":
        return [expected["evidence"][0]] if prompt["phase"] == "find" else [expected["right"]]
    if kind == "sentence_paint":
        return [f"{w}:c{r}" for w, r in expected["role_of"].items() if r] or ["none"]
    return [str(c) for c in expected["coefficients"]]


def snap(game: str, task: dict, seed: int = 1) -> tuple[dict, dict]:
    problems: list[str] = []
    assert lg.validate_task(game, task, GRADE7, "t", problems) is not None and not problems, problems
    s = lg.snapshot(game, task, random.Random(seed), "Test")
    return s["prompt"], s["answer"]


def check(prompt, expected, answer, kind):
    return cg.check(kind, prompt, expected, answer)


# ---------------------------------------------------------------------------------------------------------------
# Hành trình dòng thời gian
# ---------------------------------------------------------------------------------------------------------------

TIMELINE = {"key": "t", "prompt": "Đặt các sự kiện lên dòng thời gian.", "explanation": "…",
            "events": [{"text": "Ngô Quyền thắng Nam Hán", "year": 938}, {"text": "Nhà Lý dời đô", "year": 1010},
                       {"text": "Xây Văn Miếu", "year": 1070}, {"text": "Lập Quốc Tử Giám", "year": 1076}]}


def _by_text(prompt):
    return {e["text"]: e["id"] for e in prompt["events"]}


def test_timeline_markers_are_in_time_order_and_the_answer_is_never_sent():
    prompt, expected = snap("timeline", TIMELINE)
    assert [m["label"] for m in prompt["markers"]] == ["938", "1010", "1070", "1076"]
    assert all(m["slots"] == 1 for m in prompt["markers"])
    assert "marker_of" not in str(prompt) and "year" not in str(prompt["events"])
    assert check(prompt, expected, right("timeline_place", prompt, expected), "timeline_place")[0]


def test_timeline_wrong_keeps_the_events_on_their_right_marker():
    prompt, expected = snap("timeline", TIMELINE)
    ids = _by_text(prompt)
    m = [x["id"] for x in prompt["markers"]]
    answer = [f"{m[0]}:{ids['Ngô Quyền thắng Nam Hán']}", f"{m[1]}:{ids['Nhà Lý dời đô']}",
              f"{m[2]}:{ids['Lập Quốc Tử Giám']}", f"{m[3]}:{ids['Xây Văn Miếu']}"]
    ok, error, _, feedback = check(prompt, expected, answer, "timeline_place")
    assert not ok and error == "wrong_time" and "2/4" in feedback
    assert sorted(cg.kept("timeline_place", prompt, expected, answer)) == sorted(answer[:2])


def test_timeline_events_of_the_same_year_share_a_marker_in_either_order():
    task = {**TIMELINE, "events": [{"text": "A", "year": 1945, "label": "1945"}, {"text": "B", "year": 1945, "label": "1945"},
                                   {"text": "C", "year": 1954}]}
    prompt, expected = snap("timeline", task)
    assert [(m["label"], m["slots"]) for m in prompt["markers"]] == [("1945", 2), ("1954", 1)]
    ids, (m1, m2) = _by_text(prompt), [x["id"] for x in prompt["markers"]]
    for first, second in (("A", "B"), ("B", "A")):
        assert check(prompt, expected, [f"{m1}:{ids[first]}", f"{m1}:{ids[second]}", f"{m2}:{ids['C']}"], "timeline_place")[0]


def test_timeline_events_of_one_year_in_a_known_order_get_a_marker_each():
    task = {**TIMELINE, "events": [{"text": "Nhật đảo chính Pháp", "year": 1945, "seq": 1, "label": "9/3/1945"},
                                   {"text": "Giành chính quyền ở Hà Nội", "year": 1945, "seq": 2, "label": "19/8/1945"},
                                   {"text": "Tuyên ngôn Độc lập", "year": 1945, "seq": 3, "label": "2/9/1945"}]}
    prompt, expected = snap("timeline", task)
    assert [m["label"] for m in prompt["markers"]] == ["9/3/1945", "19/8/1945", "2/9/1945"]
    ids, m = _by_text(prompt), [x["id"] for x in prompt["markers"]]
    swapped = [f"{m[0]}:{ids['Giành chính quyền ở Hà Nội']}", f"{m[1]}:{ids['Nhật đảo chính Pháp']}", f"{m[2]}:{ids['Tuyên ngôn Độc lập']}"]
    assert not check(prompt, expected, swapped, "timeline_place")[0]


def test_timeline_before_the_common_era_and_hidden_years():
    task = {**TIMELINE, "years": "hidden", "events": [{"text": "Văn Lang", "year": -700, "label": "Thời Văn Lang"},
                                                      {"text": "Âu Lạc", "year": -208}, {"text": "Hoa Lư", "year": 968}]}
    prompt, _ = snap("timeline", task)
    assert prompt["years"] == "hidden" and [m["label"] for m in prompt["markers"]] == ["Thời Văn Lang", "208 TCN", "968"]


@pytest.mark.parametrize("answer", [
    [],  # nothing placed
    ["m1:e1"],  # not every event
    ["m1:e1", "m1:e2", "m3:e3", "m4:e4"],  # a marker over its one place
    ["m1:e1", "m2:e1", "m3:e3", "m4:e4"],  # an event twice
    ["m9:e1", "m2:e2", "m3:e3", "m4:e4"],  # an unknown marker
    ["m1e1", "m2:e2", "m3:e3", "m4:e4"],  # not marker:event
    "m1:e1",
])
def test_timeline_malformed_answers_are_refused_not_counted(answer):
    prompt, expected = snap("timeline", TIMELINE)
    with pytest.raises(InvalidAnswer):
        check(prompt, expected, answer, "timeline_place")


@pytest.mark.parametrize("events, message", [
    ([{"text": "A", "year": 1945}, {"text": "B", "year": 1945}, {"text": "C", "year": 1945}], "two different times"),
    ([{"text": "A", "year": 0}, {"text": "B", "year": 1}, {"text": "C", "year": 2}], "never 0"),
    ([{"text": "A", "year": 1}, {"text": "A", "year": 2}, {"text": "C", "year": 3}], "same text"),
    ([{"text": "A", "year": 1, "label": "x"}, {"text": "B", "year": 1, "label": "y"}, {"text": "C", "year": 3}], "same label"),
    ([{"text": "A", "year": 1}, {"text": "B", "year": 2}], "3–6 events"),
])
def test_the_timeline_validator(events, message):
    problems: list[str] = []
    lg.validate_task("timeline", {**TIMELINE, "events": events}, GRADE7, "t", problems)
    assert any(message in p for p in problems), problems


# ---------------------------------------------------------------------------------------------------------------
# Xây câu
# ---------------------------------------------------------------------------------------------------------------

SENTENCE = {"key": "s", "tiles": ["They", "didn't", "go", "to the museum."], "distractors": ["went"], "explanation": "didn't + V."}


def _ids(prompt, *texts):
    pool = {}
    for t in prompt["tiles"]:
        pool.setdefault(t["text"], []).append(t["id"])
    return [pool[x].pop(0) for x in texts]


def test_sentence_right_wrong_and_the_right_start_is_kept():
    prompt, expected = snap("sentence", SENTENCE)
    assert prompt["length"] == 4 and len(prompt["tiles"]) == 5 and "accepted" not in str(prompt)
    assert check(prompt, expected, _ids(prompt, "They", "didn't", "go", "to the museum."), "sentence_build")[0]
    wrong = _ids(prompt, "They", "didn't", "to the museum.", "go")
    ok, error, _, feedback = check(prompt, expected, wrong, "sentence_build")
    assert not ok and error == "wrong_order" and "vị trí 3" in feedback and "“to the museum.”" in feedback
    assert cg.kept("sentence_build", prompt, expected, wrong) == wrong[:2]


def test_sentence_a_distractor_is_named():
    prompt, expected = snap("sentence", SENTENCE)
    ok, error, _, feedback = check(prompt, expected, _ids(prompt, "They", "didn't", "went", "to the museum."), "sentence_build")
    assert not ok and error == "extra_word" and "“went”" in feedback


def test_sentence_the_same_word_twice_can_be_swapped():
    task = {"key": "s", "tiles": ["the", "cat", "saw", "the", "dog"], "explanation": "…"}
    prompt, expected = snap("sentence", task)
    the = [t["id"] for t in prompt["tiles"] if t["text"] == "the"]
    rest = {t["text"]: t["id"] for t in prompt["tiles"] if t["text"] != "the"}
    for a, b in (the, the[::-1]):
        assert check(prompt, expected, [a, rest["cat"], rest["saw"], b, rest["dog"]], "sentence_build")[0]


def test_sentence_several_right_orders():
    task = {"key": "s", "tiles": ["Yesterday", "I", "visited", "my grandparents"], "accepted": [["I", "visited", "my grandparents", "Yesterday"]],
            "explanation": "The time can open or close the sentence."}
    prompt, expected = snap("sentence", task)
    assert check(prompt, expected, _ids(prompt, "Yesterday", "I", "visited", "my grandparents"), "sentence_build")[0]
    assert check(prompt, expected, _ids(prompt, "I", "visited", "my grandparents", "Yesterday"), "sentence_build")[0]
    wrong = _ids(prompt, "I", "visited", "Yesterday", "my grandparents")
    assert not check(prompt, expected, wrong, "sentence_build")[0]
    assert cg.kept("sentence_build", prompt, expected, wrong) == wrong[:2]  # the longest right start of either order


def test_sentence_a_long_sentence_within_the_grade_limit():
    tiles = ["Mr Nam,", "whose son", "is a doctor,", "lives", "next door", "with his wife."]
    prompt, expected = snap("sentence", {"key": "s", "tiles": tiles, "distractors": ["who"], "explanation": "…"})
    assert check(prompt, expected, _ids(prompt, *tiles), "sentence_build")[0]
    problems: list[str] = []
    lg.validate_task("sentence", {"key": "s", "tiles": tiles + ["x", "y"], "explanation": "…"}, lc.limits(4), "s", problems)
    assert any("3–6 tiles" in p for p in problems)


@pytest.mark.parametrize("answer", [["t1", "t2", "t3"], ["t1", "t1", "t2", "t3"], ["t1", "t2", "t3", "t9"], "t1", []])
def test_sentence_malformed_answers_are_refused(answer):
    prompt, expected = snap("sentence", SENTENCE)
    with pytest.raises(InvalidAnswer):
        check(prompt, expected, answer, "sentence_build")


@pytest.mark.parametrize("task, message", [
    ({**SENTENCE, "distractors": ["go"]}, "same as a tile"),
    ({**SENTENCE, "accepted": [["They", "go", "didn't"]]}, "exactly the sentence's tiles"),
    ({**SENTENCE, "accepted": [["They", "didn't", "go", "to the museum."]]}, "listed twice"),
    ({**SENTENCE, "distractors": ["a", "b", "c"]}, "at most 2 distractors"),
])
def test_the_sentence_validator(task, message):
    problems: list[str] = []
    lg.validate_task("sentence", task, GRADE7, "s", problems)
    assert any(message in p for p in problems), problems


# ---------------------------------------------------------------------------------------------------------------
# Xưởng hình học
# ---------------------------------------------------------------------------------------------------------------

def angle(target, readout=True, step=5):
    return {"key": "g", "kind": "angle", "prompt": "Tạo góc.", "target": target, "readout": readout, "step": step, "explanation": "…"}


def test_an_angle_of_a_given_measure():
    prompt, expected = snap("geometry", angle({"degrees": 120}))
    assert prompt["shape"] == "angle" and "120" not in str({k: v for k, v in prompt.items() if k != "prompt"})
    assert check(prompt, expected, ["angle:120"], "geometry_build")[0]
    ok, error, given, feedback = check(prompt, expected, ["angle:115"], "geometry_build")
    assert not ok and error == "wrong_measure" and given == "115°" and "Mở rộng" in feedback


def test_without_a_readout_the_feedback_never_gives_the_measure_away():
    prompt, expected = snap("geometry", angle({"degrees": 45}, readout=False))
    _, _, _, feedback = check(prompt, expected, ["angle:60"], "geometry_build")
    assert "60" not in feedback and "lớn hơn 45°" in feedback


@pytest.mark.parametrize("cls, good, bad", [("acute", 85, 90), ("right", 90, 95), ("obtuse", 95, 180), ("straight", 180, 175)])
def test_an_angle_of_a_given_kind(cls, good, bad):
    prompt, expected = snap("geometry", angle({"class": cls}))
    assert check(prompt, expected, [f"angle:{good}"], "geometry_build")[0]
    ok, error, _, feedback = check(prompt, expected, [f"angle:{bad}"], "geometry_build")
    assert not ok and error == "wrong_class" and gr._fold(lg.ANGLE_RULE[cls][:8]) in gr._fold(feedback)


def test_an_angle_that_is_not_an_angle_yet_or_off_the_protractor():
    prompt, expected = snap("geometry", angle({"class": "acute"}))
    ok, error, _, _ = check(prompt, expected, ["angle:0"], "geometry_build")
    assert not ok and error == "invalid_shape"
    for answer in (["angle:181"], ["angle:33"], ["rect:2x3"], ["angle:"], ["angle:45", "angle:50"]):
        with pytest.raises(InvalidAnswer):
            check(prompt, expected, answer, "geometry_build")


def rect(target, grid=(10, 8)):
    return {"key": "r", "kind": "rect", "prompt": "Vẽ hình.", "grid": list(grid), "target": target, "explanation": "…"}


def test_a_rectangle_by_its_area_accepts_every_shape_that_has_it():
    prompt, expected = snap("geometry", rect({"area": 12}))
    for w, h in ((2, 6), (6, 2), (3, 4), (4, 3)):
        assert check(prompt, expected, [f"rect:{w}x{h}"], "geometry_build")[0]
    ok, error, _, feedback = check(prompt, expected, ["rect:3x5"], "geometry_build")
    assert not ok and error == "wrong_size" and "15 cm²" in feedback and "Cần diện tích 12 cm²" in feedback


def test_a_square_and_the_feedback_names_only_what_is_missing():
    prompt, expected = snap("geometry", rect({"perimeter": 20, "square": True}))
    assert check(prompt, expected, ["rect:5x5"], "geometry_build")[0]
    _, _, _, feedback = check(prompt, expected, ["rect:4x6"], "geometry_build")
    assert "hình vuông" in feedback and "chu vi" not in feedback.split("Cần")[1]  # 4 × 6 already has a 20 cm perimeter


def test_a_rectangle_with_no_area_or_bigger_than_the_grid():
    prompt, expected = snap("geometry", rect({"area": 12}))
    assert check(prompt, expected, ["rect:0x4"], "geometry_build")[1] == "invalid_shape"
    with pytest.raises(InvalidAnswer):
        check(prompt, expected, ["rect:11x1"], "geometry_build")


@pytest.mark.parametrize("task, message", [
    (rect({"area": 97}), "no rectangle"),
    (rect({"area": 12}, grid=(1, 8)), "grid is"),
    (angle({"degrees": 33}), "multiple of the step"),
    (angle({"degrees": 120, "class": "acute"}), "disagree"),
    (angle({"class": "reflex"}), "class must be"),
    ({"key": "x", "kind": "circle", "prompt": "…", "target": {}, "explanation": "…"}, "angle or rect"),
])
def test_the_geometry_validator(task, message):
    problems: list[str] = []
    lg.validate_task("geometry", task, GRADE7, "g", problems)
    assert any(message in p for p in problems), problems


# ---------------------------------------------------------------------------------------------------------------
# Cân bằng phương trình
# ---------------------------------------------------------------------------------------------------------------

def eq(reactants, products, coefficients):
    return {"key": "e", "reactants": reactants, "products": products, "coefficients": coefficients, "explanation": "…"}


def test_formulas_are_read_with_their_groups():
    assert lg.parse_formula("Ca(OH)2") == {"Ca": 1, "O": 2, "H": 2}
    assert lg.parse_formula("Fe2(SO4)3") == {"Fe": 2, "S": 3, "O": 12}
    for bad in ("Xx2", "H2O)", "(OH", "h2o", "", "H2 O"):
        with pytest.raises(ValueError):
            lg.parse_formula(bad)


def test_an_equation_is_balanced_by_the_atoms_not_by_the_expected_numbers():
    prompt, expected = snap("balance", eq(["Al", "O2"], ["Al2O3"], [4, 3, 2]))
    assert [s["atoms"] for s in prompt["species"]] == [{"Al": 1}, {"O": 2}, {"Al": 2, "O": 3}]
    assert "coefficients" not in str(prompt) and "4" not in str(prompt["species"])
    ok, _, given, _ = check(prompt, expected, ["4", "3", "2"], "equation_balance")
    assert ok and given == "4Al + 3O₂ → 2Al₂O₃"
    ok, error, _, feedback = check(prompt, expected, ["2", "3", "2"], "equation_balance")
    assert not ok and error == "unbalanced" and feedback == "Chưa cân bằng: Al vế trái 2, vế phải 4."


def test_balanced_but_not_the_smallest_numbers():
    prompt, expected = snap("balance", eq(["H2", "O2"], ["H2O"], [2, 1, 2]))
    ok, error, _, feedback = check(prompt, expected, ["4", "2", "4"], "equation_balance")
    assert not ok and error == "not_reduced" and "chia tất cả hệ số cho 2" in feedback


@pytest.mark.parametrize("answer", [["2", "1"], ["2", "1", "0"], ["2", "1", "13"], ["2", "1", "x"], "2 1 2"])
def test_coefficients_out_of_range_are_refused(answer):
    prompt, expected = snap("balance", eq(["H2", "O2"], ["H2O"], [2, 1, 2]))
    with pytest.raises(InvalidAnswer):
        check(prompt, expected, answer, "equation_balance")


@pytest.mark.parametrize("task, message", [
    (eq(["H2", "O2"], ["H2O"], [1, 1, 1]), "do not balance"),
    (eq(["H2", "O2"], ["H2O"], [4, 2, 4]), "not the smallest"),
    (eq(["H2", "O2"], ["H2O", "H2O2"], [3, 2, 2, 1]), "several unrelated ways"),
    (eq(["Na", "Cl2"], ["H2O"], [1, 1, 1]), "same elements"),
    (eq(["Zz"], ["Zz2"], [2, 1]), "unknown element"),
    (eq(["CuO", "H2"], ["Cu", "H2O"], [1, 1, 1, 1]), "nothing to do"),
])
def test_the_equation_validator(task, message):
    problems: list[str] = []
    lg.validate_task("balance", task, GRADE7, "e", problems)
    assert any(message in p for p in problems), problems


# ---------------------------------------------------------------------------------------------------------------
# The bundled lessons, the registry, the audit and completion
# ---------------------------------------------------------------------------------------------------------------

def test_every_bundled_question_of_the_subject_games_is_right_one_way_and_explained_the_other():
    played = set()
    for key, entry in lc.catalog()["lessons"].items():
        for spec in entry["lesson"].get("games", []):
            if spec["game"] not in lg.GAMES:
                continue
            played.add(spec["game"])
            for item in lc.stage_items(key, spec["game"], 3, {}, lambda *_: 1.0):
                kind, prompt, expected = item["kind"], item["prompt"], item["answer"]
                while step := lg.advance(kind, prompt, expected, right(kind, prompt, expected)):  # solved in steps
                    prompt = {**prompt, **step[0]}
                assert check(prompt, expected, right(kind, prompt, expected), kind)[0], (key, item["question_key"])
                assert item["explanation"] and item["question_key"].startswith(f"{key}:{spec['game']}:")
    assert played == set(lg.GAMES)


def test_the_lessons_that_moved_to_a_dedicated_gameplay():
    expect = {"ta7.qua_khu_don": "sentence", "lsdl9.duong_cuu_nuoc_cm8": "timeline", "toan4.goc": "geometry",
              "kh8.phuong_trinh_hoa_hoc": "balance"}
    for key, game in expect.items():
        entry = lc.lesson(key)
        assert game in {g["game"] for g in entry["lesson"]["games"]}, key
        assert ga.lesson_rows() and gr.fit(gr.activity_of(entry)[0], game) == "best", key
    assert "order" not in {g["game"] for g in lc.lesson("ta7.qua_khu_don")["lesson"]["games"]}


def test_a_lesson_completed_with_the_game_it_replaced_stays_completed():
    entry = lc.lesson("ta7.qua_khu_don")  # choice + sentence (credit_from: order)
    assert lesson_api.lesson_state(entry, {"choice": {"passed": True}, "order": {"passed": True, "stages": 1}})["status"] == "completed"
    assert lesson_api.lesson_state(entry, {"choice": {"passed": True}, "order": {"passed": False, "stages": 1}})["status"] == "in_progress"
    # Only the retired game was played (not passed): the lesson was started all the same.
    assert lesson_api.lesson_state(entry, {"order": {"passed": False, "stages": 2}})["status"] == "in_progress"
    math = lc.lesson("toan4.goc")  # choice + geometry (credit_from: choice): a new learner plays both
    assert lesson_api.lesson_state(math, {"choice": {"passed": True, "stages": 1}})["status"] == "completed"
    assert lesson_api.lesson_state(math, {"geometry": {"passed": True, "stages": 1}})["status"] == "in_progress"


def test_the_registry_knows_every_published_game_and_every_activity_names_known_gameplays():
    for game in lc.GAMES:
        assert gr.GAMEPLAYS[game]["status"] == gr.READY, game
    for activity, spec in gr.ACTIVITIES.items():
        assert set(spec["best"]) | set(spec["fits"]) <= set(gr.GAMEPLAYS), activity
    assert {d["code"] for d in gr.definitions() if d["status"] == gr.READY} == set(lc.GAMES)


def test_the_activity_is_declared_or_inferred_never_from_the_subject_alone():
    assert gr.activity_of(lc.lesson("ta7.qua_khu_don")) == ("grammar", True)
    assert gr.activity_of(lc.lesson("ta1.con_vat")) == ("vocabulary", False)
    assert gr.activity_of(lc.lesson("tv2.phan_biet_c_k"))[0] == "spelling"
    assert gr.activity_of(lc.lesson("ls10.su_lieu"))[0] == "history_sources"  # Lịch sử, but not a chronology
    assert gr.activity_of(lc.lesson("toan1.cong_10"))[0] == "arithmetic"
    assert gr.activity_of(lc.lesson("toan3.chu_vi"))[0] == "geometry"


def test_the_audit_finds_no_wrong_game_no_repeated_question_and_no_game_outside_its_grades():
    assert ga.main(["--strict"]) == 0
    rows = {r["key"]: r for r in ga.lesson_rows()}
    assert rows["lsdl9.duong_cuu_nuoc_cm8"]["status"] == "ok" and rows["toan4.goc"]["status"] == "ok"
    assert rows["kh8.phuong_trinh_hoa_hoc"]["lesson_status"] == "ready"
    doc = ga.markdown()
    assert "| Toán | 4 | Góc nhọn" in doc and "Cần xây dựng" in doc


def test_the_gameplays_endpoint(client):
    from conftest import bearer, login, register
    assert register(client, email="gp@example.com", age=12, school_grade="grade7").status_code == 201
    me = bearer(login(client, email="gp@example.com").json()["access_token"])
    data = client.get("/api/learning/gameplays", headers=me).json()
    by_code = {g["code"]: g for g in data["gameplays"]}
    assert by_code["timeline"]["status"] == "ready" and "chronology" in by_code["timeline"]["serves"]
    assert by_code["cell_builder"]["status"] == "planned"
    assert client.get("/api/learning/gameplays").status_code == 401
    detail = client.get("/api/learning/lesson-catalog/toan7.tong_ba_goc", headers=me).json()
    geometry = next(g for g in detail["games"] if g["game"] == "geometry")
    assert geometry["family"] == "geometry_build" and geometry["playable"]
