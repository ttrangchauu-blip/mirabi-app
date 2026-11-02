"""Healing Room (Góc thư giãn): mood check-ins, the private journal, relaxation sessions and the room's ambience.

The Healing Room is a mode of the personal room (pet_room.py), not a second room: the app draws the user's own room
with an ambience over it. This module stores what the mode adds.

- Moods are check-ins the user picks. The pet answers with a fixed, kind line for each mood; nothing here infers,
  scores or diagnoses how someone feels or their health.
- Journal pages are private: only their owner can list, read, edit or delete them (anyone else gets "not found"),
  and their text is never logged, shared or copied into the album. "Lưu vào Album" keeps the page's title as a memory.
- Relaxation sessions are reported when an activity ends; `client_ref` makes a retry or an offline replay count once.
  They earn no EXP: self-care isn't something to farm.
- Days are the user's local days (`timezone` sent by the app, else their Pomodoro settings' zone).
"""
import json
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .errors import APIError
from .memories import create_once, snapshot
from .models import JournalEntry, MoodEntry, RelaxationSession, RoomAmbiencePreference, User, as_utc, utcnow
from .schemas import AmbienceUpdate, JournalCreate, JournalUpdate, MoodCreate, RelaxationCreate
from .life_access import life_user
from .study_statistics import preferences, valid_timezone

router = APIRouter(prefix="/api/life", tags=["life"])

MOODS_PER_DAY = 24
JOURNAL_PER_DAY = 50
AMBIENCES = ("cozy_night", "rainy_day", "morning_calm", "forest_retreat", "starry_night")
DEFAULT_AMBIENCE = {"ambience_type": "cozy_night", "sound_enabled": False, "volume": 0.4}
# The pet's answer to each mood: how it moves and what it says. Supportive, never a diagnosis.
MOOD_RESPONSES = {
    "happy": {"animation": "celebrate", "line": "Thật vui khi thấy bạn vui! Mình nhảy cùng bạn nhé!", "suggest": "gratitude"},
    "neutral": {"animation": "idle", "line": "Một ngày bình thường cũng là một ngày đáng quý. Mình ở đây với bạn.", "suggest": "nature_sound"},
    "tired": {"animation": "rest", "line": "Hôm nay bạn đã cố gắng nhiều rồi. Mình cùng nghỉ một chút nhé?", "suggest": "rest"},
    "stressed": {"animation": "comfort", "line": "Mình ngồi cạnh bạn đây. Thử hít thở thật chậm cùng mình nhé?", "suggest": "breathing"},
    "sad": {"animation": "comfort", "line": "Mình ở ngay đây với bạn. Nếu muốn, bạn có thể viết vài dòng vào nhật ký.", "suggest": "journal"},
    "excited": {"animation": "celebrate", "line": "Năng lượng tuyệt quá! Kể mình nghe điều gì làm bạn hào hứng nào!", "suggest": "gratitude"},
}
# Shown with the heavier moods: a gentle pointer to people, not advice.
SUPPORT_HINT = "Nếu cảm giác này kéo dài, hãy chia sẻ với người bạn tin tưởng nhé."


def zone_of(db: Session, user: User, tz: str | None):
    return valid_timezone(tz or preferences(db, user.id).timezone)


def local_today(db: Session, user: User, tz: str | None) -> date:
    return utcnow().astimezone(zone_of(db, user, tz)).date()


def mood_view(row: MoodEntry) -> dict:
    return {"id": row.id, "mood": row.mood, "note": row.note, "local_date": row.local_date.isoformat(),
            "created_at": as_utc(row.created_at).isoformat()}


def mood_response(mood: str) -> dict:
    response = dict(MOOD_RESPONSES[mood])
    if mood in ("sad", "stressed"):
        response["support_hint"] = SUPPORT_HINT
    return response


@router.post("/moods", status_code=201)
def create_mood(data: MoodCreate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    zone = zone_of(db, user, data.timezone)
    today = utcnow().astimezone(zone).date()
    count = db.scalar(select(func.count()).select_from(MoodEntry).where(MoodEntry.user_id == user.id,
                                                                        MoodEntry.local_date == today)) or 0
    if count >= MOODS_PER_DAY:
        raise APIError(429, "too_many_moods", "That's a lot of check-ins today. Try again tomorrow.")
    row = MoodEntry(user_id=user.id, mood=data.mood, note=data.note, local_date=today, timezone=str(zone))
    db.add(row)
    db.commit()
    return {"entry": mood_view(row), "pet": mood_response(data.mood)}


@router.get("/moods/history")
def mood_history(days: int = Query(default=30, ge=1, le=366), tz: str | None = Query(default=None, max_length=80),
                 user: User = Depends(life_user), db: Session = Depends(get_db)):
    """Check-ins of the last `days` local days, newest first, and each day's last mood."""
    today = local_today(db, user, tz)
    start = today - timedelta(days=days - 1)
    rows = list(db.scalars(select(MoodEntry).where(MoodEntry.user_id == user.id, MoodEntry.local_date >= start)
                           .order_by(MoodEntry.created_at.desc(), MoodEntry.id.desc())))
    by_day: dict[str, str] = {}
    for row in rows:
        by_day.setdefault(row.local_date.isoformat(), row.mood)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.mood] = counts.get(row.mood, 0) + 1
    db.commit()
    return {"start": start.isoformat(), "end": today.isoformat(), "entries": [mood_view(r) for r in rows],
            "days": [{"date": d, "mood": m} for d, m in sorted(by_day.items(), reverse=True)], "counts": counts}


def journal_view(row: JournalEntry) -> dict:
    return {"id": row.id, "kind": row.kind, "title": row.title, "content": row.content, "mood": row.mood,
            "visibility": row.visibility, "memory_id": row.memory_id,
            "created_at": as_utc(row.created_at).isoformat(), "updated_at": as_utc(row.updated_at).isoformat()}


def own_entry(db: Session, user: User, entry_id: int) -> JournalEntry:
    row = db.scalar(select(JournalEntry).where(JournalEntry.id == entry_id, JournalEntry.user_id == user.id))
    if row is None:
        raise APIError(404, "journal_not_found", "Journal entry not found")
    return row


@router.get("/journal")
def list_journal(limit: int = Query(default=20, ge=1, le=50), before: int | None = None,
                 user: User = Depends(life_user), db: Session = Depends(get_db)):
    where = [JournalEntry.user_id == user.id]
    if before:
        where.append(JournalEntry.id < before)
    rows = list(db.scalars(select(JournalEntry).where(*where).order_by(JournalEntry.id.desc()).limit(limit + 1)))
    return {"items": [journal_view(r) for r in rows[:limit]],
            "next_before": rows[limit - 1].id if len(rows) > limit else None}


@router.post("/journal", status_code=201)
def create_journal(data: JournalCreate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    since = utcnow() - timedelta(days=1)
    recent = db.scalar(select(func.count()).select_from(JournalEntry).where(
        JournalEntry.user_id == user.id, JournalEntry.created_at >= since)) or 0
    if recent >= JOURNAL_PER_DAY:
        raise APIError(429, "too_many_entries", "You've written a lot today. Try again later.")
    row = JournalEntry(user_id=user.id, kind=data.kind, title=data.title, content=data.content, mood=data.mood)
    db.add(row)
    db.flush()
    if data.save_to_album and user.pet_name is not None:
        memory = create_once(db, user, "journal_moment", f"journal:{row.id}", utcnow(),
                             snapshot(user, result=data.title), data.title)
        row.memory_id = memory.id if memory is not None else None
    db.commit()
    return journal_view(row)


@router.patch("/journal/{entry_id}")
def update_journal(entry_id: int, data: JournalUpdate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    row = own_entry(db, user, entry_id)
    fields = data.model_fields_set
    for name in ("title", "content"):
        if name in fields and getattr(data, name) is None:
            raise APIError(422, "field_required", f"{name} cannot be empty")
    for name in ("title", "content", "mood"):
        if name in fields:
            setattr(row, name, getattr(data, name))
    row.updated_at = utcnow()
    db.commit()
    return journal_view(row)


@router.delete("/journal/{entry_id}", status_code=204)
def delete_journal(entry_id: int, user: User = Depends(life_user), db: Session = Depends(get_db)):
    """Erase the page for good. A memory saved from it stays in the album (it holds the title only) until removed there."""
    row = own_entry(db, user, entry_id)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


def relaxation_summary(db: Session, user: User, today: date) -> dict:
    week_start = today - timedelta(days=6)
    rows = list(db.scalars(select(RelaxationSession).where(RelaxationSession.user_id == user.id,
                                                           RelaxationSession.local_date >= week_start)))
    today_rows = [r for r in rows if r.local_date == today]
    return {"today_seconds": sum(r.duration_seconds for r in today_rows), "today_sessions": len(today_rows),
            "week_seconds": sum(r.duration_seconds for r in rows),
            "calm_days": len({r.local_date for r in rows})}


@router.post("/relaxation-sessions", status_code=201)
def create_relaxation(data: RelaxationCreate, response: Response, user: User = Depends(life_user),
                      db: Session = Depends(get_db)):
    zone = zone_of(db, user, data.timezone)
    today = utcnow().astimezone(zone).date()
    existing = db.scalar(select(RelaxationSession).where(RelaxationSession.user_id == user.id,
                                                         RelaxationSession.client_ref == data.client_ref))
    already = existing is not None
    if existing is None:
        existing = RelaxationSession(user_id=user.id, activity_type=data.activity_type, client_ref=data.client_ref,
                                     duration_seconds=data.duration_seconds, local_date=today)
        db.add(existing)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            already = True
            existing = db.scalar(select(RelaxationSession).where(RelaxationSession.user_id == user.id,
                                                                 RelaxationSession.client_ref == data.client_ref))
    if already:
        response.status_code = 200
    return {"session": {"id": existing.id, "activity_type": existing.activity_type,
                        "duration_seconds": existing.duration_seconds, "local_date": existing.local_date.isoformat(),
                        "completed_at": as_utc(existing.completed_at).isoformat()},
            "already_recorded": already, "summary": relaxation_summary(db, user, today)}


def ambience_view(row: RoomAmbiencePreference | None) -> dict:
    if row is None:
        return dict(DEFAULT_AMBIENCE)
    try:
        sound = json.loads(row.sound_settings or "{}")
    except ValueError:
        sound = {}
    return {"ambience_type": row.ambience_type if row.ambience_type in AMBIENCES else "cozy_night",
            "sound_enabled": bool(sound.get("enabled", False)), "volume": float(sound.get("volume", 0.4))}


@router.get("/room-ambience")
def get_ambience(user: User = Depends(life_user), db: Session = Depends(get_db)):
    return ambience_view(db.get(RoomAmbiencePreference, user.id))


@router.put("/room-ambience")
def put_ambience(data: AmbienceUpdate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    row = db.get(RoomAmbiencePreference, user.id)
    sound = json.dumps({"enabled": data.sound_enabled, "volume": round(data.volume, 2)})
    if row is None:
        row = RoomAmbiencePreference(user_id=user.id, ambience_type=data.ambience_type, sound_settings=sound)
        try:
            with db.begin_nested():
                db.add(row)
        except IntegrityError:  # created by a parallel save: update that one
            row = db.get(RoomAmbiencePreference, user.id, populate_existing=True)
    row.ambience_type = data.ambience_type
    row.sound_settings = sound
    row.updated_at = utcnow()
    db.commit()
    return ambience_view(row)


@router.get("/healing")
def healing_summary(tz: str | None = Query(default=None, max_length=80), user: User = Depends(life_user),
                    db: Session = Depends(get_db)):
    """What the Healing Room shows when it opens: the ambience, today's last mood, the week's calm and the journal."""
    today = local_today(db, user, tz)
    last = db.scalar(select(MoodEntry).where(MoodEntry.user_id == user.id, MoodEntry.local_date == today)
                     .order_by(MoodEntry.created_at.desc(), MoodEntry.id.desc()).limit(1))
    journal_count = db.scalar(select(func.count()).select_from(JournalEntry).where(JournalEntry.user_id == user.id)) or 0
    result = {"today": today.isoformat(), "ambience": ambience_view(db.get(RoomAmbiencePreference, user.id)),
              "mood_today": mood_view(last) if last else None,
              "pet": mood_response(last.mood) if last else None,
              "relaxation": relaxation_summary(db, user, today), "journal_count": journal_count}
    db.commit()
    return result
