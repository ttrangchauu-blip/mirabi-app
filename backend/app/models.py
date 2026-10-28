import json
from datetime import date, datetime, timezone
from sqlalchemy import String, Integer, Date, DateTime, ForeignKey, Text, Boolean, UniqueConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

def utcnow():
    return datetime.now(timezone.utc)

def as_utc(value: datetime) -> datetime:
    # SQLite drops tzinfo; every timestamp we store is UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Always stored normalized (trimmed + lowercase), see schemas.normalize_email.
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(80), default="Lunaria")
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")  # active | disabled
    role: Mapped[str] = mapped_column(String(20), default="user", server_default="user")
    # Embedded in access tokens; bumping it invalidates every outstanding access token for the user.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Level and XP mirror the active pet's saved evolution progress.
    level: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    xp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    coins: Mapped[int] = mapped_column(Integer, default=12450)
    gems: Mapped[int] = mapped_column(Integer, default=480)
    avatar_theme: Mapped[str] = mapped_column(String(40), default="aqua")
    # Companion species (one of schemas.PET_IDS). The pet counts as adopted once it has a name.
    pet: Mapped[str] = mapped_column(String(20), default="fox", server_default="fox")
    pet_name: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Set when the user finishes (or skips) the welcome tour after adopting a pet.
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    daily_task_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    daily_tasks_selected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    equipped_item: Mapped[str] = mapped_column(String(80), default="Vương miện pha lê")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=True)

    @property
    def onboarded(self) -> bool:
        return self.onboarded_at is not None

    @property
    def daily_tasks_selected(self) -> bool:
        if self.daily_tasks_selected_at is None:
            return False
        try:
            return bool(json.loads(self.daily_task_ids or "[]"))
        except (TypeError, ValueError):
            return False

class RefreshToken(Base):
    """One row per issued refresh token. Only the SHA-256 of the token is stored.

    Tokens issued by rotation share a family_id; presenting an already-rotated token
    revokes the whole family (replay detection).
    """
    __tablename__ = "refresh_tokens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    family_id: Mapped[str] = mapped_column(String(36), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class StudySession(Base):
    __tablename__ = "study_sessions"
    __table_args__ = (UniqueConstraint("user_id", "pomodoro_cycle", name="uq_study_user_pomodoro_cycle"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    mode: Mapped[str] = mapped_column(String(30), default="focus")
    # Loại học: self_study (Học tự chọn, the focus timer) | together (a Study Together room). English and Math games
    # are LearningSession rows, which keep their subject, game, topic and level.
    study_type: Mapped[str] = mapped_column(String(20), default="self_study", server_default="self_study")
    duration_seconds: Mapped[int] = mapped_column(Integer)
    completed: Mapped[bool] = mapped_column(Boolean, default=True)
    pomodoro_cycle: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class PomodoroSettings(Base):
    __tablename__ = "pomodoro_settings"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    timezone: Mapped[str] = mapped_column(String(80), default="UTC")
    daily_goal_minutes: Mapped[int] = mapped_column(Integer, default=120)
    focus_minutes: Mapped[int] = mapped_column(Integer, default=25)
    short_break_minutes: Mapped[int] = mapped_column(Integer, default=5)
    long_break_minutes: Mapped[int] = mapped_column(Integer, default=15)
    long_break_every: Mapped[int] = mapped_column(Integer, default=4)

class CommunityPost(Base):
    __tablename__ = "community_posts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class Activity(Base):
    """Things a user did that count toward daily quests but have no table of their own (e.g. opening a lesson)."""
    __tablename__ = "activities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    ref: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class PetWalk(Base):
    """A companion walk (Pet Adventure). `item_id` is its one gift, picked at the start: an id from
    companion.REWARD_ITEMS, or companion.EXP_GIFT for EXP.

    When the walk is over the backend grants its rewards once (`rewarded_at`, `reward_exp`, `rewards`),
    whether or not the app is open. `collected_at` is when the user confirmed the gift popup ("Nhận quà");
    it never grants anything.
    """
    __tablename__ = "pet_walks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(String(30))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    returns_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    collected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    task_cycle_id: Mapped[str | None] = mapped_column(String(10), nullable=True)
    rewarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reward_exp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # JSON list of {"item_id", "quantity"} granted into the inventory with this walk.
    rewards: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (Index("uq_pet_walk_user_cycle", "user_id", "task_cycle_id", unique=True),)

class InventoryItem(Base):
    """How many of each collectible (companion.REWARD_ITEMS) a user owns."""
    __tablename__ = "user_inventory_items"
    __table_args__ = (UniqueConstraint("user_id", "item_id", name="uq_inventory_user_item"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(String(40))
    quantity: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class UserTask(Base):
    """A personal task scheduled once or on a recurring calendar pattern."""
    __tablename__ = "user_tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(20))
    difficulty: Mapped[str] = mapped_column(String(12), default="medium", server_default="medium")
    scheduled_date: Mapped[date] = mapped_column(Date)
    repeat: Mapped[str] = mapped_column(String(10), default="none")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    end_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    repeat_interval: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    repeat_frequency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    repeat_weekdays: Mapped[str | None] = mapped_column(Text, nullable=True)
    repeat_month_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    repeat_month_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    repeat_month_weekday: Mapped[int | None] = mapped_column(Integer, nullable=True)
    repeat_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    repeat_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class UserTaskCompletion(Base):
    """Completion is recorded per scheduled occurrence and cannot be toggled off."""
    __tablename__ = "user_task_completions"
    __table_args__ = (UniqueConstraint("task_id", "occurrence_date", name="uq_user_task_occurrence"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("user_tasks.id", ondelete="CASCADE"), index=True)
    occurrence_date: Mapped[date] = mapped_column(Date)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PetEvolution(Base):
    """Saved cumulative evolution XP for one pet type owned by a user."""
    __tablename__ = "pet_evolutions"
    __table_args__ = (UniqueConstraint("user_id", "pet_id", name="uq_pet_evolution_user_pet"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    pet_id: Mapped[str] = mapped_column(String(20))
    total_xp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    level: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PetRoom(Base):
    """A user's personal pet room (Phòng cá nhân): its wall, floor and the items placed in it (pet_room.ITEMS).

    Created once with the default layout the first time the owner opens it; later reads never overwrite it.
    `version` grows on every save, so a save from an outdated screen is refused instead of silently undoing another.
    """
    __tablename__ = "pet_rooms"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    # Rooms saved with fixed slots kept their window here; rooms saved since items can be moved store "".
    background_id: Mapped[str] = mapped_column(String(40))
    wall_id: Mapped[str] = mapped_column(String(40))
    floor_id: Mapped[str] = mapped_column(String(40))
    # JSON {"items": [{item, variant, x, y, flip, rotate}]}; older rooms hold {slot: item id or null} (see pet_room.layout).
    items_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PetRoomItem(Base):
    """A room decoration a user owns. `source` says how: "starter" (granted with the room). Decorations brought back
    from walks are owned through user_inventory_items instead and have no row here."""
    __tablename__ = "pet_room_items"
    __table_args__ = (UniqueConstraint("user_id", "item_id", name="uq_pet_room_item_user_item"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(20), default="starter", server_default="starter")
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Memory(Base):
    """A private, immutable visual snapshot of a pet milestone.

    Rows are soft-deleted so an automatic source event can never re-create a
    memory the owner deliberately removed.
    """
    __tablename__ = "memories"
    __table_args__ = (UniqueConstraint("user_id", "source_key", name="uq_memory_user_source"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    pet_id: Mapped[str] = mapped_column(String(20), index=True)
    event_type: Mapped[str] = mapped_column(String(30), index=True)
    source_key: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(120))
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_text: Mapped[str] = mapped_column(Text)
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    snapshot_json: Mapped[str] = mapped_column(Text)
    image_svg: Mapped[str] = mapped_column(Text)
    thumbnail_svg: Mapped[str] = mapped_column(Text)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", index=True)
    featured: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", index=True)
    template_key: Mapped[str] = mapped_column(String(24), default="auto", server_default="auto")
    palette_key: Mapped[str] = mapped_column(String(24), default="sky", server_default="sky")
    include_message: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    status: Mapped[str] = mapped_column(String(20), default="ready", server_default="ready")
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ExpEvent(Base):
    """Auditable, idempotent XP award used for daily caps and duplicate protection."""
    __tablename__ = "exp_events"
    __table_args__ = (UniqueConstraint("user_id", "source", "reference_id", name="uq_exp_event_reference"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    pet_id: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(20), index=True)
    reference_id: Mapped[str] = mapped_column(String(100))
    amount: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class LoginStreakDay(Base):
    """One successful login and its rewards per user and local calendar day."""
    __tablename__ = "login_streak_days"
    __table_args__ = (UniqueConstraint("user_id", "login_date", name="uq_login_streak_user_date"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    login_date: Mapped[date] = mapped_column(Date)
    streak_count: Mapped[int] = mapped_column(Integer)
    daily_exp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    milestone_exp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Idempotency key of the login request that recorded this day; a retry of that request gets the popup again.
    popup_claim_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Study Together. Friends, rooms and group sessions reuse `users` for identity, pet and EXP; group focus time is
# written to `study_sessions` (see study_rooms.finalize_session) so it shares the existing study EXP cap.
# ---------------------------------------------------------------------------
class SocialProfile(Base):
    """Social settings of a user, created on first use. `public_code` is what friends type to find each other."""
    __tablename__ = "social_profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    public_code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    # Whether friends see "online"/"studying". "nobody" shows the user as hidden.
    presence_visibility: Mapped[str] = mapped_column(String(10), default="friends", server_default="friends")
    # Whether room/quest members see this user's focus minutes and contributions.
    share_study_stats: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # Whether the user appears in display-name search. Searching the exact public code always works.
    discoverable: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # Whether accepted friends may visit the personal pet room (nobody else ever can).
    allow_room_visits: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # Whether friends may invite this user into study rooms (from a visit or a room).
    allow_study_invites: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Friendship(Base):
    """One row per pair of users, stored with user_low_id < user_high_id so A->B and B->A can never coexist.

    status: pending (requester_id asked) | accepted | declined (kept for the re-request cooldown).
    """
    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("user_low_id", "user_high_id", name="uq_friendship_pair"),
                      Index("ix_friendship_high_status", "user_high_id", "status"),
                      Index("ix_friendship_low_status", "user_low_id", "status"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_low_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    user_high_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class UserBlock(Base):
    __tablename__ = "user_blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id", name="uq_user_block_pair"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserReport(Base):
    """Abuse report reviewed by an admin (see friends.resolve_report)."""
    __tablename__ = "user_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reported_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(String(20))
    details: Mapped[str | None] = mapped_column(String(500), nullable=True)
    room_id: Mapped[int | None] = mapped_column(ForeignKey("study_rooms.id", ondelete="SET NULL"), nullable=True)
    # A reported chat message; its text is copied here so the evidence survives an unsend or the retention purge.
    message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message_body: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="open", server_default="open", index=True)  # open | dismissed | actioned
    resolved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StudyRoom(Base):
    """visibility: private (invitation only) | code (anyone with the code). status: open | closed.

    `member_count` is only changed with conditional UPDATEs so concurrent joins can't exceed `max_members`;
    `version` grows with every change and orders realtime snapshots on the client.
    """
    __tablename__ = "study_rooms"
    __table_args__ = (UniqueConstraint("host_id", "idempotency_key", name="uq_study_room_idempotency"),
                      Index("ix_study_room_status_host", "status", "host_id"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(60))
    goal: Mapped[str | None] = mapped_column(String(160), nullable=True)
    subject: Mapped[str] = mapped_column(String(40), default="general")
    visibility: Mapped[str] = mapped_column(String(10), default="private")
    focus_minutes: Mapped[int] = mapped_column(Integer, default=25)
    break_minutes: Mapped[int] = mapped_column(Integer, default=5)
    cycles: Mapped[int] = mapped_column(Integer, default=4)
    max_members: Mapped[int] = mapped_column(Integer, default=4)
    member_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(10), default="open", server_default="open")
    current_session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StudyRoomMember(Base):
    """role: host | member. status: active | left. A user is an active member of at most one room."""
    __tablename__ = "study_room_members"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_study_room_member"),
                      Index("uq_study_room_one_active_room", "user_id", unique=True,
                            sqlite_where=text("status = 'active'"), postgresql_where=text("status = 'active'")))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("study_rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10), default="member")
    status: Mapped[str] = mapped_column(String(10), default="active")
    # online while heartbeats arrive (WebSocket ping or REST heartbeat); away otherwise. Display only.
    presence: Mapped[str] = mapped_column(String(10), default="online", server_default="online")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StudyRoomInvitation(Base):
    """status: pending | accepted | declined | cancelled. One row per room and invitee; re-inviting reopens it."""
    __tablename__ = "study_room_invitations"
    __table_args__ = (UniqueConstraint("room_id", "invitee_id", name="uq_study_room_invitation"),
                      Index("ix_study_room_invitation_invitee", "invitee_id", "status"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("study_rooms.id", ondelete="CASCADE"), index=True)
    inviter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    invitee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StudyRoomSession(Base):
    """One group Pomodoro run in a room. The backend is the clock: phases advance from `phase_ends_at`.

    status: active | paused | completed | cancelled. phase: focus | break. Participant focus credit is accrued up to
    `accrued_until`; `finalized_at` is set exactly once when rewards are written.
    """
    __tablename__ = "study_room_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("study_rooms.id", ondelete="CASCADE"), index=True)
    started_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), default="active", index=True)
    phase: Mapped[str] = mapped_column(String(10), default="focus")
    cycle: Mapped[int] = mapped_column(Integer, default=1)
    total_cycles: Mapped[int] = mapped_column(Integer)
    completed_cycles: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    focus_seconds: Mapped[int] = mapped_column(Integer)
    break_seconds: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    phase_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    phase_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paused_remaining_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accrued_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StudyRoomParticipant(Base):
    """A member's part in one session. `focus_ms` is server-computed valid focus time; client numbers are never used."""
    __tablename__ = "study_room_participants"
    __table_args__ = (UniqueConstraint("session_id", "user_id", name="uq_study_room_participant"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_room_sessions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    present: Mapped[bool] = mapped_column(Boolean, default=True)
    present_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    focus_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # focus_ms when the current focus phase began; a cycle counts if the member studied at least half of it.
    phase_start_focus_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cycles_completed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    study_exp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    bonus_exp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    rewarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TeamQuest(Base):
    """A cooperative goal for one room, created from a fixed template (team_quests.TEMPLATES).

    status: active | completed | expired. `progress` only grows through unique TeamQuestEvent rows.
    """
    __tablename__ = "team_quests"
    __table_args__ = (Index("ix_team_quest_room_status", "room_id", "status"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("study_rooms.id", ondelete="CASCADE"))
    template_key: Mapped[str] = mapped_column(String(30))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    target: Mapped[int] = mapped_column(Integer)
    progress: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    reward_exp: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="active")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TeamQuestMember(Base):
    __tablename__ = "team_quest_members"
    __table_args__ = (UniqueConstraint("quest_id", "user_id", name="uq_team_quest_member"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quest_id: Mapped[int] = mapped_column(ForeignKey("team_quests.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    contribution: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reward_exp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    rewarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TeamQuestEvent(Base):
    """Idempotency ledger: a session counts toward a quest once per member, however often it is processed."""
    __tablename__ = "team_quest_events"
    __table_args__ = (UniqueConstraint("quest_id", "source_ref", name="uq_team_quest_event"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quest_id: Mapped[int] = mapped_column(ForeignKey("team_quests.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    source_ref: Mapped[str] = mapped_column(String(80))
    amount: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StudyRoomMessage(Base):
    """Room chat. Members see messages sent since they (last) joined. `deleted_at` marks a message unsent by its
    sender or removed by the host; its body is kept only for moderation (reports) until the retention purge."""
    __tablename__ = "study_room_messages"
    __table_args__ = (UniqueConstraint("room_id", "sender_id", "client_id", name="uq_study_room_message_client"),
                      Index("ix_study_room_message_room_id", "room_id", "id"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("study_rooms.id", ondelete="CASCADE"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(String(500))
    # Chosen by the app per message, so a retried send (e.g. after a timeout) never posts twice.
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class SocialNotification(Base):
    """In-app notification (friend requests, room invitations, session and quest results). `read_at` marks it read."""
    __tablename__ = "social_notifications"
    __table_args__ = (Index("ix_social_notification_user_read", "user_id", "read_at"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(300))
    data_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class RoomVisitInteraction(Base):
    """Something a visitor did in a friend's pet room (room_visits.py): kind hello | cheer | study_invite.

    The source of truth for cooldowns and the daily cap, and for what the host has seen (`seen_at`, set when the
    notification that carries it is read). A study invite points at the real room invitation it created. A retry with
    the same `client_request_id` returns the stored row instead of sending again. Never awards EXP (playing with the
    pet does, see FriendPetExpGrant).
    """
    __tablename__ = "room_visit_interactions"
    __table_args__ = (UniqueConstraint("visitor_id", "client_request_id", name="uq_room_visit_interaction_request"),
                      Index("ix_room_visit_interaction_pair", "visitor_id", "host_id", "kind", "created_at"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visitor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    # A cheer's preset message (room_visits.CHEERS); never free text.
    message_key: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # The host's pet was out walking: the greeting was left for later.
    host_away: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    room_id: Mapped[int | None] = mapped_column(ForeignKey("study_rooms.id", ondelete="SET NULL"), nullable=True)
    invitation_id: Mapped[int | None] = mapped_column(ForeignKey("study_room_invitations.id", ondelete="SET NULL"), nullable=True)
    notification_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    client_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class FriendPetExpGrant(Base):
    """EXP a visiting friend gave the host's pet by playing with it (room_visits.play_with_pet), one row per grant.

    `local_date` is the host's account day. The unique keys make the limits atomic: one grant per friend, pet and day,
    and at most `slot` = 1..N per pet and day (N = cap / EXP per friend, rounded up), so concurrent visitors, retries
    and several devices can never give more. The EXP itself is the exp_events row `friend_pet:<id>`.
    """
    __tablename__ = "friend_pet_exp_grants"
    __table_args__ = (UniqueConstraint("host_id", "pet_id", "local_date", "visitor_id", name="uq_friend_pet_exp_visitor"),
                      UniqueConstraint("host_id", "pet_id", "local_date", "slot", name="uq_friend_pet_exp_slot"),
                      UniqueConstraint("visitor_id", "client_request_id", name="uq_friend_pet_exp_request"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    visitor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    pet_id: Mapped[str] = mapped_column(String(20))
    local_date: Mapped[date] = mapped_column(Date)
    slot: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer)
    client_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------------------------------------------
# Learning games (English and Math). See docs/LEARNING_GAMES.md.
#
# Content is versioned: a lesson points at its current version, and a session keeps the version it was started with
# plus a snapshot of every item it served (prompt, server-only answer, hints) and of its scoring rules, so editing
# content never changes old results. Answers live only in the backend; the app receives them when allowed to.
# ---------------------------------------------------------------------------------------------------------------

class LearningSubject(Base):
    """english | math."""
    __tablename__ = "learning_subjects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class LearningLevel(Base):
    """A level or school grade within a subject (e.g. "Lớp 3")."""
    __tablename__ = "learning_levels"
    __table_args__ = (UniqueConstraint("subject_id", "code", name="uq_learning_level_code"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("learning_subjects.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class LearningTopic(Base):
    """skill_type: vocabulary | grammar | arithmetic | missing_number | compare | order_of_operations."""
    __tablename__ = "learning_topics"
    __table_args__ = (UniqueConstraint("subject_id", "code", name="uq_learning_topic_code"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("learning_subjects.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    skill_type: Mapped[str] = mapped_column(String(30))
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class LearningLesson(Base):
    """A playable lesson for one topic and level. `current_version` is the version new sessions use."""
    __tablename__ = "learning_lessons"
    __table_args__ = (Index("ix_learning_lesson_topic_level", "topic_id", "level_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("learning_topics.id", ondelete="CASCADE"))
    level_id: Mapped[int] = mapped_column(ForeignKey("learning_levels.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(12), default="published", server_default="published")
    current_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LearningLessonVersion(Base):
    """Immutable content of one lesson version: intro (JSON), game config/difficulty (JSON) and its items.

    `content_hash` lets the seeder detect edited content and publish a new version instead of changing this one.
    """
    __tablename__ = "learning_lesson_versions"
    __table_args__ = (UniqueConstraint("lesson_id", "version", name="uq_learning_lesson_version"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lesson_id: Mapped[int] = mapped_column(ForeignKey("learning_lessons.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    intro_json: Mapped[str] = mapped_column(Text)
    game_config_json: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LearningVocabItem(Base):
    """A word taught by a vocabulary lesson version. `context_vi` disambiguates words with several meanings."""
    __tablename__ = "learning_vocab_items"
    __table_args__ = (UniqueConstraint("lesson_version_id", "item_key", name="uq_learning_vocab_item"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lesson_version_id: Mapped[int] = mapped_column(ForeignKey("learning_lesson_versions.id", ondelete="CASCADE"), index=True)
    item_key: Mapped[str] = mapped_column(String(80))  # stable across versions; also the progress skill key
    word: Mapped[str] = mapped_column(String(60))
    meaning_vi: Mapped[str] = mapped_column(String(120))
    context_vi: Mapped[str | None] = mapped_column(String(160), nullable=True)
    part_of_speech: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phonetic: Mapped[str | None] = mapped_column(String(60), nullable=True)
    example_en: Mapped[str | None] = mapped_column(String(200), nullable=True)
    example_vi: Mapped[str | None] = mapped_column(String(200), nullable=True)
    accepted_json: Mapped[str] = mapped_column(Text)  # JSON list of accepted spellings (server only)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class LearningVocabEntry(Base):
    """The shared English vocabulary bank (one row per sense: "bank" money and "bank" river are two entries).

    Imported and upserted by `entry_key` from the data files in app/data/vocabulary (app/learning_vocab.py). Both
    vocabulary games draw from it; a session freezes the entries it uses, so editing the bank never changes a
    session already played. Retired entries stay for old sessions but are no longer drawn.
    """
    __tablename__ = "learning_vocab_entries"
    __table_args__ = (UniqueConstraint("entry_key", name="uq_learning_vocab_entry_key"),
                      Index("ix_learning_vocab_entry_topic_level", "topic", "level", "status"),
                      Index("ix_learning_vocab_entry_status_difficulty", "status", "difficulty"),
                      Index("ix_learning_vocab_entry_word", "word"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_key: Mapped[str] = mapped_column(String(60))  # stable; progress keys are en.word.<key> and en.spell.<key>
    word: Mapped[str] = mapped_column(String(60))
    part_of_speech: Mapped[str] = mapped_column(String(20))  # noun | verb | adjective | adverb | phrase | phrasal_verb | ...
    level: Mapped[str] = mapped_column(String(2))  # D1..D6: the internal difficulty band (A1..C2 in rows imported before it)
    difficulty: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1 (most common) .. 6 (advanced), internal
    cefr: Mapped[str | None] = mapped_column(String(2), nullable=True)  # only when a licensed source states it
    audio_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)  # recorded audio, when there is one
    topic: Mapped[str] = mapped_column(String(40))  # a learning_topics code of the English subject
    meaning_vi: Mapped[str] = mapped_column(String(120))
    context_vi: Mapped[str | None] = mapped_column(String(160), nullable=True)  # required when a word has several senses
    example_en: Mapped[str] = mapped_column(String(200))
    example_vi: Mapped[str] = mapped_column(String(200))
    accepted_json: Mapped[str] = mapped_column(Text)  # JSON list: the word and its valid equivalents (Việt → Anh)
    phonetic: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source: Mapped[str] = mapped_column(String(80), default="mirabi-original")
    # draft | checked | active | retired: only active entries are served (see learning_vocab)
    status: Mapped[str] = mapped_column(String(10), default="active", server_default="active")
    content_hash: Mapped[str] = mapped_column(String(64))
    content_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")  # +1 on every content change
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # why a row is held back as a draft
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class LearningGrammarItem(Base):
    """The English grammar bank: one question of "Chọn đáp án" (game choice) or "Sắp xếp câu" (game order).

    Imported and upserted by `item_key` from app/data/grammar (app/learning_grammar_bank.py). `answer` and
    `accepted_json` never leave the server until the user may see them; a session freezes the items it serves, so
    editing the bank (a new `content_version`) never changes a session already played.
    """
    __tablename__ = "learning_grammar_items"
    __table_args__ = (UniqueConstraint("item_key", name="uq_learning_grammar_item_key"),
                      Index("ix_learning_grammar_game_status_difficulty", "game", "status", "difficulty"),
                      Index("ix_learning_grammar_point", "point", "game"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_key: Mapped[str] = mapped_column(String(60))
    game: Mapped[str] = mapped_column(String(10))  # choice | order
    point: Mapped[str] = mapped_column(String(40))  # grammar point code (learning_grammar_bank.POINTS)
    difficulty: Mapped[int] = mapped_column(Integer)  # 1..6, internal
    topic: Mapped[str] = mapped_column(String(40))  # situation (a vocabulary topic code)
    form: Mapped[str] = mapped_column(String(4))  # aff | neg | q
    context_vi: Mapped[str | None] = mapped_column(String(200), nullable=True)
    prompt: Mapped[str | None] = mapped_column(String(300), nullable=True)  # choice: the sentence with ___
    options_json: Mapped[str] = mapped_column(Text, default="[]")  # choice: the options (answer included)
    answer: Mapped[str | None] = mapped_column(String(80), nullable=True)  # choice: the right option (server only)
    tokens_json: Mapped[str] = mapped_column(Text, default="[]")  # order: the pieces in a right order (server only)
    accepted_json: Mapped[str] = mapped_column(Text, default="[]")  # order: every valid order (server only)
    sentence_en: Mapped[str] = mapped_column(String(300))
    sentence_vi: Mapped[str] = mapped_column(String(300))
    hint_vi: Mapped[str] = mapped_column(String(300))
    explanation_vi: Mapped[str] = mapped_column(String(500))
    pattern: Mapped[str] = mapped_column(String(120))  # structure signature, to avoid the same pattern in nearby stages
    source: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(10), default="draft", server_default="draft")  # draft|checked|active|retired
    content_hash: Mapped[str] = mapped_column(String(64))
    content_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class LearningItemHistory(Base):
    """Per-user history of one bank item in one game (grammar questions): when it was seen and how it went. Used to
    mix new and due items, to avoid repeating items in nearby stages, and to require several different items before
    a grammar point counts as mastered (one right answer is not mastery)."""
    __tablename__ = "learning_item_history"
    __table_args__ = (UniqueConstraint("user_id", "game", "item_key", name="uq_learning_item_history"),
                      Index("ix_learning_item_history_user_game_point", "user_id", "game", "point"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    game: Mapped[str] = mapped_column(String(10))  # choice | order
    item_key: Mapped[str] = mapped_column(String(60))
    point: Mapped[str] = mapped_column(String(40))
    difficulty: Mapped[int] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    first_try: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    corrected: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    hinted: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    revealed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    missed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    wrong: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_outcome: Mapped[str | None] = mapped_column(String(12), nullable=True)
    first_session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LearningContentRelease(Base):
    """A published state of a content bank (vocabulary or grammar): the hash of every active item. Sessions record the
    release they drew from; with the frozen item snapshots, an old session's results never change."""
    __tablename__ = "learning_content_releases"
    __table_args__ = (UniqueConstraint("bank", "release_hash", name="uq_learning_content_release"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bank: Mapped[str] = mapped_column(String(20))  # vocabulary | grammar
    release_hash: Mapped[str] = mapped_column(String(64))
    counts_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LearningContentImport(Base):
    """Each import of the bundled data files of a bank: the hash of the files and what changed. Startup skips the
    import when the same files were already imported."""
    __tablename__ = "learning_content_imports"
    __table_args__ = (Index("ix_learning_content_import_bank_hash", "bank", "files_hash"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bank: Mapped[str] = mapped_column(String(20))  # vocabulary | grammar
    files_hash: Mapped[str] = mapped_column(String(64))
    counts_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LearningQuestion(Base):
    """A fixed question of a lesson version. kind: vocab_typing | gate_choice | bridge_order.

    `answer_json` never leaves the server until the user may see it. Math questions are generated per session
    from the version's game config (see learning_engine) and stored in learning_session_items instead.
    """
    __tablename__ = "learning_questions"
    __table_args__ = (UniqueConstraint("lesson_version_id", "question_key", name="uq_learning_question"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lesson_version_id: Mapped[int] = mapped_column(ForeignKey("learning_lesson_versions.id", ondelete="CASCADE"), index=True)
    question_key: Mapped[str] = mapped_column(String(80))  # stable across versions (review list)
    skill_key: Mapped[str] = mapped_column(String(80))  # word or grammar point tracked in progress
    skill_label: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20))
    vocab_item_id: Mapped[int | None] = mapped_column(ForeignKey("learning_vocab_items.id", ondelete="CASCADE"), nullable=True)
    prompt_json: Mapped[str] = mapped_column(Text)
    answer_json: Mapped[str] = mapped_column(Text)
    hints_json: Mapped[str] = mapped_column(Text, default="[]")
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class LearningSession(Base):
    """One stage (màn) of a mini game. status: active | paused | completed | failed | abandoned.

    Everything that decides the result is computed here by the backend: hearts, score, combo, active time,
    completion and the reward. `version` grows with every change; writes are conditional on it so concurrent
    requests can't both apply. At most one active/paused session per user (partial unique index).
    """
    __tablename__ = "learning_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "client_request_id", name="uq_learning_session_request"),
        Index("uq_learning_one_open_session", "user_id", unique=True,
              sqlite_where=text("status IN ('active', 'paused')"),
              postgresql_where=text("status IN ('active', 'paused')")),
        Index("ix_learning_session_user_status", "user_id", "status"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("learning_subjects.id"))
    topic_id: Mapped[int] = mapped_column(ForeignKey("learning_topics.id"))
    level_id: Mapped[int] = mapped_column(ForeignKey("learning_levels.id"))
    lesson_id: Mapped[int] = mapped_column(ForeignKey("learning_lessons.id"))
    lesson_version_id: Mapped[int] = mapped_column(ForeignKey("learning_lesson_versions.id"))
    kind: Mapped[str] = mapped_column(String(10), default="lesson")  # lesson | review
    mode: Mapped[str] = mapped_column(String(10))  # practice (Học tập) | challenge (Thử thách)
    game_type: Mapped[str] = mapped_column(String(20))  # meteor | grammar | defense | math_bridge
    # The game the user picked: meteor | gate | bridge | grammar (gate and bridge mixed) | defense | math_bridge
    game: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="active")
    seed: Mapped[int] = mapped_column(Integer)
    scoring_json: Mapped[str] = mapped_column(Text)  # snapshot of scoring and game rules used by this session
    timezone: Mapped[str] = mapped_column(String(80))
    duration_seconds: Mapped[int] = mapped_column(Integer)
    active_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # server-measured play time
    required_count: Mapped[int] = mapped_column(Integer)
    hearts_max: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    hearts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    combo: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    max_combo: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    client_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_tick_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # None while paused
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # none | granted | capped | daily_cap_reached | daily_task | already_claimed | not_eligible
    reward_status: Mapped[str] = mapped_column(String(20), default="none", server_default="none")
    reward_exp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    # Every UPDATE is "... WHERE version = <read version>"; a concurrent writer gets StaleDataError and retries.
    __mapper_args__ = {"version_id_col": version}


class LearningSessionItem(Base):
    """One turn served to a session, with a frozen copy of its question.

    state: queued -> issued -> resolved. outcome (when resolved): first_try | hinted | corrected | wrong | revealed |
    missed. `practice_of_id` marks a re-practice turn added after "Xem đáp án"; it must be answered correctly for the
    session to complete, and never changes the original turn's outcome.
    """
    __tablename__ = "learning_session_items"
    __table_args__ = (UniqueConstraint("session_id", "position", name="uq_learning_item_position"),
                      Index("ix_learning_item_session_state", "session_id", "state"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    turn_id: Mapped[str] = mapped_column(String(32), unique=True)
    question_id: Mapped[int | None] = mapped_column(ForeignKey("learning_questions.id", ondelete="SET NULL"), nullable=True)
    question_key: Mapped[str] = mapped_column(String(80))
    skill_key: Mapped[str] = mapped_column(String(80))
    skill_label: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20))
    prompt_json: Mapped[str] = mapped_column(Text)
    answer_json: Mapped[str] = mapped_column(Text)
    hints_json: Mapped[str] = mapped_column(Text, default="[]")
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    practice_of_id: Mapped[int | None] = mapped_column(ForeignKey("learning_session_items.id", ondelete="CASCADE"), nullable=True)
    state: Mapped[str] = mapped_column(String(10), default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    wrong_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    hints_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    revealed: Mapped[bool] = mapped_column(Boolean, default=False)
    outcome: Mapped[str | None] = mapped_column(String(12), nullable=True)
    error_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    issued_active_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LearningEvent(Base):
    """Every accepted action (answer, hint, reveal, miss, pause, ...). `client_event_id` is the idempotency key:
    a retried request returns the stored `response_json` and changes nothing."""
    __tablename__ = "learning_events"
    __table_args__ = (UniqueConstraint("session_id", "client_event_id", name="uq_learning_event_client_id"),
                      Index("ix_learning_event_session_time", "session_id", "created_at"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"))
    item_id: Mapped[int | None] = mapped_column(ForeignKey("learning_session_items.id", ondelete="CASCADE"), nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_type: Mapped[str] = mapped_column(String(20))
    answer_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    error_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    score_delta: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    hearts_delta: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    response_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LearningSkillProgress(Base):
    """Per-user progress on one word, grammar point or math problem type. Only backend-confirmed results count;
    revealed answers never count toward mastery."""
    __tablename__ = "learning_skill_progress"
    __table_args__ = (UniqueConstraint("user_id", "skill_key", name="uq_learning_skill_progress"),
                      Index("ix_learning_progress_user_subject", "user_id", "subject_id", "mastery"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("learning_subjects.id", ondelete="CASCADE"))
    skill_key: Mapped[str] = mapped_column(String(80))
    skill_type: Mapped[str] = mapped_column(String(20))  # word | grammar_point | math_type
    label: Mapped[str] = mapped_column(String(120))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    first_try: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    corrected: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    hinted: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    revealed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    missed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    wrong: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    mastery: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # 0..100
    error_counts_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class LearningReviewItem(Base):
    """An entry on the user's "cần ôn" list. status: open | cleared. Cleared by a first-try correct answer in a later
    session; a reveal or a new mistake reopens it."""
    __tablename__ = "learning_review_items"
    __table_args__ = (UniqueConstraint("user_id", "lesson_id", "question_key", name="uq_learning_review_item"),
                      Index("ix_learning_review_user_status", "user_id", "status"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("learning_subjects.id", ondelete="CASCADE"))
    topic_id: Mapped[int] = mapped_column(ForeignKey("learning_topics.id", ondelete="CASCADE"))
    lesson_id: Mapped[int] = mapped_column(ForeignKey("learning_lessons.id", ondelete="CASCADE"))
    question_key: Mapped[str] = mapped_column(String(80))  # a question, or a math problem type
    skill_key: Mapped[str] = mapped_column(String(80))
    label: Mapped[str] = mapped_column(String(160))
    reason: Mapped[str] = mapped_column(String(12))  # wrong | corrected | hinted | revealed | missed
    status: Mapped[str] = mapped_column(String(10), default="open")
    times_flagged: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    times_practiced: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_session_id: Mapped[int | None] = mapped_column(ForeignKey("learning_sessions.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class LearningReward(Base):
    """The once-a-day stage reward claim per subject, on the account's local calendar day. The unique key makes
    the claim atomic across sessions, devices and concurrent requests. The EXP itself is an ExpEvent
    (source "learning", or "task" when the session completed the daily learning task instead)."""
    __tablename__ = "learning_rewards"
    __table_args__ = (UniqueConstraint("user_id", "subject_id", "local_date", name="uq_learning_reward_day"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("learning_subjects.id", ondelete="CASCADE"))
    session_id: Mapped[int] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"), unique=True)
    local_date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(12))  # stage | daily_task
    exp_amount: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LearningTutorialView(Base):
    """A game's first-time guide ("Cách chơi"), finished with "Bắt đầu": per account and game, so it is shown once on
    every device. Viewing it again later changes nothing."""
    __tablename__ = "learning_tutorial_views"
    __table_args__ = (UniqueConstraint("user_id", "game", name="uq_learning_tutorial_view"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    game: Mapped[str] = mapped_column(String(20))  # word_shooter | meteor | gate | bridge | grammar | defense | math_bridge
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
