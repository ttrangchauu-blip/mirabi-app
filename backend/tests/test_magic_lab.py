"""Magic Lab (Phòng thí nghiệm, the lesson game "lab"): the content rules, the setup check and a whole stage."""
import copy
import itertools
import json
import random

import pytest
from sqlalchemy import select

from app import curriculum_games as cg, lesson_catalog as lc
from app.db import SessionLocal
from app.learning_engine import InvalidAnswer
from app.models import LearningSessionItem
from conftest import bearer, login, open_lessons, register
from test_lesson_catalog import lab_answer

_ids = itertools.count()


def eid() -> str:
    return f"lab-{next(_ids):08d}"


def lab_specs() -> list[tuple[str, dict]]:
    return [(key, spec) for key, entry in lc.catalog()["lessons"].items() for spec in entry["lesson"].get("games", [])
            if spec["game"] == "lab"]


def test_the_bundled_labs_cover_five_scenes_and_every_task_can_be_set_up():
    specs = lab_specs()
    assert {spec["scene"] for _, spec in specs} == {"circuit", "shadow", "water", "plant", "magnet"}
    assert {key for key, _ in specs} >= {"kh5.mach_dien", "kh5.dan_dien_cach_dien", "kh4.anh_sang", "kh4.chuyen_the_nuoc", "kh5.cay_con",
                                          "kh7.nam_cham"}
    for key, spec in specs:
        assert len(spec["tasks"]) >= lc.MIN_TASKS["lab"], key
        for task in spec["tasks"]:
            assert cg.lab_solvable(task["slots"]), (key, task["key"])
            # Something to find out: at least one part does not fit one of the slots.
            assert any(set(s["accept"]) != {p["key"] for p in task["parts"]} for s in task["slots"])


def _turn(lesson_key: str = "kh5.mach_dien", task_key: str = "mach_don", seed: int = 3) -> dict:
    spec = next(s for k, s in lab_specs() if k == lesson_key)
    task = next(t for t in spec["tasks"] if t["key"] == task_key)
    return cg.lab_experiment(task, random.Random(seed), spec["title"], spec["scene"])


def test_the_parts_are_shuffled_with_ids_that_say_nothing_and_the_answer_stays_on_the_server():
    turn = _turn()
    prompt = turn["prompt"]
    assert prompt["scene"] == "circuit" and [s["id"] for s in prompt["slots"]] == ["power", "lamp", "link"]
    assert [p["id"] for p in prompt["parts"]] == ["p1", "p2", "p3", "p4"]
    assert all(set(p) == {"id", "name", "art"} for p in prompt["parts"])  # no "why", no "accept"
    assert "accept" not in prompt and set(turn["answer"]["accept"]) == {"power", "lamp", "link"}
    water = _turn("kh4.chuyen_the_nuoc", "tan_da")["prompt"]
    assert (water["from"], water["to"]) == ("ice", "water")


def test_a_setup_works_only_with_a_right_part_everywhere_and_a_wrong_part_says_why():
    turn = _turn()
    prompt, expected = turn["prompt"], turn["answer"]
    right = lab_answer(expected["accept"])
    placed = dict(x.split(":") for x in right)
    ok, error, given, feedback = cg.check("lab_experiment", prompt, expected, right)
    assert ok and error is None and feedback is None and "Nguồn điện: Viên pin" in given
    wool = next(p["id"] for p in prompt["parts"] if p["name"] == "Sợi len")
    wrong = [f"{k}:{v}" for k, v in {**placed, "link": wool}.items()]
    ok, error, _, feedback = cg.check("lab_experiment", prompt, expected, wrong)
    assert not ok and error == "wrong_setup" and "cách điện" in feedback
    assert cg.kept("lab_experiment", prompt, expected, wrong) == ["power", "lamp"]  # what was right stays in place
    for bad in ([f"power:{placed['power']}"], [*right[:2], f"link:{placed['power']}"], [*right[:2], "link:p9"], ["p1"],
                {"power": "p1"}, [*right, right[0]]):
        with pytest.raises(InvalidAnswer):
            cg.check("lab_experiment", prompt, expected, bad)


def test_the_magnet_lab_pulls_only_magnetic_materials_and_says_why_a_metal_is_not_pulled():
    turn = _turn("kh7.nam_cham", "hai_vat")
    prompt, expected = turn["prompt"], turn["answer"]
    assert prompt["scene"] == "magnet" and [s["id"] for s in prompt["slots"]] == ["pull", "pull2"]
    by_name = {p["name"]: p["id"] for p in prompt["parts"]}
    right = [f"pull:{by_name['Đinh sắt']}", f"pull2:{by_name['Kẹp giấy bằng thép']}"]
    assert cg.check("lab_experiment", prompt, expected, right)[0]
    swapped = [f"pull:{by_name['Kẹp giấy bằng thép']}", f"pull2:{by_name['Đinh sắt']}"]
    assert cg.check("lab_experiment", prompt, expected, swapped)[0]  # either slot takes either magnetic object
    copper = [f"pull:{by_name['Đinh sắt']}", f"pull2:{by_name['Dây đồng']}"]
    ok, error, _, feedback = cg.check("lab_experiment", prompt, expected, copper)
    assert not ok and error == "wrong_setup" and "không có từ tính" in feedback
    assert cg.kept("lab_experiment", prompt, expected, copper) == ["pull"]


def test_the_validator_refuses_labs_that_cannot_be_set_up_or_teach_nothing():
    good = copy.deepcopy(next(s for k, s in lab_specs() if k == "kh5.mach_dien"))

    def problems(spec: dict) -> list[str]:
        out: list[str] = []
        lc._validate_tasks("lab", spec, 5, "x", out)
        return out

    assert problems(good) == []
    bad = copy.deepcopy(good)
    bad["scene"] = "volcano"
    assert any("scene must be" in p for p in problems(bad))
    bad = copy.deepcopy(good)
    bad["tasks"][0]["slots"][0]["accept"] = ["den"]
    bad["tasks"][0]["slots"][1]["accept"] = ["den"]
    assert any("no way to fill" in p for p in problems(bad))
    bad = copy.deepcopy(good)
    bad["tasks"][0]["parts"][0]["art"] = "dragon"
    assert any("no drawing" in p for p in problems(bad))
    bad = copy.deepcopy(good)
    task = bad["tasks"][2]  # one slot
    task["slots"][0]["accept"] = [p["key"] for p in task["parts"]]
    assert any("nothing to find out" in p for p in problems(bad))


def _expected(turn_id: str) -> dict:
    with SessionLocal() as db:
        item = db.scalar(select(LearningSessionItem).where(LearningSessionItem.turn_id == turn_id))
        return json.loads(item.answer_json)


def test_a_lab_stage_is_played_with_a_wrong_setup_explained_then_completed(client):
    register(client, "lab@example.com", age=11, school_grade="grade5")
    me = bearer(login(client, "lab@example.com").json()["access_token"])
    open_lessons(client, me, "kh5.dan_dien_cach_dien")
    res = client.post("/api/learning/lesson-catalog/kh5.dan_dien_cach_dien/play", headers={**me, "Idempotency-Key": eid()},
                      json={"game": "lab", "timezone": "Asia/Ho_Chi_Minh"})
    assert res.status_code in (200, 201), res.json()
    sid = res.json()["id"]
    session = client.post(f"/api/learning/sessions/{sid}/resume", headers=me, json={}).json()["session"]
    assert session["game"] == "lab" and session["open_turns"][0]["kind"] == "lab_experiment"
    first = True
    while not session["can_complete"]:
        turn = session["open_turns"][0]
        expected = _expected(turn["turn_id"])
        if first:  # one slot (the gap): an insulator first ends the experiment with the reason and the right setup
            insulator = next(p["id"] for p in turn["prompt"]["parts"] if p["id"] not in expected["accept"]["link"])
            res = client.post(f"/api/learning/sessions/{sid}/answer", headers=me,
                              json={"turn_id": turn["turn_id"], "answer": [f"link:{insulator}"], "client_event_id": eid()})
            body = res.json()["result"]
            assert body["correct"] is False and body["resolved"] and "cách điện" in body["feedback"]
            assert body["correct_answer"] and body["explanation"] and body["practice_added"]
            first = False
            session = res.json()["session"]
            continue
        res = client.post(f"/api/learning/sessions/{sid}/answer", headers=me,
                          json={"turn_id": turn["turn_id"], "answer": lab_answer(expected["accept"]), "client_event_id": eid()})
        assert res.status_code == 200, res.json()
        assert res.json()["result"]["correct"] and res.json()["result"]["explanation"]
        session = res.json()["session"]
    done = client.post(f"/api/learning/sessions/{sid}/complete", headers=me, json={}).json()["session"]
    assert done["status"] == "completed"
