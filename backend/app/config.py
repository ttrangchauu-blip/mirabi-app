from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-change-me"

class Settings(BaseSettings):
    # "development" | "test" | "production". Production enables strict checks below.
    environment: str = "development"
    jwt_secret: str = DEV_JWT_SECRET
    jwt_issuer: str = "refmi-api"
    jwt_audience: str = "refmi-mobile"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    password_reset_minutes: int = 30
    # How long the companion is out on its daily walk.
    pet_walk_minutes: int = 480
    # How often the API process grants rewards for walks that ended while nobody was looking. 0 disables the sweep
    # (rewards are then still granted the next time the user's pet space or dashboard is read).
    pet_reward_sweep_seconds: int = 60
    # XP is capped separately per source. Task cap is product-defined; study cap can be tuned locally.
    task_daily_exp_cap: int = 60
    study_daily_exp_cap: int = 48  # 2 EXP per 5 valid minutes -> 120 minutes/day
    # Study Together. Group focus minutes earn study EXP under study_daily_exp_cap; these caps cover the extras.
    group_daily_exp_cap: int = 10  # "learning together" bonus per completed group cycle
    team_quest_daily_exp_cap: int = 30
    # Learning games (docs/LEARNING_GAMES.md). A completed stage earns this once per subject per local day; it shares
    # task_daily_exp_cap with daily tasks.
    learning_stage_exp: int = 10
    # Play time between two requests counts at most this long (a killed app doesn't burn the session's time).
    learning_idle_cap_seconds: int = 60
    # An active session with no request for this long is paused on the next read (app closed without pausing).
    learning_auto_pause_seconds: int = 90
    # Open sessions untouched for this long are abandoned.
    learning_expire_hours: int = 24
    learning_max_duration_minutes: int = 90
    # How often the API advances group timers, expires presence and transfers hosts. 0 disables (tests);
    # timers are then still advanced whenever a room is read.
    study_room_tick_seconds: int = 2
    # No heartbeat for this long -> a member is shown as away.
    study_room_presence_seconds: int = 70
    # Focus credit continues this long after the last heartbeat (locked screen, brief network loss).
    study_room_away_grace_seconds: int = 600
    # Rooms where nobody has sent a heartbeat for this long are closed.
    study_room_idle_close_minutes: int = 120
    room_invitation_hours: int = 24
    study_room_message_retention_days: int = 30  # room chat messages are deleted after this
    friend_request_cooldown_hours: int = 24
    # Friend room visits: the same interaction (greeting, cheer, study invite) to the same friend once per cooldown,
    # and at most this many interactions a day in total. Greetings, cheers and study invites never award EXP.
    visit_interaction_cooldown_minutes: int = 10
    visit_interaction_daily_limit: int = 40
    # Unread greetings/cheers of one kind within this window are merged into one notification.
    visit_notification_group_hours: int = 12
    # Playing with a friend's pet on a visit (room_visits.play_with_pet): each friend gives a pet this much EXP once per
    # day, and a pet takes at most `friend_pet_exp_daily_cap` a day from all friends together. Days are the host's
    # account days. Its own cap: the 60 EXP/day of tasks and learning is unchanged.
    friend_pet_exp_per_friend: int = 2
    friend_pet_exp_daily_cap: int = 10
    # Caring for a friend's garden (garden.py): every plant is watered and tended at most once per owner day (by
    # anyone), and a visitor cares for at most this many plants a day across all friends' gardens. Never EXP or items.
    garden_care_daily_limit: int = 20
    # IANA zone whose calendar days define the login streak (one check-in per local day).
    login_streak_timezone: str = "Asia/Ho_Chi_Minh"
    database_url: str = "sqlite:///./refmi.db"
    # Comma-separated accounts that get the admin role (moderating user reports); synced on startup and login.
    admin_emails: str = ""
    cors_origins: str = "http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082,http://localhost:19006"
    # Redirect plain HTTP to HTTPS and send HSTS. Defaults to on in production.
    force_https: bool | None = None
    # Per-process sliding-window limits: "<requests>/<seconds>". Use a shared store (Redis/gateway) when scaling out.
    rate_limit_enabled: bool = True
    rate_limit_login: str = "10/300"  # per account
    rate_limit_login_ip: str = "50/300"  # per client IP (generous: classrooms often share one IP)
    rate_limit_register: str = "5/3600"
    rate_limit_password_reset: str = "5/900"
    rate_limit_refresh: str = "30/300"
    rate_limit_user_search: str = "30/60"
    rate_limit_friend_request: str = "20/3600"
    rate_limit_room_code: str = "10/300"  # per account; room codes have ~40 bits, this makes guessing hopeless
    rate_limit_room_code_ip: str = "60/300"
    rate_limit_room_create: str = "10/3600"
    rate_limit_room_invite: str = "30/3600"
    rate_limit_report: str = "10/86400"
    rate_limit_reaction: str = "20/60"
    rate_limit_room_message: str = "15/60"
    rate_limit_realtime_ticket: str = "30/60"
    rate_limit_visit_interaction: str = "20/600"  # burst limit on top of the per-friend cooldown and daily cap
    rate_limit_pet_play: str = "30/60"  # taps on a friend's pet that reach the backend (the app sends one per visit)
    rate_limit_garden_care: str = "30/60"  # burst limit on watering and tending friends' plants
    rate_limit_friend_lookup: str = "20/300"  # exact friend-code lookups (typed or scanned)
    # Password reset email delivery: "disabled" | "console" (development only) | "smtp".
    email_backend: str = "disabled"
    email_from: str = "Mirabi <no-reply@mirabi.app>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    # Optional link included in reset emails; the token is appended as ?token=...
    password_reset_url: str = ""
    # env_ignore_empty: blank values in .env (e.g. "FORCE_HTTPS=") fall back to the defaults above.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False, env_ignore_empty=True)

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def https_required(self) -> bool:
        return self.is_production if self.force_https is None else self.force_https

    @property
    def cors_origin_list(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]

    @property
    def admin_email_list(self) -> set[str]:
        return {x.strip().lower() for x in self.admin_emails.split(",") if x.strip()}

    @model_validator(mode="after")
    def check_production_safety(self):
        try:
            ZoneInfo(self.login_streak_timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("LOGIN_STREAK_TIMEZONE must be an IANA timezone such as Asia/Ho_Chi_Minh") from exc
        if self.email_backend not in {"disabled", "console", "smtp"}:
            raise ValueError("EMAIL_BACKEND must be one of: disabled, console, smtp")
        if self.is_production:
            if self.jwt_secret == DEV_JWT_SECRET or self.jwt_secret.startswith("replace-with") or len(self.jwt_secret) < 32:
                raise ValueError("JWT_SECRET must be a random value of at least 32 characters in production")
            if "*" in self.cors_origin_list:
                raise ValueError("CORS_ORIGINS must not contain '*' in production")
            if self.email_backend == "console":
                raise ValueError("EMAIL_BACKEND=console prints reset links to logs and is not allowed in production")
        return self

settings = Settings()
