"""Private pet memory album: pictures frozen at the moment of the event, paging, ownership and idempotent milestones.

A memory keeps what was true when its event happened (`snapshot`): the pet's species, level and name, its accessory,
the picture's headline, and what the event was about: the learning session's result, the friends who studied along
(only what they show every room member, see friends.public_user), or the keepsake the walk brought back. The picture
is drawn from that snapshot once and stored. Opening the album never redraws it from the current pet, room or
garden, and renaming the pet, evolving it or redecorating later leaves old memories as they were. Editing a memory's
title or note changes the caption next to the picture, not the picture.

When the artwork can't be read at the time of the event, the memory is stored with its snapshot as `pending` and
drawn from that same snapshot when the album is opened again; it never gets a stand-in picture. Old memories are
redrawn only when their stored picture lacks the pet and their snapshot says which pet and level it was (and the
title it showed); a redraw that fails leaves the old picture as it was.

Text is laid out with the measurements of the app's own font (memory_render), and the app shows, saves and shares
the picture as one PNG rendered from the stored SVG with that font (`GET /api/memories/{id}/image`).
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
import logging
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, BeforeValidator, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .errors import APIError
from .memory_render import RenderError, clean, ellipsize, fit, fit_text, png, width
from .models import Memory, User, utcnow
from .security import current_user

router = APIRouter(prefix="/api/memories", tags=["memories"])
log = logging.getLogger("refmi.memories")

EVENT_META = {
    "pet_hatched": ("Pet đã nở!", "Một người bạn nhỏ đã bắt đầu đồng hành cùng bạn."),
    "pet_evolved": ("Pet tiến hóa", "Pet đã lớn thêm một bước trên hành trình của hai bạn."),
    "first_learning_session": ("Buổi học đầu tiên", "Bạn và pet đã hoàn thành chặng học đầu tiên."),
    "first_group_session": ("Lần đầu học cùng bạn bè", "Bạn và pet đã hoàn thành buổi học nhóm đầu tiên."),
    "first_daily_quests": ("Một ngày thật trọn vẹn", "Bạn đã lần đầu hoàn thành toàn bộ nhiệm vụ trong ngày."),
    "manual": ("Kỷ niệm cùng pet", "Một khoảnh khắc được bạn lưu lại."),
    "room_photo": ("Ảnh trong phòng", "Một khoảnh khắc trong phòng của pet."),
    "walk_keepsake": ("Kỷ vật từ chuyến đi", "Pet đã mang kỷ vật này về từ một chuyến khám phá."),
}
# Saved by the user, so they never trigger the "new memory" notice.
USER_EVENTS = ("manual", "room_photo")
# Drawn by their own feature: room photos keep the image taken in the room (pet_room.save_photo).
SELF_DRAWN = ("room_photo",)

Template = Literal["auto", "hatch", "evolve", "study", "together", "walk"]
Palette = Literal["sky", "lilac", "peach"]
# The layout an automatic memory is drawn with, and the small label above its headline.
EVENT_TEMPLATE = {"pet_hatched": "hatch", "pet_evolved": "evolve", "first_learning_session": "study",
                  "first_daily_quests": "study", "first_group_session": "together", "walk_keepsake": "walk"}
TEMPLATE_LABEL = {"auto": "Kỷ niệm", "hatch": "Pet nở trứng", "evolve": "Tiến hóa", "study": "Học tập",
                  "together": "Học cùng bạn", "walk": "Đi dạo"}
EVENT_PALETTE = {"pet_hatched": "peach", "pet_evolved": "lilac", "first_group_session": "lilac"}
PALETTES = {"sky": ("#DDF1F6", "#F5F1DD", "#FDF8ED"), "lilac": ("#E9E4F8", "#F5EEFA", "#FFF9ED"),
            "peach": ("#F9E2D9", "#FFF0DB", "#F8F4E9")}
# One family; `font-weight` picks the Nunito file (the app maps it to its own font names, MemoryPoster.deviceFonts).
FONT = "Nunito"
INK, MUTED, BRAND = "#173B52", "#4F6C79", "#136FA8"
# Lines stay 80 px clear of the 1080 card's sides. A long title gets smaller and a third line before it is shortened.
TEXT_WIDTH = 920
TITLE_SIZES = [(60, 2), (50, 3)]


class Snapshot(BaseModel):
    """Sent by older apps with a manual memory; the server takes the pet as it is now instead."""
    pet_name: str = Field(min_length=1, max_length=30)
    pet_id: str = Field(min_length=1, max_length=20)
    level: int = Field(ge=0, le=100)
    element: str = Field(default="", max_length=30)
    accessory: str | None = Field(default=None, max_length=80)
    background: str = Field(default="home", max_length=40)
    result: str | None = Field(default=None, max_length=160)


# Precomposed (NFC) before the length limits: a keyboard that types Vietnamese marks as separate characters (NFD)
# would otherwise make a title of 100 letters count as 130.
Caption = Annotated[str, BeforeValidator(lambda v: unicodedata.normalize("NFC", v) if isinstance(v, str) else v)]


class PreviewMemory(BaseModel):
    title: Caption | None = Field(default=None, max_length=120)
    message: Caption | None = Field(default=None, max_length=1000)
    template_key: Template = "auto"
    palette_key: Palette = "sky"
    include_message: bool = False


class CreateMemory(PreviewMemory):
    snapshot: Snapshot | None = None
    client_request_id: str = Field(min_length=8, max_length=80)


class UpdateMemory(BaseModel):
    title: Caption | None = Field(default=None, max_length=120)
    message: Caption | None = Field(default=None, max_length=1000)
    favorite: bool | None = None
    featured: bool | None = None


def snapshot(user: User, *, level: int | None = None, result: str | None = None, **event) -> dict:
    """The pet and the event as they are right now: call it when the event happens. `event` adds what the event was
    about (before_level, session, friends, item); None values are left out."""
    data = {"pet_name": user.pet_name or "Pet", "pet_id": user.pet, "level": user.level if level is None else level,
            "element": PET_ELEMENTS.get(user.pet, user.pet), "accessory": user.equipped_item, "background": "home",
            "result": result}
    data.update({k: v for k, v in event.items() if v is not None})
    return data


def study_friend(user: User) -> dict:
    """A friend in a group-study memory: what every member of the room sees of them (friends.public_user)."""
    return {"display_name": user.display_name, "pet_id": user.pet, "pet_name": user.pet_name or "Pet", "level": user.level}


# ---------------------------------------------------------------------------- artwork
PET_ELEMENTS = {"dolphin": "water", "fox": "fire", "turtle": "grass", "penguin": "ice", "bunny": "electric", "cat": "mist"}
STAGE_FILES = ["Lv0_Trung_Pet.png", "Lv1_So_Sinh.png", "Lv2_Phat_Trien.png", "Lv3_Nang_Cao.png", "Lv4_Truong_Thanh.png", "Lv5_Dai_Than.png"]
KING_FILES = {"water": "Lv6_Vua_Nuoc.png", "fire": "Lv6_Vua_Lua.png", "grass": "Lv6_Vua_Co.png", "ice": "Lv6_Vua_Bang.png", "electric": "Lv6_Vua_Dien.png", "mist": "Lv6_Vua_Suong.png"}
ASSETS = Path(__file__).resolve().parents[2] / "mobile" / "assets"
# Item icons and garden plants exported from the app's drawings (mobile/scripts/export-memory-art.mjs).
MEMORY_ART_PATH = ASSETS / "memory-art.json"
SVG_DOC = re.compile(r'^\s*<svg\b[^>]*\bviewBox="([-\d. ]+)"[^>]*>(.*)</svg>\s*$', re.S)


class ArtMissing(Exception):
    """Artwork a memory picture needs could not be read; the memory waits as `pending`."""


def pet_art(pet_id: str, level: int) -> str:
    """The pet's still at `level` as a PNG data URI."""
    element = PET_ELEMENTS.get(pet_id)
    if not element:
        raise ArtMissing(f"unknown pet {pet_id!r}")
    stage = max(0, min(6, level))
    path = ASSETS / "pets" / element / (STAGE_FILES[stage] if stage < 6 else KING_FILES[element])
    try:
        return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError as exc:
        raise ArtMissing(str(path)) from exc


def pet_data_uri(pet_id: str, level: int) -> str:
    """pet_art, or "" when it can't be read (a room photo then draws no pet)."""
    try:
        return pet_art(pet_id, level)
    except ArtMissing:
        return ""


def item_art(item_id: str, variant: str | None = None) -> str:
    """An item's icon (SVG document) as the app shows it (components/ItemIcon: `<id>.<variant>` first)."""
    try:
        items = json.loads(MEMORY_ART_PATH.read_text(encoding="utf-8"))["items"]
    except (OSError, ValueError, KeyError) as exc:
        raise ArtMissing(str(MEMORY_ART_PATH)) from exc
    svg = items.get(f"{item_id}.{variant}") or items.get(item_id)
    if not svg:
        raise ArtMissing(f"no icon for item {item_id!r}")
    return svg


def _n(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def pet_image(uri: str, x: float, y: float, size: float) -> str:
    """The pet standing in a size x size box (whole, never cropped), with a soft shadow at its feet."""
    return (f'<ellipse cx="{_n(x + size / 2)}" cy="{_n(y + size * .97)}" rx="{_n(size * .3)}" ry="{_n(size * .045)}" '
            f'fill="#0A2438" opacity=".10"/>'
            f'<image href="{uri}" x="{_n(x)}" y="{_n(y)}" width="{_n(size)}" height="{_n(size)}" '
            f'preserveAspectRatio="xMidYMax meet"/>')


def inline_svg(svg: str, x: float, y: float, size: float) -> str:
    """An SVG document drawn inside a size x size box at x,y (centred, whole)."""
    match = SVG_DOC.match(svg)
    if not match:
        raise ArtMissing("unreadable SVG artwork")
    vx, vy, vw, vh = (float(v) for v in match.group(1).split())
    scale = size / max(vw, vh)
    dx, dy = x + (size - vw * scale) / 2 - vx * scale, y + (size - vh * scale) / 2 - vy * scale
    return f'<g transform="translate({_n(dx)} {_n(dy)}) scale({scale:.4f})">{match.group(2)}</g>'


def text_lines(lines: list[str], y: float, step: float, size: float, color: str, weight: int = 800,
               x: float = 540) -> str:
    """Centred lines, already measured to fit (memory_render.fit / ellipsize)."""
    return "".join(f'<text x="{_n(x)}" y="{_n(y + i * step)}" text-anchor="middle" font-size="{_n(size)}" '
                   f'font-weight="{weight}" fill="{color}" font-family="{FONT}">{html.escape(line, quote=False)}</text>'
                   for i, line in enumerate(lines))


def backdrop(width: int, height: int, palette: str, rounded: float) -> str:
    palette = palette if palette in PALETTES else "sky"
    top, mid, bottom = PALETTES[palette]
    gradient = f"memory-bg-{palette}"  # pictures share a page on the web: same id, same colours
    sun = (width / 2, height * (.44 if width > 500 else .5), height * (.2 if width > 500 else .3))
    return (f'<defs><linearGradient id="{gradient}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
            f'<stop offset=".55" stop-color="{mid}"/><stop offset="1" stop-color="{bottom}"/></linearGradient></defs>'
            f'<rect width="{width}" height="{height}" rx="{rounded}" fill="url(#{gradient})"/>'
            f'<circle cx="{_n(sun[0])}" cy="{_n(sun[1])}" r="{_n(sun[2])}" fill="#FFF8DD" opacity=".72"/>'
            f'<rect x="{_n(-width * .05)}" y="{_n(height * .2)}" width="{_n(width * .26)}" height="{_n(height * .055)}" '
            f'rx="{_n(height * .03)}" fill="#FFFFFF" opacity=".45"/>'
            f'<rect x="{_n(width * .8)}" y="{_n(height * .34)}" width="{_n(width * .26)}" height="{_n(height * .05)}" '
            f'rx="{_n(height * .03)}" fill="#FFFFFF" opacity=".45"/>')


def badge(inner: str, cx: float, cy: float, r: float) -> str:
    """A white round frame for a keepsake."""
    return (f'<circle cx="{_n(cx)}" cy="{_n(cy + r * .06)}" r="{_n(r)}" fill="#0A2438" opacity=".08"/>'
            f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="{_n(r)}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="{_n(r * .08)}"/>'
            + inner)


def template_of(event_type: str, template: str) -> str:
    return EVENT_TEMPLATE.get(event_type, "auto") if event_type != "manual" or template == "auto" else template


def scene(data: dict, layout: str, compact: bool) -> str:
    """The pet (and what the event was about) on a 1080 x 1350 card's stage (y 300-1010) or a 400 x 280 card."""
    pet_id, level = str(data["pet_id"]), int(data["level"])
    pet = pet_art(pet_id, level)
    if layout == "evolve" and data.get("before_level") is not None:
        before = pet_art(pet_id, int(data["before_level"]))
        if compact:
            return badge(f'<image href="{before}" x="40" y="128" width="84" height="84" preserveAspectRatio="xMidYMid meet"/>',
                         82, 172, 50) + pet_image(pet, 130, 30, 236)
        return (badge(f'<image href="{before}" x="128" y="702" width="208" height="208" preserveAspectRatio="xMidYMid meet"/>',
                      232, 806, 132)
                + text_lines([f'Cấp {int(data["before_level"])}'], 984, 0, 30, MUTED, 800, 232)
                + f'<path d="M392 806H452M432 784L456 806L432 828" stroke="{BRAND}" stroke-width="12" fill="none" '
                  f'stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>'
                + pet_image(pet, 430, 330, 600))
    if layout == "walk" and data.get("item"):
        item = data["item"]
        icon = item_art(str(item["id"]), item.get("variant"))
        if compact:
            return pet_image(pet, 40, 36, 230) + badge(inline_svg(icon, 266, 132, 92), 312, 178, 62)
        return pet_image(pet, 90, 360, 600) + badge(inline_svg(icon, 690, 590, 260), 820, 720, 170)
    if layout == "together" and data.get("friends"):
        friends = data["friends"][:4]
        arts = [pet_art(str(f["pet_id"]), int(f["level"])) for f in friends]
        if compact:
            spots = [(4, 120, 120), (276, 120, 120), (40, 40, 90), (270, 40, 90)]
            out = "".join(pet_image(a, *spots[i]) for i, a in enumerate(arts))
            return out + pet_image(pet, 110, 50, 200)
        spots = [(60, 600, 290), (730, 600, 290), (150, 380, 230), (700, 380, 230)]
        out = ""
        for i, (friend, art) in enumerate(zip(friends, arts)):
            x, y, size = spots[i]
            out += pet_image(art, x, y, size)
            if i < 2:  # the front two have their names under them; the back two would cover the stage
                name = clean(str(friend.get("display_name") or friend.get("pet_name") or ""))
                out += text_lines([ellipsize(name, 28, size, 800)] if name else [], y + size + 34, 0, 28, MUTED,
                                  800, x + size / 2)
        return out + pet_image(pet, 290, 360, 500)
    return pet_image(pet, 80, 28, 240) if compact else pet_image(pet, 220, 330, 640)


def render_card(data: dict, event_type: str, event_at: datetime, *, compact: bool = False, palette: str = "sky",
                template: str = "auto") -> str:
    """The memory picture, 1080 x 1350 (or the 400 x 280 album card), from the snapshot alone. Raises ArtMissing."""
    layout = template_of(event_type, template)
    if compact:
        label = TEMPLATE_LABEL[layout]
        return ('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280">'
                + backdrop(400, 280, palette, 0) + scene(data, layout, True)
                + f'<rect x="14" y="14" width="{_n(width(label, 17) + 28)}" height="34" rx="17" fill="#FFFFFF" opacity=".86"/>'
                + f'<text x="28" y="37" font-size="17" font-weight="800" fill="{MUTED}" font-family="{FONT}">'
                  f'{html.escape(label, quote=False)}</text></svg>')
    label = TEMPLATE_LABEL[layout].upper()
    headline = clean(str(data.get("headline") or "")) or EVENT_META.get(event_type, EVENT_META["manual"])[0]
    size, title = fit(headline, TEXT_WIDTH, TITLE_SIZES)
    footer = [(ellipsize(clean(f"{data.get('pet_name') or 'Pet'} · Cấp {int(data['level'])}"), 46, TEXT_WIDTH), 46, INK, 800)]
    if result := clean(str(data.get("result") or "")):
        footer += [(line, 32, INK, 700) for line in fit(result, TEXT_WIDTH, [(32, 2)], 700)[1]]
    if accessory := clean(str(data.get("accessory") or "")):
        footer.append((ellipsize(f"Phụ kiện: {accessory}", 28, TEXT_WIDTH, 600), 28, MUTED, 600))
    if note := clean(str(data.get("note") or "")):
        footer.append((ellipsize(note, 28, TEXT_WIDTH, 600), 28, MUTED, 600))
    footer.append((event_at.strftime("%d/%m/%Y"), 28, MUTED, 700))
    y, rows = 1046, ""
    for text, line_size, color, weight in footer:
        y += line_size * 1.28
        rows += text_lines([text], y - line_size * .28, 0, line_size, color, weight)
    # The title is centred between the label (bottom y 126) and the stage (top y 330), marks and descenders included.
    step = size * 1.17
    title_y = 228 - (len(title) - 1) * step / 2 + size * .35
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">'
            + backdrop(1080, 1350, palette, 0)
            + f'<rect x="{_n(540 - width(label, 26) / 2 - 34)}" y="70" width="{_n(width(label, 26) + 68)}" height="56" '
              f'rx="28" fill="#FFFFFF" opacity=".82"/>'
            + text_lines([label], 108, 0, 26, MUTED, 800)
            + text_lines(title, title_y, step, size, INK, 800)
            + scene(data, layout, False) + rows
            + f'<text x="1008" y="1300" text-anchor="end" font-size="30" font-weight="800" fill="{BRAND}" '
              f'font-family="{FONT}">Mirabi</text></svg>')


def draw(row: Memory) -> bool:
    """Draw `row`'s picture from its snapshot. If the artwork is missing, a memory without a picture stays `pending`
    and one that has a picture keeps it."""
    data = json.loads(row.snapshot_json)
    try:
        image = render_card(data, row.event_type, row.event_at, palette=row.palette_key, template=row.template_key)
        thumbnail = render_card(data, row.event_type, row.event_at, compact=True, palette=row.palette_key,
                                template=row.template_key)
    except (ArtMissing, RenderError) as exc:
        log.warning("Memory %s waits for its picture: %s", row.id, exc)
        if not row.image_svg:
            row.status, row.image_svg, row.thumbnail_svg = "pending", "", ""
        return False
    row.status, row.image_svg, row.thumbnail_svg = "ready", image, thumbnail
    return True


def needs_drawing(row: Memory) -> bool:
    """Pending memories, and old ones stored without their pet (its artwork was missing then), when the snapshot says
    exactly which pet and level to draw. Room photos are pet_room's."""
    if row.event_type in SELF_DRAWN or row.deleted_at is not None:
        return False
    if not (row.status == "pending" or (row.status == "ready" and '<image href=""' in row.image_svg)):
        return False
    try:
        data = json.loads(row.snapshot_json)
        return bool(data.get("pet_id")) and int(data["level"]) >= 0
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


_DRAWN_TITLE = re.compile(r'<text\b[^>]*\bfont-size="(?:5\d|6\d)(?:\.\d+)?"[^>]*>([^<]*)</text>')


def drawn_title(svg: str) -> str | None:
    """The title an old picture shows (its 50-69 px lines), so a redraw keeps it even if the caption was edited."""
    lines = [html.unescape(x).strip() for x in _DRAWN_TITLE.findall(svg or "")]
    return " ".join(x for x in lines if x) or None


def retry_drawing(db: Session, rows: list[Memory]) -> None:
    changed = False
    for row in rows:
        if not needs_drawing(row):
            continue
        data = json.loads(row.snapshot_json)
        if "headline" not in data:  # an old memory: drawn with the title its picture showed
            headline = drawn_title(row.image_svg)
            if headline is None and row.event_type != "manual" and row.event_type in EVENT_META:
                headline = default_title(row.event_type, data)
            if headline is None and row.image_svg:
                continue  # the old picture's title can't be read back: keep that picture rather than guess
            row.snapshot_json = json.dumps({**data, "headline": headline or row.title}, ensure_ascii=False)
        draw(row)
        changed = True
    if changed:
        db.commit()


def default_title(event_type: str, data: dict) -> str:
    if event_type == "pet_evolved":
        return f"{data.get('pet_name') or 'Pet'} đạt cấp {int(data['level'])}"
    return EVENT_META[event_type][0]


def create_once(db: Session, user: User, event_type: str, source_key: str, at: datetime, data: dict,
                title: str | None = None, message: str | None = None, *, palette: str | None = None,
                template: str = "auto", include_message: bool = False) -> Memory | None:
    """Store the memory of an event once, its picture drawn now from `data` (see draw)."""
    existing = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.source_key == source_key))
    if existing is not None:
        return None  # includes tombstones: deleted automatic memories stay deleted
    title = (title or default_title(event_type, data)).strip()
    message = (message or "").strip() or None
    data = {**data, "headline": title}
    if include_message and message:
        data["note"] = message
    row = Memory(user_id=user.id, pet_id=data["pet_id"], event_type=event_type, source_key=source_key, title=title,
                 message=message, event_text=EVENT_META[event_type][1], event_at=at,
                 snapshot_json=json.dumps(data, ensure_ascii=False), image_svg="", thumbnail_svg="",
                 palette_key=palette or EVENT_PALETTE.get(event_type, "sky"), template_key=template,
                 include_message=include_message)
    if event_type not in SELF_DRAWN:
        draw(row)
    try:
        with db.begin_nested():
            db.add(row)
        return row
    except IntegrityError:
        return None


def record_event(db: Session, user: User, event_type: str, source_key: str, *, at: datetime | None = None,
                 level: int | None = None, title: str | None = None, result: str | None = None, **event) -> Memory | None:
    """Record an event inside the caller's transaction, with the pet as it is now; safe to call again after retries.
    `event` is what the event was about, kept in the snapshot (see snapshot)."""
    return create_once(db, user, event_type, source_key, at or utcnow(),
                       snapshot(user, level=level, result=result, **event), title)


def view(row: Memory, *, detail: bool = False) -> dict:
    data = {"id": row.id, "pet_id": row.pet_id, "event_type": row.event_type, "title": row.title,
            "message": row.message, "event_text": row.event_text, "event_at": row.event_at,
            "created_at": row.created_at, "favorite": row.favorite, "status": row.status,
            "snapshot": json.loads(row.snapshot_json), "thumbnail_svg": fit_text(row.thumbnail_svg),
            "featured": row.featured, "template_key": row.template_key,
            "palette_key": row.palette_key, "include_message": row.include_message,
            # Changes only when the picture is drawn: the app keeps the PNG it downloaded under this key.
            "image_key": hashlib.sha1(row.image_svg.encode()).hexdigest()[:16] if row.image_svg else None}
    if detail:
        data["image_svg"] = row.image_svg
    return data


def picture_png(svg: str) -> dict:
    """The PNG the app shows, saves and shares, base64-encoded (the app's JSON client carries it)."""
    try:
        data = png(svg)
    except RenderError as exc:
        log.error("Memory picture could not be rendered: %s", exc)
        raise APIError(503, "memory_image_unavailable", "The memory picture can't be rendered right now")
    return {"png": base64.b64encode(data).decode("ascii"), "width": int.from_bytes(data[16:20], "big"),
            "height": int.from_bytes(data[20:24], "big"), "key": hashlib.sha1(svg.encode()).hexdigest()[:16]}


def own(db: Session, memory_id: int, user: User) -> Memory:
    row = db.scalar(select(Memory).where(Memory.id == memory_id, Memory.user_id == user.id,
                                         Memory.deleted_at.is_(None)))
    if not row:
        raise APIError(404, "memory_not_found", "Memory not found")
    return row


@router.get("")
def list_memories(category: Literal["all", "pet", "study", "friends", "favorite"] = "all",
                  pet_id: str | None = None, cursor: int | None = None,
                  limit: int = Query(20, ge=1, le=50), user: User = Depends(current_user), db: Session = Depends(get_db)):
    where = [Memory.user_id == user.id, Memory.deleted_at.is_(None)]
    if cursor: where.append(Memory.id < cursor)
    if pet_id: where.append(Memory.pet_id == pet_id)
    if category == "favorite": where.append(Memory.favorite.is_(True))
    elif category == "pet": where.append(Memory.event_type.in_(("pet_hatched", "pet_evolved", "manual", "room_photo", "walk_keepsake")))
    elif category == "study": where.append(Memory.event_type.in_(("first_learning_session", "first_daily_quests")))
    elif category == "friends": where.append(Memory.event_type == "first_group_session")
    rows = list(db.scalars(select(Memory).where(*where).order_by(Memory.id.desc()).limit(limit + 1)))
    retry_drawing(db, rows[:limit])
    featured = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.deleted_at.is_(None),
                                               Memory.featured.is_(True)).order_by(Memory.id.desc()))
    first = db.scalar(select(Memory.event_at).where(Memory.user_id == user.id, Memory.deleted_at.is_(None))
                      .order_by(Memory.event_at.asc()).limit(1))
    days = max(1, (utcnow().date() - first.date()).days + 1) if first else None
    return {"items": [view(x) for x in rows[:limit]], "next_cursor": rows[limit - 1].id if len(rows) > limit else None,
            "featured_id": featured.id if featured else None, "companion_days": days}


def manual_snapshot(user: User, data: PreviewMemory) -> dict:
    return snapshot(user, headline=(data.title or "").strip() or EVENT_META["manual"][0],
                    note=((data.message or "").strip() or None) if data.include_message else None)


@router.post("/preview")
def preview_memory(data: PreviewMemory, user: User = Depends(current_user)):
    """The exact picture "Lưu kỷ niệm" will store for the pet as it is now, and the PNG the app shows of it. Stores
    nothing."""
    try:
        svg = render_card(manual_snapshot(user, data), "manual", utcnow(), palette=data.palette_key,
                          template=data.template_key)
    except ArtMissing:
        raise APIError(503, "memory_art_missing", "The pet's artwork is not available right now")
    return {"svg": svg, **picture_png(svg)}


@router.post("", status_code=201)
def create_memory(data: CreateMemory, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A memory of the pet as it is now (whatever an older app sends as `snapshot`)."""
    source_key = f"manual:{data.client_request_id}"
    row = create_once(db, user, "manual", source_key, utcnow(), manual_snapshot(user, data), data.title, data.message,
                      palette=data.palette_key, template=data.template_key, include_message=data.include_message)
    if row is None:
        row = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.source_key == source_key,
                                             Memory.deleted_at.is_(None)))
    if row is None:
        raise APIError(409, "memory_deleted", "This memory was already deleted")
    db.commit()
    return view(row, detail=True)


@router.get("/pending")
def pending_memory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.deleted_at.is_(None),
                                         Memory.notified_at.is_(None), Memory.event_type.not_in(USER_EVENTS))
                    .order_by(Memory.id).limit(1))
    return view(row) if row else None


@router.post("/{memory_id}/acknowledge")
def acknowledge_memory(memory_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = own(db, memory_id, user)
    row.notified_at = row.notified_at or utcnow()
    db.commit()
    return {"acknowledged": True}


@router.get("/{memory_id}")
def get_memory(memory_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """One memory with its picture; a picture still waiting is drawn now from the memory's own snapshot."""
    row = own(db, memory_id, user)
    retry_drawing(db, [row])
    return view(row, detail=True)


@router.get("/{memory_id}/image")
def memory_image(memory_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The memory's picture as a 1080 x 1350 PNG (picture_png): what the album shows and "Tải ảnh" / "Chia sẻ"
    hand over. A picture still waiting is drawn from the snapshot first; 409 if it still can't be."""
    row = own(db, memory_id, user)
    retry_drawing(db, [row])
    if not row.image_svg:
        raise APIError(409, "memory_image_pending", "The memory picture is not drawn yet")
    return picture_png(row.image_svg)


@router.patch("/{memory_id}")
def update_memory(memory_id: int, data: UpdateMemory, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Title, note, favourite and featured. The picture stays as it was taken."""
    row = own(db, memory_id, user)
    if data.title is not None:
        if not data.title.strip(): raise APIError(422, "empty_title", "Title cannot be empty")
        row.title = data.title.strip()
    if data.message is not None: row.message = data.message.strip() or None
    if data.favorite is not None: row.favorite = data.favorite
    if data.featured is not None:
        if data.featured:
            db.query(Memory).filter(Memory.user_id == user.id, Memory.featured.is_(True)).update({Memory.featured: False})
        row.featured = data.featured
    db.commit(); db.refresh(row)
    return view(row, detail=True)


@router.delete("/{memory_id}", status_code=204)
def delete_memory(memory_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = own(db, memory_id, user)
    row.deleted_at = utcnow()
    row.image_svg = ""; row.thumbnail_svg = ""  # no orphaned image payload
    db.commit()
