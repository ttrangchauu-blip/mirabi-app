"""Personal pet room (Phòng cá nhân): the owner's saved layout, decoration ownership and room photos. Friends visit
it read only through room_visits.py, which reads the same saved room and pet state from here.

A room has a wall and a floor (surfaces) and a list of placed items. Each placement is one catalog item (ITEMS) with its
colour variant, position, and a flip or tilt where the artwork allows it; the owner moves items around freely. The
artwork and geometry of every item live in mobile/assets/room/room-art.json, which the app draws and the photo export
below renders, so the photo matches the screen. Pet, level, EXP and walk state are always read from their own tables,
never copied here, and opening the room never settles or starts a walk.
"""
from __future__ import annotations

import html
import json
import math
import re
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .companion import inventory, latest_walk
from .db import get_db
from .errors import APIError
from .friends import no_control_chars, presence_for
from .memories import create_once, pet_data_uri, view as memory_view
from .models import Memory, PetRoom, PetRoomItem, PomodoroSettings, StudySession, User, as_utc, utcnow
from .security import current_user

router = APIRouter(prefix="/api/personal-room", tags=["personal room"])

# Tabs of the decorating panel. "surface" holds the wall and floor; every other group holds placeable items.
GROUPS = [("surface", "Tường và sàn"), ("furniture", "Bàn ghế"), ("bed", "Giường pet"), ("rug", "Thảm"),
          ("storage", "Kệ và tủ"), ("plant", "Cây xanh"), ("light", "Đèn"), ("wall_decor", "Cửa sổ và tranh"),
          ("toy", "Đồ chơi")]
SURFACES = [("wall", "Giấy dán tường"), ("floor", "Sàn nhà")]
MAX_ITEMS = 24

# Stable ids (rooms and photos store them): only ever add. `kind` is "wall" or "floor" for surfaces and "item" for
# placeable items. "starter" items are granted with the room; an item with `inventory_id` is owned while the user has
# that walk find (companion.REWARD_ITEMS) in their inventory.
ITEMS: dict[str, dict] = {
    "wall_cream": {"kind": "wall", "group": "surface", "name": "Tường kem chấm bi", "source": "starter"},
    "wall_mint": {"kind": "wall", "group": "surface", "name": "Tường sọc bạc hà", "source": "starter"},
    "wall_lilac": {"kind": "wall", "group": "surface", "name": "Tường sọc tím nhạt", "source": "starter"},
    "wall_peach": {"kind": "wall", "group": "surface", "name": "Tường hồng đào", "source": "starter"},
    "floor_wood_light": {"kind": "floor", "group": "surface", "name": "Sàn gỗ sáng", "source": "starter"},
    "floor_wood_honey": {"kind": "floor", "group": "surface", "name": "Sàn gỗ mật ong", "source": "starter"},
    "floor_tile_cream": {"kind": "floor", "group": "surface", "name": "Sàn gạch kem", "source": "starter"},
    "desk": {"kind": "item", "group": "furniture", "name": "Bàn học", "source": "starter"},
    "chair": {"kind": "item", "group": "furniture", "name": "Ghế tựa", "source": "starter"},
    "side_table": {"kind": "item", "group": "furniture", "name": "Bàn trà tròn", "source": "starter"},
    "pouf": {"kind": "item", "group": "furniture", "name": "Ghế đôn", "source": "starter"},
    "pet_cushion": {"kind": "item", "group": "bed", "name": "Đệm tròn", "source": "starter"},
    "pet_bed_basket": {"kind": "item", "group": "bed", "name": "Giường mây", "source": "starter"},
    "pet_house": {"kind": "item", "group": "bed", "name": "Lều ngủ", "source": "starter"},
    "rug_oval": {"kind": "item", "group": "rug", "name": "Thảm bầu dục", "source": "starter"},
    "rug_round": {"kind": "item", "group": "rug", "name": "Thảm tròn viền sò", "source": "starter"},
    "rug_stripes": {"kind": "item", "group": "rug", "name": "Thảm sọc tua rua", "source": "starter"},
    "bookcase": {"kind": "item", "group": "storage", "name": "Tủ sách", "source": "starter"},
    "cube_shelf": {"kind": "item", "group": "storage", "name": "Kệ ô vuông", "source": "starter"},
    "wall_shelf": {"kind": "item", "group": "storage", "name": "Kệ treo tường", "source": "starter"},
    "lantern_shelf": {"kind": "item", "group": "storage", "name": "Kệ đèn lồng trăng", "source": "walk",
                      "inventory_id": "moon_lantern"},
    "plant_monstera": {"kind": "item", "group": "plant", "name": "Chậu cây lá lớn", "source": "starter"},
    "plant_flowers": {"kind": "item", "group": "plant", "name": "Chậu hoa", "source": "starter"},
    "hanging_plant": {"kind": "item", "group": "plant", "name": "Chậu cây treo", "source": "starter"},
    "small_pot": {"kind": "item", "group": "plant", "name": "Chậu cây nhỏ", "source": "walk", "inventory_id": "small_pot"},
    "floor_lamp": {"kind": "item", "group": "light", "name": "Đèn cây", "source": "starter"},
    "mushroom_lamp": {"kind": "item", "group": "light", "name": "Đèn nấm", "source": "starter"},
    "garland": {"kind": "item", "group": "light", "name": "Dây đèn lấp lánh", "source": "starter"},
    "window": {"kind": "item", "group": "wall_decor", "name": "Cửa sổ vòm", "source": "starter"},
    "window_round": {"kind": "item", "group": "wall_decor", "name": "Cửa sổ tròn", "source": "starter"},
    "painting_hills": {"kind": "item", "group": "wall_decor", "name": "Tranh đồi xanh", "source": "starter"},
    "painting_tulips": {"kind": "item", "group": "wall_decor", "name": "Tranh hoa tulip", "source": "starter"},
    "cork_board": {"kind": "item", "group": "wall_decor", "name": "Bảng ghim kỷ niệm", "source": "starter"},
    "wall_clock": {"kind": "item", "group": "wall_decor", "name": "Đồng hồ treo tường", "source": "starter"},
    "toy_ball": {"kind": "item", "group": "toy", "name": "Cuộn len", "source": "starter"},
    "toy_blocks": {"kind": "item", "group": "toy", "name": "Khối gỗ xếp hình", "source": "starter"},
    "toy_plush": {"kind": "item", "group": "toy", "name": "Gấu bông nhỏ", "source": "starter"},
}


def placement(item: str, variant: str, x: int, y: int, flip: bool = False, rotate: int = 0) -> dict:
    return {"item": item, "variant": variant, "x": x, "y": y, "flip": flip, "rotate": rotate}


DEFAULT_LAYOUT = {"wall": "wall_cream", "floor": "floor_wood_light", "items": [
    placement("window", "morning", 200, 124), placement("painting_hills", "oak", 62, 124),
    placement("wall_shelf", "oak", 336, 122), placement("rug_oval", "sage", 200, 372),
    placement("desk", "oak", 96, 318), placement("floor_lamp", "cream", 372, 316),
    placement("pet_cushion", "blue", 318, 356), placement("plant_monstera", "terracotta", 60, 436),
    placement("toy_ball", "pink", 262, 412)]}
# Rooms saved before items could be moved kept one item per fixed slot; each old id is drawn by today's item.
LEGACY_SLOTS = ("background", "shelf", "rug", "study", "rest", "plant")
LEGACY_ITEMS = {
    "window_morning": placement("window", "morning", 200, 124), "window_starry": placement("window", "starry", 200, 124),
    "shelf_books": placement("wall_shelf", "oak", 336, 122), "shelf_moon_lantern": placement("lantern_shelf", "oak", 336, 122),
    "rug_sage": placement("rug_oval", "sage", 200, 372), "rug_peach": placement("rug_round", "peach", 200, 372),
    "rug_sky_stripes": placement("rug_stripes", "sky", 200, 374),
    "desk_oak": placement("desk", "oak", 96, 318), "desk_white": placement("desk", "white", 96, 318),
    "cushion_blue": placement("pet_cushion", "blue", 318, 356), "bed_basket": placement("pet_bed_basket", "natural", 318, 360),
    "plant_monstera": placement("plant_monstera", "terracotta", 60, 436),
    "plant_flowers": placement("plant_flowers", "pink", 46, 436), "plant_small_pot": placement("small_pot", "default", 46, 436),
}
POSES = ("rug", "study", "rest")
ART_PATH = Path(__file__).resolve().parents[2] / "mobile" / "assets" / "room" / "room-art.json"


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    no_control_chars(value)
    return value.strip() or None


class PlacementInput(BaseModel):
    item: str = Field(max_length=40)
    variant: str | None = Field(default=None, max_length=24)
    x: float = Field(ge=-1000, le=1000)
    y: float = Field(ge=-1000, le=1000)
    flip: bool = False
    rotate: int = Field(default=0, ge=-180, le=180)


class RoomInput(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    wall_id: str = Field(max_length=40)
    floor_id: str = Field(max_length=40)
    items: list[PlacementInput] = Field(default_factory=list, max_length=MAX_ITEMS)
    version: int = Field(ge=1)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = _clean_text(value) or ""
        if not value:
            raise ValueError("Name cannot be empty")
        return value


class PhotoInput(BaseModel):
    pose: Literal["rug", "study", "rest"] = "rug"
    title: str | None = Field(default=None, max_length=40)
    message: str | None = Field(default=None, max_length=60)

    @field_validator("title", "message")
    @classmethod
    def _text(cls, value: str | None) -> str | None:
        return _clean_text(value)


class SavePhotoInput(PhotoInput):
    client_request_id: str = Field(min_length=8, max_length=80)


# ---------------------------------------------------------------------------- artwork geometry
@lru_cache(maxsize=1)
def art() -> dict:
    try:
        return json.loads(ART_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise APIError(503, "room_art_missing", "Room artwork is not available")


def _round(value: float) -> int:
    return math.floor(value + 0.5)  # the app rounds the same way (Math.floor(v + 0.5))


def item_box(meta: dict, flip: bool, rotate: int) -> tuple[float, float, float, float]:
    """The item's extent around its anchor once flipped (first) and tilted."""
    x0, y0, x1, y1 = meta["box"]
    if flip:
        x0, x1 = -x1, -x0
    if rotate:
        a = math.radians(rotate)
        c, s = math.cos(a), math.sin(a)
        xs, ys = zip(*((x * c - y * s, x * s + y * c) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))))
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    return x0, y0, x1, y1


def _fit(value: float, low: float, high: float) -> float:
    return (low + high) / 2 if low > high else min(max(value, low), high)


def fit_position(meta: dict, x: float, y: float, flip: bool, rotate: int) -> tuple[int, int]:
    """Moves an item back inside its area: wall items stay on the wall, rugs on the floor, and floor items stand on
    the floor with nothing outside the room."""
    data = art()
    x0, y0, x1, y1 = item_box(meta, flip, rotate)
    ax0, ay0, ax1, ay1 = data["areas"][meta["mount"]]
    x = _fit(x, ax0 - x0, ax1 - x1)
    if meta["mount"] == "floor":
        low, high = data["feet"]
        y = _fit(y, max(low, ay0 - y0), min(high, ay1 - y1))
    else:
        y = _fit(y, ay0 - y0, ay1 - y1)
    return _round(x), _round(y)


def transform_allowed(meta: dict, flip: bool, rotate: int) -> bool:
    if flip and not meta.get("flip"):
        return False
    if rotate:
        step, limit = meta.get("rotate") or (0, 0)
        return bool(step) and rotate % step == 0 and abs(rotate) <= limit
    return True


def clean_placement(raw: dict) -> dict | None:
    """A stored placement as it can be drawn today, or None when it no longer can (never expected, but be safe)."""
    meta = art()["items"].get(raw.get("item"))
    if meta is None or ITEMS.get(raw["item"], {}).get("kind") != "item":
        return None
    variants = [v["id"] for v in meta["variants"]]
    variant = raw.get("variant") if raw.get("variant") in variants else variants[0]
    flip, rotate = bool(raw.get("flip")), int(raw.get("rotate") or 0)
    if not transform_allowed(meta, flip, rotate):
        flip, rotate = False, 0
    x, y = fit_position(meta, float(raw.get("x", 0)), float(raw.get("y", 0)), flip, rotate)
    return placement(raw["item"], variant, x, y, flip, rotate)


# ---------------------------------------------------------------------------- ownership and the saved room
def grant_starter_items(db: Session, user_id: int) -> None:
    """Record ownership of every starter decoration once; later additions to the starter set are granted too."""
    owned = set(db.scalars(select(PetRoomItem.item_id).where(PetRoomItem.user_id == user_id)))
    for item_id, item in ITEMS.items():
        if item["source"] == "starter" and item_id not in owned:
            try:
                with db.begin_nested():
                    db.add(PetRoomItem(user_id=user_id, item_id=item_id, source="starter", granted_at=utcnow()))
            except IntegrityError:
                pass  # granted by a concurrent request


def owned_items(db: Session, user: User) -> set[str]:
    granted = set(db.scalars(select(PetRoomItem.item_id).where(PetRoomItem.user_id == user.id)))
    finds = inventory(user, db)
    return {item_id for item_id, item in ITEMS.items()
            if item_id in granted or (item.get("inventory_id") and finds.get(item["inventory_id"], 0) > 0)}


def default_name(user: User) -> str:
    return f"Phòng của {user.pet_name or 'Pet'}"[:40]


def stored_items(items: list[dict]) -> str:
    return json.dumps({"items": items}, ensure_ascii=False)


def ensure_room(db: Session, user: User) -> PetRoom:
    """The owner's room, created with the default layout the first time. Never overwrites a saved room. Commits."""
    room = db.get(PetRoom, user.id)
    if room is None:
        try:
            with db.begin_nested():
                db.add(PetRoom(user_id=user.id, name=default_name(user), background_id="", wall_id=DEFAULT_LAYOUT["wall"],
                               floor_id=DEFAULT_LAYOUT["floor"], items_json=stored_items(DEFAULT_LAYOUT["items"]), version=1))
        except IntegrityError:
            pass  # a concurrent first open created it
        room = db.get(PetRoom, user.id)
    grant_starter_items(db, user.id)
    db.commit()
    return room


def layout(room: PetRoom) -> dict:
    """{wall, floor, items: [placement]}. A room saved with fixed slots reads as the same items at their old places."""
    stored = json.loads(room.items_json or "{}")
    if isinstance(stored, dict) and isinstance(stored.get("items"), list):
        raw = stored["items"]
    else:
        slots = {"background": room.background_id, **(stored if isinstance(stored, dict) else {})}
        raw = [LEGACY_ITEMS[slots[slot]] for slot in LEGACY_SLOTS if slots.get(slot) in LEGACY_ITEMS]
    items, seen = [], set()
    for entry in raw:
        clean = clean_placement(entry) if isinstance(entry, dict) else None
        if clean and clean["item"] not in seen:
            seen.add(clean["item"])
            items.append(clean)
    wall = room.wall_id if ITEMS.get(room.wall_id, {}).get("kind") == "wall" else DEFAULT_LAYOUT["wall"]
    floor = room.floor_id if ITEMS.get(room.floor_id, {}).get("kind") == "floor" else DEFAULT_LAYOUT["floor"]
    return {"wall": wall, "floor": floor, "items": items[:MAX_ITEMS]}


def room_view(room: PetRoom) -> dict:
    return {"name": room.name, "layout": layout(room), "version": room.version,
            "updated_at": as_utc(room.updated_at).isoformat()}


def catalog(owned: set[str]) -> dict:
    return {"groups": [{"id": group, "label": label} for group, label in GROUPS],
            "surfaces": [{"id": kind, "label": label} for kind, label in SURFACES],
            "items": [{"id": item_id, "kind": item["kind"], "group": item["group"], "name": item["name"],
                       "source": item["source"], "owned": item_id in owned} for item_id, item in ITEMS.items()],
            "max_items": MAX_ITEMS}


# ---------------------------------------------------------------------------- live pet state (read only)
def walk_view(db: Session, user: User) -> dict:
    """Whether the pet is out on its walk, read without settling or starting anything."""
    walk = latest_walk(user, db)
    away = walk is not None and walk.collected_at is None and as_utc(walk.returns_at) > utcnow()
    return {"away": away, "return_at": as_utc(walk.returns_at).isoformat() if away else None}


def activity(db: Session, user: User, *, viewer_id: int | None = None) -> str:
    """"studying" while a personal focus session is running or the user studies in a group room, else "idle".
    A visitor only sees "studying" when the owner's presence settings allow it."""
    if viewer_id is not None and viewer_id != user.id:
        presence = presence_for(db, viewer_id, {user.id})[user.id]["status"]
        if presence == "hidden":
            return "idle"
        if presence == "studying":
            return "studying"
    elif presence_for(db, user.id, {user.id})[user.id]["status"] == "studying":
        return "studying"
    prefs = db.get(PomodoroSettings, user.id)
    minutes = min(180, prefs.focus_minutes if prefs else 25) + 10
    started = db.scalar(select(StudySession.id).where(
        StudySession.user_id == user.id, StudySession.status == "started",
        StudySession.started_at >= utcnow() - timedelta(minutes=minutes)).limit(1))
    return "studying" if started else "idle"


def pet_view(user: User) -> dict:
    return {"id": user.pet, "name": user.pet_name, "level": user.level, "xp": user.xp}


# ---------------------------------------------------------------------------- drawing (same order as src/room/art.ts)
def _num(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def _paint(svg: str, colors: dict[str, str]) -> str:
    return re.sub(r"@(\w+)", lambda m: colors.get(m.group(1), "#000000"), svg)


def item_markup(p: dict) -> str:
    meta = art()["items"][p["item"]]
    colors = next((v["colors"] for v in meta["variants"] if v["id"] == p["variant"]), meta["variants"][0]["colors"])
    transform = f"translate({p['x']} {p['y']})" + (f" rotate({p['rotate']})" if p["rotate"] else "") + (" scale(-1 1)" if p["flip"] else "")
    shadow = ""
    if meta.get("shadow"):
        rx, ry = meta["shadow"]
        shadow = f"<ellipse cx='{p['x']}' cy='{p['y']}' rx='{_num(rx)}' ry='{_num(ry)}' fill='#6B4E3C' opacity='.16'/>"
    return f"{shadow}<g transform='{transform}'>{_paint(meta['svg'], colors)}</g>"


def light_markup(p: dict) -> str:
    """Sunlight (or moonlight) from a window, falling on the floor in front of it."""
    meta = art()["items"][p["item"]]
    colors = next((v["colors"] for v in meta["variants"] if v["id"] == p["variant"]), meta["variants"][0]["colors"])
    w, length = meta["light"]["w"] // 2, meta["light"]["len"]
    top = art()["canvas"]["floorY"] + 6
    gid = f"light-{p['item']}"
    return (f"<defs><linearGradient id='{gid}' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='{colors['light']}' "
            f"stop-opacity='{colors['lightop']}'/><stop offset='1' stop-color='{colors['light']}' stop-opacity='0'/></linearGradient></defs>"
            f"<path d='M{p['x'] - w - 10} {top}H{p['x'] + w + 10}L{p['x'] + w + 46} {top + length + 8}H{p['x'] - w + 2}Z' "
            f"fill='url(#{gid})' opacity='.5'/>"
            f"<path d='M{p['x'] - w} {top}H{p['x'] + w}L{p['x'] + w + 30} {top + length}H{p['x'] - w + 10}Z' fill='url(#{gid})'/>")


def room_markup(room_layout: dict) -> str:
    """Everything behind the pets, back to front: wall, floor, wall items, rugs, window light, then floor items from
    the back of the room to the front, and a soft vignette. Pets are always drawn on top, so nothing covers them."""
    data = art()
    items = room_layout["items"]

    def mount(p: dict) -> str:
        return data["items"][p["item"]]["mount"]

    parts = [data["surfaces"][room_layout["wall"]]["svg"], data["surfaces"][room_layout["floor"]]["svg"]]
    parts += [item_markup(p) for p in items if mount(p) == "wall"]
    parts += [item_markup(p) for p in items if mount(p) == "rug"]
    parts += [light_markup(p) for p in items if data["items"][p["item"]].get("light")]
    parts += [item_markup(p) for p in sorted((p for p in items if mount(p) == "floor"), key=lambda p: p["y"])]
    parts.append(data["vignette"])
    return "".join(parts)


ROLE = {"rug": "rug", "study": "study", "rest": "rest"}


def pet_spot(room_layout: dict, pose: str) -> dict:
    """Where the pet stands: on its rug, at its desk or on its bed, wherever the owner put them. Without a rug it
    stands in the middle of the room."""
    data = art()
    spot = dict(data["spots"]["rug"])
    for p in room_layout["items"]:
        meta = data["items"][p["item"]]
        if meta.get("role") == ROLE[pose]:
            seat = meta["seat"]
            spot = {"x": p["x"] + (-seat["dx"] if p["flip"] else seat["dx"]), "feet": p["y"] + seat["dy"], "size": seat["size"]}
            break
    half, canvas = spot["size"] / 2, data["canvas"]
    spot["x"] = _fit(spot["x"], half + 2, canvas["width"] - half - 2)
    spot["feet"] = _fit(spot["feet"], canvas["floorY"] + 24, canvas["height"] - 2)
    return spot


def normalize_pose(pose: str, room_layout: dict) -> str:
    """The pet studies at its desk and rests on its bed; without that furniture it stays on its rug."""
    if pose == "rug":
        return pose
    return pose if any(art()["items"][p["item"]].get("role") == pose for p in room_layout["items"]) else "rug"


def scene_markup(room_layout: dict, pose: str, pet_id: str, level: int) -> str:
    """The room on its 400 x 440 canvas with the pet."""
    spot = pet_spot(room_layout, pose)
    uri = pet_data_uri(pet_id, level)
    size = spot["size"]
    pet = (f'<image href="{uri}" x="{_num(spot["x"] - size / 2)}" y="{_num(spot["feet"] - size)}" width="{_num(size)}" '
           f'height="{_num(size)}" preserveAspectRatio="xMidYMax meet"/>') if uri else ""
    return room_markup(room_layout) + pet


FONT_BOLD = "Nunito_800ExtraBold, Nunito, sans-serif"
FONT_TEXT = "Nunito_600SemiBold, Nunito, sans-serif"


def render_photo(snapshot: dict, title: str, message: str | None, date_text: str) -> str:
    """The 1080 x 1350 room photo: the scene in a rounded frame (no buttons, EXP or menus) and a short caption."""
    canvas = art()["canvas"]
    scale = 984 / canvas["width"]
    scene_height = canvas["height"] * scale
    scene = scene_markup(snapshot["room"]["layout"], snapshot["pose"], snapshot["pet_id"], snapshot["level"])
    caption = html.escape(message) if message else html.escape(f"{snapshot['pet_name']} · Cấp {snapshot['level']}")
    meta = html.escape(f"{snapshot['pet_name']} · Cấp {snapshot['level']} · {date_text}" if message else date_text)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">'
        f'<defs><clipPath id="room-photo-frame"><rect x="48" y="48" width="984" height="{scene_height:.1f}" rx="44"/></clipPath></defs>'
        '<rect width="1080" height="1350" fill="#FBF6EE"/>'
        f'<g clip-path="url(#room-photo-frame)"><g transform="translate(48 48) scale({scale:.4f})">{scene}</g></g>'
        f'<rect x="48" y="48" width="984" height="{scene_height:.1f}" rx="44" fill="none" stroke="#FFFFFF" stroke-width="6"/>'
        f'<text x="72" y="1196" font-size="42" font-weight="800" fill="#173B52" font-family="{FONT_BOLD}">{html.escape(title)}</text>'
        f'<text x="72" y="1246" font-size="28" font-weight="600" fill="#4F6C79" font-family="{FONT_TEXT}">{caption}</text>'
        f'<text x="72" y="1296" font-size="26" font-weight="600" fill="#6A8492" font-family="{FONT_TEXT}">{meta}</text>'
        f'<text x="1008" y="1296" text-anchor="end" font-size="30" font-weight="800" fill="#136FA8" font-family="{FONT_BOLD}">Mirabi</text>'
        '</svg>')


def render_thumbnail(snapshot: dict) -> str:
    """The album card: the part of the scene around the pet, at card proportions."""
    room_layout = snapshot["room"]["layout"]
    spot = pet_spot(room_layout, snapshot["pose"])
    top = _round(_fit(spot["feet"] - spot["size"] / 2 - 140, 0, art()["canvas"]["height"] - 280))
    scene = scene_markup(room_layout, snapshot["pose"], snapshot["pet_id"], snapshot["level"])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 {top} 400 280" '
            f'preserveAspectRatio="xMidYMid slice">{scene}</svg>')


def photo_snapshot(user: User, room: PetRoom, pose: str) -> dict:
    room_layout = layout(room)
    return {"pet_name": user.pet_name or "Pet", "pet_id": user.pet, "level": user.level, "element": user.pet,
            "accessory": None, "background": room_layout["wall"], "result": None,
            "pose": normalize_pose(pose, room_layout), "room": {"name": room.name, "layout": room_layout, "version": room.version}}


def default_title(user: User) -> str:
    return f"Một ngày ở phòng {user.pet_name or 'Pet'}"[:40]


def date_label(at) -> str:
    return as_utc(at).strftime("%d/%m/%Y")


def ensure_present(db: Session, user: User) -> None:
    if walk_view(db, user)["away"]:
        raise APIError(409, "pet_away", "The pet is out on a walk")


# ---------------------------------------------------------------------------- owner endpoints
@router.get("")
def get_room(user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = ensure_room(db, user)
    return {"room": room_view(room), "catalog": catalog(owned_items(db, user)), "pet": pet_view(user),
            "activity": activity(db, user), "walk": walk_view(db, user)}


def _check_surface(item_id: str, kind: str, owned: set[str]) -> None:
    if ITEMS.get(item_id, {}).get("kind") != kind:
        raise APIError(422, "invalid_item", f"{item_id} is not a {kind}")
    if item_id not in owned:
        raise APIError(403, "item_not_owned", f"{item_id} is not owned")


@router.put("")
def save_room(data: RoomInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Saves the whole room. Only owned items, each at most once, in a variant and flip/tilt its artwork has; positions
    are moved back inside the room if needed (the app does the same while dragging)."""
    room = ensure_room(db, user)
    if data.version != room.version:
        raise APIError(409, "room_version_conflict", "The room changed since it was opened")
    owned = owned_items(db, user)
    _check_surface(data.wall_id, "wall", owned)
    _check_surface(data.floor_id, "floor", owned)
    items, seen = [], set()
    for entry in data.items:
        meta = art()["items"].get(entry.item)
        if meta is None or ITEMS.get(entry.item, {}).get("kind") != "item":
            raise APIError(422, "invalid_item", f"{entry.item} is not a room item")
        if entry.item in seen:
            raise APIError(422, "duplicate_item", f"{entry.item} is already in the room")
        if entry.item not in owned:
            raise APIError(403, "item_not_owned", f"{entry.item} is not owned")
        variant = entry.variant or meta["variants"][0]["id"]
        if variant not in {v["id"] for v in meta["variants"]}:
            raise APIError(422, "invalid_variant", f"{entry.item} has no variant {variant}")
        if not transform_allowed(meta, entry.flip, entry.rotate):
            raise APIError(422, "invalid_transform", f"{entry.item} cannot be turned that way")
        seen.add(entry.item)
        x, y = fit_position(meta, entry.x, entry.y, entry.flip, entry.rotate)
        items.append(placement(entry.item, variant, x, y, entry.flip, entry.rotate))
    # Only the version read above may be replaced, even if two saves race.
    changed = db.query(PetRoom).filter(PetRoom.user_id == user.id, PetRoom.version == data.version).update({
        PetRoom.name: data.name, PetRoom.background_id: "", PetRoom.wall_id: data.wall_id, PetRoom.floor_id: data.floor_id,
        PetRoom.items_json: stored_items(items), PetRoom.version: PetRoom.version + 1, PetRoom.updated_at: utcnow()},
        synchronize_session=False)
    if changed != 1:
        db.rollback()
        raise APIError(409, "room_version_conflict", "The room changed since it was opened")
    db.commit()
    db.refresh(room)
    return {"room": room_view(room)}


@router.post("/photo/preview")
def preview_photo(data: PhotoInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The exact image "Lưu" will store, from the saved room. Stores nothing."""
    room = ensure_room(db, user)
    ensure_present(db, user)
    snap = photo_snapshot(user, room, data.pose)
    return {"svg": render_photo(snap, data.title or default_title(user), data.message, date_label(utcnow())),
            "pose": snap["pose"]}


@router.post("/photo", status_code=201)
def save_photo(data: SavePhotoInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Save a room photo to the memory album. The image and the room/pet it shows are frozen; a retry with the same
    `client_request_id` returns the same memory instead of a second one."""
    room = ensure_room(db, user)
    source_key = f"room_photo:{data.client_request_id}"
    existing = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.source_key == source_key))
    if existing is not None:
        if existing.deleted_at is not None:
            raise APIError(409, "memory_deleted", "This memory was already deleted")
        return memory_view(existing, detail=True)
    ensure_present(db, user)
    snap = photo_snapshot(user, room, data.pose)
    now = utcnow()
    title = data.title or default_title(user)
    row = create_once(db, user, "room_photo", source_key, now, snap, title, data.message)
    if row is None:  # a concurrent retry stored it first
        row = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.source_key == source_key))
        return memory_view(row, detail=True)
    row.include_message = bool(data.message)
    row.image_svg = render_photo(snap, title, data.message, date_label(now))
    row.thumbnail_svg = render_thumbnail(snap)
    db.commit()
    return memory_view(row, detail=True)
