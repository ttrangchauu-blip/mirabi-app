import json
import re
from datetime import timedelta

from sqlalchemy import select

from app import pet_room
from app.models import InventoryItem, Memory, PetRoom, PetRoomItem, PetWalk, SocialNotification, StudySession, User, utcnow
from together import befriend, person


def saved(client, who) -> dict:
    response = client.get("/api/personal-room", headers=who.headers)
    assert response.status_code == 200, response.json()
    return response.json()


def body(room: dict, **changes) -> dict:
    layout = {**room["layout"], **changes.pop("layout", {})}
    return {"name": changes.pop("name", room["name"]), "wall_id": layout["wall"], "floor_id": layout["floor"],
            "items": layout["items"], "version": changes.pop("version", room["version"])}


def without(room: dict, *item_ids: str) -> list[dict]:
    return [p for p in room["layout"]["items"] if p["item"] not in item_ids]


def place(item: str, x: float, y: float, variant: str | None = None, **turn) -> dict:
    return {"item": item, "variant": variant, "x": x, "y": y, **turn}


def send_walk(db, user_id: int, minutes: int = 90) -> PetWalk:
    now = utcnow()
    walk = PetWalk(user_id=user_id, item_id="exp", started_at=now, returns_at=now + timedelta(minutes=minutes),
                   task_cycle_id=now.date().isoformat())
    db.add(walk)
    db.commit()
    return walk


def test_room_is_created_once_with_the_default_layout_and_starter_ownership(client, db):
    aqua = person(client, "Aqua", pet="dolphin")
    first = saved(client, aqua)
    assert first["room"]["name"] == "Phòng của Aqua Pet" and first["room"]["version"] == 1
    assert first["room"]["layout"] == pet_room.DEFAULT_LAYOUT
    owner = db.get(User, aqua.id)  # pet, level and EXP come straight from the user, never a copy
    assert first["pet"] == {"id": "dolphin", "name": "Aqua Pet", "level": owner.level, "xp": owner.xp}
    assert first["walk"] == {"away": False, "return_at": None} and first["activity"] == "idle"
    owned = {item["id"] for item in first["catalog"]["items"] if item["owned"]}
    assert owned == {i for i, item in pet_room.ITEMS.items() if item["source"] == "starter"}
    rows = db.scalars(select(PetRoomItem).where(PetRoomItem.user_id == aqua.id)).all()
    assert {r.source for r in rows} == {"starter"} and len(rows) == len(owned)

    moved = [{**p, "x": 150, "variant": "white"} if p["item"] == "desk" else p for p in without(first["room"], "rug_oval")]
    changed = client.put("/api/personal-room", headers=aqua.headers,
                         json=body(first["room"], name="Góc nhỏ", layout={"wall": "wall_mint", "items": moved}))
    assert changed.status_code == 200, changed.json()
    reopened = saved(client, aqua)
    assert reopened["room"]["name"] == "Góc nhỏ" and reopened["room"]["version"] == 2
    layout = reopened["room"]["layout"]
    assert layout["wall"] == "wall_mint" and layout["items"] == moved == changed.json()["room"]["layout"]["items"]
    assert "rug_oval" not in {p["item"] for p in layout["items"]}  # stored away, still owned
    assert next(i for i in reopened["catalog"]["items"] if i["id"] == "rug_oval")["owned"]
    assert db.scalar(select(PetRoom).where(PetRoom.user_id == aqua.id)).version == 2
    assert len(db.scalars(select(PetRoomItem).where(PetRoomItem.user_id == aqua.id)).all()) == len(owned)


def test_only_owned_items_once_each_in_a_variant_and_turn_their_artwork_has_can_be_saved(client, db):
    aqua = person(client, "Aqua")
    room = saved(client, aqua)["room"]
    items = room["layout"]["items"]
    attempts = {
        "item_not_owned": body(room, layout={"items": items + [place("small_pot", 150, 420)]}),  # a walk find not found yet
        "invalid_item": body(room, layout={"items": items + [place("wall_mint", 150, 420)]}),  # a surface is not an item
        "duplicate_item": body(room, layout={"items": items + [place("desk", 300, 330)]}),
        "invalid_variant": body(room, layout={"items": [*items[:-1], place("toy_ball", 262, 412, "plaid")]}),
        "invalid_transform": body(room, layout={"items": [*items[:-1], place("toy_ball", 262, 412, rotate=20)]}),  # 15° steps
        "validation_error": body(room, layout={"items": items + [place("chair", 150, 330, flip="sideways")]}),
    }
    for code, payload in attempts.items():
        refused = client.put("/api/personal-room", headers=aqua.headers, json=payload)
        assert refused.json()["code"] == code, (code, refused.json())
    not_flippable = body(room, layout={"items": [*without(room, "floor_lamp"), place("floor_lamp", 372, 316, flip=True)]})
    assert client.put("/api/personal-room", headers=aqua.headers, json=not_flippable).json()["code"] == "invalid_transform"
    assert client.put("/api/personal-room", headers=aqua.headers, json={**body(room), "floor_id": "wall_cream"}).json()["code"] == "invalid_item"
    too_many = body(room, layout={"items": [place("desk", 10 * n, 330) for n in range(pet_room.MAX_ITEMS + 1)]})
    assert client.put("/api/personal-room", headers=aqua.headers, json=too_many).status_code == 422
    assert saved(client, aqua)["room"]["version"] == 1  # nothing was stored

    db.add(InventoryItem(user_id=aqua.id, item_id="small_pot", quantity=1))
    db.commit()
    catalog = {item["id"]: item for item in saved(client, aqua)["catalog"]["items"]}
    assert catalog["small_pot"]["owned"] and catalog["small_pot"]["source"] == "walk"
    turned = [*without(room, "toy_ball"), place("toy_ball", 262, 412, "sky", rotate=-45, flip=True), place("small_pot", 150, 420)]
    stored = client.put("/api/personal-room", headers=aqua.headers, json=body(room, layout={"items": turned}))
    assert stored.status_code == 200, stored.json()
    ball = next(p for p in stored.json()["room"]["layout"]["items"] if p["item"] == "toy_ball")
    assert ball == {"item": "toy_ball", "variant": "sky", "x": 262, "y": 412, "flip": True, "rotate": -45}


def test_items_are_kept_inside_the_room(client):
    aqua = person(client, "Aqua")
    room = saved(client, aqua)["room"]
    wild = [place("window", -500, 900), place("desk", 999, -999), place("rug_oval", 200, 100), place("toy_ball", 10.4, 437.6)]
    stored = client.put("/api/personal-room", headers=aqua.headers, json=body(room, layout={"items": wild}))
    assert stored.status_code == 200, stored.json()
    data = pet_room.art()
    canvas = data["canvas"]
    for p in stored.json()["room"]["layout"]["items"]:
        meta = data["items"][p["item"]]
        x0, y0, x1, y1 = pet_room.item_box(meta, p["flip"], p["rotate"])
        assert 0 <= p["x"] + x0 and p["x"] + x1 <= canvas["width"] and 0 <= p["y"] + y0 and p["y"] + y1 <= canvas["height"], p
        if meta["mount"] == "wall":
            assert p["y"] + y1 <= canvas["floorY"], p  # a window stays on the wall
        else:
            assert p["y"] > canvas["floorY"], p  # rugs and furniture stay on the floor
        assert isinstance(p["x"], int) and isinstance(p["y"], int)


def test_a_room_saved_with_fixed_slots_opens_as_the_same_items(client, db):
    aqua = person(client, "Aqua")
    saved(client, aqua)
    db.query(PetRoom).filter(PetRoom.user_id == aqua.id).update({
        PetRoom.background_id: "window_starry", PetRoom.wall_id: "wall_lilac", PetRoom.floor_id: "floor_tile_cream", PetRoom.version: 4,
        PetRoom.items_json: json.dumps({"rug": "rug_peach", "study": None, "rest": "bed_basket", "shelf": "shelf_moon_lantern",
                                        "plant": "plant_monstera"})})
    db.commit()
    room = saved(client, aqua)["room"]
    assert room["version"] == 4 and room["layout"]["wall"] == "wall_lilac" and room["layout"]["floor"] == "floor_tile_cream"
    assert [(p["item"], p["variant"]) for p in room["layout"]["items"]] == [
        ("window", "starry"), ("lantern_shelf", "oak"), ("rug_round", "peach"), ("pet_bed_basket", "natural"),
        ("plant_monstera", "terracotta")]
    # Saving it again (the moon lantern is not owned without the walk find) stores the new format.
    keep = without(room, "lantern_shelf")
    assert client.put("/api/personal-room", headers=aqua.headers, json=body(room, layout={"items": keep})).status_code == 200
    row = db.get(PetRoom, aqua.id)
    db.refresh(row)
    assert json.loads(row.items_json) == {"items": keep} and row.version == 5


def test_a_save_from_an_outdated_screen_is_refused(client):
    aqua = person(client, "Aqua")
    room = saved(client, aqua)["room"]
    assert client.put("/api/personal-room", headers=aqua.headers, json=body(room, layout={"wall": "wall_lilac"})).status_code == 200
    stale = client.put("/api/personal-room", headers=aqua.headers, json=body(room, layout={"wall": "wall_mint"}))
    assert stale.status_code == 409 and stale.json()["code"] == "room_version_conflict"
    assert saved(client, aqua)["room"]["layout"]["wall"] == "wall_lilac"


def test_opening_the_room_reads_the_walk_without_changing_it(client, db):
    aqua = person(client, "Aqua")
    walk = send_walk(db, aqua.id)
    state = saved(client, aqua)
    assert state["walk"]["away"] is True and state["walk"]["return_at"].startswith(walk.returns_at.isoformat()[:16])
    # A finished walk is not settled by the room: only the walk endpoints and the sweep grant rewards.
    walk.returns_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert saved(client, aqua)["walk"] == {"away": False, "return_at": None}
    db.expire_all()
    assert db.get(PetWalk, walk.id).rewarded_at is None and db.get(PetWalk, walk.id).collected_at is None


def test_a_running_focus_session_shows_the_pet_studying(client, db):
    aqua = person(client, "Aqua")
    db.add(StudySession(user_id=aqua.id, duration_seconds=0, completed=False, status="started", started_at=utcnow(),
                        pomodoro_cycle="focus-1"))
    db.commit()
    assert saved(client, aqua)["activity"] == "studying"
    db.query(StudySession).update({StudySession.started_at: utcnow() - timedelta(hours=4)})
    db.commit()
    assert saved(client, aqua)["activity"] == "idle"  # an abandoned session does not keep the pet at the desk


def test_photo_preview_is_the_saved_image_and_the_album_keeps_it_frozen(client, db):
    aqua = person(client, "Aqua", pet="dolphin")
    room = saved(client, aqua)["room"]
    request = {"pose": "study", "title": "Buổi chiều yên tĩnh", "message": "Học xong chương 2"}
    preview = client.post("/api/personal-room/photo/preview", headers=aqua.headers, json=request)
    assert preview.status_code == 200 and preview.json()["pose"] == "study"
    svg = preview.json()["svg"]
    assert 'width="1080" height="1350"' in svg and "Buổi chiều yên tĩnh" in svg and "data:image/png;base64," in svg
    assert db.scalar(select(Memory.id)) is None  # a preview stores nothing

    stored = client.post("/api/personal-room/photo", headers=aqua.headers, json={**request, "client_request_id": "room-photo-0001"})
    assert stored.status_code == 201, stored.json()
    memory = stored.json()
    assert memory["event_type"] == "room_photo" and memory["image_svg"] == svg
    assert memory["snapshot"]["room"]["layout"] == room["layout"] and memory["snapshot"]["pose"] == "study"
    again = client.post("/api/personal-room/photo", headers=aqua.headers, json={**request, "client_request_id": "room-photo-0001"})
    assert again.json()["id"] == memory["id"] and db.query(Memory).count() == 1

    # Later changes to the room, the pet or the caption leave the photo as it was taken.
    client.put("/api/personal-room", headers=aqua.headers, json=body(room, layout={"wall": "wall_lilac"}))
    client.put("/api/pet", headers=aqua.headers, json={"pet": "dolphin", "name": "Sóng"})
    edited = client.patch(f"/api/memories/{memory['id']}", headers=aqua.headers, json={"title": "Tên mới", "favorite": True})
    assert edited.status_code == 200
    assert edited.json()["image_svg"] == svg and edited.json()["snapshot"]["room"]["layout"]["wall"] == "wall_cream"
    pet_photos = client.get("/api/memories?category=pet", headers=aqua.headers).json()["items"]
    assert [m["id"] for m in pet_photos] == [memory["id"]] and pet_photos[0]["thumbnail_svg"].startswith("<svg")
    assert client.get("/api/memories/pending", headers=aqua.headers).json() is None  # saved by hand: no notice


def test_the_pet_follows_its_furniture_falls_back_to_the_rug_and_no_photo_while_the_pet_is_away(client, db):
    aqua = person(client, "Aqua")
    room = saved(client, aqua)["room"]
    desk = next(p for p in room["layout"]["items"] if p["item"] == "desk")
    seat = pet_room.art()["items"]["desk"]["seat"]
    assert pet_room.pet_spot(room["layout"], "study") == {"x": desk["x"] + seat["dx"], "feet": desk["y"] + seat["dy"], "size": seat["size"]}
    flipped = {**room["layout"], "items": [{**p, "x": 300, "flip": True} if p["item"] == "desk" else p for p in room["layout"]["items"]]}
    assert pet_room.pet_spot(flipped, "study")["x"] == 300 - seat["dx"]  # a turned desk turns its seat too

    client.put("/api/personal-room", headers=aqua.headers, json=body(room, layout={"items": without(room, "pet_cushion")}))
    assert client.post("/api/personal-room/photo/preview", headers=aqua.headers, json={"pose": "rest"}).json()["pose"] == "rug"
    send_walk(db, aqua.id)
    away = client.post("/api/personal-room/photo", headers=aqua.headers, json={"pose": "rug", "client_request_id": "room-photo-away"})
    assert away.status_code == 409 and away.json()["code"] == "pet_away"
    assert db.query(Memory).count() == 0


def test_friends_visit_the_saved_room_read_only_and_strangers_cannot(client, db):
    aqua, mây, lạ = person(client, "Aqua", pet="dolphin"), person(client, "May", pet="cat"), person(client, "La")
    room = saved(client, aqua)["room"]
    client.put("/api/personal-room", headers=aqua.headers, json=body(room, layout={"floor": "floor_tile_cream"}))
    assert client.get(f"/api/personal-room/visit/{aqua.id}", headers=mây.headers).status_code == 404  # not friends yet
    befriend(client, aqua, mây)
    visit = client.get(f"/api/personal-room/visit/{aqua.id}", headers=mây.headers)
    assert visit.status_code == 200
    data = visit.json()
    assert data["room"]["layout"]["floor"] == "floor_tile_cream" and data["pet"]["id"] == "dolphin"
    assert data["guest_pet"]["id"] == "cat" and "email" not in data["owner"]
    assert client.get(f"/api/personal-room/visit/{aqua.id}", headers=lạ.headers).status_code == 404
    assert client.get(f"/api/personal-room/visit/{mây.id}", headers=mây.headers).status_code == 404  # own room is not a visit
    # There is no way for a visitor to change the room: saving always edits the caller's own room.
    before = saved(client, aqua)["room"]
    client.put("/api/personal-room", headers=mây.headers, json=body(saved(client, mây)["room"], layout={"wall": "wall_mint"}))
    assert saved(client, aqua)["room"] == before

    client.post(f"/api/users/{aqua.id}/block", headers=mây.headers)
    assert client.get(f"/api/personal-room/visit/{aqua.id}", headers=mây.headers).status_code == 404


def test_greetings_notify_the_owner_once_per_cooldown_even_while_the_pet_walks(client, db):
    aqua, mây = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, mây)
    send_walk(db, aqua.id)
    hello = client.post(f"/api/personal-room/visit/{aqua.id}/greetings", headers=mây.headers, json={"kind": "hello"})
    assert hello.status_code == 201 and hello.json()["sent"] is True and hello.json()["host_away"] is True
    repeat = client.post(f"/api/personal-room/visit/{aqua.id}/greetings", headers=mây.headers, json={"kind": "hello"})
    assert repeat.status_code == 429 and repeat.json()["code"] == "greeting_cooldown"
    assert client.post(f"/api/personal-room/visit/{aqua.id}/greetings", headers=mây.headers,
                       json={"kind": "cheer", "message": "study_well"}).status_code == 201
    notes = db.scalars(select(SocialNotification).where(SocialNotification.user_id == aqua.id,
                                                        SocialNotification.kind == "room_visit")).all()
    assert [json.loads(n.data_json)["action"] for n in notes] == ["hello", "cheer"]
    assert "đang đi dạo" in notes[0].body and "Học tốt nhé!" in notes[1].body
    walk = db.scalars(select(PetWalk).where(PetWalk.user_id == aqua.id)).one()
    assert walk.rewarded_at is None  # visiting never ends the walk


def test_every_catalog_item_has_artwork_and_the_default_photo_renders(client):
    data = pet_room.art()
    surfaces = {i for i, item in pet_room.ITEMS.items() if item["kind"] != "item"}
    assert surfaces == set(data["surfaces"]) and set(pet_room.ITEMS) - surfaces == set(data["items"])
    assert {group for group, _ in pet_room.GROUPS} == {item["group"] for item in pet_room.ITEMS.values()}
    for item_id, art in [*data["items"].items(), *data["surfaces"].items()]:
        ids = re.findall(r"id='([^']+)'", art["svg"])
        assert all(i.startswith(f"{item_id}-") for i in ids), item_id  # ids are namespaced, so items can be combined
    for item_id, art in data["items"].items():
        tokens = set(re.findall(r"@(\w+)", art["svg"]))
        assert all(tokens <= set(v["colors"]) for v in art["variants"]), item_id  # every variant paints every colour
        assert art["mount"] in data["areas"] and len(art["box"]) == 4
    for p in [*pet_room.DEFAULT_LAYOUT["items"], *pet_room.LEGACY_ITEMS.values()]:
        assert pet_room.clean_placement(p) == p, p  # the default and the old slots sit where they are drawn
    user = User(pet="fox", pet_name="Hỏa", level=3)
    room = PetRoom(name="Phòng", background_id="", wall_id="wall_cream", floor_id="floor_wood_light",
                   items_json=pet_room.stored_items(pet_room.DEFAULT_LAYOUT["items"]), version=1, updated_at=utcnow())
    svg = pet_room.render_photo(pet_room.photo_snapshot(user, room, "rest"), "Tiêu đề <b>", None, "27/10/2026")
    assert "Tiêu đề &lt;b&gt;" in svg and svg.count("<image") == 1 and "@" not in svg.split("<image")[0]
