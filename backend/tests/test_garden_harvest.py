"""Vườn nhà's shop and harvests: coins and seeds change together, a planting pays once, EXP stays under its daily cap."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import days, garden
from app import garden_catalog as gc
from app.config import settings
from app.main import app
from app.models import (CoinEvent, ExpEvent, GardenHarvest, GardenPlot, InventoryEvent, InventoryStack, PetEvolution, User,
                        utcnow)
from conftest import bearer, signup


@pytest.fixture()
def auth(client):
    return bearer(signup(client).json()["access_token"])


def me(db) -> User:
    db.expire_all()
    return db.scalars(select(User).where(User.email != "community@refmi.demo")).one()


def set_user(db, **values):
    user = me(db)
    for k, v in values.items():
        setattr(user, k, v)
    db.commit()


def adopt(client, auth):
    assert client.put("/api/pet", headers=auth, json={"pet": "cat", "name": "Mây"}).status_code == 200


def buy(client, auth, item="seed_carrot", quantity=1, rid="buy-request-1", **extra):
    return client.post("/api/garden/shop/buy", headers=auth,
                       json={"item_id": item, "quantity": quantity, "client_request_id": rid, **extra})


def seeds(db, item="seed_carrot") -> int:
    db.expire_all()
    return db.scalar(select(func.coalesce(func.sum(InventoryStack.quantity), 0)).where(InventoryStack.item_id == item))


def plant(client, auth, plot=0, item="seed_carrot", rid=None):
    return client.post(f"/api/garden/plots/{plot}/plant", headers=auth,
                       json={"item_id": item, "client_request_id": rid or f"plant-{plot}-{item}"})


def age(db, plot=0, share=1.0, extra=60):
    """Move the planting in `plot` back by `share` of its growing time (plus `extra` seconds)."""
    db.expire_all()
    row = db.scalars(select(GardenPlot).where(GardenPlot.plot == plot)).one()
    row.planted_at = utcnow() - timedelta(seconds=garden.grow_seconds(row) * share + extra)
    db.commit()


def harvest(client, auth, plot=0, rid="harvest-request-1"):
    return client.post(f"/api/garden/plots/{plot}/harvest", headers=auth, json={"client_request_id": rid})


def coins(db) -> int:
    return me(db).coins


# ---------------------------------------------------------------------------- the shop
def test_the_shop_lists_every_seed_on_sale_with_the_catalogs_numbers(client, auth):
    shop = client.get("/api/garden/shop", headers=auth).json()
    assert [i["plant_id"] for i in shop["items"]] == [p["id"] for p in gc.for_sale()]
    assert [t["id"] for t in shop["tiers"]] == ["common", "uncommon", "rare", "epic", "legendary"]
    crystal = next(i for i in shop["items"] if i["plant_id"] == "crystal_tree")
    assert (crystal["name"], crystal["tier_label"], crystal["harvest_exp"], crystal["harvest_coins"]) == ("Cây pha lê", "Hiếm", 7, 40)
    assert crystal["profit"] == crystal["harvest_coins"] - crystal["seed_price"] and crystal["grow_seconds"] == 120 * 60
    # A new account's egg (Lv.0) buys commons only; walk-only seeds are not on sale.
    assert {i["tier"] for i in shop["items"] if i["unlocked"]} == {"common"}
    assert "succulent" not in {i["plant_id"] for i in shop["items"]} and shop["coins"] == 12450


def test_buying_takes_the_catalogs_price_once_and_adds_the_seeds(client, auth, db):
    before = coins(db)
    # A price sent by the app is ignored: only the catalog's counts.
    res = buy(client, auth, "seed_carrot", 3, seed_price=0, price=0, total=0)
    assert res.status_code == 200 and res.json()["bought"] is True and res.json()["spent"] == 15
    assert coins(db) == before - 15 and seeds(db) == 3 and res.json()["coins"] == before - 15
    again = buy(client, auth, "seed_carrot", 3)  # the answer was lost: the app sends the same request again
    assert again.json()["replayed"] is True and again.json()["bought"] is False
    assert coins(db) == before - 15 and seeds(db) == 3
    events = db.scalars(select(CoinEvent)).all()
    assert [(e.delta, e.balance_after, e.kind) for e in events] == [(-15, before - 15, "garden_seed")]
    assert db.scalar(select(InventoryEvent).where(InventoryEvent.kind == "buy")).delta == 3
    shop = client.get("/api/garden/shop", headers=auth).json()
    assert next(i for i in shop["items"] if i["item_id"] == "seed_carrot")["owned"] == 3


def test_a_purchase_the_coins_cant_cover_changes_nothing(client, auth, db):
    set_user(db, coins=14)
    res = buy(client, auth, "seed_carrot", 3)
    assert res.status_code == 409 and res.json()["code"] == "insufficient_coins"
    assert coins(db) == 14 and seeds(db) == 0 and db.scalar(select(func.count()).select_from(CoinEvent)) == 0
    assert buy(client, auth, "seed_carrot", 2, rid="buy-request-2").status_code == 200 and coins(db) == 4


def test_what_the_shop_refuses(client, auth, db):
    assert buy(client, auth, "seed_succulent").json()["code"] == "not_for_sale"
    assert buy(client, auth, "wood").json()["code"] == "not_for_sale"
    assert buy(client, auth, "seed_carrot", settings.garden_buy_max_quantity + 1).json()["code"] == "too_many"
    assert buy(client, auth, "seed_carrot", 0).status_code == 422
    assert buy(client, auth, "seed_crystal_tree").json()["code"] == "seed_locked"  # rare opens at Lv.2
    set_user(db, level=2)
    assert buy(client, auth, "seed_crystal_tree", rid="buy-request-rare").status_code == 200
    assert buy(client, auth, "seed_mist_tree", rid="buy-request-epic").json()["code"] == "seed_locked"
    assert coins(db) == 12450 - 24


def test_purchases_from_several_devices_never_overspend(client, auth, db):
    set_user(db, coins=50)  # enough for 5 purchases of two carrot seeds (10 each)
    racer = TestClient(app, raise_server_exceptions=False)
    with ThreadPoolExecutor(max_workers=8) as pool:
        answers = list(pool.map(lambda i: racer.post("/api/garden/shop/buy", headers=auth, json={
            "item_id": "seed_carrot", "quantity": 2, "client_request_id": f"device-buy-{i}"}), range(8)))
    bought = [a for a in answers if a.status_code == 200 and a.json()["bought"]]
    assert len(bought) == 5 and all(a.json()["code"] == "insufficient_coins" for a in answers if a not in bought)
    assert coins(db) == 0 and seeds(db) == 10
    # The same purchase sent from two devices at once is one purchase.
    set_user(db, coins=50)
    with ThreadPoolExecutor(max_workers=4) as pool:
        same = list(pool.map(lambda i: racer.post("/api/garden/shop/buy", headers=auth, json={
            "item_id": "seed_carrot", "quantity": 2, "client_request_id": "one-purchase"}), range(4)))
    assert all(a.status_code == 200 for a in same) and sum(a.json()["bought"] for a in same) == 1
    assert coins(db) == 40 and seeds(db) == 12


# ---------------------------------------------------------------------------- planting and growing
def test_a_bought_seed_plants_and_grows_through_five_stages_in_real_time(client, auth, db):
    buy(client, auth, "seed_carrot", 2)
    view = plant(client, auth).json()["garden"]
    p = view["plots"][0]
    assert (p["name"], p["tier"], p["stage"], p["stage_label"], p["ready"]) == ("Cà rốt", "common", 0, "Hạt giống", False)
    assert p["grow_seconds"] == 600 and p["harvest"] == {"exp": 2, "coins": 6} and p["art"] == "carrot"
    assert view["stages"] == ["Hạt giống", "Nảy mầm", "Cây non", "Trưởng thành", "Sẵn sàng thu hoạch"] and seeds(db) == 1
    # The app was closed meanwhile: the stage is told from the clock alone.
    for share, stage in ((0.12, 1), (0.4, 2), (0.75, 3), (1.0, 4)):
        age(db, share=share, extra=0)
        p = client.get("/api/garden", headers=auth).json()["plots"][0]
        assert p["stage"] == stage and p["stage_label"] == gc.STAGE_LABELS[stage], share
    assert p["ready"] is True and p["grown"] is True and p["next_stage_at"] is None
    assert plant(client, auth, rid="plant-again").json()["code"] == "plot_taken"


def test_planting_without_a_seed_or_in_a_taken_plot_is_refused(client, auth, db):
    assert plant(client, auth).json()["code"] == "not_enough_items"
    buy(client, auth, "seed_carrot", 1)
    assert plant(client, auth, rid="plant-first").status_code == 200
    buy(client, auth, "seed_carrot", 1, rid="buy-request-2")
    assert plant(client, auth, rid="plant-second").json()["code"] == "plot_taken" and seeds(db) == 1


def test_a_planting_keeps_the_time_and_rewards_it_was_planted_with(client, auth, db, monkeypatch):
    buy(client, auth, "seed_carrot", 1)
    plant(client, auth)
    changed = {**gc.PLANTS["carrot"], "grow_seconds": 99_999, "harvest_coins": 11, "harvest_exp": 4}
    monkeypatch.setitem(gc.BY_SEED, "seed_carrot", changed)
    p = client.get("/api/garden", headers=auth).json()["plots"][0]
    assert p["grow_seconds"] == 600 and p["harvest"] == {"exp": 2, "coins": 6}


def test_watering_and_tending_change_neither_growth_nor_rewards(client, auth, db):
    buy(client, auth, "seed_carrot", 1)
    before = plant(client, auth).json()["garden"]["plots"][0]
    for kind in ("water", "tend"):
        for i in range(3):  # fast repeated taps
            client.post("/api/garden/plots/0/care", headers=auth, json={"kind": kind, "client_request_id": f"care-{kind}-{i}"})
    after = client.get("/api/garden", headers=auth).json()["plots"][0]
    assert {k: after[k] for k in ("ready_at", "harvest", "grow_seconds")} == {k: before[k] for k in ("ready_at", "harvest", "grow_seconds")}
    assert after["care"]["water"]["done"] and after["care"]["tend"]["done"]
    assert db.scalar(select(func.count()).select_from(CoinEvent).where(CoinEvent.kind != "garden_seed")) == 0
    assert db.scalar(select(func.count()).select_from(ExpEvent).where(ExpEvent.source == "garden")) == 0


# ---------------------------------------------------------------------------- harvesting
def test_a_ready_plant_is_harvested_once_for_its_coins_and_its_pets_exp(client, auth, db):
    adopt(client, auth)
    set_user(db, level=2)
    buy(client, auth, "seed_crystal_tree", 1)
    plant(client, auth, 4, "seed_crystal_tree")
    early = harvest(client, auth, 4)
    assert early.status_code == 409 and early.json()["code"] == "not_ready"
    before_coins, before_xp = coins(db), db.scalar(select(PetEvolution.total_xp))
    age(db, 4)
    res = harvest(client, auth, 4).json()
    assert res["harvested"] is True and res["harvest"]["name"] == "Cây pha lê"
    assert (res["harvest"]["exp"], res["harvest"]["coins"], res["harvest"]["exp_capped"]) == (7, 40, False)
    assert coins(db) == before_coins + 40 == res["coins"]
    db.expire_all()
    assert db.scalar(select(PetEvolution.total_xp)) == before_xp + 7
    assert res["garden"]["plots"][4]["empty"] is True and res["garden"]["garden_exp"]["earned_today"] == 7
    # Pressed again (same request: the answer was lost) and again (a new tap): never a second reward.
    again = harvest(client, auth, 4).json()
    assert again["replayed"] is True and again["harvest"]["coins"] == 40
    assert harvest(client, auth, 4, rid="harvest-request-2").json()["code"] == "plot_empty"
    assert coins(db) == before_coins + 40 and db.scalar(select(func.count()).select_from(GardenHarvest)) == 1
    assert [(e.source, e.amount) for e in db.scalars(select(ExpEvent).where(ExpEvent.source == "garden"))] == [("garden", 7)]
    assert [e.kind for e in db.scalars(select(CoinEvent).order_by(CoinEvent.id))] == ["garden_seed", "garden_harvest"]


def test_harvests_at_once_from_several_devices_pay_once(client, auth, db):
    buy(client, auth, "seed_carrot", 1)
    plant(client, auth)
    age(db)
    before = coins(db)
    racer = TestClient(app, raise_server_exceptions=False)
    with ThreadPoolExecutor(max_workers=6) as pool:
        answers = list(pool.map(lambda i: racer.post("/api/garden/plots/0/harvest", headers=auth,
                                                     json={"client_request_id": f"device-harvest-{i}"}), range(6)))
    assert sum(a.status_code == 200 and a.json()["harvested"] for a in answers) == 1
    assert all(a.json()["code"] == "plot_empty" for a in answers if a.status_code != 200)
    assert coins(db) == before + 6 and db.scalar(select(func.count()).select_from(GardenHarvest)) == 1


def test_past_the_daily_cap_a_harvest_still_gives_its_coins_but_no_more_exp(client, auth, db):
    adopt(client, auth)
    user = me(db)
    db.add(ExpEvent(user_id=user.id, pet_id=user.pet, source="garden", reference_id="earlier", amount=settings.garden_daily_exp_cap - 1,
                    created_at=utcnow()))
    db.commit()
    buy(client, auth, "seed_sunflower", 2)
    for plot in (0, 1):
        plant(client, auth, plot, "seed_sunflower", rid=f"plant-sun-{plot}")
        age(db, plot)
    first = harvest(client, auth, 0, rid="harvest-cap-1").json()["harvest"]
    second = harvest(client, auth, 1, rid="harvest-cap-2").json()["harvest"]
    assert (first["exp"], first["exp_requested"], first["exp_capped"], first["coins"]) == (1, 4, True, 10)
    assert (second["exp"], second["coins"]) == (0, 10)
    garden_exp = client.get("/api/garden", headers=auth).json()["garden_exp"]
    assert garden_exp == {"daily_cap": settings.garden_daily_exp_cap, "earned_today": settings.garden_daily_exp_cap, "left": 0}
    # Tasks and learning keep their own 60 a day: the garden takes nothing from them.
    from app.progression import daily_exp_remaining
    assert daily_exp_remaining(me(db), db, source="task", daily_cap=settings.task_daily_exp_cap) == settings.task_daily_exp_cap


def test_a_plant_ready_after_the_daily_reset_counts_on_the_new_day(client, auth, db):
    adopt(client, auth)
    user = me(db)
    # Yesterday's harvests filled yesterday's cap (days.py's day, Vietnam's midnight in production).
    db.add(ExpEvent(user_id=user.id, pet_id=user.pet, source="garden", reference_id="yesterday",
                    amount=settings.garden_daily_exp_cap, created_at=days.day_start() - timedelta(minutes=1)))
    db.commit()
    buy(client, auth, "seed_carrot", 1)
    plant(client, auth)
    age(db, share=1.0, extra=24 * 3600)  # planted yesterday, ready since then
    assert harvest(client, auth).json()["harvest"]["exp"] == 2


def test_a_plant_in_the_ground_before_this_update_keeps_growing_and_can_be_harvested(client, auth, db):
    adopt(client, auth)
    user = me(db)
    # Planted by the old garden: no growing time or rewards were kept with it.
    db.add(GardenPlot(user_id=user.id, plot=6, item_id="seed_tulip", variant="default", request_id="old-planting-01",
                      planted_at=utcnow() - timedelta(hours=2)))
    db.add(GardenPlot(user_id=user.id, plot=7, item_id="seed_daisy", variant="default", request_id="old-planting-02",
                      planted_at=utcnow() - timedelta(minutes=3)))
    db.commit()
    plots = client.get("/api/garden", headers=auth).json()["plots"]
    assert plots[6]["ready"] is True and plots[6]["harvest"] == {"exp": 4, "coins": 14}
    assert plots[7]["stage"] == 1 and plots[7]["ready"] is False  # 3 of its 10 minutes
    assert harvest(client, auth, 6).json()["harvest"]["coins"] == 14


def test_clear_of_older_apps_harvests_a_ready_plant_instead_of_losing_it(client, auth, db):
    buy(client, auth, "seed_carrot", 1)
    plant(client, auth, 2)
    assert client.post("/api/garden/plots/2/clear", headers=auth).json()["code"] == "not_grown"
    age(db, 2)
    before = coins(db)
    res = client.post("/api/garden/plots/2/clear", headers=auth).json()
    assert res["harvest"]["coins"] == 6 and res["garden"]["plots"][2]["empty"] is True and coins(db) == before + 6
    assert client.post("/api/garden/plots/2/clear", headers=auth).json()["harvest"] is None and coins(db) == before + 6


def test_a_visitor_never_sees_the_owners_coins_and_cannot_harvest(client, auth, db):
    view = client.get("/api/garden", headers=auth).json()
    assert view["coins"] == 12450 and "garden_exp" in view
    from app.garden import garden_view
    owner = me(db)
    other = User(email="may@example.com", password_hash="x", display_name="May")
    db.add(other)
    db.commit()
    seen = garden_view(db, owner, viewer=other)
    assert "coins" not in seen and "seeds" not in seen and "garden_exp" not in seen
    assert client.post(f"/api/garden/visit/{owner.id}/plots/0/harvest", headers=auth,
                       json={"client_request_id": "visitor-harvest"}).status_code in (404, 405)


def test_a_town_contribution_is_written_to_the_coin_history(client, db):
    from conftest import adult_signup
    headers = bearer(adult_signup(client, "town@example.com").json()["access_token"])
    project = client.get("/api/town/projects", headers=headers).json()[0]
    res = client.post(f"/api/town/projects/{project['id']}/contribute", headers=headers,
                      json={"amount": 100, "client_ref": "town-ref-0001"})
    assert res.status_code in (200, 201)
    again = client.post(f"/api/town/projects/{project['id']}/contribute", headers=headers,
                        json={"amount": 100, "client_ref": "town-ref-0001"})
    assert again.json()["already_recorded"] is True
    events = db.scalars(select(CoinEvent)).all()
    assert [(e.kind, e.delta, e.balance_after) for e in events] == [("town_contribution", -100, 12350)]
