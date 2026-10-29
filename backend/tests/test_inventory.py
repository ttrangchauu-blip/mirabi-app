"""Kho đồ: walk rewards from the catalog, the inventory, decorations placed copy by copy, and the garden."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import companion, garden, pet_room
from app import inventory as inv
from app import items_catalog as cat
from app.db import SessionLocal
from app.main import app
from app.models import (InventoryEvent, InventoryItem, InventoryStack, Memory, PetEvolution, PetRoom, PetWalk, PlacedItem, User,
                        WalkReward, utcnow)
from conftest import bearer, login, signup
from test_companion import finish_quests


@pytest.fixture()
def auth(client):
    return bearer(signup(client).json()["access_token"])


def me(db) -> User:
    db.expire_all()
    return db.scalars(select(User).where(User.email != "community@refmi.demo")).one()


def walk_home(client, auth, db, location="seaside"):
    """Start today's walk and bring the pet back now, from `location`, with the catalog's rewards."""
    finish_quests(client, auth)
    walk = db.scalars(select(PetWalk)).one()
    assert walk.item_id == companion.CATALOG_GIFT and walk.location_id in cat.LOCATIONS
    walk.location_id = location
    walk.returns_at = walk.started_at - timedelta(seconds=1)
    db.commit()
    return walk.id


def give(db, user_id, item_id, quantity=1, variant=None, key=None):
    variant = variant or inv.variants_of(item_id)[0]
    with SessionLocal() as s:
        inv.grant(s, user_id, item_id, variant, quantity, kind="walk_reward", ref=None, event_key=key or f"test:{item_id}:{variant}:{quantity}")
        s.commit()
    return variant


def items(client, auth):
    return {(i["id"], i["variant"]): i for i in client.get("/api/inventory", headers=auth).json()["items"]}


def room(client, auth):
    return client.get("/api/personal-room", headers=auth).json()


def save(client, auth, data, extra, url="/api/personal-room"):
    layout = data["room"]["layout"]
    body = {"version": data["room"]["version"], "wall_id": layout["wall"], "floor_id": layout["floor"],
            "items": layout["items"] + extra}
    if url == "/api/personal-room":
        body["name"] = data["room"]["name"]
    return client.put(url, json=body, headers=auth)


def pot(x, uid=None):
    """A small pot (a found decoration) standing at the front of the room, out of the pet's way."""
    return {"item": "small_pot", "variant": "default", "x": x, "y": 735, **({"uid": uid} if uid else {})}


# ---------------------------------------------------------------------------- the catalog
def test_every_place_has_something_of_every_rarity_and_every_item_can_be_found():
    for location in cat.LOCATIONS:
        for rarity in cat.RARITIES:
            assert cat.pool(location, rarity), (location, rarity)
        assert all(cat.ITEMS[b]["group"] in ("seed", "material") for b in cat.LOCATIONS[location]["bonus"])
    found = {i for loc in cat.LOCATIONS for r in cat.RARITIES for i in cat.pool(loc, r)}
    assert found == {i for i, item in cat.ITEMS.items() if item["drop"]}
    groups = {item["group"] for item in cat.ITEMS.values()}
    assert groups == set(cat.GROUPS)
    for item_id, item in cat.ITEMS.items():
        assert item["rarity"] in cat.RARITIES and item["name"] and item["description"], item_id
        if cat.use_of(item_id) == "room":
            assert item["art"] in pet_room.ITEMS and pet_room.counted(item["art"]) == item_id  # placeable, copy by copy


def test_the_catalog_is_stored_at_startup(client, db):
    from app.models import CatalogEntry
    rows = {row.id: row for row in db.scalars(select(CatalogEntry))}
    assert set(rows) == set(cat.ITEMS)
    assert rows["place_badge"].use == "album" and "seaside" in rows["place_badge"].variants_json


# ---------------------------------------------------------------------------- rewards
def test_a_walk_brings_back_one_main_item_and_maybe_a_bonus_granted_once_without_the_app(client, auth, db):
    walk_id = walk_home(client, auth, db)
    assert companion.sweep_returned_walks() == 1  # the app is closed
    rolled = db.scalars(select(WalkReward).where(WalkReward.walk_id == walk_id)).all()
    assert [r.slot for r in rolled][0] == "main" and len(rolled) in (1, 2)
    assert rolled[0].location_id == "seaside" and cat.ITEMS[rolled[0].item_id]["group"] in cat.LOCATIONS["seaside"]["groups"]
    expected = companion.roll_rewards(db.get(PetWalk, walk_id))
    assert [(r.slot, r.item_id, r.variant, r.quantity) for r in rolled] == [(e["slot"], e["item_id"], e["variant"], e["quantity"]) for e in expected]

    # Another device (or the app opened later) sees the same, and reading again never grants again.
    tablet = bearer(login(client).json()["access_token"])
    reward = client.get("/api/pet/space", headers=tablet).json()["pending_reward"]
    assert reward["location"] == {"id": "seaside", "name": "Bờ biển"} and reward["exp"] == 0
    assert [(i["id"], i["quantity"], i["is_new"], i["rarity_label"]) for i in reward["items"]] == [
        (r.item_id, r.quantity, True, cat.RARITY_LABELS[cat.ITEMS[r.item_id]["rarity"]]) for r in rolled]
    for _ in range(3):
        assert companion.settle_walk(db, walk_id) is False
        client.get("/api/inventory", headers=auth)
    owned = items(client, auth)
    assert {k: v["owned"] for k, v in owned.items()} == {(r.item_id, r.variant): r.quantity for r in rolled} or rolled[0].item_id == rolled[-1].item_id

    # Closing the popup ("Đóng" or "Xem kho đồ") only records it was seen.
    assert client.post(f"/api/pet/walks/{walk_id}/acknowledge", headers=auth).json()["acknowledged"] == reward
    assert items(client, auth) == owned and client.get("/api/pet/space", headers=auth).json()["pending_reward"] is None


def test_the_roll_is_kept_so_a_failed_grant_retried_gives_the_same(client, auth, db, monkeypatch):
    walk_id = walk_home(client, auth, db)
    expected = companion.roll_rewards(db.get(PetWalk, walk_id))
    real = inv.grant
    monkeypatch.setattr(companion.inv, "grant", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    assert client.get("/api/pet/space", headers=auth).json()["pending_reward"] is None
    assert db.scalar(select(func.count()).select_from(WalkReward)) == 0 and db.scalar(select(func.count()).select_from(InventoryStack)) == 0
    monkeypatch.setattr(companion.inv, "grant", real)
    reward = client.get("/api/pet/space", headers=auth).json()["pending_reward"]
    assert [(i["id"], i["variant"], i["quantity"]) for i in reward["items"]] == [(e["item_id"], e["variant"], e["quantity"]) for e in expected]


def test_duplicates_add_up_and_only_a_first_find_is_new(client, auth, db, monkeypatch):
    monkeypatch.setattr(companion, "roll_rewards", lambda walk: [
        {"slot": "main", "item_id": "shell", "variant": "default", "quantity": 1},
        {"slot": "bonus", "item_id": "stone", "variant": "default", "quantity": 2}])
    user_id = me(db).id
    give(db, user_id, "stone", 3)
    walk_id = walk_home(client, auth, db)
    reward = client.get("/api/pet/space", headers=auth).json()["pending_reward"]
    assert [(i["id"], i["quantity"], i["is_new"]) for i in reward["items"]] == [("shell", 1, True), ("stone", 2, False)]
    owned = items(client, auth)
    assert owned[("stone", "default")]["owned"] == 5 and owned[("shell", "default")]["is_new"] is True
    # A keepsake is in the album, linked to its walk.
    detail = client.get("/api/inventory/items/shell", headers=auth).json()
    memory = db.get(Memory, detail["memory_id"])
    assert memory.event_type == "walk_keepsake" and memory.source_key == f"keepsake:walk:{walk_id}" and memory.notified_at
    assert detail["walk_id"] == walk_id and detail["history"][0]["location"]["name"] == "Bờ biển"
    assert client.get(f"/api/memories/{memory.id}", headers=auth).status_code == 200
    # Opening it: no longer "Mới".
    assert client.post("/api/inventory/items/shell/seen", json={"variant": "default"}, headers=auth).status_code == 200
    assert items(client, auth)[("shell", "default")]["is_new"] is False


def test_an_egg_that_can_hatch_on_the_walk_gets_its_gifts_first_and_no_second_walk(client, auth, db):
    assert client.put("/api/pet", headers=auth, json={"pet": "dolphin", "name": "Aqua"}).status_code == 200
    walk_id = walk_home(client, auth, db)
    user = me(db)
    progress = db.scalars(select(PetEvolution)).one()
    progress.total_xp = user.xp = 400  # earned while it walked
    db.commit()
    space = client.get("/api/pet/space", headers=auth).json()
    assert space["pending_reward"]["walk_id"] == walk_id and space["hatch"]["status"] == "waiting_return"
    assert client.post("/api/pet/hatch", headers=auth).json()["code"] == "pet_away"  # gifts first
    after = client.post(f"/api/pet/walks/{walk_id}/acknowledge", headers=auth).json()
    assert after["hatch"]["status"] == "ready"
    hatched = client.post("/api/pet/hatch", headers=auth).json()
    assert hatched["hatched"] is True and hatched["status"] == "rested"
    assert db.scalar(select(func.count()).select_from(PetWalk)) == 1
    assert sum(i["owned"] for i in items(client, auth).values()) >= 1  # the gifts stayed


def test_finds_from_before_the_inventory_move_in_once(client, auth, db):
    user_id = me(db).id
    db.add(InventoryItem(user_id=user_id, item_id="moon_lantern", quantity=2))
    db.add(InventoryItem(user_id=user_id, item_id="acorn", quantity=1))
    db.commit()
    for _ in range(2):
        owned = items(client, auth)
    assert owned[("moon_lantern", inv.variants_of("moon_lantern")[0])]["owned"] == 2 and owned[("acorn", "default")]["owned"] == 1


# ---------------------------------------------------------------------------- decorations
def test_decorations_are_placed_copy_by_copy_and_never_more_than_owned(client, auth, db):
    give(db, me(db).id, "small_pot", 3)
    data = room(client, auth)
    found = [f for f in data["catalog"]["found"] if f["item"] == "small_pot"]
    assert found == [{**found[0], "owned": 3, "placed": 0, "available": 3}]

    saved = save(client, auth, data, [pot(60, "tmp-1"), pot(120, "tmp-2")])
    assert saved.status_code == 200, saved.json()
    copies = [p for p in saved.json()["room"]["layout"]["items"] if p["item"] == "small_pot"]
    assert len(copies) == 2 and len({p["uid"] for p in copies}) == 2 and all(p["uid"].startswith("p") for p in copies)
    stack = items(client, auth)[("small_pot", "default")]
    assert (stack["owned"], stack["placed"], stack["available"]) == (3, 2, 1)  # "Còn 1 · Đang đặt 2"
    assert saved.json()["catalog"]["found"][0]["available"] == 1

    # Moving a copy changes no count; the same save sent again is refused (outdated) and changes nothing.
    data = room(client, auth)
    moved = [{**p, "x": p["x"] + 30} if p.get("uid") == copies[0]["uid"] else p for p in data["room"]["layout"]["items"]]
    body = {"name": data["room"]["name"], "version": data["room"]["version"], "wall_id": data["room"]["layout"]["wall"],
            "floor_id": data["room"]["layout"]["floor"], "items": moved}
    assert client.put("/api/personal-room", json=body, headers=auth).status_code == 200
    assert client.put("/api/personal-room", json=body, headers=auth).json()["code"] == "room_version_conflict"
    assert db.scalar(select(func.count()).select_from(PlacedItem)) == 2
    assert items(client, auth)[("small_pot", "default")]["available"] == 1

    # Two more than the one left: refused, nothing changes.
    data = room(client, auth)
    too_many = save(client, auth, data, [pot(180, "tmp-3"), pot(240, "tmp-4")])
    assert too_many.status_code == 409 and too_many.json()["code"] == "not_enough_items"
    assert db.scalar(select(func.count()).select_from(PlacedItem)) == 2 and room(client, auth)["room"]["version"] == data["room"]["version"]

    # The last copy goes to the focus room; then the personal room cannot take it too.
    focus = client.get("/api/focus-room", headers=auth).json()
    assert save(client, auth, focus, [{**pot(560), "y": 420}], url="/api/focus-room").status_code == 200
    data = room(client, auth)
    assert save(client, auth, data, [pot(180, "tmp-5")]).json()["code"] == "not_enough_items"
    stack = items(client, auth)[("small_pot", "default")]
    assert (stack["owned"], stack["placed"], stack["available"]) == (3, 3, 0)

    # Storing a copy frees it; the detail says where each copy is.
    kept = [p for p in data["room"]["layout"]["items"] if p.get("uid") != copies[1]["uid"]]
    body = {"name": data["room"]["name"], "version": data["room"]["version"], "wall_id": data["room"]["layout"]["wall"],
            "floor_id": data["room"]["layout"]["floor"], "items": kept}
    assert client.put("/api/personal-room", json=body, headers=auth).status_code == 200
    detail = client.get("/api/inventory/items/small_pot", headers=auth).json()
    assert (detail["item"]["placed"], detail["item"]["available"]) == (2, 1)
    assert sorted(p["room"] for p in detail["placements"]) == ["focus", "personal"]
    kinds = [h["kind"] for h in detail["history"]]
    assert kinds.count("place") == 3 and kinds.count("store") == 1


def test_a_copy_cannot_be_recoloured_into_a_variant_that_is_not_owned(client, auth, db):
    variant = give(db, me(db).id, "moon_lantern", 1)
    other = next(v for v in inv.variants_of("moon_lantern") if v != variant)
    data = room(client, auth)
    shelf = {"item": "lantern_shelf", "variant": variant, "x": 330, "y": 260}
    first = save(client, auth, data, [shelf])
    assert first.status_code == 200, first.json()
    data = first.json()
    copy = next(p for p in data["room"]["layout"]["items"] if p["item"] == "lantern_shelf")
    data2 = room(client, auth)
    recoloured = [{**p, "variant": other} if p.get("uid") == copy["uid"] else p for p in data2["room"]["layout"]["items"]]
    body = {"name": data2["room"]["name"], "version": data2["room"]["version"], "wall_id": data2["room"]["layout"]["wall"],
            "floor_id": data2["room"]["layout"]["floor"], "items": recoloured}
    assert client.put("/api/personal-room", json=body, headers=auth).json()["code"] == "not_enough_items"


def test_unowned_decorations_are_refused(client, auth):
    data = room(client, auth)
    refused = save(client, auth, data, [pot(60)])
    assert refused.status_code == 403 and refused.json()["code"] == "item_not_owned"


def test_concurrent_saves_of_both_rooms_never_place_one_copy_twice(client, auth, db):
    give(db, me(db).id, "small_pot", 1)
    personal, focus = room(client, auth), client.get("/api/focus-room", headers=auth).json()
    racer = TestClient(app, raise_server_exceptions=False)
    jobs = [lambda: save(racer, auth, personal, [pot(60)]),
            lambda: save(racer, auth, focus, [{**pot(560), "y": 420}], url="/api/focus-room")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = [f.result().status_code for f in [pool.submit(j) for j in jobs]]
    assert codes.count(200) <= 1 and db.scalar(select(func.count()).select_from(PlacedItem)) <= 1


def test_a_small_pot_saved_in_both_rooms_before_copies_keeps_one_and_stores_the_other(client, auth, db):
    user_id = me(db).id
    room(client, auth)
    client.get("/api/focus-room", headers=auth)
    give(db, user_id, "small_pot", 1)
    from app.models import FocusRoomLayout
    for model in (PetRoom, FocusRoomLayout):
        row = db.get(model, user_id)
        stored = pet_room.json.loads(row.items_json)
        stored["items"].append({"item": "small_pot", "variant": "default", "x": 60, "y": 735, "flip": False, "rotate": 0})
        row.items_json = pet_room.json.dumps(stored)
    db.commit()
    personal = [p for p in room(client, auth)["room"]["layout"]["items"] if p["item"] == "small_pot"]
    focus = [p for p in client.get("/api/focus-room", headers=auth).json()["room"]["layout"]["items"] if p["item"] == "small_pot"]
    assert len(personal) == 1 and personal[0]["uid"] and focus == []
    assert db.scalar(select(func.count()).select_from(PlacedItem)) == 1


# ---------------------------------------------------------------------------- the garden
def test_planting_uses_one_seed_once_per_request_and_only_in_an_empty_plot(client, auth, db):
    give(db, me(db).id, "seed_daisy", 2)
    plant = lambda plot, rid, item="seed_daisy": client.post(f"/api/garden/plots/{plot}/plant", headers=auth,
                                                             json={"item_id": item, "variant": "default", "client_request_id": rid})
    first = plant(0, "request-0001")
    assert first.status_code == 200 and first.json()["planted"] is True
    again = plant(0, "request-0001")  # a retry, or a double tap
    assert again.json()["replayed"] is True
    assert items(client, auth)[("seed_daisy", "default")]["owned"] == 1
    assert plant(0, "request-0002").json()["code"] == "plot_taken"
    assert items(client, auth)[("seed_daisy", "default")]["owned"] == 1  # refused: not used
    assert plant(1, "request-0003").json()["planted"] is True
    assert plant(2, "request-0004").json()["code"] == "not_enough_items"
    assert plant(2, "request-0005", "shell").json()["code"] == "not_a_seed"
    assert plant(9, "request-0006").status_code == 404
    view = client.get("/api/garden", headers=auth).json()
    assert [p["empty"] for p in view["plots"]] == [False, False, True, True, True, True] and view["seeds"] == []
    assert view["plots"][0]["stage"] == 0 and view["plots"][0]["name"] == "Hạt hoa cúc"
    assert client.post("/api/garden/plots/0/clear", headers=auth).json()["code"] == "not_grown"


def test_concurrent_plantings_of_the_last_seed_plant_once(client, auth, db):
    give(db, me(db).id, "seed_tulip", 1)
    racer = TestClient(app, raise_server_exceptions=False)
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda i: racer.post(f"/api/garden/plots/{i}/plant", headers=auth, json={
            "item_id": "seed_tulip", "variant": "default", "client_request_id": f"race-request-{i}"}), range(4)))
    assert sum(r.status_code == 200 and r.json().get("planted") for r in responses) == 1
    stack = db.scalars(select(InventoryStack).where(InventoryStack.item_id == "seed_tulip")).one()
    db.refresh(stack)
    assert stack.quantity == 0


def test_a_grown_plant_frees_its_plot(client, auth, db):
    from app.models import GardenPlot
    give(db, me(db).id, "seed_sunflower", 1)
    client.post("/api/garden/plots/3/plant", headers=auth, json={"item_id": "seed_sunflower", "client_request_id": "grow-request"})
    row = db.scalars(select(GardenPlot)).one()
    row.planted_at = utcnow() - timedelta(hours=garden.STAGE_HOURS[-1] + 1)
    db.commit()
    assert client.get("/api/garden", headers=auth).json()["plots"][3]["grown"] is True
    assert client.post("/api/garden/plots/3/clear", headers=auth).json()["garden"]["plots"][3]["empty"] is True


def test_inventory_endpoints_need_a_session(client):
    assert client.get("/api/inventory").status_code == 401
    assert client.get("/api/garden").status_code == 401
