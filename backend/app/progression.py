"""Pet evolution and source-specific XP accounting."""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .models import ExpEvent, PetEvolution, StudySession, User, as_utc, utcnow

EVOLUTION_THRESHOLDS = (0, 300, 800, 1500, 2400, 3500, 5000)
HATCH_EXP = EVOLUTION_THRESHOLDS[1]
CUSTOM_TASK_EXP = 5
SYSTEM_TASK_EXP = 10
STUDY_BLOCK_SECONDS = 5 * 60
STUDY_EXP_PER_BLOCK = 2


def level_for_exp(total_xp: int) -> int:
    return max(level for level, threshold in enumerate(EVOLUTION_THRESHOLDS) if total_xp >= threshold)


def stage_for(progress: PetEvolution) -> int:
    """The pet's level: an egg stays Lv.0 until its hatch is confirmed, however much EXP it has."""
    return level_for_exp(progress.total_xp) if progress.hatched_at is not None else 0


def awaiting_hatch(progress: PetEvolution | None) -> bool:
    """The egg has the EXP to hatch, but hasn't hatched yet (companion.complete_hatch)."""
    return progress is not None and progress.hatched_at is None and progress.total_xp >= HATCH_EXP


def new_progress(user: User, pet_id: str, initial_xp: int) -> PetEvolution:
    """A pet's first progress row. EXP carried over from before per-pet progress existed was already shown as a
    hatched pet, so a pet that starts past Lv.0 counts as hatched."""
    level = level_for_exp(initial_xp)
    return PetEvolution(user_id=user.id, pet_id=pet_id, total_xp=initial_xp, level=level,
                        hatched_at=utcnow() if level >= 1 else None)


def record_level_ups(db: Session, user: User, previous_level: int, level: int, at: datetime) -> None:
    from .memories import record_event
    for reached in range(previous_level + 1, level + 1):
        event = "pet_hatched" if reached == 1 else "pet_evolved"
        title = None if reached == 1 else f"{user.pet_name or 'Pet'} đạt cấp {reached}"
        record_event(db, user, event, f"{'hatch' if reached == 1 else 'evolution'}:{user.pet}:{reached}",
                     at=at, level=reached, title=title, before_level=None if reached == 1 else reached - 1)


def hatch(user: User, db: Session, progress: PetEvolution, at: datetime) -> None:
    """The egg is out: its level catches up with its EXP (gifts earned while it waited included). The caller has
    claimed `hatched_at` and commits."""
    previous_level = progress.level
    progress.hatched_at = at
    progress.level = stage_for(progress)
    progress.updated_at = at
    user.xp = progress.total_xp
    user.level = progress.level
    record_level_ups(db, user, previous_level, progress.level, at)


def active_pet_progress(user: User, db: Session) -> PetEvolution:
    progress = db.scalar(select(PetEvolution).where(
        PetEvolution.user_id == user.id, PetEvolution.pet_id == user.pet,
    ))
    if progress is None:
        # Preserve earned XP for accounts from before pet-specific progress existed.
        initial_xp = max(0, user.xp) if user.pet_name is not None else 0
        progress = new_progress(user, user.pet, initial_xp)
        db.add(progress)
        db.flush()
    user.xp = progress.total_xp
    user.level = progress.level
    return progress


def activate_pet(user: User, pet_id: str, db: Session) -> PetEvolution:
    """Select a pet and restore its own progression, creating new pets at Lv.0."""
    current_pet = user.pet
    current_name = user.pet_name
    if current_name is not None:
        active_pet_progress(user, db)
    user.pet = pet_id
    progress = db.scalar(select(PetEvolution).where(
        PetEvolution.user_id == user.id, PetEvolution.pet_id == pet_id,
    ))
    if progress is None:
        # If this is an already-adopted legacy pet, migrate its existing XP once.
        initial_xp = max(0, user.xp) if current_name is None or current_pet == pet_id else 0
        progress = new_progress(user, pet_id, initial_xp)
        db.add(progress)
        db.flush()
    user.xp = progress.total_xp
    user.level = progress.level
    return progress


def award_exp(
    user: User,
    db: Session,
    *,
    source: str,
    reference_id: str,
    requested: int,
    daily_cap: int,
    already_earned: int | None = None,
) -> int:
    """Award XP once per reference, respecting that source's UTC-day cap (or a caller-computed `already_earned`)."""
    if requested <= 0 or daily_cap <= 0:
        return 0
    exists = db.scalar(select(ExpEvent.id).where(
        ExpEvent.user_id == user.id,
        ExpEvent.source == source,
        ExpEvent.reference_id == reference_id,
    ).limit(1))
    if exists:
        return 0

    now = utcnow()
    if already_earned is None:
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        already_earned = db.scalar(select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(
            ExpEvent.user_id == user.id,
            ExpEvent.source.in_(cap_pool(source)),
            ExpEvent.created_at >= day_start,
        )) or 0
    granted = min(requested, max(0, daily_cap - already_earned))
    if granted == 0:
        return 0

    if user.pet_name is None:
        # Login rewards can arrive before first adoption; keep them pending on the
        # profile so activate_pet can transfer them to the chosen companion.
        user.xp += granted
        user.level = level_for_exp(user.xp)
    else:
        progress = active_pet_progress(user, db)
        # Added in SQL (total_xp = total_xp + n) and read back: two awards to the same pet at once (friends playing
        # with it from several devices) both count. The update holds the row until commit, so the level and the
        # evolution events below are computed from the real total.
        progress.total_xp = PetEvolution.total_xp + granted
        progress.updated_at = now
        db.flush()
        db.refresh(progress)
        previous_level = progress.level
        # Reaching the hatching EXP doesn't hatch the egg: it waits ("chờ nở") for complete_hatch, so it never
        # hatches while the pet is out on its walk, nor without the app showing it.
        progress.level = stage_for(progress)
        user.xp = progress.total_xp
        user.level = progress.level
        record_level_ups(db, user, previous_level, progress.level, now)
    db.add(ExpEvent(
        user_id=user.id,
        pet_id=user.pet,
        source=source,
        reference_id=reference_id,
        amount=granted,
        created_at=now.astimezone(timezone.utc),
    ))
    return granted


def counts_for_study_exp(session: StudySession) -> bool:
    """Completed sessions, and sessions ended early, count their studied minutes (at least one)."""
    finished = (bool(session.completed) and session.status in (None, "completed")) or session.status == "cancelled"
    return finished and session.duration_seconds >= 60 and "break" not in (session.mode or "")


def study_exp_for(seconds: int, daily_cap: int) -> int:
    return min(daily_cap, seconds // STUDY_BLOCK_SECONDS * STUDY_EXP_PER_BLOCK)


def award_study_exp(user: User, db: Session, session: StudySession) -> int:
    """+2 EXP per full 5 valid minutes studied on the session's local day.

    Minutes are summed across the day's sessions, so a leftover (e.g. 3 of a 23-minute session) carries into the
    next block. Pomodoro cycles and logged sessions share one daily cap (48 EXP = 120 valid minutes by default).
    Recomputing from the day's total keeps it correct when an offline session syncs late.
    """
    if not counts_for_study_exp(session):
        return 0
    from .study_statistics import preferences, valid_timezone

    zone = valid_timezone(session.timezone or preferences(db, user.id).timezone)
    local_day = lambda row: as_utc(row.ended_at or row.created_at or utcnow()).astimezone(zone).date()
    day = local_day(session)
    same_day = [row for row in db.scalars(select(StudySession).where(StudySession.user_id == user.id)).all()
                if counts_for_study_exp(row) and local_day(row) == day]
    if session not in same_day:
        same_day.append(session)
    references = [f"study:{row.id}" for row in same_day if row.id != session.id]
    earned = 0
    if references:
        earned = db.scalar(select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(
            ExpEvent.user_id == user.id, ExpEvent.source == "study", ExpEvent.reference_id.in_(references),
        )) or 0
    cap = source_daily_cap("study")
    target = study_exp_for(sum(row.duration_seconds for row in same_day), cap)
    return award_exp(user, db, source="study", reference_id=f"study:{session.id}",
                     requested=target - earned, daily_cap=target, already_earned=earned)


def daily_exp_remaining(user: User, db: Session, *, source: str, daily_cap: int) -> int:
    """Return the unspent cap for this source today, independently of why an award was zero."""
    now = utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    earned_today = db.scalar(select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(
        ExpEvent.user_id == user.id,
        ExpEvent.source.in_(cap_pool(source)),
        ExpEvent.created_at >= day_start,
    )) or 0
    return max(0, daily_cap - earned_today)


# Sources that share one daily cap. Learning-game stage rewards (source "learning") count toward the same
# 60 EXP/day as daily tasks; every other source keeps its own cap.
CAP_POOLS = {"task": ("task", "learning"), "learning": ("task", "learning")}


def cap_pool(source: str) -> tuple[str, ...]:
    return CAP_POOLS.get(source, (source,))


def pool_exp_between(user: User, db: Session, source: str, start: datetime, end: datetime) -> int:
    """EXP already granted by `source`'s cap pool in [start, end) (UTC bounds of the account's local day)."""
    return db.scalar(select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(
        ExpEvent.user_id == user.id,
        ExpEvent.source.in_(cap_pool(source)),
        ExpEvent.created_at >= start.astimezone(timezone.utc),
        ExpEvent.created_at < end.astimezone(timezone.utc),
    )) or 0


def source_daily_cap(source: str) -> int:
    """Resolve an independent cap for each supported source."""
    return {
        "task": settings.task_daily_exp_cap,
        "learning": settings.task_daily_exp_cap,
        "study": settings.study_daily_exp_cap,
        "group": settings.group_daily_exp_cap,
        "team_quest": settings.team_quest_daily_exp_cap,
        "friend_pet": settings.friend_pet_exp_daily_cap,  # per pet and host day, enforced by room_visits.play_with_pet
    }.get(source, 0)
