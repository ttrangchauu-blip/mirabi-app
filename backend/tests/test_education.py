"""Locked school grade, automatic promotion on the school calendar and Kho lưu trữ học tập (education.py).

The clock is moved explicitly. No school calendar is bundled: the `school` fixture enters verified VN school years
(test dates, as an administrator would): 2026–2027 starts on 2026-08-31, 2027–2028 on 2027-08-30, 2028–2029 on
2028-08-28, 2029–2030 on 2029-08-27, 2030–2031 on 2030-08-26, 2031–2032 on 2031-08-25 (Asia/Ho_Chi_Minh).
The lesson tests use the small catalog of tests/data/catalog (Toán lớp 2, Tiếng Anh and Khoa học lớp 3)."""
import json
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func, inspect, select, text

from app import education
from app.config import settings
from app.db import SessionLocal
from app.migrations import upgrade_schema
from app.models import (AcademicCalendarChange, AcademicYearConfig, ExpEvent, GradePromotion, LearningNote, LearningSession,
                        LearningYearArchive, User, UserEducationProfile)
from conftest import bearer, login, register
from test_lesson_catalog import answer, fixture_catalog, finish, start  # noqa: F401 (fixture)

VN = timezone(timedelta(hours=7))


def at(y, m, d, hh=10, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=VN).astimezone(timezone.utc)


YEARS = {2026: "2026-08-31", 2027: "2027-08-30", 2028: "2028-08-28", 2029: "2029-08-27", 2030: "2030-08-26",
         2031: "2031-08-25"}


def calendar(region="VN", years=None, verified=True):
    """School years as an administrator enters them (with their decision), verified or not."""
    with SessionLocal() as db:
        for year, start in (years or YEARS).items():
            db.add(AcademicYearConfig(region=region, academic_year=year, timezone="Asia/Ho_Chi_Minh",
                                      school_start_date=date.fromisoformat(start), promotion_date=date.fromisoformat(start),
                                      source="Khung kế hoạch thời gian năm học (test)", decision_number=f"{year}/QĐ-TEST",
                                      verified=verified))
        db.commit()


@pytest.fixture()
def school(clock, client):
    """The clock at 2026-10-31 (school year 2026–2027) and verified VN school years."""
    clock.t = at(2026, 10, 31)
    calendar()
    return clock


def account(client, email="hoc@example.com", **profile):
    assert register(client, email=email, **profile).status_code == 201
    return bearer(login(client, email=email).json()["access_token"])


def state(client, me):
    res = client.get("/api/education", headers=me)
    assert res.status_code == 200, res.json()
    return res.json()


def promotions(user_email="hoc@example.com"):
    with SessionLocal() as db:
        uid = db.scalar(select(User.id).where(User.email == user_email))
        return [(r.kind, r.academic_year, r.from_grade, r.to_grade, r.skipped) for r in db.scalars(
            select(GradePromotion).where(GradePromotion.user_id == uid, GradePromotion.kind.in_(education.YEARLY_KINDS))
            .order_by(GradePromotion.id))]


# ---------- 1, 13: the grade is set at registration and cannot be changed by the app ----------

def test_registered_grade_is_locked_and_requests_cannot_switch_it(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    s = state(client, me)
    assert (s["grade"], s["grade_label"], s["academic_year_label"], s["locked"]) == ("grade2", "Lớp 2", "2026–2027", True)
    assert s["initial_grade"] == "grade2" and s["next_promotion"]["date"] == "2027-08-30" and s["next_promotion"]["to_grade"] == "grade3"
    # Cài đặt / Học tập: another grade is refused; the age alone can still be corrected.
    res = client.put("/api/profile/study", headers=me, json={"age": 8, "school_grade": "grade3"})
    assert res.status_code == 409 and res.json()["code"] == "grade_locked"
    res = client.put("/api/profile/study", headers=me, json={"age": 8, "school_grade": "grade2"})
    assert res.status_code == 200 and (res.json()["age"], res.json()["school_grade"]) == (8, "grade2")
    # Any content request naming another grade is refused, whatever the app sends.
    for url in ("/api/learning/programme?grade=grade3", "/api/learning/programme/subjects/science?grade=grade3",
                "/api/learning/catalog?grade=grade3", "/api/learning/lesson-catalog/kh3.vong_doi_cay"):
        res = client.get(url, headers=me)
        assert res.status_code == 403 and res.json()["code"] == "grade_locked", url
    res = client.post("/api/learning/play", headers=me, json={"game": "sorting", "grade": "grade3", "timezone": "UTC"})
    assert res.status_code == 403 and res.json()["code"] == "grade_locked"
    start(client, me, "kh3.vong_doi_cay", "order", expect=403)
    assert client.patch("/api/profile", headers=me, json={"school_grade": "grade5"}).json()["school_grade"] == "grade2"
    # The current grade itself is still accepted (older apps send it).
    assert client.get("/api/learning/programme?grade=grade2", headers=me).json()["grade"] == "grade2"
    assert client.get("/api/auth/me", headers=me).json()["school_grade"] == "grade2"


def test_unknown_region_and_outside_school_learners(client, school):
    assert register(client, email="x@example.com", age=7, school_grade="grade2", education_region="ZZ").status_code == 422
    adult = account(client, email="adult@example.com", age=30, school_grade="adult")
    s = state(client, adult)
    assert s["status"] == "outside_school" and s["next_promotion"] is None and s["progress"] is None
    school.t = at(2028, 10, 1)
    assert state(client, adult)["grade"] == "adult"  # no grade, no promotion
    assert client.get("/api/education/archives", headers=adult).json()["items"] == []


# ---------- 2, 3, 4: before the day, on the day, and never twice ----------

def test_promotion_happens_on_the_configured_day_and_only_once(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    school.t = at(2027, 6, 15)  # summer: the school year has ended but the next has not begun
    assert state(client, me)["grade"] == "grade2"
    school.t = at(2027, 8, 29, 23, 59)  # the evening before (Viet Nam time)
    s = state(client, me)
    assert (s["grade"], s["academic_year"]) == ("grade2", 2026) and s["celebration"] is None
    school.t = at(2027, 8, 30, 0, 1)  # promotion day, just after midnight in Viet Nam (still 29 Aug in UTC)
    s = state(client, me)
    assert (s["grade"], s["grade_label"], s["academic_year_label"]) == ("grade3", "Lớp 3", "2027–2028")
    assert s["celebration"]["message"] == "Chúc mừng! Bạn đã lên lớp 3!" and s["celebration"]["academic_year_label"] == "2027–2028"
    assert client.get("/api/auth/me", headers=me).json()["school_grade"] == "grade3"
    # Shown once: after "seen" no device shows it again.
    seen = client.post(f"/api/education/celebrations/{s['celebration']['id']}/seen", headers=me)
    assert seen.status_code == 200 and state(client, me)["celebration"] is None
    # Signing in again, reading again, the sweep: nothing moves twice.
    again = bearer(login(client, email="hoc@example.com").json()["access_token"])
    for _ in range(3):
        assert state(client, again)["grade"] == "grade3"
    assert education.sweep() == 0
    assert promotions() == [("promotion", 2027, "grade2", "grade3", True)]


def test_the_sweep_promotes_learners_who_do_not_open_the_app(client, school):
    account(client, age=6, school_grade="grade1")
    school.t = at(2027, 8, 30, 8)
    assert education.sweep() == 1
    with SessionLocal() as db:
        assert db.scalar(select(User.school_grade).where(User.email == "hoc@example.com")) == "grade2"
    assert education.sweep() == 0


# ---------- 5, 6, 7, 8: the new grade's content, the old year frozen, reviewing it apart ----------

def test_new_grade_content_frozen_archive_and_separate_reviews(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    lesson = "toan2.bang_nhan_2"
    session = start(client, me, lesson, "defense")
    turn = session["open_turns"][0]
    res = answer(client, me, session["id"], turn["turn_id"], "-1").json()  # one mistake, fixed right after
    assert res["result"]["correct"] is False, res
    finish(client, me, res["session"])
    finish(client, me, start(client, me, lesson, "match"))
    before = client.get(f"/api/learning/lesson-catalog/{lesson}", headers=me).json()
    assert before["progress"]["status"] in ("completed", "in_progress")
    review_before = client.get("/api/learning/review", headers=me).json()["total"]

    school.t = at(2027, 9, 2)
    s = state(client, me)
    assert s["grade"] == "grade3" and s["archives"] == 1
    # Học tập now only offers grade 3: its subjects, its lessons, no grade-2 lesson as current content.
    programme = client.get("/api/learning/programme", headers=me).json()
    assert programme["grade"] == "grade3" and programme["academic_year_label"] == "2027–2028" and programme["resume"] is None
    assert {x["code"]: x for x in programme["subjects"]}["science"]["name"] == "Tự nhiên và Xã hội"
    assert client.get("/api/learning/catalog", headers=me).json()["programme"]["grade"] == "grade3"
    assert client.get(f"/api/learning/lesson-catalog/{lesson}", headers=me).status_code == 403
    sci = client.get("/api/learning/lesson-catalog/kh3.vong_doi_cay", headers=me).json()
    assert sci["progress"]["status"] == "not_started"  # a fresh year
    assert s["progress"]["lessons_completed"] == 0

    # Kho lưu trữ: the grade-2 year with everything that was learned in it.
    cards = client.get("/api/education/archives", headers=me).json()
    assert cards["visible_years"] == 3
    assert [(c["academic_year_label"], c["grade_label"]) for c in cards["items"]] == [("2026–2027", "Lớp 2")]
    year = client.get("/api/education/archives/2026", headers=me).json()
    assert year["read_only"] and year["had_activity"] and year["stats"]["sessions"] == 2
    results = {(r["lesson"], r["game"]): r for r in year["lesson_results"]}
    assert results[(lesson, "defense")]["passed"] and results[(lesson, "match")]["completed"] == 1
    assert lesson in {k["key"] for k in year["knowledge"]}
    assert any(m["lesson"] == lesson for m in year["mistakes"])
    math = next(x for x in year["subjects"] if x["code"] == "math")
    assert math["started"] == 1 and math["chapters"][0]["lessons"][0]["key"] == lesson
    read = client.get(f"/api/education/archives/2026/lessons/{lesson}", headers=me).json()
    assert read["frozen"] and read["summary"] and {g["game"] for g in read["games"]} == {"defense", "match"}

    # Reviewing the old year: its own session kind, kept apart from the frozen results and from grade 3.
    res = client.post(f"/api/education/archives/2026/lessons/{lesson}/play", headers=me, json={"game": "match", "timezone": "UTC"})
    assert res.status_code == 201, res.json()
    assert res.json()["kind"] == "archive" and res.json()["archive_year"] == 2026
    replay = client.post(f"/api/learning/sessions/{res.json()['id']}/resume", headers=me, json={}).json()["session"]
    done = finish(client, me, replay)
    assert done["status"] == "completed" and done["reward"]["status"] == "not_eligible"
    after = client.get("/api/education/archives/2026", headers=me).json()
    assert after["lesson_results"] == year["lesson_results"] and after["stats"] == year["stats"]
    assert after["reviews"]["completed"] == 1
    assert review_before >= 1 and client.get("/api/learning/review", headers=me).json()["total"] == 0  # the old grade's left with it
    assert client.get("/api/education", headers=me).json()["progress"] == s["progress"]
    with SessionLocal() as db:
        archived = db.scalar(select(LearningSession).where(LearningSession.id == done["id"]))
        assert (archived.academic_year, archived.archive_year) == (2027, 2026)
    # Another user's archive is never readable.
    other = account(client, email="other@example.com", age=7, school_grade="grade2")
    assert client.get("/api/education/archives/2026", headers=other).status_code == 404
    assert client.post(f"/api/education/archives/2026/lessons/{lesson}/play", headers=other,
                       json={"game": "match"}).status_code == 404


# ---------- 9, 10, 12: three finished years at most; years away are caught up honestly ----------

def test_archive_keeps_the_three_most_recent_years_and_offline_years_are_caught_up(client, school):
    me = account(client, age=6, school_grade="grade1")
    school.t = at(2029, 10, 1)  # three school years without opening the app
    me = bearer(login(client, email="hoc@example.com").json()["access_token"])
    s = state(client, me)
    assert (s["grade_label"], s["academic_year_label"]) == ("Lớp 4", "2029–2030")
    assert s["celebration"]["grade_label"] == "Lớp 4"  # one celebration for where they are now
    items = client.get("/api/education/archives", headers=me).json()["items"]
    assert [(i["academic_year_label"], i["grade_label"]) for i in items] == [
        ("2028–2029", "Lớp 3"), ("2027–2028", "Lớp 2"), ("2026–2027", "Lớp 1")]
    assert not any(i["had_activity"] for i in items) and all(i["lessons_completed"] == 0 for i in items)  # nothing made up
    assert [p[4] for p in promotions()] == [True, True, True]  # skipped years are marked as such

    school.t = at(2030, 9, 1)
    assert state(client, me)["grade_label"] == "Lớp 5"
    items = client.get("/api/education/archives", headers=me).json()["items"]
    assert [i["grade_label"] for i in items] == ["Lớp 4", "Lớp 3", "Lớp 2"]  # Lớp 1 left the list...
    assert client.get("/api/education/archives/2026", headers=me).status_code == 404
    with SessionLocal() as db:  # ...but is not deleted (retention 0 keeps it)
        assert db.scalar(select(func.count()).select_from(LearningYearArchive)) == 4


def test_retention_deletes_only_archive_rows(client, school, monkeypatch):
    me = account(client, age=6, school_grade="grade1")
    school.t = at(2031, 9, 1)
    state(client, me)
    monkeypatch.setattr(settings, "learning_archive_retention_years", 3)
    education.sweep()
    with SessionLocal() as db:
        years = sorted(db.scalars(select(LearningYearArchive.academic_year)))
        assert years == [2028, 2029, 2030]
        assert db.scalar(select(User.school_grade).where(User.email == "hoc@example.com")) == "grade6"
        assert db.scalar(select(func.count()).select_from(GradePromotion).where(GradePromotion.kind == "promotion")) == 5


# ---------- 11: pets, EXP and everything else are untouched ----------

def test_promotion_keeps_pet_exp_and_achievements(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    client.put("/api/pet", headers=me, json={"pet": "fox", "name": "Mimi"})
    finish(client, me, start(client, me, "toan2.bang_nhan_2", "defense"))
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "hoc@example.com"))
        before = (user.xp, user.level, user.pet, user.pet_name, user.coins, user.gems)
        events = db.scalar(select(func.count()).select_from(ExpEvent).where(ExpEvent.user_id == user.id))
    assert before[0] > 0
    school.t = at(2027, 9, 1)
    assert state(client, me)["grade"] == "grade3"
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "hoc@example.com"))
        assert (user.xp, user.level, user.pet, user.pet_name, user.coins, user.gems) == before
        assert db.scalar(select(func.count()).select_from(ExpEvent).where(ExpEvent.user_id == user.id)) == events
    assert client.get("/api/learning/vocabulary/history?filter=all", headers=me).status_code == 200


# ---------- 14: no race, no duplicate ----------

def test_a_stale_or_concurrent_promotion_never_duplicates(client, school):
    account(client, age=6, school_grade="grade1")
    school.t = at(2027, 9, 1)
    with SessionLocal() as one, SessionLocal() as two:
        uid = one.scalar(select(User.id).where(User.email == "hoc@example.com"))
        one.get(UserEducationProfile, uid)  # read before the other one promotes
        education.sync(two, two.get(User, uid))
        with pytest.raises(education._LostRace):  # closing the same year again is refused, not repeated
            education._close_year(one, uid, 2026, school.now())
        one.rollback()

    school.t = at(2026, 10, 31)
    account(client, email="race@example.com", age=6, school_grade="grade1")
    school.t = at(2028, 9, 1)
    errors = []

    def run():
        try:
            with SessionLocal() as db:
                education.sync(db, db.scalar(select(User).where(User.email == "race@example.com")))
        except Exception as exc:  # SQLite may make a writer wait; it must never create a duplicate
            errors.append(exc)
    threads = [threading.Thread(target=run) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    with SessionLocal() as db:
        db.expire_all()
        user = db.scalar(select(User).where(User.email == "race@example.com"))
        if user.school_grade != "grade3":  # a thread that waited too long: the next request finishes the job
            education.sync(db, user)
        assert db.get(UserEducationProfile, user.id).current_grade == "grade3", errors
    assert promotions("race@example.com") == [("promotion", 2027, "grade1", "grade2", True), ("promotion", 2028, "grade2", "grade3", True)]
    with SessionLocal() as db:
        uid = db.scalar(select(User.id).where(User.email == "race@example.com"))
        assert sorted(db.scalars(select(LearningYearArchive.academic_year).where(LearningYearArchive.user_id == uid))) == [2026, 2027]


def test_a_stage_being_played_finishes_first(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    school.t = at(2027, 8, 29, 23, 50)
    session = start(client, me, "toan2.bang_nhan_2", "defense")
    school.t = at(2027, 8, 30, 0, 5)
    s = state(client, me)
    assert s["grade"] == "grade2" and s["promotion_pending"]
    resumed = client.post(f"/api/learning/sessions/{session['id']}/resume", headers=me, json={})  # paused while away
    done = finish(client, me, resumed.json()["session"])
    assert done["status"] == "completed"
    s = state(client, me)
    assert s["grade"] == "grade3" and not s["promotion_pending"]
    year = client.get("/api/education/archives/2026", headers=me).json()
    assert year["stats"]["stages_completed"] == 1  # the stage finished after midnight still counts for grade 2


# ---------- 15: học lại, region change, end of the programme, verified correction ----------

@pytest.fixture()
def admin(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_emails", "admin@example.com")
    return account(client, email="admin@example.com")


def test_repeat_a_grade_through_verified_support(client, school, admin):
    me = account(client, age=7, school_grade="grade2")
    uid = client.get("/api/auth/me", headers=me).json()["id"]
    body = {"reason": "Phụ huynh xác nhận học lại lớp 2", "verification": "TICKET-123"}
    assert client.post(f"/api/admin/education/users/{uid}/repeat", headers=me, json=body).status_code == 403  # not an admin
    res = client.post(f"/api/admin/education/users/{uid}/repeat", headers=admin, json=body)
    assert res.status_code == 200 and res.json()["next_promotion"]["to_grade"] == "grade2"
    school.t = at(2027, 9, 1)
    s = state(client, me)
    assert (s["grade"], s["academic_year"], s["celebration"]) == ("grade2", 2027, None)
    assert promotions()[-1][:4] == ("repeat", 2027, "grade2", "grade2")
    school.t = at(2028, 9, 1)  # the hold was for one year only
    assert state(client, me)["grade"] == "grade3"
    assert [i["academic_year"] for i in client.get("/api/education/archives", headers=me).json()["items"]] == [2027, 2026]


def test_changing_region_never_promotes_twice_nor_moves_back(client, school, admin, monkeypatch):
    regions = {"VN": education.regions()["VN"], "XX": {"name": "Test", "curriculum": "GDPT2018", "timezone": "Asia/Ho_Chi_Minh",
                                                       "years": []}}
    monkeypatch.setattr(education, "calendar_file", lambda: {"regions": regions})
    calendar("XX", {y: f"{y}-09-15" for y in range(2026, 2031)})
    me = account(client, age=7, school_grade="grade2")
    uid = client.get("/api/auth/me", headers=me).json()["id"]
    school.t = at(2027, 9, 1)
    assert state(client, me)["grade"] == "grade3"  # VN: 2027–2028 began on 30 Aug
    res = client.post(f"/api/admin/education/users/{uid}/region", headers=admin,
                      json={"region": "XX", "reason": "Chuyển trường sang vùng khác", "verification": "TICKET-9"})
    assert res.status_code == 200 and res.json()["region"] == "XX"
    for day in (5, 16, 30):  # XX begins 2027–2028 on 15 Sep: already there, so nothing happens
        school.t = at(2027, 9, day)
        s = state(client, me)
        assert (s["grade"], s["academic_year"]) == ("grade3", 2027)
    school.t = at(2028, 9, 10)  # VN would have promoted on 28 Aug; XX waits until 15 Sep
    assert state(client, me)["grade"] == "grade3"
    school.t = at(2028, 9, 15)
    assert state(client, me)["grade"] == "grade4"
    assert [p[1] for p in promotions()] == [2027, 2028]


def test_the_last_grade_completes_the_programme(client, school):
    me = account(client, age=17, school_grade="grade12")
    assert state(client, me)["next_promotion"]["completes"]
    school.t = at(2027, 9, 1)
    s = state(client, me)
    assert (s["grade"], s["status"]) == ("grade12", "completed")
    assert s["celebration"]["message"] == "Chúc mừng! Bạn đã hoàn thành chương trình Lớp 12!"
    school.t = at(2029, 9, 1)
    assert state(client, me)["academic_year"] == 2027  # no grade that does not exist, no further years closed
    assert promotions() == [("completed", 2027, "grade12", "grade12", True)]
    assert [i["grade_label"] for i in client.get("/api/education/archives", headers=me).json()["items"]] == ["Lớp 12"]


def test_a_wrong_grade_is_corrected_only_by_verified_support(client, school, admin):
    me = account(client, age=8, school_grade="grade2")
    uid = client.get("/api/auth/me", headers=me).json()["id"]
    assert client.post(f"/api/admin/education/users/{uid}/grade", headers=admin, json={"grade": "grade3", "reason": "x"}).status_code == 422
    res = client.post(f"/api/admin/education/users/{uid}/grade", headers=admin,
                      json={"grade": "grade3", "reason": "Đăng ký nhầm lớp, phụ huynh xác nhận", "verification": "TICKET-77"})
    assert res.status_code == 200 and (res.json()["grade"], res.json()["initial_grade"]) == ("grade3", "grade3")
    assert state(client, me)["celebration"] is None
    kinds = [h["kind"] for h in client.get(f"/api/admin/education/users/{uid}/history", headers=admin).json()["items"]]
    assert kinds == ["enrollment", "correction"]


CAL = {"region": "VN", "academic_year": 2027, "school_start_date": "2027-08-23", "opening_date": "2027-09-06",
       "source": "Khung kế hoạch thời gian năm học 2027–2028", "decision_number": "1234/QĐ-BGDĐT", "verified": True,
       "reason": "Theo quyết định của Bộ"}


def test_the_calendar_is_configured_verified_and_audited(client, school, admin):
    assert client.get("/api/education/calendar/current").json()["academic_year_label"] == "2026–2027"
    res = client.put("/api/admin/education/calendar", headers=admin, json=CAL)
    body = res.json()
    assert res.status_code == 200 and body["promotion_date"] == "2027-08-23" and body["verified"]
    assert body["decision_number"] == "1234/QĐ-BGDĐT" and body["verified_at"] and body["verified_by"]
    for bad, code in (({"school_start_date": "2028-02-01"}, "invalid_calendar"), ({"opening_date": "2027-08-01"}, "invalid_calendar"),
                      ({"decision_number": ""}, "verification_incomplete"), ({"source": None}, "verification_incomplete")):
        res = client.put("/api/admin/education/calendar", headers=admin, json={**CAL, **bad})
        assert res.status_code == 422 and res.json()["code"] == code, bad
    assert client.put("/api/admin/education/calendar", headers=admin, json={**CAL, "reason": ""}).status_code == 422  # a reason is required
    me = account(client, age=6, school_grade="grade1")
    school.t = at(2027, 8, 24)
    assert state(client, me)["grade"] == "grade2"  # the edited date (23 Aug), not the one entered before (30 Aug)
    detail = client.get("/api/admin/education/calendar?region=VN", headers=admin).json()
    change = detail["changes"][0]
    assert (change["academic_year"], change["actor"], change["reason"]) == (2027, "admin@example.com", "Theo quyết định của Bộ")
    assert change["before"]["promotion_date"] == "2027-08-30" and change["after"]["promotion_date"] == "2027-08-23"
    with SessionLocal() as db:  # the seed never adds guessed dates nor overwrites an administrator's row
        education.seed_calendar(db)
        db.commit()
        assert education.verified_start(db, "VN", 2027).isoformat() == "2027-08-23"
        assert db.scalar(select(func.count()).select_from(AcademicCalendarChange)) == 1


# ---------- the calendar must be verified ----------

def test_no_promotion_on_an_unverified_calendar_and_admins_are_told(client, clock, admin):
    clock.t = at(2026, 10, 31)
    calendar(years={2026: YEARS[2026]})
    calendar(years={2027: YEARS[2027]}, verified=False)  # entered, not checked against the decision yet
    me = account(client, age=7, school_grade="grade2")
    s = state(client, me)
    assert s["next_promotion"]["date"] is None and not s["next_promotion"]["confirmed"]  # no guessed date announced
    clock.t = at(2027, 9, 10)  # the year has begun by its dates
    for _ in range(2):
        bearer(login(client, email="hoc@example.com").json()["access_token"])
        s = state(client, me)
        assert (s["grade"], s["academic_year"], s["awaiting_calendar"]) == ("grade2", 2026, True)
    assert education.sweep() == 0 and promotions() == []
    alerts = client.get("/api/admin/education/alerts", headers=admin).json()
    assert {(a["label"], a["level"], a["waiting"]) for a in alerts} >= {("2027–2028", "overdue", 1)}
    detail = client.get(f"/api/admin/education/users/{client.get('/api/auth/me', headers=me).json()['id']}", headers=admin).json()
    assert detail["awaiting_calendar"] == "2027–2028" and detail["can_promote"]
    # Verified: the next request promotes, once.
    client.put("/api/admin/education/calendar", headers=admin, json={**CAL, "school_start_date": YEARS[2027]})
    s = state(client, me)
    assert (s["grade"], s["awaiting_calendar"]) == ("grade3", False)
    assert state(client, me)["grade"] == "grade3" and promotions() == [("promotion", 2027, "grade2", "grade3", True)]


def test_a_year_without_any_calendar_never_promotes(client, clock):
    clock.t = at(2026, 10, 31)
    me = account(client, age=7, school_grade="grade2")
    assert state(client, me)["academic_year_label"] == "2026–2027"  # named by the expected start (5 Sep) only
    clock.t = at(2028, 10, 1)
    s = state(client, me)
    assert (s["grade"], s["academic_year"], s["awaiting_calendar"]) == ("grade2", 2026, True)


def test_an_admin_confirms_a_promotion_while_the_calendar_waits(client, clock, admin):
    clock.t = at(2026, 10, 31)
    me = account(client, age=7, school_grade="grade2")
    uid = client.get("/api/auth/me", headers=me).json()["id"]
    body = {"reason": "Nhà trường xác nhận đã lên lớp 3", "verification": "TICKET-5"}
    res = client.post(f"/api/admin/education/users/{uid}/promote", headers=admin, json=body)
    assert res.status_code == 409 and res.json()["code"] == "school_year_not_started"
    clock.t = at(2027, 9, 10)
    res = client.post(f"/api/admin/education/users/{uid}/promote", headers=admin, json=body)
    assert res.status_code == 200 and res.json()["grade"] == "grade3"
    again = client.post(f"/api/admin/education/users/{uid}/promote", headers=admin, json=body)
    assert again.status_code == 409 and again.json()["code"] == "school_year_not_started"  # never twice
    history = client.get(f"/api/admin/education/users/{uid}", headers=admin).json()["history"]
    assert [(h["kind"], h["actor"]) for h in history] == [("enrollment", None), ("promotion", "admin@example.com")]
    assert "TICKET-5" in history[-1]["reason"]
    assert state(client, me)["celebration"]["grade_label"] == "Lớp 3"
    assert client.get("/api/education/archives", headers=me).json()["items"][0]["grade_label"] == "Lớp 2"


ADMIN_CALLS = [("get", "/api/admin/education/regions", None), ("get", "/api/admin/education/alerts", None),
               ("get", "/api/admin/education/calendar", None), ("put", "/api/admin/education/calendar", CAL),
               ("get", "/api/admin/education/users?q=hoc", None), ("get", "/api/admin/education/users/{uid}", None),
               ("get", "/api/admin/education/users/{uid}/history", None),
               ("post", "/api/admin/education/users/{uid}/grade", {"grade": "grade5", "reason": "Tự đổi lớp", "verification": "none"}),
               ("post", "/api/admin/education/users/{uid}/repeat", {"reason": "Tự học lại", "verification": "none"}),
               ("post", "/api/admin/education/users/{uid}/promote", {"reason": "Tự lên lớp", "verification": "none"}),
               ("post", "/api/admin/education/users/{uid}/region", {"region": "VN", "reason": "Tự đổi vùng", "verification": "none"})]


def test_only_admins_can_use_the_admin_api(client, school):
    me = account(client, age=7, school_grade="grade2")
    uid = client.get("/api/auth/me", headers=me).json()["id"]
    for method, url, body in ADMIN_CALLS:
        url = url.format(uid=uid)
        kwargs = {"json": body} if body else {}
        res = getattr(client, method)(url, headers=me, **kwargs)
        assert res.status_code == 403 and res.json()["code"] == "admin_required", url
        assert getattr(client, method)(url, **kwargs).status_code == 401, url  # not signed in
    assert state(client, me)["grade"] == "grade2"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AcademicCalendarChange)) == 0


def test_admin_finds_a_learner_and_sees_who_changed_what(client, school, admin):
    me = account(client, email="minh.anh@example.com", age=7, school_grade="grade2")
    found = client.get("/api/admin/education/users?q=MINH", headers=admin).json()["items"]
    assert [(u["email"], u["grade_label"], u["academic_year_label"], u["region"]) for u in found] == [
        ("minh.anh@example.com", "Lớp 2", "2026–2027", "VN")]
    uid = found[0]["id"]
    client.post(f"/api/admin/education/users/{uid}/repeat", headers=admin, json={"reason": "Học lại lớp 2", "verification": "T-1"})
    history = client.get(f"/api/admin/education/users/{uid}", headers=admin).json()["history"]
    assert history[-1]["kind"] == "repeat_request" and history[-1]["actor"] == "admin@example.com" and history[-1]["at"]
    assert client.get("/api/admin/education/users?q=x", headers=admin).status_code == 422  # at least 2 characters
    assert state(client, me)["next_promotion"]["to_grade"] == "grade2"


# ---------- Sổ tay kiến thức: ghi chú cá nhân ----------

def test_personal_notes_crud_search_ownership_and_kept_across_promotion(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    note = {"title": "Mẹo bảng nhân", "body": "2 × 5 = 10: đếm thêm 2 năm lần.", "subject": "math", "lesson_key": "toan2.bang_nhan_2"}
    res = client.post("/api/education/notes", headers=me, json=note)
    assert res.status_code == 201, res.json()
    created = res.json()
    assert (created["academic_year_label"], created["grade_label"], created["subject_name"], created["lesson_title"]) == (
        "2026–2027", "Lớp 2", "Toán", "Bảng nhân 2")
    for bad, code in (({"subject": "physics"}, "note_subject_invalid"), ({"lesson_key": "kh3.vong_doi_cay"}, "note_lesson_invalid"),
                      ({"body": "   "}, "note_empty")):
        res = client.post("/api/education/notes", headers=me, json={**note, **bad})
        assert res.status_code == 422 and res.json()["code"] == code, bad
    client.post("/api/education/notes", headers=me, json={"body": "Đọc to bài thơ", "subject": "vietnamese"})
    assert client.get("/api/education/notes?q=dem them", headers=me).json()["total"] == 1  # accents and case ignored
    assert client.get("/api/education/notes?subject=vietnamese", headers=me).json()["items"][0]["body"] == "Đọc to bài thơ"
    edited = client.put(f"/api/education/notes/{created['id']}", headers=me, json={**note, "body": "2 × 5 = 10 và 5 × 2 = 10"})
    assert edited.status_code == 200 and edited.json()["body"] == "2 × 5 = 10 và 5 × 2 = 10"
    other = account(client, email="other@example.com", age=7, school_grade="grade2")
    assert client.put(f"/api/education/notes/{created['id']}", headers=other, json=note).status_code == 404
    assert client.delete(f"/api/education/notes/{created['id']}", headers=other).status_code == 404
    assert client.get("/api/education/notes", headers=other).json()["total"] == 0

    school.t = at(2027, 9, 2)  # promoted: the notes stay, in their own school year
    assert state(client, me)["grade"] == "grade3"
    notes = client.get("/api/education/notes", headers=me).json()["items"]
    assert {(n["academic_year"], n["grade"]) for n in notes} == {(2026, "grade2")}
    assert len(client.get("/api/education/archives/2026", headers=me).json()["notes"]) == 2
    new = client.post("/api/education/notes", headers=me, json={"body": "Vòng đời của cây", "subject": "science",
                                                                "lesson_key": "kh3.vong_doi_cay"})
    assert new.status_code == 201 and new.json()["academic_year"] == 2027
    assert client.get("/api/education/notes?academic_year=2027", headers=me).json()["total"] == 1
    assert client.delete(f"/api/education/notes/{created['id']}", headers=me).status_code == 204
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(LearningNote)) == 2


def test_registering_creates_the_education_profile_and_locks_the_grade(client, school):
    res = register(client, email="new@example.com", age=6, school_grade="grade1")
    assert res.status_code == 201 and res.json()["school_grade"] == "grade1"
    me = bearer(login(client, email="new@example.com").json()["access_token"])
    s = state(client, me)
    assert (s["enrolled"], s["locked"], s["initial_grade"], s["academic_year_label"], s["region"]) == (
        True, True, "grade1", "2026–2027", "VN")
    with SessionLocal() as db:
        uid = db.scalar(select(User.id).where(User.email == "new@example.com"))
        kinds = list(db.scalars(select(GradePromotion.kind).where(GradePromotion.user_id == uid)))
        assert kinds == ["enrollment"]


# ---------- API documentation ----------

def test_the_learning_openapi_document_is_valid_and_up_to_date():
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import export_learning_openapi as export
    doc = export.build()
    assert export.problems(doc) == []
    committed = json.loads(export.TARGET.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(doc)), "run backend/scripts/export_learning_openapi.py"
    education_ops = {(m, p) for p, item in doc["paths"].items() for m in item if p.startswith("/api/education")}
    assert ("get", "/api/education") in education_ops and ("post", "/api/education/notes") in education_ops
    admin_op = doc["paths"]["/api/admin/education/calendar"]["put"]
    assert "403" in admin_op["responses"] and "admin_required" in admin_op["responses"]["403"]["description"]
    assert admin_op.get("security")  # bearer token


# ---------- migration of existing accounts ----------

def test_upgrade_locks_the_grades_of_existing_accounts_once(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    upgrade_schema(engine)
    with engine.begin() as conn:
        for email, grade, age in (("old@example.com", "grade4", 9), ("free@example.com", "adult", 30), ("none@example.com", None, None)):
            conn.execute(text("INSERT INTO users (email, password_hash, display_name, coins, gems, avatar_theme, equipped_item, "
                              "school_grade, age, created_at) VALUES (:email, 'x', 'Old', 0, 0, 'aqua', '', :grade, :age, "
                              "'2025-01-10 08:00:00')"), {"email": email, "grade": grade, "age": age})
    upgrade_schema(engine)
    upgrade_schema(engine)  # idempotent
    assert "academic_year" in {c["name"] for c in inspect(engine).get_columns("learning_sessions")}
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT u.email, p.initial_grade, p.current_grade, p.status, p.enrollment_date FROM "
                                 "user_education_profiles p JOIN users u ON u.id = p.user_id ORDER BY u.email")).all()
        assert [(r[0], r[1], r[2], r[3]) for r in rows] == [("free@example.com", "adult", "adult", "outside_school"),
                                                             ("old@example.com", "grade4", "grade4", "studying")]
        assert str(rows[1][4]).startswith("2025-01-10")
        assert conn.execute(text("SELECT count(*) FROM grade_promotion_history WHERE kind = 'migration'")).scalar_one() == 2
        assert conn.execute(text("SELECT count(*) FROM grade_promotion_history WHERE kind <> 'migration'")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM learning_year_archives")).scalar_one() == 0  # no made-up past years


def test_upgrade_removes_the_guessed_dates_of_the_first_release_and_keeps_admin_rows(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'cal.db'}")
    upgrade_schema(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO academic_year_configs (region, academic_year, timezone, school_start_date, promotion_date, "
                          "source, verified, updated_at) VALUES ('VN', 2027, 'Asia/Ho_Chi_Minh', '2027-08-30', '2027-08-30', "
                          "'Mặc định của Mirabi (data/academic_calendar.json)', 0, CURRENT_TIMESTAMP)"))
        conn.execute(text("INSERT INTO users (email, password_hash, display_name, coins, gems, avatar_theme, equipped_item, created_at) "
                          "VALUES ('a@example.com', 'x', 'A', 0, 0, 'aqua', '', CURRENT_TIMESTAMP)"))
        conn.execute(text("INSERT INTO academic_year_configs (region, academic_year, timezone, school_start_date, promotion_date, "
                          "source, verified, updated_by, updated_at) VALUES ('VN', 2028, 'Asia/Ho_Chi_Minh', '2028-08-28', "
                          "'2028-08-28', 'QĐ', 0, 1, CURRENT_TIMESTAMP)"))
    upgrade_schema(engine)
    with engine.connect() as conn:
        assert [r[0] for r in conn.execute(text("SELECT academic_year FROM academic_year_configs"))] == [2028]
        columns = {c["name"] for c in inspect(engine).get_columns("academic_year_configs")}
        assert {"decision_number", "verified_at", "verified_by"} <= columns


def test_upgrade_works_on_its_own_without_the_app_imported(tmp_path):
    """A deploy may run the migration alone: it must register every table itself (the suite always imports the app)."""
    import subprocess
    import sys
    db = tmp_path / "alone.db"
    code = ("from sqlalchemy import create_engine, inspect; from app.migrations import upgrade_schema; "
            f"e = create_engine(r'sqlite:///{db}'); upgrade_schema(e); upgrade_schema(e); "
            "print(sorted(t for t in inspect(e).get_table_names() if t in "
            "('user_education_profiles', 'learning_notes', 'academic_calendar_changes')))")
    out = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True,
                         env={**__import__("os").environ, "DATABASE_URL": "sqlite://"})
    assert out.returncode == 0, out.stderr[-2000:]
    assert out.stdout.strip() == "['academic_calendar_changes', 'learning_notes', 'user_education_profiles']"
