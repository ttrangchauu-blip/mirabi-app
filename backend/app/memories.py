"""Private pet memory album: durable SVG cards, paging, ownership and idempotent milestones."""
from __future__ import annotations

import base64
import html
import json
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .errors import APIError
from .models import ExpEvent, LearningSession, Memory, PetEvolution, StudySession, User, utcnow
from .security import current_user

router = APIRouter(prefix="/api/memories", tags=["memories"])

EVENT_META = {
    "pet_hatched": ("Pet đã nở!", "Một người bạn nhỏ đã bắt đầu đồng hành cùng bạn."),
    "pet_evolved": ("Pet tiến hóa", "Pet đã lớn thêm một bước trên hành trình của hai bạn."),
    "first_learning_session": ("Buổi học đầu tiên", "Bạn và pet đã hoàn thành chặng học đầu tiên."),
    "first_group_session": ("Lần đầu học cùng bạn bè", "Bạn và pet đã hoàn thành buổi học nhóm đầu tiên."),
    "first_daily_quests": ("Một ngày thật trọn vẹn", "Bạn đã lần đầu hoàn thành toàn bộ nhiệm vụ trong ngày."),
    "manual": ("Kỷ niệm cùng pet", "Một khoảnh khắc được bạn lưu lại."),
    "room_photo": ("Ảnh trong phòng", "Một khoảnh khắc trong phòng của pet."),
}
# Saved by the user, so they never trigger the "new memory" notice. Room photos keep the image taken in the room
# (see pet_room.save_photo): editing the caption never re-renders them.
USER_EVENTS = ("manual", "room_photo")


class Snapshot(BaseModel):
    pet_name: str = Field(min_length=1, max_length=30)
    pet_id: str = Field(min_length=1, max_length=20)
    level: int = Field(ge=0, le=100)
    element: str = Field(default="", max_length=30)
    accessory: str | None = Field(default=None, max_length=80)
    background: str = Field(default="home", max_length=40)
    result: str | None = Field(default=None, max_length=160)


class CreateMemory(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=1000)
    snapshot: Snapshot
    client_request_id: str = Field(min_length=8, max_length=80)
    template_key: Literal["auto", "hatch", "evolve", "study", "together", "walk"] = "auto"
    palette_key: Literal["sky", "lilac", "peach"] = "sky"
    include_message: bool = False


class UpdateMemory(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=1000)
    favorite: bool | None = None
    featured: bool | None = None
    template_key: Literal["auto", "hatch", "evolve", "study", "together", "walk"] | None = None
    palette_key: Literal["sky", "lilac", "peach"] | None = None
    include_message: bool | None = None


def snapshot(user: User, *, level: int | None = None, result: str | None = None) -> dict:
    return {"pet_name": user.pet_name or "Pet", "pet_id": user.pet, "level": user.level if level is None else level,
            "element": user.pet, "accessory": user.equipped_item, "background": "home", "result": result}


PET_ELEMENTS = {"dolphin": "water", "fox": "fire", "turtle": "grass", "penguin": "ice", "bunny": "electric", "cat": "mist"}
STAGE_FILES = ["Lv0_Trung_Pet.png", "Lv1_So_Sinh.png", "Lv2_Phat_Trien.png", "Lv3_Nang_Cao.png", "Lv4_Truong_Thanh.png", "Lv5_Dai_Than.png"]
KING_FILES = {"water": "Lv6_Vua_Nuoc.png", "fire": "Lv6_Vua_Lua.png", "grass": "Lv6_Vua_Co.png", "ice": "Lv6_Vua_Bang.png", "electric": "Lv6_Vua_Dien.png", "mist": "Lv6_Vua_Suong.png"}


def pet_data_uri(pet_id: str, level: int) -> str:
    element = PET_ELEMENTS.get(pet_id)
    if not element: return ""
    stage = max(0, min(6, level)); filename = STAGE_FILES[stage] if stage < 6 else KING_FILES[element]
    path = Path(__file__).resolve().parents[2] / "mobile" / "assets" / "pets" / element / filename
    try: return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError: return ""


def render_card(data: dict, title: str, event_at: datetime, *, compact: bool = False, palette: str = "sky") -> str:
    width, height = (360, 260) if compact else (1080, 1350)
    pet = html.escape(data.get("pet_name") or "Pet")
    pet_id = str(data.get("pet_id") or "pet")
    level = int(data.get("level") or 0)
    title = html.escape(title[:76])
    date = event_at.strftime("%d/%m/%Y")
    size = 34 if compact else 72
    colors = {"sky": ("#DDF1F6", "#FDF8ED"), "lilac": ("#E9E4F8", "#FFF9ED"), "peach": ("#F9E2D9", "#F8F4E9")}.get(palette, ("#DDF1F6", "#FDF8ED"))
    image = pet_data_uri(pet_id, level)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
      <defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="{colors[0]}"/><stop offset="1" stop-color="{colors[1]}"/></linearGradient></defs>
      <rect width="100%" height="100%" rx="{24 if compact else 64}" fill="url(#g)"/>
      <circle cx="{width/2}" cy="{height*.43}" r="{height*.2}" fill="#fff" opacity=".55"/>
      <text x="50%" y="14%" text-anchor="middle" font-size="{size*.7}" font-weight="800" fill="#173B52" font-family="sans-serif">{title}</text>
      <image href="{image}" x="20%" y="20%" width="60%" height="50%" preserveAspectRatio="xMidYMid meet"/>
      <text x="50%" y="74%" text-anchor="middle" font-size="{size*.62}" font-weight="800" fill="#173B52" font-family="sans-serif">{pet}</text>
      <text x="50%" y="78%" text-anchor="middle" font-size="{size*.38}" fill="#547184" font-family="sans-serif">Cấp {level}</text>
      <text x="50%" y="81%" text-anchor="middle" font-size="{size*.4}" fill="#547184" font-family="sans-serif">{date}</text>
      <text x="{width-24}" y="{height-20}" text-anchor="end" font-size="{size*.32}" fill="#136FA8" font-weight="700" font-family="sans-serif">Mirabi</text>
    </svg>'''


def create_once(db: Session, user: User, event_type: str, source_key: str, at: datetime, data: dict,
                title: str | None = None, message: str | None = None) -> Memory | None:
    existing = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.source_key == source_key))
    if existing is not None:
        return None  # includes tombstones: deleted automatic memories stay deleted
    title0, event_text = EVENT_META[event_type]
    row = Memory(user_id=user.id, pet_id=data["pet_id"], event_type=event_type, source_key=source_key,
                 title=(title or title0).strip(), message=(message or "").strip() or None, event_text=event_text,
                 event_at=at, snapshot_json=json.dumps(data, ensure_ascii=False), image_svg="", thumbnail_svg="")
    row.image_svg = render_card(data, row.title, at)
    row.thumbnail_svg = render_card(data, row.title, at, compact=True)
    try:
        with db.begin_nested():
            db.add(row)
        return row
    except IntegrityError:
        return None


def record_event(db: Session, user: User, event_type: str, source_key: str, *, at: datetime | None = None,
                 level: int | None = None, title: str | None = None, result: str | None = None) -> Memory | None:
    """Record an event inside the caller's transaction; safe to call again after retries."""
    return create_once(db, user, event_type, source_key, at or utcnow(), snapshot(user, level=level, result=result), title)


def reconcile(db: Session, user: User) -> None:
    """Rebuild missing automatic milestones on album open; soft-deleted rows block resurrection."""
    evolution = db.scalar(select(PetEvolution).where(PetEvolution.user_id == user.id,
                                                       PetEvolution.pet_id == user.pet))
    if evolution and evolution.level >= 1:
        create_once(db, user, "pet_hatched", f"hatch:{user.pet}:1", evolution.updated_at, snapshot(user, level=1))
        for level in range(2, evolution.level + 1):
            create_once(db, user, "pet_evolved", f"evolution:{user.pet}:{level}", evolution.updated_at,
                        snapshot(user, level=level), title=f"{user.pet_name or 'Pet'} đạt cấp {level}")
    learning = db.scalar(select(LearningSession).where(LearningSession.user_id == user.id,
                                                        LearningSession.status == "completed").order_by(LearningSession.created_at))
    if learning:
        create_once(db, user, "first_learning_session", "first:learning", learning.created_at,
                    snapshot(user, result="Hoàn thành phiên học đầu tiên"))
    group = db.scalar(select(StudySession).where(StudySession.user_id == user.id, StudySession.study_type == "together",
                                                 StudySession.completed.is_(True)).order_by(StudySession.created_at))
    if group:
        create_once(db, user, "first_group_session", "first:group", group.created_at,
                    snapshot(user, result="Hoàn thành buổi học nhóm đầu tiên"))
    quest = db.scalar(select(ExpEvent).where(ExpEvent.user_id == user.id,
                                             ExpEvent.reference_id.like("all_quests:%")).order_by(ExpEvent.created_at))
    if quest:
        create_once(db, user, "first_daily_quests", "first:daily-quests", quest.created_at,
                    snapshot(user, result="Hoàn thành toàn bộ nhiệm vụ trong ngày"))
    db.commit()


def view(row: Memory, *, detail: bool = False) -> dict:
    data = {"id": row.id, "pet_id": row.pet_id, "event_type": row.event_type, "title": row.title,
            "message": row.message, "event_text": row.event_text, "event_at": row.event_at,
            "created_at": row.created_at, "favorite": row.favorite, "status": row.status,
            "snapshot": json.loads(row.snapshot_json), "thumbnail_svg": row.thumbnail_svg,
            "featured": row.featured, "template_key": row.template_key,
            "palette_key": row.palette_key, "include_message": row.include_message}
    if detail:
        data["image_svg"] = row.image_svg
    return data


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
    reconcile(db, user)
    where = [Memory.user_id == user.id, Memory.deleted_at.is_(None)]
    if cursor: where.append(Memory.id < cursor)
    if pet_id: where.append(Memory.pet_id == pet_id)
    if category == "favorite": where.append(Memory.favorite.is_(True))
    elif category == "pet": where.append(Memory.event_type.in_(("pet_hatched", "pet_evolved", "manual", "room_photo")))
    elif category == "study": where.append(Memory.event_type.in_(("first_learning_session", "first_daily_quests")))
    elif category == "friends": where.append(Memory.event_type == "first_group_session")
    rows = list(db.scalars(select(Memory).where(*where).order_by(Memory.id.desc()).limit(limit + 1)))
    featured = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.deleted_at.is_(None),
                                               Memory.featured.is_(True)).order_by(Memory.id.desc()))
    first = db.scalar(select(Memory.event_at).where(Memory.user_id == user.id, Memory.deleted_at.is_(None))
                      .order_by(Memory.event_at.asc()).limit(1))
    days = max(1, (utcnow().date() - first.date()).days + 1) if first else None
    return {"items": [view(x) for x in rows[:limit]], "next_cursor": rows[limit - 1].id if len(rows) > limit else None,
            "featured_id": featured.id if featured else None, "companion_days": days}


@router.post("", status_code=201)
def create_memory(data: CreateMemory, user: User = Depends(current_user), db: Session = Depends(get_db)):
    snap = data.snapshot.model_dump()
    if snap["pet_id"] != user.pet:
        raise APIError(422, "pet_mismatch", "The snapshot must use the current pet")
    row = create_once(db, user, "manual", f"manual:{data.client_request_id}", utcnow(), snap, data.title, data.message)
    if row is None:
        row = db.scalar(select(Memory).where(Memory.user_id == user.id,
                                             Memory.source_key == f"manual:{data.client_request_id}",
                                             Memory.deleted_at.is_(None)))
    if row is None:
        raise APIError(409, "memory_deleted", "This memory was already deleted")
    row.template_key = data.template_key
    row.palette_key = data.palette_key
    row.include_message = data.include_message
    row.image_svg = render_card(snap, row.title, row.event_at, palette=row.palette_key)
    row.thumbnail_svg = render_card(snap, row.title, row.event_at, compact=True, palette=row.palette_key)
    db.commit()
    return view(row, detail=True)


@router.get("/pending")
def pending_memory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    reconcile(db, user)
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
    return view(own(db, memory_id, user), detail=True)


@router.patch("/{memory_id}")
def update_memory(memory_id: int, data: UpdateMemory, user: User = Depends(current_user), db: Session = Depends(get_db)):
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
    if data.template_key is not None: row.template_key = data.template_key
    if data.palette_key is not None: row.palette_key = data.palette_key
    if data.include_message is not None: row.include_message = data.include_message
    if row.event_type != "room_photo":
        snap = json.loads(row.snapshot_json)
        row.image_svg = render_card(snap, row.title, row.event_at, palette=row.palette_key)
        row.thumbnail_svg = render_card(snap, row.title, row.event_at, compact=True, palette=row.palette_key)
    db.commit(); db.refresh(row)
    return view(row, detail=True)


@router.delete("/{memory_id}", status_code=204)
def delete_memory(memory_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = own(db, memory_id, user)
    row.deleted_at = utcnow()
    row.image_svg = ""; row.thumbnail_svg = ""  # no orphaned image payload
    db.commit()
