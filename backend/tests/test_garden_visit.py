"""Vườn nhà with friends: visiting a friend's garden, watering and tending, the limits, and what a guest cannot do."""
import itertools
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import garden
from app import inventory as inv
from app.config import settings
from app.db import SessionLocal
from app.main import app
from app.models import GardenCare, GardenPlot, SocialNotification, utcnow
from together import befriend, person

_ids = itertools.count()


def rid() -> str:
    return f"care-request-{next(_ids):06d}"


def plant(client, who, plot=0, item="seed_daisy"):
    with SessionLocal() as s:
        inv.grant(s, who.id, item, "default", 1, kind="walk_reward", ref=None, event_key=f"test:{who.id}:{plot}:{rid()}")
        s.commit()
    planted = client.post(f"/api/garden/plots/{plot}/plant", headers=who.headers,
                          json={"item_id": item, "variant": "default", "client_request_id": rid()})
    assert planted.status_code == 200 and planted.json()["planted"] is True, planted.json()


def visit(client, who, host):
    return client.get(f"/api/garden/visit/{host.id}", headers=who.headers)


def care(client, who, host, plot=0, kind="water", request_id=None):
    return client.post(f"/api/garden/visit/{host.id}/plots/{plot}/care", headers=who.headers,
                       json={"kind": kind, "client_request_id": request_id or rid()})


def xp(client, who) -> int:
    return client.get("/api/profile", headers=who.headers).json()["xp"]


def test_a_friend_sees_the_plants_and_their_growth_but_never_the_seeds(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    plant(client, aqua, 2, "seed_tulip")
    seen = visit(client, may, aqua)
    assert seen.status_code == 200, seen.json()
    body = seen.json()
    assert body["owner"]["id"] == aqua.id and body["owner"]["display_name"] == "Aqua" and "email" not in body["owner"]
    assert "seeds" not in body["garden"]
    plots = body["garden"]["plots"]
    assert [p["empty"] for p in plots] == [True, True, False, True, True, True]
    assert plots[2]["name"] == "Củ tulip" and plots[2]["stage"] == 0
    assert plots[2]["care"] == {"water": {"done": False, "by": None, "at": None}, "tend": {"done": False, "by": None, "at": None}}
    assert body["care"] == {"daily_limit": settings.garden_care_daily_limit, "used": 0, "left": settings.garden_care_daily_limit}
    # It is the owner's own data: the same plant, the same stage.
    own = client.get("/api/garden", headers=aqua.headers).json()["plots"][2]
    assert {k: own[k] for k in ("item_id", "stage", "planted_at")} == {k: plots[2][k] for k in ("item_id", "stage", "planted_at")}


def test_only_friends_visit_and_only_while_visits_are_on(client, db):
    aqua, may, kai = person(client, "Aqua"), person(client, "May"), person(client, "Kai")
    befriend(client, aqua, may)
    plant(client, aqua)
    assert visit(client, kai, aqua).json()["code"] == "garden_not_found"
    assert care(client, kai, aqua).json()["code"] == "garden_not_found"
    assert visit(client, aqua, aqua).json()["code"] == "garden_not_found"
    assert client.get("/api/garden/visit/999999", headers=may.headers).json()["code"] == "garden_not_found"
    client.patch("/api/social/me", headers=aqua.headers, json={"allow_room_visits": False})
    off = visit(client, may, aqua)
    assert off.status_code == 403 and off.json()["code"] == "garden_visits_disabled"
    assert care(client, may, aqua).json()["code"] == "garden_visits_disabled"
    client.patch("/api/social/me", headers=aqua.headers, json={"allow_room_visits": True})
    client.post(f"/api/users/{may.id}/block", headers=aqua.headers)
    assert visit(client, may, aqua).status_code == 404


def test_each_plant_is_watered_once_a_day_by_anyone_and_a_retry_answers_the_same(client, db, clock):
    aqua, may, kai = person(client, "Aqua"), person(client, "May"), person(client, "Kai")
    befriend(client, aqua, may)
    befriend(client, aqua, kai)
    plant(client, aqua)
    before = xp(client, aqua), xp(client, may)

    first = care(client, may, aqua, request_id="water-0000001")
    assert first.status_code == 200, first.json()
    assert first.json()["cared"] is True and first.json()["replayed"] is False
    watered = first.json()["garden"]["plots"][0]["care"]["water"]
    assert watered["done"] is True and watered["by"] == {"id": may.id, "display_name": "May", "me": True}
    assert first.json()["care"]["used"] == 1

    retry = care(client, may, aqua, request_id="water-0000001")
    assert retry.json()["cared"] is True and retry.json()["replayed"] is True
    again = care(client, may, aqua).json()  # another tap on the same plant
    assert (again["cared"], again["replayed"], again["reason"]) == (False, False, "already_cared")
    other = care(client, kai, aqua)  # a second friend: the plant already had its water today
    assert other.json()["reason"] == "already_cared"
    assert other.json()["garden"]["plots"][0]["care"]["water"]["by"] == {"id": may.id, "display_name": "May", "me": False}
    assert care(client, kai, aqua, kind="tend").json()["cared"] is True  # tending is its own care

    # The owner sees it when they open the garden again; nothing else changed: no EXP, no items, the same growth.
    mine = client.get("/api/garden", headers=aqua.headers).json()["plots"][0]
    assert mine["care"]["water"]["by"]["display_name"] == "May" and mine["care"]["tend"]["by"]["display_name"] == "Kai"
    assert mine["stage"] == 0 and (xp(client, aqua), xp(client, may)) == before
    assert db.scalar(select(func.count()).select_from(GardenCare)) == 2
    # One notification for the owner, merged while unread.
    inbox = client.get("/api/notifications", headers=aqua.headers).json()["items"]
    cares = [n for n in inbox if n["kind"] == "garden_care"]
    assert len(cares) == 1 and cares[0]["data"]["count"] == 2 and cares[0]["title"].startswith("Kai và 1 bạn khác")

    clock.advance(days=1)  # the owner's next day: it can be watered again
    assert care(client, kai, aqua).json()["cared"] is True


def test_the_owner_waters_their_own_plants_with_the_same_daily_rule(client, db):
    aqua = person(client, "Aqua")
    plant(client, aqua, 1)
    water = lambda plot=1, request_id=None: client.post(f"/api/garden/plots/{plot}/care", headers=aqua.headers,
                                                        json={"kind": "water", "client_request_id": request_id or rid()})
    first = water(request_id="own-water-001")
    assert first.json()["cared"] is True and first.json()["garden"]["plots"][1]["care"]["water"]["by"]["me"] is True
    assert water(request_id="own-water-001").json()["replayed"] is True
    assert water().json()["reason"] == "already_cared"
    assert water(plot=0).json()["code"] == "plot_empty"
    assert water(plot=7).status_code == 404
    assert client.post("/api/garden/plots/1/care", headers=aqua.headers, json={"kind": "harvest", "client_request_id": rid()}).status_code == 422
    assert client.get("/api/notifications", headers=aqua.headers).json()["items"] == []  # caring for one's own: no notice


def test_a_visitor_has_a_daily_limit_across_all_gardens(client, db, monkeypatch):
    monkeypatch.setattr(settings, "garden_care_daily_limit", 3)
    aqua, kai, may = person(client, "Aqua"), person(client, "Kai"), person(client, "May")
    befriend(client, aqua, may)
    befriend(client, kai, may)
    for plot in range(2):
        plant(client, aqua, plot)
    plant(client, kai)
    assert care(client, may, aqua, 0).json()["cared"] is True
    assert care(client, may, aqua, 1).json()["cared"] is True
    assert care(client, may, kai, 0).json()["care"]["left"] == 0
    limited = care(client, may, aqua, 0, kind="tend")
    assert limited.status_code == 429 and limited.json()["code"] == "garden_care_daily_limit"
    assert visit(client, may, aqua).json()["care"] == {"daily_limit": 3, "used": 3, "left": 0}


def test_a_guest_cannot_plant_clear_or_care_for_an_empty_plot(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    plant(client, aqua)
    row = db.scalars(select(GardenPlot).where(GardenPlot.user_id == aqua.id)).one()
    row.planted_at = utcnow() - timedelta(hours=garden.STAGE_HOURS[-1] + 1)
    db.commit()
    assert care(client, may, aqua, plot=3).json()["code"] == "plot_empty"
    # Planting and clearing only ever touch one's own garden: the friend's plant stays where it is.
    client.post("/api/garden/plots/0/clear", headers=may.headers)
    assert client.post(f"/api/garden/visit/{aqua.id}/plots/0/clear", headers=may.headers).status_code in (404, 405)
    assert client.post(f"/api/garden/visit/{aqua.id}/plots/1/plant", headers=may.headers,
                       json={"item_id": "seed_daisy", "client_request_id": rid()}).status_code in (404, 405)
    assert visit(client, may, aqua).json()["garden"]["plots"][0]["grown"] is True
    assert [p["empty"] for p in client.get("/api/garden", headers=aqua.headers).json()["plots"]] == [False] + [True] * 5


def test_friends_watering_at_once_water_once_and_clearing_starts_over(client, db):
    aqua = person(client, "Aqua")
    friends = [person(client, f"Ban{i}") for i in range(4)]
    for f in friends:
        befriend(client, aqua, f)
    plant(client, aqua)
    racer = TestClient(app, raise_server_exceptions=False)
    with ThreadPoolExecutor(max_workers=4) as pool:
        answers = list(pool.map(lambda f: racer.post(f"/api/garden/visit/{aqua.id}/plots/0/care", headers=f.headers,
                                                     json={"kind": "water", "client_request_id": rid()}), friends))
    assert all(a.status_code == 200 for a in answers), [a.json() for a in answers]
    assert sum(a.json()["cared"] for a in answers) == 1
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(GardenCare)) == 1
    assert db.scalar(select(func.count()).select_from(SocialNotification).where(SocialNotification.kind == "garden_care")) == 1

    row = db.scalars(select(GardenPlot).where(GardenPlot.user_id == aqua.id)).one()
    row.planted_at = utcnow() - timedelta(hours=garden.STAGE_HOURS[-1] + 1)
    db.commit()
    assert client.post("/api/garden/plots/0/clear", headers=aqua.headers).json()["garden"]["plots"][0]["empty"] is True
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(GardenCare)) == 0
    plant(client, aqua)  # a new planting in the same plot can be watered today
    assert care(client, friends[0], aqua).json()["cared"] is True
