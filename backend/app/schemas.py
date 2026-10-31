import re
from datetime import date, datetime
from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, EmailStr, Field, model_validator
from typing import Annotated, Literal, Optional, get_args
from .study_profile import AGE_MAX, AGE_MIN, GradeId, check_study_profile

PASSWORD_MIN, PASSWORD_MAX = 8, 128

# Pets a user can adopt. Keep in sync with mobile/src/pets.ts.
PetId = Literal["fox", "cat", "bunny", "penguin", "dolphin", "turtle"]
PET_IDS: tuple[str, ...] = get_args(PetId)

# Preset profile pictures. Keep in sync with mobile/src/avatars.ts.
AvatarId = Literal["aqua", "sunset", "forest", "lavender", "fox", "cat", "bunny", "penguin", "dolphin", "turtle", "star", "flower"]

def normalize_email(value: str) -> str:
    return value.strip().lower()

def _strip(value):
    return value.strip() if isinstance(value, str) else value

def optional_text(max_length: int):
    """Optional free text, stripped, at most `max_length` long. The limit sits on the inner `str` so an explicit
    null stays valid: a limit on `Optional[str]` itself makes pydantic raise on None (a 500, not a 422)."""
    return Annotated[Optional[Annotated[str, Field(max_length=max_length)]], BeforeValidator(_strip)]

def check_password_policy(value: str) -> str:
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("Password must contain at least one letter and one number")
    if value.strip() != value:
        raise ValueError("Password must not start or end with whitespace")
    return value

def check_pet_name(value: str) -> str:
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError("Pet name must not contain control characters")
    return value

NormalizedEmail = Annotated[EmailStr, BeforeValidator(_strip), AfterValidator(normalize_email)]
NewPassword = Annotated[str, Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX), AfterValidator(check_password_policy)]
PetName = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=30), AfterValidator(check_pet_name)]
# A whole number of years: strict, so "12", 12.5 and true are rejected rather than coerced.
Age = Annotated[int, Field(strict=True, ge=AGE_MIN, le=AGE_MAX)]

class LoginInput(BaseModel):
    email: NormalizedEmail
    # No policy check on login: accounts created under older rules must still be able to sign in.
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)

class RegisterInput(BaseModel):
    email: NormalizedEmail
    password: NewPassword
    display_name: Optional[Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=80)]] = None
    # The app always sends both; optional together so older app versions can still register (Học tập asks later).
    age: Optional[Age] = None
    school_grade: Optional[GradeId] = None
    # The region whose school calendar moves the grade on (education.py); the default region when absent.
    education_region: Optional[Annotated[str, Field(pattern=r"^[A-Z]{2,8}$")]] = None

    @model_validator(mode="after")
    def validate_study_profile(self):
        if (self.age is None) != (self.school_grade is None):
            raise ValueError("Age and school grade must be given together")
        if self.age is not None:
            check_study_profile(self.age, self.school_grade)
        return self

class StudyProfileInput(BaseModel):
    age: Age
    school_grade: GradeId

    @model_validator(mode="after")
    def validate_study_profile(self):
        check_study_profile(self.age, self.school_grade)
        return self

class RefreshInput(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=256)

class LogoutInput(BaseModel):
    refresh_token: Optional[str] = Field(default=None, max_length=256)

class ForgotPasswordInput(BaseModel):
    email: NormalizedEmail

class ResetPasswordInput(BaseModel):
    token: Annotated[str, BeforeValidator(_strip), Field(min_length=20, max_length=256)]
    new_password: NewPassword

class MessageOut(BaseModel):
    message: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    role: str = "user"
    display_name: str
    level: int
    xp: int
    coins: int
    gems: int
    avatar_theme: str
    pet: str
    pet_name: Optional[str]  # None until the user adopts (names) a pet after signing in
    onboarded: bool
    daily_tasks_selected: bool
    age: Optional[int] = None  # None (with school_grade) until the user gives them
    school_grade: Optional[str] = None  # the current grade (education.py moves it on with the school years)
    model_config = ConfigDict(from_attributes=True)

class LoginStreakOut(BaseModel):
    current_streak: int
    longest_streak: int
    last_login_date: str  # local calendar date (LOGIN_STREAK_TIMEZONE), ISO format
    # True only for the login that recorded today's check-in (or a retry with the same Idempotency-Key).
    should_show_popup: bool
    daily_exp_awarded: int
    milestone_exp_awarded: int
    already_claimed: bool

class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut
    # Only set by /login; None if the streak could not be recorded (login still succeeds).
    login_streak: Optional[LoginStreakOut] = None

class StudyInput(BaseModel):
    mode: str = "focus"
    duration_seconds: int = Field(ge=1, le=86400)
    completed: bool = True

class PostInput(BaseModel):
    body: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=2000)]
    image_url: Optional[str] = None

class ProfilePatch(BaseModel):
    display_name: Optional[Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=80)]] = None
    avatar_theme: Optional[AvatarId] = None
    pet: Optional[PetId] = None
    pet_name: Optional[PetName] = None

class AdoptPetInput(BaseModel):
    pet: PetId
    name: PetName

class DailyTaskSelection(BaseModel):
    task_ids: list[str] = Field(min_length=1, max_length=3)

class PetRoomUpdate(BaseModel):
    equipped_item: str = Field(min_length=1, max_length=40)

TaskCategory = Literal["study", "health", "habit", "personal", "work", "other"]
TaskPriority = Literal["low", "medium", "high", "urgent"]
TaskTitle = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=120)]

class UserTaskCreate(BaseModel):
    title: TaskTitle
    category: TaskCategory
    description: optional_text(1000) = None
    scheduled_date: date
    # Work Quest (work.py); optional for every task.
    project_id: Optional[int] = None
    priority: TaskPriority = "medium"
    due_at: Optional[datetime] = None
    estimated_minutes: Optional[int] = Field(default=None, ge=1, le=24 * 60)
    steps: list[TaskTitle] = Field(default_factory=list, max_length=20)
    repeat: Literal["none", "daily", "weekly", "monthly", "yearly", "custom"] = "none"
    start_time: Optional[str] = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end_time: Optional[str] = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    all_day: bool = True
    repeat_interval: int = Field(default=1, ge=1, le=365)
    repeat_frequency: Optional[Literal["daily", "weekly", "monthly", "yearly"]] = None
    repeat_weekdays: list[int] = Field(default_factory=list, max_length=7)
    repeat_month_day: Optional[int] = Field(default=None, ge=1, le=31)
    repeat_month_week: Optional[int] = Field(default=None, ge=1, le=5)
    repeat_month_weekday: Optional[int] = Field(default=None, ge=0, le=6)
    repeat_until: Optional[date] = None
    repeat_count: Optional[int] = Field(default=None, ge=1, le=1000)

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.end_time and self.start_time and self.end_time <= self.start_time:
            raise ValueError("End time must be after start time")
        if self.end_time and not self.start_time:
            raise ValueError("Start time is required when an end time is set")
        if self.repeat_until and self.repeat_until < self.scheduled_date:
            raise ValueError("Repeat end date must not be before start date")
        if any(day not in range(7) for day in self.repeat_weekdays):
            raise ValueError("Weekdays must be between 0 and 6")
        if self.repeat == "custom" and not self.repeat_frequency:
            raise ValueError("Custom repeat requires a frequency")
        return self

class UserTaskComplete(BaseModel):
    occurrence_date: date

class UserTaskUpdate(BaseModel):
    """Edits what a task is about. Its schedule (date and repeat) is kept: completions are recorded per occurrence, so
    moving them would make done occurrences reappear or vanish. Fields left out are unchanged; null clears them."""
    model_config = ConfigDict(extra="forbid")
    title: Optional[TaskTitle] = None
    description: optional_text(1000) = None
    category: Optional[TaskCategory] = None
    project_id: Optional[int] = None
    priority: Optional[TaskPriority] = None
    due_at: Optional[datetime] = None
    estimated_minutes: Optional[int] = Field(default=None, ge=1, le=24 * 60)

class TaskStepCreate(BaseModel):
    title: TaskTitle

class TaskStepToggle(BaseModel):
    occurrence_date: date
    done: bool

ProjectTheme = Literal["meadow", "beach", "forest", "snow", "desert", "sky"]

class WorkProjectCreate(BaseModel):
    name: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=60)]
    description: optional_text(500) = None
    theme: ProjectTheme = "meadow"

class WorkProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=60)]] = None
    description: optional_text(500) = None
    theme: Optional[ProjectTheme] = None
    status: Optional[Literal["active", "completed", "archived"]] = None

Mood = Literal["happy", "neutral", "tired", "stressed", "sad", "excited"]
TimeZoneName = Annotated[str, Field(min_length=1, max_length=80)]

class MoodCreate(BaseModel):
    mood: Mood
    note: optional_text(280) = None
    timezone: TimeZoneName = "UTC"

class JournalCreate(BaseModel):
    kind: Literal["free", "gratitude"] = "free"
    title: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=120)]
    content: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=5000)]
    mood: Optional[Mood] = None
    # Keep the moment in the album too (its title only: the text stays in the journal).
    save_to_album: bool = False

class JournalUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=120)]] = None
    content: Optional[Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=5000)]] = None
    mood: Optional[Mood] = None

RelaxationActivity = Literal["breathing", "nature_sound", "journal", "gratitude", "rest", "pet"]

class RelaxationCreate(BaseModel):
    activity_type: RelaxationActivity
    duration_seconds: int = Field(ge=1, le=2 * 60 * 60)
    client_ref: Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")]
    timezone: TimeZoneName = "UTC"

Ambience = Literal["cozy_night", "rainy_day", "morning_calm", "forest_retreat", "starry_night"]

class AmbienceUpdate(BaseModel):
    ambience_type: Ambience
    sound_enabled: bool = False
    volume: float = Field(default=0.4, ge=0, le=1)

class CareerQuiz(BaseModel):
    interests: list[str] = Field(min_length=1, max_length=10)

ClientRef = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")]

# ---- Phiêu lưu cuộc sống (adventure.py)
class AdventureStart(BaseModel):
    scheduled_date: date

# ---- Vườn tài chính (finance.py). Money is whole VND: a positive integer, at most 100 billion.
MAX_MONEY = 100_000_000_000
Money = Annotated[int, Field(gt=0, le=MAX_MONEY, strict=True)]
GoalPlant = Literal["sakura", "oak", "sunflower", "bamboo", "maple", "lotus"]

class FinanceGoalCreate(BaseModel):
    name: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=60)]
    target_amount: Money
    target_date: Optional[date] = None
    plant: GoalPlant = "sakura"

class FinanceGoalUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=60)]] = None
    target_amount: Optional[Money] = None
    target_date: Optional[date] = None
    plant: Optional[GoalPlant] = None
    status: Optional[Literal["active", "archived"]] = None

class FinanceTransactionCreate(BaseModel):
    transaction_type: Literal["deposit", "withdraw", "income", "expense"]
    amount: Money
    goal_id: Optional[int] = None
    category_id: Optional[int] = None
    occurred_at: Optional[datetime] = None
    note: optional_text(200) = None
    client_ref: ClientRef

    @model_validator(mode="after")
    def goal_or_category(self):
        if self.transaction_type in ("deposit", "withdraw") and self.goal_id is None:
            raise ValueError("A deposit or withdrawal needs a goal")
        if self.transaction_type in ("income", "expense") and self.goal_id is not None:
            raise ValueError("Income and expenses don't belong to a goal")
        return self

class FinanceTransactionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Optional[Money] = None
    category_id: Optional[int] = None
    occurred_at: Optional[datetime] = None
    note: optional_text(200) = None

class FinanceCategoryCreate(BaseModel):
    name: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=40)]
    type: Literal["income", "expense"]
    icon: Annotated[str, Field(min_length=1, max_length=8)] = "💰"

class FinanceBudgetUpsert(BaseModel):
    category_id: int
    period: Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
    limit_amount: Money

# ---- Thị trấn Mirabi (town.py)
class TownContribution(BaseModel):
    amount: int = Field(ge=10, le=500)
    client_ref: ClientRef

class TownGift(BaseModel):
    receiver_id: int
    item_id: Annotated[str, Field(min_length=1, max_length=40)]
    variant: Annotated[str, Field(min_length=1, max_length=24)] = "default"
    client_ref: ClientRef

# ---- Hành trình sự nghiệp (careers.py)
class CareerProfileSet(BaseModel):
    career_code: Annotated[str, Field(min_length=1, max_length=32)]
    current_goal: optional_text(200) = None

class SkillProgressUpdate(BaseModel):
    """Self-reported progress (0..100), or "practiced" once a practice activity is done."""
    progress_percent: Optional[int] = Field(default=None, ge=0, le=100)
    practiced: bool = False

class SkillAssessment(BaseModel):
    answers: list[int] = Field(min_length=1, max_length=10)

