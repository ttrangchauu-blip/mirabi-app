"""Decorated rooms: the personal pet room (Phòng cá nhân) and the Focus Space room (Phòng tập trung). The owner's saved
layouts, decoration ownership and room photos. Friends visit the personal room read only through room_visits.py, which
reads the same saved room and pet state from here.

A room has a wall and a floor (surfaces) and a list of placed items. Each placement is one catalog item (ITEMS) with its
colour variant, position, and a flip or tilt where the artwork allows it; the owner moves items around freely. Items hang
on the wall, lie on the floor (rugs), stand on the floor, or stand on the top of a desk or shelf ("top" items, carried by
that support). Both rooms share the catalog and the rules; each has its own canvas ("rooms" in the artwork) and its own
saved layout (PetRoom, FocusRoomLayout). The artwork and geometry of every item live in
mobile/assets/room/room-art.json, which the app draws and the photo export below renders, so the photo matches the
screen. Pet, level, EXP and walk state are always read from their own tables, never copied here, and opening a room
never settles or starts a walk.
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

from . import inventory as inv
from . import items_catalog as cat
from .companion import latest_walk
from .db import get_db
from .errors import APIError
from .friends import no_control_chars, presence_for
from .memories import Caption, create_once, pet_data_uri, view as memory_view
from .memory_render import clean, ellipsize
from .models import (FocusRoomLayout, InventoryStack, Memory, PetRoom, PetRoomItem, PlacedItem, PomodoroSettings, StudySession,
                     User, as_utc, utcnow)
from .security import current_user

router = APIRouter(prefix="/api/personal-room", tags=["personal room"])
focus_router = APIRouter(prefix="/api/focus-room", tags=["personal room"])

# Tabs of the decorating panel. "surface" holds the wall, the floor and the colour palettes; every other group holds
# placeable items. Groups are only a display choice (rooms store item ids), so they may change.
GROUPS = [("surface", "Tường và sàn"), ("table", "Bàn"), ("chair", "Ghế"), ("storage", "Tủ và kệ"), ("light", "Đèn"),
          ("plant", "Cây"), ("wall_decor", "Trang trí tường"), ("study", "Đồ học tập"), ("living", "Đồ sinh hoạt"),
          ("pet", "Đồ cho pet"), ("special", "Đặc biệt"), ("found", "Đồ khám phá")]
SURFACES = [("wall", "Giấy dán tường"), ("floor", "Sàn nhà")]
MAX_ITEMS = 32
ROOM_KINDS = ("personal", "focus")


def _starter(kind: str, group: str, name: str) -> dict:
    return {"kind": kind, "group": group, "name": name, "source": "starter"}


def _item(group: str, name: str) -> dict:
    return _starter("item", group, name)


# Stable ids (rooms and photos store them): only ever add. `kind` is "wall" or "floor" for surfaces and "item" for
# placeable items. "starter" items are granted with the room, one of each per room. An item with `inventory_id` is a
# decoration a pet found on a walk (items_catalog): it is counted, each copy in a room is one of the inventory's copies
# (a PlacedItem row, its `uid` stored with the placement), so a room may hold several and a copy is in one room only.
ITEMS: dict[str, dict] = {
    "wall_cream": _starter("wall", "surface", "Tường kem chấm bi"),
    "wall_mint": _starter("wall", "surface", "Tường sọc bạc hà"),
    "wall_lilac": _starter("wall", "surface", "Tường sọc lavender"),
    "wall_peach": _starter("wall", "surface", "Tường hồng đào"),
    "wall_sky": _starter("wall", "surface", "Tường xanh biển"),
    "wall_night": _starter("wall", "surface", "Tường đêm sao"),
    "floor_wood_light": _starter("floor", "surface", "Sàn gỗ sáng"),
    "floor_wood_honey": _starter("floor", "surface", "Sàn gỗ mật ong"),
    "floor_tile_cream": _starter("floor", "surface", "Sàn gạch kem"),
    "floor_tile_blue": _starter("floor", "surface", "Sàn gạch xanh trắng"),
    "floor_wood_rose": _starter("floor", "surface", "Sàn gỗ hồng đào"),
    "floor_tile_lilac": _starter("floor", "surface", "Sàn gạch lavender"),
    "floor_wood_night": _starter("floor", "surface", "Sàn gỗ đêm"),
    # Bàn
    "desk": _item("table", "Bàn học"),
    "computer_desk": _item("table", "Bàn máy tính"),
    "low_table": _item("table", "Bàn trà thấp"),
    "side_table": _item("table", "Bàn tròn"),
    # Ghế
    "chair": _item("chair", "Ghế gỗ"),
    "swivel_chair": _item("chair", "Ghế xoay"),
    "armchair": _item("chair", "Ghế đệm"),
    "bean_bag": _item("chair", "Ghế lười"),
    "pouf": _item("chair", "Ghế đôn"),
    # Tủ và kệ
    "bookcase": _item("storage", "Kệ sách"),
    "low_cabinet": _item("storage", "Tủ thấp"),
    "drawer_chest": _item("storage", "Tủ ngăn kéo"),
    "cube_shelf": _item("storage", "Kệ ô vuông"),
    "wall_shelf": _item("storage", "Kệ treo tường"),
    "lantern_shelf": {**_item("found", "Kệ đèn lồng trăng"), "source": "walk", "inventory_id": "moon_lantern"},
    # Đèn
    "desk_lamp": _item("light", "Đèn bàn"),
    "floor_lamp": _item("light", "Đèn đứng"),
    "night_lamp": _item("light", "Đèn ngủ"),
    "mushroom_lamp": _item("light", "Đèn nấm"),
    "garland": _item("light", "Dây đèn lấp lánh"),
    # Cây
    "desk_plant": _item("plant", "Cây để bàn"),
    "plant_monstera": _item("plant", "Chậu cây lớn"),
    "hanging_plant": _item("plant", "Cây treo"),
    "flower_vase": _item("plant", "Bình hoa"),
    "plant_flowers": _item("plant", "Chậu hoa"),
    "small_pot": {**_item("found", "Chậu cây nhỏ"), "source": "walk", "inventory_id": "small_pot"},
    # Trang trí tường
    "window": _item("wall_decor", "Cửa sổ vòm"),
    "window_round": _item("wall_decor", "Cửa sổ tròn"),
    "painting_hills": _item("wall_decor", "Tranh đồi xanh"),
    "painting_tulips": _item("wall_decor", "Tranh hoa tulip"),
    "poster": _item("wall_decor", "Poster"),
    "wall_clock": _item("wall_decor", "Đồng hồ treo tường"),
    "memo_board": _item("wall_decor", "Bảng ghi chú"),
    "cork_board": _item("wall_decor", "Bảng ghim kỷ niệm"),
    "calendar": _item("wall_decor", "Lịch treo tường"),
    # Đồ học tập
    "book_stack": _item("study", "Chồng sách"),
    "notebook": _item("study", "Vở mở"),
    "laptop": _item("study", "Laptop"),
    "pencil_cup": _item("study", "Hộp bút"),
    "easel": _item("study", "Bảng vẽ"),
    # Đồ sinh hoạt
    "rug_oval": _item("living", "Thảm bầu dục"),
    "rug_round": _item("living", "Thảm tròn viền sò"),
    "rug_stripes": _item("living", "Thảm sọc tua rua"),
    "curtains": _item("living", "Rèm cửa"),
    "floor_cushion": _item("living", "Gối ngồi"),
    "sofa": _item("living", "Sofa"),
    "mug": _item("living", "Cốc nước"),
    # Đồ cho pet
    "pet_bed_basket": _item("pet", "Giường mây"),
    "pet_cushion": _item("pet", "Đệm tròn"),
    "pet_house": _item("pet", "Nhà nhỏ"),
    "pet_bowl": _item("pet", "Bát ăn"),
    "toy_ball": _item("pet", "Cuộn len"),
    "toy_blocks": _item("pet", "Khối gỗ xếp hình"),
    "toy_plush": _item("pet", "Gấu bông nhỏ"),
    "toy_basket": _item("pet", "Giỏ đồ chơi"),
    # Đặc biệt
    "fish_tank": _item("special", "Bể cá"),
    "globe": _item("special", "Quả địa cầu"),
    "record_player": _item("special", "Máy nghe nhạc"),
    "element_crystal": _item("special", "Pha lê nguyên tố"),
    "element_banner": _item("special", "Cờ nguyên tố"),
}
# Đồ khám phá: every decoration of the walk catalog, drawn by the room artwork under its `art` id.
for _id, _found in cat.ITEMS.items():
    if _found["art"] and _found["art"] not in ITEMS:
        ITEMS[_found["art"]] = {**_item("found", _found["name"]), "source": "walk", "inventory_id": _id}


def counted(item: str) -> str | None:
    """The catalog id of a found decoration (placed copy by copy), None for a starter item."""
    return ITEMS.get(item, {}).get("inventory_id")


def key(p: dict) -> str:
    """What tells placements apart: a found decoration's copy by its uid, any other item by its id (once per room)."""
    return p.get("uid") or p["item"]


def placement(item: str, variant: str, x: int, y: int, flip: bool = False, rotate: int = 0, uid: str | None = None) -> dict:
    p = {"item": item, "variant": variant, "x": x, "y": y, "flip": flip, "rotate": rotate}
    if uid:
        p["uid"] = uid
    return p


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
    # A found decoration's copy ("p<id>" once saved); a new copy may come with a temporary one, or none.
    uid: str | None = Field(default=None, max_length=24)


class LayoutInput(BaseModel):
    wall_id: str = Field(max_length=40)
    floor_id: str = Field(max_length=40)
    items: list[PlacementInput] = Field(default_factory=list, max_length=MAX_ITEMS)
    version: int = Field(ge=1)


class RoomInput(LayoutInput):
    name: str = Field(min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = _clean_text(value) or ""
        if not value:
            raise ValueError("Name cannot be empty")
        return value


class PhotoInput(BaseModel):
    pose: Literal["rug", "study", "rest"] = "rug"
    title: Caption | None = Field(default=None, max_length=40)
    message: Caption | None = Field(default=None, max_length=60)

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


def geometry(kind: str = "personal") -> dict:
    """The room's canvas, areas, feet range, pet spots and vignette (personal 420 x 770, focus 640 x 440)."""
    return art()["rooms"][kind]


def default_layout(kind: str = "personal") -> dict:
    """The room a user gets on first open: a complete, decorated room, with room left for the pet."""
    return json.loads(json.dumps(art()["defaults"][kind]))


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


def fit_position(meta: dict, x: float, y: float, flip: bool, rotate: int, kind: str = "personal") -> tuple[int, int]:
    """Moves an item back inside its area: wall items stay on the wall, rugs on the floor, floor items stand on the
    floor with nothing outside the room. A top item only stays inside the room; its support decides its height."""
    geo = geometry(kind)
    x0, y0, x1, y1 = item_box(meta, flip, rotate)
    ax0, ay0, ax1, ay1 = geo["areas"][meta["mount"]]
    x = _fit(x, ax0 - x0, ax1 - x1)
    if meta["mount"] == "floor":
        low, high = geo["feet"]
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


# ---------------------------------------------------------------------------- supports (items on a desk or shelf)
def top_lines(p: dict) -> list[tuple[float, float, float]]:
    """The tops of a placed support where top items stand, in canvas units: (x0, x1, y)."""
    meta = art()["items"][p["item"]]
    lines = []
    for tx0, tx1, dy in meta.get("tops") or ():
        if p["flip"]:
            tx0, tx1 = -tx1, -tx0
        lines.append((p["x"] + tx0, p["x"] + tx1, p["y"] + dy))
    return lines


SNAP = 1.0  # a top item's feet are on a top when within this of it (positions are whole numbers, tops may not be)


def support_of(p: dict, items: list[dict]) -> dict | None:
    """The support a top item stands on: a placed item with a top under its feet that is wide enough for it."""
    meta = art()["items"][p["item"]]
    bx0, _, bx1, _ = item_box(meta, p["flip"], p["rotate"])
    for s in items:
        if s is p or key(s) == key(p) or not art()["items"].get(s["item"], {}).get("tops"):
            continue
        for x0, x1, y in top_lines(s):
            if abs(p["y"] - y) <= SNAP and p["x"] + bx0 >= x0 - 2 and p["x"] + bx1 <= x1 + 2:
                return s
    return None


def seated_tops(items: list[dict]) -> list[dict]:
    """The items with every top item standing on a desk or shelf. One standing on nothing (saved before that rule, or
    read from an older canvas) is put on the free part of the nearest top it fits on; with none in the room, it goes
    back to the storage (it stays owned). The rest never move."""
    data = art()["items"]
    out = [p for p in items if data[p["item"]]["mount"] != "top" or support_of(p, items) is not None]
    for p in items:
        if p in out:
            continue
        bx0, _, bx1, _ = item_box(data[p["item"]], p["flip"], p["rotate"])
        best, best_d = None, math.inf
        for s in out:
            busy = [(q["x"] + item_box(data[q["item"]], q["flip"], q["rotate"])[0], q["x"] + item_box(data[q["item"]], q["flip"], q["rotate"])[2])
                    for q in out if data[q["item"]]["mount"] == "top" and support_of(q, out) is s]
            for x0, x1, y in top_lines(s):
                lo, hi = math.ceil(x0 - bx0), math.floor(x1 - bx1)
                for x in sorted(range(lo, hi + 1), key=lambda v: abs(v - p["x"])):
                    if any(x + bx0 < b - 1 and x + bx1 > a + 1 for a, b in busy):
                        continue
                    d = math.hypot(x - p["x"], y - p["y"])
                    if d < best_d:
                        best, best_d = {**p, "x": x, "y": _round(y)}, d
                    break
        if best is not None and support_of(best, out) is not None:
            out.append(best)
    return out


# ---------------------------------------------------------------------------- the pet's room to stand and move
def footprint(meta: dict, p: dict) -> tuple[float, float, float, float]:
    """The strip of floor a floor item stands on (as the app's walk.obstacles, without the pet's width)."""
    x0, _, x1, _ = item_box(meta, p["flip"], p["rotate"])
    depth = min(36, max(14, (x1 - x0) * 0.3))
    return p["x"] + x0 + 4, p["y"] - depth - 6, p["x"] + x1 - 4, p["y"] + 6


def pet_homes(room_layout: dict, kind: str) -> list[tuple[dict, str | None]]:
    """Every spot the pet uses in this room, with the item it belongs to: its rug, desk and bed in the personal room;
    its desk (or, without one, its rug) in the focus room."""
    poses = ("rug", "study", "rest") if kind == "personal" else ("study",)
    homes = []
    for pose in poses:
        pose = normalize_pose(pose, room_layout)
        home = _home(room_layout, pose)
        entry = (pet_spot(room_layout, pose, kind), key(home) if home else None)
        if entry not in homes:
            homes.append(entry)
    return homes


def blocking_items(room_layout: dict, kind: str) -> set[str]:
    """Floor items standing where the pet stands, or in front of it hiding most of it (by `key`)."""
    data = art()["items"]
    blocked: set[str] = set()
    for spot, home in pet_homes(room_layout, kind):
        half = spot["size"] * 0.32
        zone = (spot["x"] - half, spot["feet"] - spot["size"] * 0.85, spot["x"] + half, spot["feet"])
        zone_area = (zone[2] - zone[0]) * (zone[3] - zone[1])
        for p in room_layout["items"]:
            meta = data.get(p["item"])
            if meta is None or meta["mount"] != "floor" or key(p) == home:
                continue
            fx0, fy0, fx1, fy1 = footprint(meta, p)
            if fx0 < spot["x"] < fx1 and fy0 < spot["feet"] < fy1:
                blocked.add(key(p))
                continue
            if p["y"] > spot["feet"]:
                x0, y0, x1, y1 = item_box(meta, p["flip"], p["rotate"])
                w = min(zone[2], p["x"] + x1) - max(zone[0], p["x"] + x0)
                h = min(zone[3], p["y"] + y1) - max(zone[1], p["y"] + y0)
                if w > 0 and h > 0 and w * h > 0.25 * zone_area:
                    blocked.add(key(p))
    return blocked


# ---------------------------------------------------------------------------- personal rooms saved on older canvases
# The personal room's canvas changed: 400 wide with its floor from 292 down to 440 until art v5 (briefly down to 640),
# then 360 x 760 with its content below 160 (art v5), now 420 x 770 (art v6, above the menu bar). A room saved on an
# older canvas is read on today's: the same arrangement across the width, the wall items spread over today's wall and
# the floor items evenly over today's deeper floor (a desk a sixth of the way into the old floor is a sixth of the way
# into today's, so the front of the room is used as before), and what stands on a desk or shelf moves with it. Nothing is rewritten in the database: the next save stores today's canvas.
CANVAS_VERSION = 6
# Each older canvas: width, where its wall's content starts, its floor line, and how deep its floor is.
OLD_CANVAS = {"v2": (400, 0, 292, 148.0), "v4": (400, 0, 292, 348.0), 5: (360, 160, 436, 324.0)}


def legacy_point(mount: str, x: float, y: float, source: str | int = "v2") -> tuple[float, float]:
    """Where a point of an older personal canvas is on today's (the app's art.legacyPoint does the same from "v2")."""
    geo = geometry("personal")
    width, floor_y, bottom = geo["canvas"]["width"], geo["canvas"]["floorY"], geo["canvas"]["height"]
    old_width, old_top, old_floor, depth = OLD_CANVAS[source]
    x = width / 2 + (x - old_width / 2) * width / old_width
    if mount == "wall":
        return x, geo["top"] + (y - old_top) * (floor_y - geo["top"]) / (old_floor - old_top)
    d = y - old_floor
    return x, floor_y + (d * (bottom - floor_y) / depth if d > 0 else d)


def from_legacy(raw: list, source: str | int) -> list[dict]:
    """Placements saved on an older personal canvas, moved to today's (see legacy_point)."""
    data = art()["items"]
    old = [placement(e["item"], e.get("variant"), float(e.get("x") or 0), float(e.get("y") or 0), bool(e.get("flip")),
                     int(e.get("rotate") or 0), e.get("uid")) for e in raw if isinstance(e, dict) and e.get("item") in data]
    moved: dict[int, dict] = {}
    supports = {id(p): support_of(p, old) if data[p["item"]]["mount"] == "top" else None for p in old}
    for p in old:
        if supports[id(p)] is None:
            meta = data[p["item"]]
            x, y = legacy_point(meta["mount"], p["x"], p["y"], source)
            x, y = fit_position(meta, x, y, p["flip"], p["rotate"])
            moved[id(p)] = {**p, "x": x, "y": y}
    for p in old:
        if (s := supports[id(p)]) is not None:  # stays on its desk or shelf
            moved[id(p)] = {**p, "x": p["x"] + moved[id(s)]["x"] - s["x"], "y": p["y"] + moved[id(s)]["y"] - s["y"]}
    return [moved[id(p)] for p in old]


def clean_placement(raw: dict, kind: str = "personal") -> dict | None:
    """A stored placement as it can be drawn today, or None when it no longer can (never expected, but be safe)."""
    meta = art()["items"].get(raw.get("item"))
    if meta is None or ITEMS.get(raw["item"], {}).get("kind") != "item":
        return None
    variants = [v["id"] for v in meta["variants"]]
    variant = raw.get("variant") if raw.get("variant") in variants else variants[0]
    flip, rotate = bool(raw.get("flip")), int(raw.get("rotate") or 0)
    if not transform_allowed(meta, flip, rotate):
        flip, rotate = False, 0
    x, y = fit_position(meta, float(raw.get("x", 0)), float(raw.get("y", 0)), flip, rotate, kind)
    uid = raw.get("uid") if counted(raw["item"]) and isinstance(raw.get("uid"), str) else None
    return placement(raw["item"], variant, x, y, flip, rotate, uid)


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
    """Starter items granted with the room, and every found decoration the inventory holds at least one copy of."""
    granted = set(db.scalars(select(PetRoomItem.item_id).where(PetRoomItem.user_id == user.id)))
    finds = inv.totals(db, user.id)
    return {item_id for item_id, item in ITEMS.items()
            if item_id in granted or (item.get("inventory_id") and finds.get(item["inventory_id"], 0) > 0)}


def found_stacks(db: Session, user: User) -> list[dict]:
    """The found decorations the user owns, stack by stack (item and variant): owned, placed in any room, free."""
    placed = inv.placed_counts(db, user.id)
    out = []
    for stack in inv.owned_stacks(db, user.id):
        item = cat.ITEMS.get(stack.item_id)
        if not item or not item["art"] or item["art"] not in ITEMS:
            continue
        n = placed.get((stack.item_id, stack.variant), 0)
        out.append({"item": item["art"], "item_id": stack.item_id, "variant": stack.variant, "name": item["name"],
                    "rarity": item["rarity"], "rarity_label": cat.RARITY_LABELS[item["rarity"]],
                    "owned": stack.quantity, "placed": n, "available": max(0, stack.quantity - n)})
    return out


def default_name(user: User) -> str:
    return f"Phòng của {user.pet_name or 'Pet'}"[:40]


def stored_items(items: list[dict]) -> str:
    return json.dumps({"items": items, "canvas": CANVAS_VERSION}, ensure_ascii=False)


def ensure_room(db: Session, user: User) -> PetRoom:
    """The owner's room, created with the default layout the first time. Never overwrites a saved room. Commits."""
    room = db.get(PetRoom, user.id)
    if room is None:
        start = default_layout("personal")
        try:
            with db.begin_nested():
                db.add(PetRoom(user_id=user.id, name=default_name(user), background_id="", wall_id=start["wall"],
                               floor_id=start["floor"], items_json=stored_items(start["items"]), version=1))
        except IntegrityError:
            pass  # a concurrent first open created it
        room = db.get(PetRoom, user.id)
    grant_starter_items(db, user.id)
    inv.migrate_legacy(db, user.id)
    db.commit()
    return reconcile_copies(db, user, room, "personal")


def ensure_focus_room(db: Session, user: User) -> FocusRoomLayout:
    """The owner's focus room, created with its default layout the first time. Never overwrites a saved one. Commits."""
    room = db.get(FocusRoomLayout, user.id)
    if room is None:
        start = default_layout("focus")
        try:
            with db.begin_nested():
                db.add(FocusRoomLayout(user_id=user.id, wall_id=start["wall"], floor_id=start["floor"],
                                       items_json=stored_items(start["items"]), version=1))
        except IntegrityError:
            pass  # a concurrent first open created it
        room = db.get(FocusRoomLayout, user.id)
    grant_starter_items(db, user.id)
    inv.migrate_legacy(db, user.id)
    db.commit()
    return reconcile_copies(db, user, room, "focus")


def reconcile_copies(db: Session, user: User, room, kind: str):
    """A found decoration saved in a room before copies were counted (the small pot, the moon lantern shelf) becomes
    one of the inventory's copies; with no free copy left it goes back to the storage (still owned). Rooms with no
    such placement are returned untouched. Commits."""
    stored = json.loads(room.items_json or "{}")
    raw = stored.get("items") if isinstance(stored, dict) else None
    if not isinstance(raw, list):
        return room
    rows = {f"p{r}" for r in db.scalars(select(PlacedItem.id).where(PlacedItem.user_id == user.id, PlacedItem.room == kind))}
    if not any(isinstance(e, dict) and counted(e.get("item")) and e.get("uid") not in rows for e in raw):
        return room
    inv.lock_user(db, user.id)
    model = type(room)
    room = db.get(model, user.id, populate_existing=True)
    stored = json.loads(room.items_json or "{}")
    rows = {f"p{r}" for r in db.scalars(select(PlacedItem.id).where(PlacedItem.user_id == user.id, PlacedItem.room == kind))}
    placed = inv.placed_counts(db, user.id)
    stacks = inv.owned_stacks(db, user.id)
    items = []
    for e in stored.get("items", []):
        item_id = counted(e.get("item")) if isinstance(e, dict) else None
        if item_id is None or e.get("uid") in rows:
            items.append(e)
            continue
        free = [s for s in stacks if s.item_id == item_id and s.quantity > placed.get((s.item_id, s.variant), 0)]
        free.sort(key=lambda s: s.variant != e.get("variant"))  # its own colour first
        if not free:
            continue  # back to the storage
        stack = free[0]
        copy = PlacedItem(user_id=user.id, item_id=item_id, variant=stack.variant, room=kind,
                          x=int(e.get("x") or 0), y=int(e.get("y") or 0))
        db.add(copy)
        db.flush()
        inv.record(db, user.id, item_id, stack.variant, kind="place", placed_delta=1, ref=f"room:{kind}")
        placed[(item_id, stack.variant)] = placed.get((item_id, stack.variant), 0) + 1
        items.append({**e, "uid": f"p{copy.id}", "variant": stack.variant})
    room.items_json = json.dumps({**stored, "items": items}, ensure_ascii=False)
    room.version += 1
    db.commit()
    return room


def layout(room: PetRoom | FocusRoomLayout, kind: str = "personal") -> dict:
    """{wall, floor, items: [placement]}. A room saved with fixed slots reads as the same items at their old places, and
    a personal room saved on an older canvas as the same room on today's (from_legacy)."""
    stored = json.loads(room.items_json or "{}")
    if isinstance(stored, dict) and isinstance(stored.get("items"), list):
        raw, current = stored["items"], stored.get("canvas") == CANVAS_VERSION
    else:
        slots = {"background": getattr(room, "background_id", ""), **(stored if isinstance(stored, dict) else {})}
        raw, current = [LEGACY_ITEMS[slots[slot]] for slot in LEGACY_SLOTS if slots.get(slot) in LEGACY_ITEMS], False
    if kind == "personal" and not current:
        source = stored.get("canvas") if isinstance(stored, dict) and stored.get("canvas") in OLD_CANVAS else None
        if source is None:  # the 400 x 440 canvas never had anything below 440; the 400 x 640 one is told apart by that
            deep = any(isinstance(e, dict) and isinstance(e.get("y"), (int, float)) and e["y"] > 445 for e in raw)
            source = "v4" if deep else "v2"
        raw = from_legacy(raw, source)
    items, seen = [], set()
    for entry in raw:
        clean = clean_placement(entry, kind) if isinstance(entry, dict) else None
        if clean and key(clean) not in seen:
            seen.add(key(clean))
            items.append(clean)
    items = seated_tops(items)
    start = default_layout(kind)
    wall = room.wall_id if ITEMS.get(room.wall_id, {}).get("kind") == "wall" else start["wall"]
    floor = room.floor_id if ITEMS.get(room.floor_id, {}).get("kind") == "floor" else start["floor"]
    return {"wall": wall, "floor": floor, "items": items[:MAX_ITEMS]}


def room_view(room: PetRoom) -> dict:
    return {"name": room.name, "layout": layout(room), "version": room.version,
            "updated_at": as_utc(room.updated_at).isoformat()}


def focus_room_view(room: FocusRoomLayout) -> dict:
    return {"name": "Phòng tập trung", "layout": layout(room, "focus"), "version": room.version,
            "updated_at": as_utc(room.updated_at).isoformat()}


def catalog(owned: set[str], found: list[dict] | None = None) -> dict:
    """The decorating panel's catalog. A `counted` item is a found decoration: the room takes its copies from `found`
    (one entry per owned item and variant)."""
    return {"groups": [{"id": group, "label": label} for group, label in GROUPS],
            "surfaces": [{"id": kind, "label": label} for kind, label in SURFACES],
            "items": [{"id": item_id, "kind": item["kind"], "group": item["group"], "name": item["name"],
                       "source": item["source"], "owned": item_id in owned, "counted": bool(item.get("inventory_id"))}
                      for item_id, item in ITEMS.items()],
            "found": found or [], "max_items": MAX_ITEMS}


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


def item_markup(p: dict, part: str = "svg") -> str:
    """An item at its place; `part="cover"` draws only its front (a desk's), without the floor shadow."""
    meta = art()["items"][p["item"]]
    colors = next((v["colors"] for v in meta["variants"] if v["id"] == p["variant"]), meta["variants"][0]["colors"])
    transform = f"translate({p['x']} {p['y']})" + (f" rotate({p['rotate']})" if p["rotate"] else "") + (" scale(-1 1)" if p["flip"] else "")
    shadow = ""
    if meta.get("shadow") and part == "svg":
        rx, ry = meta["shadow"]
        shadow = f"<ellipse cx='{p['x']}' cy='{p['y']}' rx='{_num(rx)}' ry='{_num(ry)}' fill='#6B4E3C' opacity='.16'/>"
    return f"{shadow}<g transform='{transform}'>{_own_ids(_paint(meta[part], colors), p)}</g>"


def _own_ids(svg: str, p: dict) -> str:
    """A copy's gradient ids get its uid, so two copies in other colours never share one (same as the app's ownIds)."""
    if not p.get("uid"):
        return svg
    return re.sub(r"(id='|url\(#)(" + re.escape(p["item"]) + r"-[\w-]*)", lambda m: f"{m.group(1)}{m.group(2)}-{p['uid']}", svg)


def light_markup(p: dict, kind: str = "personal") -> str:
    """Sunlight (or moonlight) from a window, falling on the floor in front of it."""
    meta = art()["items"][p["item"]]
    colors = next((v["colors"] for v in meta["variants"] if v["id"] == p["variant"]), meta["variants"][0]["colors"])
    w, length = meta["light"]["w"] // 2, meta["light"]["len"]
    top = geometry(kind)["canvas"]["floorY"] + 6
    gid = f"light-{key(p)}"
    return (f"<defs><linearGradient id='{gid}' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='{colors['light']}' "
            f"stop-opacity='{colors['lightop']}'/><stop offset='1' stop-color='{colors['light']}' stop-opacity='0'/></linearGradient></defs>"
            f"<path d='M{p['x'] - w - 10} {top}H{p['x'] + w + 10}L{p['x'] + w + 46} {top + length + 8}H{p['x'] - w + 2}Z' "
            f"fill='url(#{gid})' opacity='.5'/>"
            f"<path d='M{p['x'] - w} {top}H{p['x'] + w}L{p['x'] + w + 30} {top + length}H{p['x'] - w + 10}Z' fill='url(#{gid})'/>")


def carried(items: list[dict]) -> tuple[dict[str, list[dict]], list[dict]]:
    """Top items by the `key` of the support they stand on (back to front), and those standing on nothing."""
    on: dict[str, list[dict]] = {}
    loose = []
    for p in items:
        if art()["items"][p["item"]]["mount"] != "top":
            continue
        s = support_of(p, items)
        if s is None:
            loose.append(p)
        else:
            on.setdefault(key(s), []).append(p)
    for group in on.values():
        group.sort(key=lambda p: (p["y"], p["x"]))
    return on, loose


def draw_order(room_layout: dict) -> list[dict]:
    """Back to front: wall items, rugs, then floor items from the back of the room to the front; a support's top items
    right after it, and top items standing on nothing last (same order as the app's art.drawOrder)."""
    data = art()["items"]
    items = [p for p in room_layout["items"] if p["item"] in data]
    on, loose = carried(items)

    def mount(p: dict) -> str:
        return data[p["item"]]["mount"]

    order = []
    for p in ([p for p in items if mount(p) == "wall"] + [p for p in items if mount(p) == "rug"]
              + sorted((p for p in items if mount(p) == "floor"), key=lambda p: p["y"])):
        order.append(p)
        order += on.get(key(p), [])
    return order + loose


def room_markup(room_layout: dict, kind: str = "personal") -> str:
    """Everything behind the pets, back to front: wall, floor, wall items, rugs, window light, then floor items from
    the back of the room to the front (each with what stands on it), and a soft vignette. Pets are drawn on top; only
    the desk a pet sits behind is drawn again over it (`scene_markup`)."""
    data = art()
    surface = "svg" if kind == "personal" else "focus"
    order = draw_order(room_layout)
    walls = [p for p in order if data["items"][p["item"]]["mount"] == "wall" or (
        data["items"][p["item"]]["mount"] == "top" and _on_wall(p, room_layout["items"]))]
    rest = [p for p in order if p not in walls]
    parts = [data["surfaces"][room_layout["wall"]][surface], data["surfaces"][room_layout["floor"]][surface]]
    parts += [item_markup(p) for p in walls]
    rugs = [p for p in rest if data["items"][p["item"]]["mount"] == "rug"]
    parts += [item_markup(p) for p in rugs]
    parts += [light_markup(p, kind) for p in room_layout["items"] if data["items"].get(p["item"], {}).get("light")]
    parts += [item_markup(p) for p in rest if p not in rugs]
    parts.append(geometry(kind)["vignette"])
    return "".join(parts)


def _on_wall(p: dict, items: list[dict]) -> bool:
    s = support_of(p, items)
    return s is not None and art()["items"][s["item"]]["mount"] == "wall"


ROLE = {"rug": "rug", "study": "study", "rest": "rest"}


def _home(room_layout: dict, pose: str) -> dict | None:
    return next((p for p in room_layout["items"] if art()["items"].get(p["item"], {}).get("role") == ROLE[pose]), None)


def pet_spot(room_layout: dict, pose: str, kind: str = "personal") -> dict:
    """Where the pet stands: on its rug, at its desk or on its bed, wherever the owner put them. Without a rug it
    stands in the middle of the room. At a desk it sits on the chair behind it, above the floor."""
    data = art()
    geo = geometry(kind)
    spot = dict(geo["spots"]["rug"])
    home = _home(room_layout, pose)
    behind = False
    if home:
        meta = data["items"][home["item"]]
        seat = meta["seat"]
        spot = {"x": home["x"] + (-seat["dx"] if home["flip"] else seat["dx"]), "feet": home["y"] + seat["dy"], "size": seat["size"]}
        behind = "cover" in meta
    spot["size"] *= geo.get("petScale", 1)  # the personal room's pets are a little smaller against its furniture
    half, canvas = spot["size"] / 2, geo["canvas"]
    spot["x"] = _fit(spot["x"], half + 2, canvas["width"] - half - 2)
    spot["feet"] = _fit(spot["feet"], spot["size"] if behind else canvas["floorY"] + 24, canvas["height"] - 2)
    return spot


def normalize_pose(pose: str, room_layout: dict) -> str:
    """The pet studies at its desk and rests on its bed; without that furniture it stays on its rug."""
    if pose == "rug":
        return pose
    return pose if any(art()["items"].get(p["item"], {}).get("role") == pose for p in room_layout["items"]) else "rug"


def scene_markup(room_layout: dict, pose: str, pet_id: str, level: int) -> str:
    """The room on its 420 x 770 canvas with the pet. At its desk the pet sits behind it: the photo draws its standing
    artwork lowered by the seat's `sink` and the desk's front over it, so the desk hides its legs."""
    spot = pet_spot(room_layout, pose)
    home = _home(room_layout, pose) if pose != "rug" else None
    cover = home if home and "cover" in art()["items"][home["item"]] else None
    sink = art()["items"][cover["item"]]["seat"].get("sink", 0) * geometry().get("petScale", 1) if cover else 0
    feet = spot["feet"] + sink
    uri = pet_data_uri(pet_id, level)
    size = spot["size"]
    pet = (f'<image href="{uri}" x="{_num(spot["x"] - size / 2)}" y="{_num(feet - size)}" width="{_num(size)}" '
           f'height="{_num(size)}" preserveAspectRatio="xMidYMax meet"/>') if uri else ""
    front = ""
    if cover:  # the desk's front, and what stands on the desk, in front of the seated pet
        front = item_markup(cover, "cover") + "".join(item_markup(p) for p in carried(room_layout["items"])[0].get(key(cover), []))
    return room_markup(room_layout) + pet + front


# One family; `font-weight` picks the Nunito file (see memories.FONT).
FONT = "Nunito"


def photo_area() -> tuple[float, float, float]:
    """The part of the personal canvas a photo shows (top, width, height): the room from a little above where its
    content starts, without the wall behind the app's header."""
    geo = geometry()
    top = max(0, geo["top"] - 40)
    return top, geo["canvas"]["width"], geo["canvas"]["height"] - top


def render_photo(snapshot: dict, title: str, message: str | None, date_text: str) -> str:
    """The 1080 x 1350 room photo: the scene in a rounded frame (no buttons, EXP or menus) and a short caption. The
    scene is as large as fits above the caption (984 x 1090 at most), centred."""
    top, width, height = photo_area()
    scale = min(984 / width, 1090 / height)
    scene_width, scene_height = width * scale, height * scale
    left = (1080 - scene_width) / 2
    scene = scene_markup(snapshot["room"]["layout"], snapshot["pose"], snapshot["pet_id"], snapshot["level"])
    # Each caption line is measured to stay inside the card (936 px from x 72); the last one also clears "Mirabi".
    pet = f"{snapshot['pet_name']} · Cấp {snapshot['level']}"
    title = ellipsize(clean(title), 42, 936)
    caption = html.escape(ellipsize(clean(message or "") or clean(pet), 28, 936, 600), quote=False)
    meta = html.escape(ellipsize(clean(f"{pet} · {date_text}" if message else date_text), 26, 800, 600), quote=False)
    frame = f'x="{left:.1f}" y="48" width="{scene_width:.1f}" height="{scene_height:.1f}" rx="44"'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">'
        f'<defs><clipPath id="room-photo-frame"><rect {frame}/></clipPath></defs>'
        '<rect width="1080" height="1350" fill="#FBF6EE"/>'
        f'<g clip-path="url(#room-photo-frame)"><g transform="translate({left:.1f} {48 - top * scale:.1f}) scale({scale:.4f})">{scene}</g></g>'
        f'<rect {frame} fill="none" stroke="#FFFFFF" stroke-width="6"/>'
        f'<text x="72" y="1196" font-size="42" font-weight="800" fill="#173B52" font-family="{FONT}">{html.escape(title, quote=False)}</text>'
        f'<text x="72" y="1246" font-size="28" font-weight="600" fill="#4F6C79" font-family="{FONT}">{caption}</text>'
        f'<text x="72" y="1296" font-size="26" font-weight="600" fill="#6A8492" font-family="{FONT}">{meta}</text>'
        f'<text x="1008" y="1296" text-anchor="end" font-size="30" font-weight="800" fill="#136FA8" font-family="{FONT}">Mirabi</text>'
        '</svg>')


def render_thumbnail(snapshot: dict) -> str:
    """The album card: the part of the scene around the pet, at card proportions."""
    room_layout = snapshot["room"]["layout"]
    spot = pet_spot(room_layout, snapshot["pose"])
    area_top, width, height = photo_area()
    tall = _round(width * 0.7)  # the card's 400 x 280
    top = _round(_fit(spot["feet"] - spot["size"] / 2 - tall / 2, area_top, area_top + height - tall))
    scene = scene_markup(room_layout, snapshot["pose"], snapshot["pet_id"], snapshot["level"])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 {top} {width} {tall}" '
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
    return {"room": room_view(room), "catalog": catalog(owned_items(db, user), found_stacks(db, user)), "pet": pet_view(user),
            "activity": activity(db, user), "walk": walk_view(db, user)}


def _check_surface(item_id: str, kind: str, owned: set[str]) -> None:
    if ITEMS.get(item_id, {}).get("kind") != kind:
        raise APIError(422, "invalid_item", f"{item_id} is not a {kind}")
    if item_id not in owned:
        raise APIError(403, "item_not_owned", f"{item_id} is not owned")


def checked_layout(data: LayoutInput, owned: set[str], previous: dict, kind: str) -> dict:
    """The layout to store: only owned items, a starter item at most once and a found decoration once per copy (its
    `uid`; `sync_copies` checks there are enough), in a variant and flip/tilt its artwork has; positions moved back
    inside the room if needed (the app does the same while dragging). A top item must stand on a desk or shelf in the
    room, and nothing that changed may stand where the pet stands or hide it (`blocking_items`): the app refuses those
    places too. Placements kept exactly as they were stored are never refused."""
    _check_surface(data.wall_id, "wall", owned)
    _check_surface(data.floor_id, "floor", owned)
    items, seen = [], set()
    for index, entry in enumerate(data.items):
        meta = art()["items"].get(entry.item)
        if meta is None or ITEMS.get(entry.item, {}).get("kind") != "item":
            raise APIError(422, "invalid_item", f"{entry.item} is not a room item")
        uid = (entry.uid or f"new{index}") if counted(entry.item) else None
        if (uid or entry.item) in seen:
            raise APIError(422, "duplicate_item", f"{entry.item} is already in the room")
        if entry.item not in owned:
            raise APIError(403, "item_not_owned", f"{entry.item} is not owned")
        variant = entry.variant or meta["variants"][0]["id"]
        if variant not in {v["id"] for v in meta["variants"]}:
            raise APIError(422, "invalid_variant", f"{entry.item} has no variant {variant}")
        if not transform_allowed(meta, entry.flip, entry.rotate):
            raise APIError(422, "invalid_transform", f"{entry.item} cannot be turned that way")
        seen.add(uid or entry.item)
        x, y = fit_position(meta, entry.x, entry.y, entry.flip, entry.rotate, kind)
        items.append(placement(entry.item, variant, x, y, entry.flip, entry.rotate, uid))
    kept = {json.dumps(p, sort_keys=True) for p in previous["items"]}
    changed = {key(p) for p in items if json.dumps(p, sort_keys=True) not in kept}
    for p in items:
        if art()["items"][p["item"]]["mount"] == "top" and key(p) in changed and support_of(p, items) is None:
            raise APIError(422, "unsupported_item", f"{p['item']} must stand on a desk or shelf")
    candidate = {"wall": data.wall_id, "floor": data.floor_id, "items": items}
    if blocked := sorted(blocking_items(candidate, kind) & changed):
        raise APIError(422, "blocks_pet", f"{', '.join(blocked)} would stand in the pet's way")
    return candidate


def sync_copies(db: Session, user: User, kind: str, items: list[dict]) -> list[dict]:
    """Makes the room's placed copies (PlacedItem) match the layout about to be stored, in the caller's transaction:
    a copy kept (its uid) moves with no change of count, a new one takes a free copy of its item and variant, one no
    longer in the room goes back to the storage. Refused (409 not_enough_items) when there are not enough free copies,
    so a copy is never in two places and nothing goes below zero. Returns the items with their copies' uids."""
    rows = {f"p{r.id}": r for r in db.scalars(select(PlacedItem).where(PlacedItem.user_id == user.id, PlacedItem.room == kind))}
    out, kept, taken = [], set(), set()
    for p in items:
        item_id = counted(p["item"])
        if item_id is None:
            out.append(p)
            continue
        row = rows.get(p.get("uid"))
        if row is not None and row.item_id == item_id and row.variant == p["variant"] and p["uid"] not in kept:
            kept.add(p["uid"])
            if (row.x, row.y) != (p["x"], p["y"]):
                row.x, row.y = p["x"], p["y"]
            out.append(p)
            continue
        copy = PlacedItem(user_id=user.id, item_id=item_id, variant=p["variant"], room=kind, x=p["x"], y=p["y"])
        db.add(copy)
        db.flush()
        inv.record(db, user.id, item_id, p["variant"], kind="place", placed_delta=1, ref=f"room:{kind}")
        taken.add((item_id, p["variant"]))
        out.append({**p, "uid": f"p{copy.id}"})
    for uid, row in rows.items():
        if uid not in kept:
            inv.record(db, user.id, row.item_id, row.variant, kind="store", placed_delta=-1, ref=f"room:{kind}")
            db.delete(row)
    db.flush()
    placed = inv.placed_counts(db, user.id)
    owned = {(st.item_id, st.variant): st.quantity for st in db.scalars(select(InventoryStack).where(InventoryStack.user_id == user.id))}
    short = sorted(f"{i}:{v}" for i, v in taken if placed.get((i, v), 0) > owned.get((i, v), 0))
    if short:
        raise APIError(409, "not_enough_items", f"Not enough free copies of {', '.join(short)}")
    return out


def _store(db: Session, model, user: User, version: int, values: dict) -> None:
    """Replaces only the version that was opened, even if two saves race. The caller commits."""
    changed = db.query(model).filter(model.user_id == user.id, model.version == version).update({
        **values, model.version: model.version + 1, model.updated_at: utcnow()}, synchronize_session=False)
    if changed != 1:
        db.rollback()
        raise APIError(409, "room_version_conflict", "The room changed since it was opened")


def save_layout(db: Session, user: User, model, kind: str, data: LayoutInput, extra: dict) -> None:
    """Stores a whole layout and its placed copies in one transaction, under the user's inventory lock, so a copy
    freed in one room and taken in another, a retry or a save from another device never counts a copy twice."""
    inv.lock_user(db, user.id)
    room = db.get(model, user.id, populate_existing=True)
    if data.version != room.version:
        db.rollback()
        raise APIError(409, "room_version_conflict", "The room changed since it was opened")
    try:
        checked = checked_layout(data, owned_items(db, user), layout(room, kind), kind)
        items = sync_copies(db, user, kind, checked["items"])
        _store(db, model, user, data.version, {**extra, model.wall_id: checked["wall"], model.floor_id: checked["floor"],
                                               model.items_json: stored_items(items)})
    except APIError:
        db.rollback()
        raise
    db.commit()


@router.put("")
def save_room(data: RoomInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Saves the whole personal room (see checked_layout)."""
    room = ensure_room(db, user)
    if data.version != room.version:
        raise APIError(409, "room_version_conflict", "The room changed since it was opened")
    save_layout(db, user, PetRoom, "personal", data, {PetRoom.name: data.name, PetRoom.background_id: ""})
    db.refresh(room)
    return {"room": room_view(room), "catalog": catalog(owned_items(db, user), found_stacks(db, user))}


@focus_router.get("")
def get_focus_room(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The decorated Phòng tập trung and the shared catalog."""
    room = ensure_focus_room(db, user)
    return {"room": focus_room_view(room), "catalog": catalog(owned_items(db, user), found_stacks(db, user))}


@focus_router.put("")
def save_focus_room(data: LayoutInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Saves the whole focus room, with the personal room's rules on its own canvas (see checked_layout)."""
    room = ensure_focus_room(db, user)
    if data.version != room.version:
        raise APIError(409, "room_version_conflict", "The room changed since it was opened")
    save_layout(db, user, FocusRoomLayout, "focus", data, {})
    db.refresh(room)
    return {"room": focus_room_view(room), "catalog": catalog(owned_items(db, user), found_stacks(db, user))}


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
