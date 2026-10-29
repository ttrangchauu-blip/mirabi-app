import random
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text

from app import companion
from app import items_catalog as cat
from app.main import app
from app.migrations import upgrade_schema
from app.models import ExpEvent, InventoryStack, PetWalk
from conftest import bearer, login, signup
from test_companion import bring_pet_home, finish_quests

ADVENTURE_EXP = companion.ADVENTURE_EXP
EXP = companion.EXP_GIFT


@pytest.fixture()
def auth(client):
    return bearer(signup(client).json()["access_token"])


def start_walk(client, auth):
    finish_quests(client, auth)
    assert client.get("/api/pet/space", headers=auth).json()["status"] == "walking"


def xp(client, auth):
    return client.get("/api/profile", headers=auth).json()["xp"]


def owned(db):
    db.expire_all()
    return {row.item_id: row.quantity for row in db.scalars(select(InventoryStack))}


def shown(item):
    """The part of a gift the popup used to show (the rest: catalog details, see test_inventory.py)."""
    return {k: item[k] for k in ("id", "name", "emoji", "rarity", "kind", "quantity")}


def exp_events(db):
    return db.scalar(select(func.count()).select_from(ExpEvent).where(ExpEvent.source == "pet_adventure"))


def acknowledge(client, auth, walk_id):
    return client.post(f"/api/pet/walks/{walk_id}/acknowledge", headers=auth)


def pending(client, auth):
    return client.get("/api/pet/space", headers=auth).json()["pending_reward"]


# Walks started before the item catalog keep the one gift they picked when they started (EXP or an old find); the
# catalog's rewards are in test_inventory.py.
def test_an_item_gift_comes_alone_and_is_granted_while_the_app_is_open(client, auth, db):
    start_walk(client, auth)
    before = xp(client, auth)
    bring_pet_home(db, "small_pot")

    space = client.get("/api/pet/space", headers=auth).json()
    assert space["status"] == "returned"
    reward = space["pending_reward"]
    assert reward["walk_id"] == db.scalars(select(PetWalk)).one().id
    assert reward["exp"] == 0 and [shown(i) for i in reward["items"]] == [{**companion.REWARD_ITEMS["small_pot"], "quantity": 1}]
    # Granted before the user tapped anything; no EXP with an item, and reading again grants nothing more.
    assert xp(client, auth) == before and exp_events(db) == 0
    assert pending(client, auth) == reward
    assert owned(db) == {"small_pot": 1}
    assert [(i["id"], i["owned"], i["available"]) for i in space["inventory"]] == [("small_pot", 1, 1)]


def test_an_exp_gift_comes_alone(client, auth, db):
    start_walk(client, auth)
    before = xp(client, auth)
    bring_pet_home(db, EXP)
    reward = pending(client, auth)
    assert reward["exp"] == ADVENTURE_EXP and reward["items"] == []
    assert xp(client, auth) == before + ADVENTURE_EXP and owned(db) == {} and exp_events(db) == 1


def test_walk_times_are_sent_as_utc_with_an_offset(client, auth, db):
    start_walk(client, auth)
    walking = client.get("/api/pet/space", headers=auth).json()
    for key in ("started_at", "return_at", "server_now"):
        assert walking[key].endswith("+00:00"), key
    bring_pet_home(db)
    assert pending(client, auth)["returned_at"].endswith("+00:00")


def test_pet_returning_while_the_app_is_closed_is_granted_by_the_sweep(client, auth, db):
    start_walk(client, auth)
    before = xp(client, auth)
    bring_pet_home(db, EXP)

    assert companion.sweep_returned_walks() == 1  # no request from the app
    db.expire_all()
    walk = db.scalars(select(PetWalk)).one()
    assert walk.rewarded_at is not None and walk.collected_at is None and walk.reward_exp == ADVENTURE_EXP
    assert exp_events(db) == 1 and companion.sweep_returned_walks() == 0

    # Opening the app later shows the waiting popup with the same gift.
    reopened = client.get("/api/pet/space", headers=auth).json()
    assert reopened["status"] == "returned" and reopened["pending_reward"]["walk_id"] == walk.id
    assert xp(client, auth) == before + ADVENTURE_EXP


def test_nhan_qua_only_marks_the_popup_seen_and_is_idempotent(client, auth, db):
    start_walk(client, auth)
    bring_pet_home(db, "crystal")
    reward = pending(client, auth)
    after_grant, items = xp(client, auth), owned(db)

    responses = [acknowledge(client, auth, reward["walk_id"]) for _ in range(3)]
    assert all(r.status_code == 200 for r in responses)
    assert all(r.json()["acknowledged"] == reward for r in responses)
    assert responses[0].json()["status"] == "rested" and responses[0].json()["pending_reward"] is None
    assert xp(client, auth) == after_grant and owned(db) == items == {"crystal": 1}
    # Never comes back.
    assert pending(client, auth) is None


@pytest.mark.parametrize("gift", [EXP, "seedling"])
def test_concurrent_nhan_qua_requests_do_not_duplicate_anything(client, auth, db, gift):
    start_walk(client, auth)
    bring_pet_home(db, gift)
    reward = pending(client, auth)
    after_grant, items = xp(client, auth), owned(db)

    # SQLite allows one writer, so a parallel request may fail with "database is locked"; none may grant twice.
    racer = TestClient(app, raise_server_exceptions=False)
    with ThreadPoolExecutor(max_workers=5) as pool:
        responses = list(pool.map(lambda _: racer.post(
            f"/api/pet/walks/{reward['walk_id']}/acknowledge", headers=auth), range(5)))
    assert any(r.status_code == 200 for r in responses) and all(r.status_code in (200, 500) for r in responses)
    assert xp(client, auth) == after_grant and owned(db) == items and exp_events(db) == (gift == EXP)
    assert pending(client, auth) is None


@pytest.mark.parametrize("gift", [EXP, "acorn"])
def test_racing_grants_settle_a_walk_once(client, auth, db, gift):
    from app.db import SessionLocal
    start_walk(client, auth)
    bring_pet_home(db, gift)
    walk_id = db.scalars(select(PetWalk)).one().id
    with SessionLocal() as first, SessionLocal() as second:
        assert companion.settle_walk(first, walk_id) is True
        assert companion.settle_walk(second, walk_id) is False  # e.g. the sweep and an app request
    assert exp_events(db) == (gift == EXP) and sum(owned(db).values()) == (gift != EXP)
    assert companion.sweep_returned_walks() == 0


def test_a_failed_grant_leaves_nothing_behind_and_is_retried(client, auth, db, monkeypatch):
    start_walk(client, auth)
    bring_pet_home(db, "star")
    real = companion.inv.grant

    def broken(*args, **kwargs):
        raise RuntimeError("inventory unavailable")
    monkeypatch.setattr(companion.inv, "grant", broken)
    assert pending(client, auth) is None
    db.expire_all()
    assert db.scalars(select(PetWalk)).one().rewarded_at is None and owned(db) == {}

    monkeypatch.setattr(companion.inv, "grant", real)
    assert pending(client, auth)["items"][0]["id"] == "star"
    assert owned(db) == {"star": 1}


def test_other_device_sees_the_popup_until_it_is_confirmed_anywhere(client, auth, db):
    start_walk(client, auth)
    phone = auth
    tablet = bearer(login(client).json()["access_token"])
    bring_pet_home(db, EXP)
    reward = pending(client, phone)
    assert pending(client, tablet) == reward

    assert acknowledge(client, phone, reward["walk_id"]).status_code == 200
    assert pending(client, tablet) is None
    # The tablet still had the popup open: its tap succeeds without granting again.
    assert acknowledge(client, tablet, reward["walk_id"]).status_code == 200
    assert exp_events(db) == 1


def test_cannot_confirm_a_walk_that_is_not_back_or_not_yours(client, auth, db):
    start_walk(client, auth)
    walk_id = db.scalars(select(PetWalk)).one().id
    early = acknowledge(client, auth, walk_id)
    assert early.status_code == 409 and early.json()["code"] == "walk_not_returned"
    bring_pet_home(db)
    stranger = bearer(signup(client, email="other@example.com").json()["access_token"])
    assert acknowledge(client, stranger, walk_id).status_code == 404
    assert acknowledge(client, auth, 999_999).status_code == 404
    assert client.post(f"/api/pet/walks/{walk_id}/acknowledge").status_code == 401


def test_dashboard_reflects_an_exp_gift_from_a_walk_that_ended_offline(client, auth, db):
    start_walk(client, auth)
    before = client.get("/api/dashboard", headers=auth).json()["user"]["xp"]
    bring_pet_home(db, EXP)
    dashboard = client.get("/api/dashboard", headers=auth).json()
    assert dashboard["user"]["xp"] == before + ADVENTURE_EXP and dashboard["pet_walk"] == "returned"


def test_legacy_collect_confirms_without_granting_again(client, auth, db):
    start_walk(client, auth)
    bring_pet_home(db, "clover")
    pending(client, auth)
    after_grant, items = xp(client, auth), owned(db)
    collected = client.post("/api/pet/walk/collect", headers=auth).json()
    assert collected["found"]["id"] == "clover" and collected["pending_reward"] is None
    assert xp(client, auth) == after_grant and owned(db) == items == {"clover": 1}
    assert client.post("/api/pet/walk/collect", headers=auth).json()["code"] == "nothing_to_collect"
    assert client.get("/api/pet/inventory", headers=auth).json() == collected["inventory"]


def test_a_walk_from_before_the_catalog_gives_exactly_its_one_gift():
    assert companion.roll_rewards(PetWalk(id=42, item_id="star")) == [{"slot": "main", "item_id": "star", "variant": "default", "quantity": 1}]
    assert companion.roll_rewards(PetWalk(id=43, item_id=EXP)) == []


def test_main_gift_odds_follow_the_rarity_table_and_the_bonus_comes_half_the_time():
    walks = [PetWalk(id=i, item_id=companion.CATALOG_GIFT, location_id=sorted(cat.LOCATIONS)[i % 5]) for i in range(1, 20_001)]
    rolls = [companion.roll_rewards(w) for w in walks]
    mains = [r[0] for r in rolls]
    assert all(r[0]["slot"] == "main" and r[0]["quantity"] == 1 for r in rolls)
    share = {tier: sum(cat.ITEMS[m["item_id"]]["rarity"] == tier for m in mains) / len(mains) for tier in cat.RARITIES}
    assert abs(share["common"] - 0.65) < 0.015 and abs(share["rare"] - 0.25) < 0.015
    assert abs(share["special"] - 0.09) < 0.01 and abs(share["legendary"] - 0.01) < 0.004
    bonuses = [r[1] for r in rolls if len(r) == 2]
    assert abs(len(bonuses) / len(rolls) - cat.BONUS_CHANCE) < 0.015
    assert all(cat.ITEMS[b["item_id"]]["group"] in ("seed", "material") and 1 <= b["quantity"] <= 3 for b in bonuses)
    assert {b["quantity"] for b in bonuses} == {1, 2, 3}
    # Where the pet went decides what it can find; every pet finds the same things.
    for w, r in zip(walks, rolls):
        assert cat.ITEMS[r[0]["item_id"]]["group"] in cat.LOCATIONS[w.location_id]["groups"]
    assert {m["item_id"] for m in mains} == {i for i, item in cat.ITEMS.items() if item["drop"]}
    assert companion.roll_rewards(walks[0]) == rolls[0]  # rolled again: the same


def test_migration_moves_legacy_collected_finds_into_the_inventory_once(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("""CREATE TABLE pet_walks (id INTEGER PRIMARY KEY, user_id INTEGER, item_id VARCHAR(30),
            started_at DATETIME, returns_at DATETIME, collected_at DATETIME)"""))
        conn.execute(text("""INSERT INTO pet_walks (user_id, item_id, returns_at, collected_at) VALUES
            (1, 'shell', '2026-01-01', '2026-01-01'), (1, 'shell', '2026-01-02', '2026-01-02'),
            (1, 'star', '2026-01-03', NULL)"""))
    upgrade_schema(engine)
    upgrade_schema(engine)  # idempotent
    with engine.connect() as conn:
        assert conn.execute(text("SELECT user_id, item_id, quantity FROM user_inventory_items")).all() == [(1, "shell", 2)]
        rows = conn.execute(text("SELECT item_id, rewarded_at IS NOT NULL, reward_exp, rewards FROM pet_walks ORDER BY id")).all()
    assert [tuple(r[:3]) for r in rows] == [("shell", 1, 0), ("shell", 1, 0), ("star", 0, 0)]
    assert rows[0][3] == '[{"item_id": "shell", "quantity": 1}]'
