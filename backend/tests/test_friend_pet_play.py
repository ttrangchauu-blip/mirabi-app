"""Playing with a friend's pet on a visit: 2 EXP per friend and day, 10 per pet and day, the host's day, atomic."""
import itertools
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.config import settings
from app.models import ExpEvent, FriendPetExpGrant, PetEvolution, PetWalk, PomodoroSettings, User, utcnow
from together import befriend, person

_ids = itertools.count()


def rid() -> str:
    return f"pet-play-{next(_ids):06d}"


def play(client, who, host, request_id=None):
    return client.post(f"/api/personal-room/visit/{host.id}/pet-play", headers=who.headers,
                       json={"client_request_id": request_id or rid()})


def gift(client, who, host) -> dict:
    return client.get(f"/api/personal-room/visit/{host.id}", headers=who.headers).json()["pet_gift"]


def friend_exp(db, host) -> int:
    db.expire_all()
    return db.scalar(select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(
        ExpEvent.user_id == host.id, ExpEvent.source == "friend_pet")) or 0


def xp(client, who) -> int:
    return client.get("/api/profile", headers=who.headers).json()["xp"]


def friends_of(client, host, n: int, prefix="Ban"):
    out = []
    for i in range(n):
        f = person(client, f"{prefix}{i}")
        befriend(client, host, f)
        out.append(f)
    return out


def test_each_friend_gives_2_exp_once_a_day_and_a_retry_answers_the_same(client, db, clock):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    assert gift(client, may, aqua) == {"exp": 2, "daily_cap": 10, "available": True, "reason": None}
    before, visitor_before = xp(client, aqua), xp(client, may)

    first = play(client, may, aqua, request_id="tap-0000001")
    assert first.status_code == 200, first.json()
    assert first.json() == {"granted": 2, "reason": "granted", "pet_name": "Aqua Pet", "pet_level": 0, "replayed": False}
    assert xp(client, aqua) == before + 2 and xp(client, may) == visitor_before  # the host's pet gets it, never the visitor
    again = play(client, may, aqua)  # another tap: the pet still plays, no EXP
    assert again.json()["granted"] == 0 and again.json()["reason"] == "already_given"
    retry = play(client, may, aqua, request_id="tap-0000001")  # the first request, sent again after a timeout
    assert retry.json()["granted"] == 2 and retry.json()["replayed"] is True
    assert friend_exp(db, aqua) == 2 and xp(client, aqua) == before + 2
    assert gift(client, may, aqua)["reason"] == "already_given"

    clock.advance(hours=24)  # the host's next day (UTC account): a new gift
    assert gift(client, may, aqua)["available"] is True
    assert play(client, may, aqua).json()["granted"] == 2 and friend_exp(db, aqua) == 4


def test_a_pet_takes_at_most_10_exp_a_day_from_all_friends_and_task_exp_keeps_its_own_cap(client, db):
    from app.progression import daily_exp_remaining
    aqua = person(client, "Aqua")
    friends = friends_of(client, aqua, 6)
    results = [play(client, f, aqua).json() for f in friends]
    assert [r["granted"] for r in results] == [2, 2, 2, 2, 2, 0]
    assert results[-1]["reason"] == "pet_full" and gift(client, friends[-1], aqua)["reason"] == "pet_full"
    assert friend_exp(db, aqua) == 10
    host = db.get(User, aqua.id)
    assert daily_exp_remaining(host, db, source="task", daily_cap=settings.task_daily_exp_cap) == settings.task_daily_exp_cap


def test_the_limits_are_central_settings(client, db, monkeypatch):
    monkeypatch.setattr(settings, "friend_pet_exp_per_friend", 3)
    monkeypatch.setattr(settings, "friend_pet_exp_daily_cap", 7)
    aqua = person(client, "Aqua")
    assert [play(client, f, aqua).json()["granted"] for f in friends_of(client, aqua, 4)] == [3, 3, 1, 0]
    assert friend_exp(db, aqua) == 7


def test_fast_taps_several_devices_and_many_friends_at_once_never_give_more(client, db):
    aqua = person(client, "Aqua")
    friends = friends_of(client, aqua, 7)
    start = xp(client, aqua)
    taps = [f for f in friends for _ in range(3)]  # every friend taps three times, all at the same moment
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda f: play(client, f, aqua), taps))
    assert all(r.status_code == 200 for r in responses), [r.json() for r in responses]
    assert sum(r.json()["granted"] for r in responses) == 10 and friend_exp(db, aqua) == 10
    db.expire_all()
    grants = db.scalars(select(FriendPetExpGrant).where(FriendPetExpGrant.host_id == aqua.id)).all()
    assert len(grants) == 5 and len({g.visitor_id for g in grants}) == 5 and sorted(g.slot for g in grants) == [1, 2, 3, 4, 5]
    progress = db.scalar(select(PetEvolution).where(PetEvolution.user_id == aqua.id))
    assert progress.total_xp == start + 10 and xp(client, aqua) == start + 10  # every grant reached the pet: none lost


def test_one_request_sent_again_from_overlapping_retries_is_given_once_and_answered_the_same(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    with ThreadPoolExecutor(max_workers=4) as pool:  # a slow network: the app's retries overlap the first request
        responses = list(pool.map(lambda _: play(client, may, aqua, request_id="tap-race-01"), range(4)))
    bodies = [r.json() for r in responses]
    assert all(r.status_code == 200 for r in responses), bodies
    assert all(b["granted"] == 2 and b["reason"] == "granted" for b in bodies), bodies
    assert sorted(b["replayed"] for b in bodies) == [False, True, True, True]
    assert friend_exp(db, aqua) == 2


def test_a_friend_without_a_pet_yet_has_no_room_to_visit(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    host = db.get(User, aqua.id)
    host.pet_name = None
    db.commit()
    assert play(client, may, aqua).status_code == 404 and friend_exp(db, aqua) == 0


def test_a_walking_pet_only_takes_greetings(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    now = utcnow()
    db.add(PetWalk(user_id=aqua.id, item_id="exp", started_at=now, returns_at=now + timedelta(minutes=60),
                   task_cycle_id=now.date().isoformat()))
    db.commit()
    assert gift(client, may, aqua)["reason"] == "pet_away"
    assert play(client, may, aqua).json() == {"granted": 0, "reason": "pet_away", "pet_name": "Aqua Pet", "pet_level": 0,
                                              "replayed": False}
    assert friend_exp(db, aqua) == 0
    assert client.post(f"/api/personal-room/visit/{aqua.id}/greetings", headers=may.headers, json={"kind": "hello"}).status_code == 201


def test_only_friends_can_play_never_with_your_own_pet(client, db):
    aqua, may, linh = person(client, "Aqua"), person(client, "May"), person(client, "Linh")
    befriend(client, aqua, may)
    assert play(client, aqua, aqua).status_code == 404  # your own pet: no visit, no EXP
    assert play(client, linh, aqua).status_code == 404  # not a friend
    assert client.patch("/api/social/me", headers=aqua.headers, json={"allow_room_visits": False}).status_code == 200
    assert play(client, may, aqua).status_code == 403
    assert client.patch("/api/social/me", headers=aqua.headers, json={"allow_room_visits": True}).status_code == 200
    assert client.post(f"/api/users/{aqua.id}/block", headers=may.headers).status_code == 201
    assert play(client, may, aqua).status_code == 404
    assert friend_exp(db, aqua) == 0


def test_the_day_is_the_hosts_account_day(client, db, clock):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    db.add(PomodoroSettings(user_id=aqua.id, timezone="Pacific/Kiritimati", daily_goal_minutes=120, focus_minutes=25,
                            short_break_minutes=5, long_break_minutes=15, long_break_every=4))  # UTC+14
    db.commit()
    clock.t = datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc)  # 23:00 on the 28th for the host
    assert play(client, may, aqua).json()["granted"] == 2
    clock.advance(hours=1, minutes=30)  # still the 28th in UTC (and for a visitor in Asia/Ho_Chi_Minh), the 29th for the host
    assert gift(client, may, aqua)["available"] is True
    assert play(client, may, aqua).json()["granted"] == 2
    db.expire_all()
    days = sorted(g.local_date.isoformat() for g in db.scalars(select(FriendPetExpGrant).where(FriendPetExpGrant.host_id == aqua.id)))
    assert days == ["2026-10-28", "2026-10-29"]


def test_friend_exp_evolves_the_pet_with_the_existing_rules(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    xp(client, aqua)  # creates the pet's progress row
    progress = db.scalar(select(PetEvolution).where(PetEvolution.user_id == aqua.id))
    progress.total_xp = 299  # one tap from hatching (Lv.1 at 300)
    db.commit()
    result = play(client, may, aqua).json()
    # The EXP counts at once; the egg hatches when its owner's app shows it.
    assert result["granted"] == 2 and result["pet_level"] == 0
    assert client.post("/api/pet/hatch", headers=aqua.headers).json()["pet_level"] == 1
    profile = client.get("/api/profile", headers=aqua.headers).json()
    assert profile["xp"] == 301 and profile["level"] == 1
