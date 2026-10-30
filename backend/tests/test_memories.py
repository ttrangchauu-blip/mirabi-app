import base64
import html
import json
import re
import struct
import unicodedata
import zlib

import pytest

from app import items_catalog as cat, memories, memory_render
from app.models import Memory, PetEvolution, User, utcnow
from app.progression import record_level_ups
from together import create_room, join, person
from test_pet_room import body, classic
from test_room_sessions import start, study


@pytest.fixture()
def me(client):
    email = "album-owner@example.com"
    assert client.post("/api/auth/register", json={"email": email, "password": "Sparkle123"}).status_code == 201
    login = client.post("/api/auth/login", json={"email": email, "password": "Sparkle123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def payload(key="manual-memory-0001"):
    return {"title": "Ngày đầu bên nhau", "message": "Một ngày rất vui", "client_request_id": key,
            "snapshot": {"pet_name": "Mây", "pet_id": "fox", "level": 2, "element": "Lửa",
                         "accessory": None, "background": "home"}}


def owner(db) -> User:
    return db.query(User).filter(User.email == "album-owner@example.com").one()


def by_type(client, headers, event_type):
    items = client.get("/api/memories", headers=headers).json()["items"]
    return [client.get(f"/api/memories/{m['id']}", headers=headers).json() for m in items if m["event_type"] == event_type]


def test_manual_memory_is_idempotent_private_and_editable(client, me, db):
    user = owner(db)
    user.pet_name, user.level = "Mây", 2
    db.commit()
    first = client.post("/api/memories", headers=me, json=payload())
    assert first.status_code == 201
    second = client.post("/api/memories", headers=me, json=payload())
    assert second.status_code == 201 and second.json()["id"] == first.json()["id"]
    assert db.query(Memory).filter(Memory.source_key == "manual:manual-memory-0001").count() == 1

    other = client.post("/api/auth/register", json={"email": "album-other@example.com", "password": "Sparkle123"})
    assert other.status_code == 201
    login = client.post("/api/auth/login", json={"email": "album-other@example.com", "password": "Sparkle123"}).json()
    other_headers = {"Authorization": f"Bearer {login['access_token']}"}
    assert client.get(f"/api/memories/{first.json()['id']}", headers=other_headers).status_code == 404

    changed = client.patch(f"/api/memories/{first.json()['id']}", headers=me,
                           json={"title": "Tên mới", "message": "Lời nhắn mới", "favorite": True})
    assert changed.status_code == 200
    assert changed.json()["favorite"] is True and changed.json()["snapshot"]["pet_name"] == "Mây"
    # The caption changed; the picture is the one taken when the memory was saved.
    assert changed.json()["title"] == "Tên mới" and changed.json()["image_svg"] == first.json()["image_svg"]


def test_manual_memory_shows_the_pet_as_it_is_and_the_preview_is_the_saved_picture(client, me, db):
    user = owner(db)
    user.pet, user.pet_name, user.level = "turtle", "Rùa", 3
    db.commit()
    request = {"title": "Chiều thứ bảy", "message": "Đi dạo công viên", "template_key": "walk", "palette_key": "peach",
               "include_message": True}
    preview = client.post("/api/memories/preview", headers=me, json=request)
    assert preview.status_code == 200 and db.query(Memory).count() == 0
    # An older app's snapshot (another pet, another level) is not trusted: the server draws the pet as it is.
    stored = client.post("/api/memories", headers=me, json={**request, **payload("manual-memory-preview"),
                                                             "title": "Chiều thứ bảy", "message": "Đi dạo công viên"})
    memory = stored.json()
    assert stored.status_code == 201 and memory["status"] == "ready"
    assert memory["snapshot"]["pet_id"] == "turtle" and memory["snapshot"]["level"] == 3
    assert memory["snapshot"]["pet_name"] == "Rùa" and memory["snapshot"]["note"] == "Đi dạo công viên"
    assert memories.pet_art("turtle", 3) in memory["image_svg"] and "Đi dạo công viên" in memory["image_svg"]
    # The preview is the same picture, but for the date it was drawn on.
    assert preview.json()["svg"].count(memories.pet_art("turtle", 3)) == memory["image_svg"].count(memories.pet_art("turtle", 3))
    assert "Chiều thứ bảy" in preview.json()["svg"] and "Đi dạo công viên" in preview.json()["svg"]


def test_hatch_and_evolution_keep_the_pet_of_that_moment(client, db):
    """Create the memories, then rename the pet, evolve it further, change its accessory and redecorate: the pictures
    stay as they were taken."""
    may = person(client, "May", pet="fox")
    me = may.headers
    user = db.get(User, may.id)
    user.pet_name, user.level, user.equipped_item = "Mây", 3, "Nơ đỏ"
    db.commit()
    record_level_ups(db, user, 0, 3, utcnow())  # hatched and reached Lv.2 and Lv.3 in one go
    db.commit()
    hatched, = by_type(client, me, "pet_hatched")
    evolved = sorted(by_type(client, me, "pet_evolved"), key=lambda m: m["snapshot"]["level"])
    assert [m["snapshot"]["level"] for m in evolved] == [2, 3] and hatched["snapshot"]["level"] == 1
    assert memories.pet_art("fox", 1) in hatched["image_svg"] and memories.pet_art("fox", 3) not in hatched["image_svg"]
    lv3 = evolved[1]
    assert lv3["snapshot"]["before_level"] == 2 and lv3["title"] == "Mây đạt cấp 3"
    assert memories.pet_art("fox", 3) in lv3["image_svg"] and memories.pet_art("fox", 2) in lv3["image_svg"]
    assert "Nơ đỏ" in lv3["image_svg"] and "Mây · Cấp 3" in lv3["image_svg"]

    room = classic(client, may)
    assert client.put("/api/personal-room", headers=me, json=body(room, layout={"wall": "wall_lilac"})).status_code == 200
    assert client.put("/api/pet", headers=me, json={"pet": "fox", "name": "Sấm"}).status_code == 200
    db.refresh(user)
    user.level, user.equipped_item = 5, "Mũ len"
    db.commit()
    record_level_ups(db, user, 3, 5, utcnow())
    db.commit()

    again = {m["id"]: m for m in by_type(client, me, "pet_evolved") + by_type(client, me, "pet_hatched")}
    for old in [hatched, *evolved]:
        assert again[old["id"]]["image_svg"] == old["image_svg"]
        assert again[old["id"]]["thumbnail_svg"] == old["thumbnail_svg"]
        assert again[old["id"]]["snapshot"] == old["snapshot"]
    lv5 = next(m for m in again.values() if m["snapshot"]["level"] == 5)
    assert "Sấm · Cấp 5" in lv5["image_svg"] and "Mũ len" in lv5["image_svg"]


def test_memories_are_not_guessed_from_the_current_pet(client, me, db):
    """Progress from before the album existed has no record of the pet's name or look then: no memory is made up."""
    user = owner(db)
    user.level = 2
    db.add(PetEvolution(user_id=user.id, pet_id=user.pet, total_xp=800, level=2))
    db.commit()
    assert client.get("/api/memories", headers=me).json()["items"] == []
    assert client.get("/api/memories/pending", headers=me).json() is None


def test_a_picture_that_could_not_be_drawn_is_drawn_later_from_the_event(client, me, db, monkeypatch, tmp_path):
    user = owner(db)
    user.pet, user.pet_name, user.level = "cat", "Sương", 1
    db.commit()
    monkeypatch.setattr(memories, "ASSETS", tmp_path)  # the artwork can't be read right now
    record_level_ups(db, user, 0, 1, utcnow())
    db.commit()
    row = db.query(Memory).filter(Memory.event_type == "pet_hatched").one()
    assert row.status == "pending" and row.image_svg == "" and row.thumbnail_svg == ""
    listed = client.get("/api/memories", headers=me).json()["items"]
    assert listed[0]["status"] == "pending" and listed[0]["thumbnail_svg"] == ""  # no stand-in picture
    assert client.get(f"/api/memories/{row.id}", headers=me).json()["image_svg"] == ""

    # Meanwhile the pet grows up and is renamed; the retry still draws the newly hatched Sương.
    user.pet_name, user.level = "Bão", 4
    db.commit()
    monkeypatch.undo()
    drawn = client.get(f"/api/memories/{row.id}", headers=me).json()
    assert drawn["status"] == "ready" and memories.pet_art("cat", 1) in drawn["image_svg"]
    assert memories.pet_art("cat", 4) not in drawn["image_svg"] and "Sương · Cấp 1" in drawn["image_svg"]
    assert "Bão" not in drawn["image_svg"] and drawn["thumbnail_svg"].startswith("<svg")


def test_an_old_picture_without_its_pet_is_redrawn_from_its_own_snapshot(client, me, db):
    user = owner(db)
    user.level = 6
    snap = {"pet_name": "Mây", "pet_id": "fox", "level": 2, "element": "fox", "accessory": None,
            "background": "home", "result": None}
    old = Memory(user_id=user.id, pet_id="fox", event_type="pet_evolved", source_key="evolution:fox:2", title="Tên mới",
                 event_text="", event_at=utcnow(), snapshot_json=json.dumps(snap),
                 image_svg='<svg><image href="" x="20%"/></svg>', thumbnail_svg='<svg><image href=""/></svg>')
    kept = Memory(user_id=user.id, pet_id="fox", event_type="pet_hatched", source_key="hatch:fox:1", title="Pet đã nở!",
                  event_text="", event_at=utcnow(), snapshot_json=json.dumps({**snap, "level": 1}),
                  image_svg='<svg><image href="data:image/png;base64,AAAA"/></svg>', thumbnail_svg="<svg/>")
    db.add_all([old, kept])
    db.commit()
    redrawn = client.get(f"/api/memories/{old.id}", headers=me).json()
    assert memories.pet_art("fox", 2) in redrawn["image_svg"] and memories.pet_art("fox", 6) not in redrawn["image_svg"]
    assert "Mây đạt cấp 2" in redrawn["image_svg"]  # the headline it had, not the edited title
    # A complete old picture is the one taken back then: it is never redrawn.
    assert client.get(f"/api/memories/{kept.id}", headers=me).json()["image_svg"] == kept.image_svg


def test_a_walk_keepsake_shows_the_item_it_brought_back(client, me, db):
    from app.companion import keepsake_memory
    from app.models import PetWalk
    user = owner(db)
    user.pet_name = "Mây"
    walk = PetWalk(user_id=user.id, item_id="catalog", location_id="seaside", started_at=utcnow(), returns_at=utcnow(),
                   task_cycle_id="2026-10-30")
    db.add(walk)
    db.flush()
    keepsake_memory(db, user, walk, "place_badge", "seaside", "seaside")
    db.commit()
    memory, = by_type(client, me, "walk_keepsake")
    place = cat.LOCATIONS["seaside"]["name"]
    assert memory["snapshot"]["item"] == {"id": "place_badge", "variant": "seaside", "name": "Huy hiệu địa điểm",
                                          "place": place, "location": "seaside"}
    assert memory["title"] == f"Huy hiệu địa điểm từ {place}"
    assert "place_badge-seaside-clip" in memory["image_svg"] and "place_badge-seaside-clip" in memory["thumbnail_svg"]


def test_a_group_memory_shows_the_friends_who_studied_along(client, clock, db):
    ana, binh = person(client, "Ana", pet="fox"), person(client, "Binh", pet="penguin")
    snap = create_room(client, ana, cycles=1)
    assert join(client, binh, snap["code"]).status_code == 200
    start(client, ana, snap["id"])
    study(client, clock, [ana, binh], snap["id"], 25)
    memory, = by_type(client, ana.headers, "first_group_session")
    binh_user = db.get(User, binh.id)
    assert memory["snapshot"]["friends"] == [{"display_name": "Binh", "pet_id": "penguin", "pet_name": "Binh Pet",
                                              "level": binh_user.level}]
    assert memories.pet_art("penguin", binh_user.level) in memory["image_svg"] and "Tập trung 25 phút cùng 1 bạn" in memory["image_svg"]
    # Binh renames and changes pet later; Ana's memory keeps the study session as it was.
    client.put("/api/pet", headers=binh.headers, json={"pet": "cat", "name": "Mèo"})
    assert by_type(client, ana.headers, "first_group_session")[0]["image_svg"] == memory["image_svg"]


def rgba(data: bytes) -> tuple[int, int, list[bytearray]]:
    """Width, height and RGBA rows of an 8-bit RGBA PNG (what the renderer writes)."""
    w, h = struct.unpack(">II", data[16:24])
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and data[24:26] == bytes([8, 6])
    i, idat = 8, b""
    while i < len(data):
        n, kind = struct.unpack(">I4s", data[i:i + 8])
        idat += data[i + 8:i + 8 + n] if kind == b"IDAT" else b""
        i += 12 + n
    raw, stride, prev, rows = zlib.decompress(idat), w * 4, bytearray(w * 4), []
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a, b, c = line[x - 4] if x >= 4 else 0, prev[x], prev[x - 4] if x >= 4 else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                line[x] = (line[x] + min((abs(p - a), 0, a), (abs(p - b), 1, b), (abs(p - c), 2, c))[2]) & 255
        rows.append(line)
        prev = line
    return w, h, rows


def texts(svg: str) -> list[dict]:
    return [{**dict(re.findall(r'([\w-]+)="([^"]*)"', attrs)), "text": html.unescape(body)}
            for attrs, body in re.findall(r"<text\b([^>]*)>([^<]*)</text>", svg)]


def test_the_album_shows_saves_and_shares_one_png_drawn_with_the_app_font(client, me, db):
    user = owner(db)
    user.pet, user.pet_name, user.level = "bunny", "Bông", 5
    db.commit()
    # A long title typed with combining marks (NFD) and an emoji the font has no letter for.
    title = unicodedata.normalize("NFD", "Kỷ niệm đáng nhớ: lần đầu tiên chúng mình học xuyên đêm, ôn thi cuối kỳ, "
                                         "uống trà sữa và ngắm bình minh ở ban công 🌅")
    request = {"title": title, "template_key": "study", "palette_key": "sky"}
    preview = client.post("/api/memories/preview", headers=me, json=request).json()
    memory = client.post("/api/memories", headers=me, json={**request, "client_request_id": "long-title-0001"}).json()
    image = client.get(f"/api/memories/{memory['id']}/image", headers=me)
    assert image.status_code == 200
    png = base64.b64decode(image.json()["png"])
    w, h, rows = rgba(png)
    assert (w, h) == (1080, 1350) == (image.json()["width"], image.json()["height"])
    # Opaque to the corners: a saved photo has no see-through parts.
    assert min(min(row[3::4]) for row in rows) == 255
    assert image.json()["key"] == memory["image_key"]
    # The create sheet previewed the same PNG (the preview's date is the same day).
    assert base64.b64decode(preview["png"]) == png

    lines = texts(memory["image_svg"])
    assert all(x["font-family"] == "Nunito" for x in lines)
    title_lines = [x for x in lines if float(x["font-size"]) >= 50]
    assert 2 <= len(title_lines) <= 3 and title_lines[-1]["text"].endswith("…")
    for line in title_lines:
        size = float(line["font-size"])
        assert memory_render.width(line["text"], size) <= memories.TEXT_WIDTH
        assert float(line["y"]) - size * 1.011 > 126 and float(line["y"]) + size * .353 < 330  # clear of label and pet
        assert unicodedata.is_normalized("NFC", line["text"]) and "🌅" not in line["text"]
    assert "Kỷ niệm đáng nhớ" in title_lines[0]["text"]


def test_an_old_picture_is_rendered_with_its_text_and_square_corners(client, me, db):
    """Pictures stored before the font was named say "sans-serif"; they keep their text, in Nunito."""
    old = ('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">'
           '<rect width="100%" height="100%" rx="64" fill="#DDF1F6"/>'
           '<text x="50%" y="14%" text-anchor="middle" font-size="50.4" font-weight="800" fill="#173B52" '
           'font-family="sans-serif">Sóng đạt cấp 4</text></svg>')
    _, _, rows = rgba(memory_render.png(old))
    title_band = rows[160:200]
    assert any(min(row[0::4]) < 100 for row in title_band)  # dark letters were drawn
    assert tuple(rows[0][:4]) == (0xDD, 0xF1, 0xF6, 255)  # the corner is the card, not transparent
    # A line that ran past the card's edges is made to fit.
    long = old.replace("Sóng đạt cấp 4", "Một tiêu đề rất dài từ phiên bản cũ của album kỷ niệm, không được xuống dòng")
    line, = texts(memory_render.fit_text(long))
    assert memory_render.width(line["text"], float(line["font-size"])) <= 1080 * .9


def test_a_redraw_that_fails_keeps_the_old_picture_and_keeps_its_title(client, me, db, monkeypatch, tmp_path):
    user = owner(db)
    snap = {"pet_name": "Mây", "pet_id": "fox", "level": 2, "element": "fox", "background": "home"}
    old_svg = ('<svg><text x="540" y="206" font-size="60">Chiều thứ bảy</text><text x="540" y="276" font-size="60">'
               'ở công viên</text><image href="" x="20%"/></svg>')
    old = Memory(user_id=user.id, pet_id="fox", event_type="manual", source_key="manual:old-0001",
                 title="Tiêu đề đã sửa", event_text="", event_at=utcnow(), snapshot_json=json.dumps(snap),
                 image_svg=old_svg, thumbnail_svg="<svg/>")
    db.add(old)
    db.commit()
    monkeypatch.setattr(memories, "ASSETS", tmp_path)  # the artwork can't be read right now
    kept = client.get(f"/api/memories/{old.id}", headers=me).json()
    assert kept["status"] == "ready" and kept["image_svg"] == old_svg
    monkeypatch.undo()
    redrawn = client.get(f"/api/memories/{old.id}", headers=me).json()
    assert memories.pet_art("fox", 2) in redrawn["image_svg"]
    assert "Chiều thứ bảy ở công viên" in redrawn["image_svg"] and "Tiêu đề đã sửa" not in redrawn["image_svg"]


def test_a_picture_not_drawn_yet_has_no_png(client, me, db, monkeypatch, tmp_path):
    user = owner(db)
    user.pet, user.level = "cat", 1
    db.commit()
    monkeypatch.setattr(memories, "ASSETS", tmp_path)
    record_level_ups(db, user, 0, 1, utcnow())
    db.commit()
    row = db.query(Memory).filter(Memory.event_type == "pet_hatched").one()
    reply = client.get(f"/api/memories/{row.id}/image", headers=me)
    assert reply.status_code == 409 and reply.json()["code"] == "memory_image_pending"


def test_room_photo_captions_stay_inside_the_picture(client):
    aqua = person(client, "Aqua", pet="dolphin")
    classic(client, aqua)
    request = {"pose": "rug", "title": "MƯỜNG THANH " * 2 + "MƯỜNG MƯỜNG", "message": "Lời nhắn thật dài " * 3 + "ở cuối"}
    svg = client.post("/api/personal-room/photo/preview", headers=aqua.headers, json=request).json()["svg"]
    captions = [x for x in texts(svg) if x.get("text-anchor") != "end"]
    assert captions[0]["text"].startswith("MƯỜNG THANH") and captions[0]["text"].endswith("…")
    for line in captions:  # inside the card, with the same 72 px margin on the right as on the left
        assert 72 + memory_render.width(line["text"], float(line["font-size"]), int(line["font-weight"])) <= 1080 - 72
