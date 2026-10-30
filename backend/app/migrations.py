"""Additive, idempotent schema upgrades run at startup.

The project has no migration tool yet, and `create_all` only creates missing tables;
it never adds columns to tables that already exist. This module adds the columns
introduced after the first release so existing databases keep working. It never
drops or rewrites data. Switch to Alembic before moving to PostgreSQL in production.
"""
import json
import logging
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from .db import Base

log = logging.getLogger("refmi.migrations")

# table -> [(column, DDL fragment)]; keep DDL portable between SQLite and PostgreSQL.
ADDED_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "users": [
        ("status", "VARCHAR(20) NOT NULL DEFAULT 'active'"),
        ("role", "VARCHAR(20) NOT NULL DEFAULT 'user'"),
        ("token_version", "INTEGER NOT NULL DEFAULT 0"),
        ("updated_at", "TIMESTAMP"),
        ("pet", "VARCHAR(20) NOT NULL DEFAULT 'fox'"),
        ("pet_name", "VARCHAR(30)"),
        ("onboarded_at", "TIMESTAMP"),
        ("daily_task_ids", "TEXT"),
        ("daily_tasks_selected_at", "TIMESTAMP"),
        ("age", "INTEGER"),
        ("school_grade", "VARCHAR(20)"),
        ("study_subjects", "TEXT"),
    ],
    "user_tasks": [
        ("difficulty", "VARCHAR(12) NOT NULL DEFAULT 'medium'"),
        ("description", "TEXT"),
        ("start_time", "VARCHAR(5)"),
        ("end_time", "VARCHAR(5)"),
        ("all_day", "BOOLEAN NOT NULL DEFAULT 1"),
        ("repeat_interval", "INTEGER NOT NULL DEFAULT 1"),
        ("repeat_frequency", "VARCHAR(10)"),
        ("repeat_weekdays", "TEXT"),
        ("repeat_month_day", "INTEGER"),
        ("repeat_month_week", "INTEGER"),
        ("repeat_month_weekday", "INTEGER"),
        ("repeat_until", "DATE"),
        ("repeat_count", "INTEGER"),
    ],
    "pet_evolutions": [("hatched_at", "TIMESTAMP")],
    "pet_walks": [
        ("task_cycle_id", "VARCHAR(10)"),
        ("rewarded_at", "TIMESTAMP"),
        ("reward_exp", "INTEGER NOT NULL DEFAULT 0"),
        ("rewards", "TEXT"),
        ("location_id", "VARCHAR(20)"),
    ],
    "study_sessions": [("pomodoro_cycle", "VARCHAR(64)"), ("started_at", "TIMESTAMP"),
                       ("ended_at", "TIMESTAMP"), ("timezone", "VARCHAR(80)"), ("status", "VARCHAR(20)"),
                       ("study_type", "VARCHAR(20) NOT NULL DEFAULT 'self_study'")],
    "learning_sessions": [("game", "VARCHAR(20)"), ("catalog_lesson", "VARCHAR(40)"), ("catalog_grade", "INTEGER"),
                          ("content_version", "VARCHAR(20)")],
    "learning_tutorial_views": [("version", "INTEGER NOT NULL DEFAULT 1")],
    "learning_vocab_entries": [("difficulty", "INTEGER"), ("cefr", "VARCHAR(2)"), ("audio_ref", "VARCHAR(200)"),
                               ("content_version", "INTEGER NOT NULL DEFAULT 1"), ("review_notes", "TEXT")],
    "login_streak_days": [("popup_claim_key", "VARCHAR(64)")],
    "user_reports": [("message_id", "INTEGER"), ("message_body", "VARCHAR(500)")],
    "social_profiles": [("allow_room_visits", "BOOLEAN NOT NULL DEFAULT 1"),
                        ("allow_study_invites", "BOOLEAN NOT NULL DEFAULT 1")],
    "memories": [("notified_at", "TIMESTAMP"),
                 ("featured", "BOOLEAN NOT NULL DEFAULT 0"),
                 ("template_key", "VARCHAR(24) NOT NULL DEFAULT 'auto'"),
                 ("palette_key", "VARCHAR(24) NOT NULL DEFAULT 'sky'"),
                 ("include_message", "BOOLEAN NOT NULL DEFAULT 0")],
}

def upgrade_schema(engine: Engine) -> None:
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in ADDED_COLUMNS.items():
            if not inspector.has_table(table):
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns:
                if name not in existing:
                    log.info("Adding column %s.%s", table, name)
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        if inspector.has_table("pet_walks"):
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_pet_walk_user_cycle ON pet_walks (user_id, task_cycle_id)"))
        if inspector.has_table("pet_walks"):
            backfill_collected_walks(conn)
        if inspector.has_table("study_sessions"):
            conn.execute(text("UPDATE study_sessions SET study_type = 'together' "
                              "WHERE pomodoro_cycle LIKE 'room%' AND study_type <> 'together'"))
        if inspector.has_table("learning_sessions"):
            backfill_learning_games(conn)
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_learning_sessions_catalog_lesson ON learning_sessions (catalog_lesson)"))
        if inspector.has_table("learning_vocab_entries"):
            backfill_vocab_difficulty(conn)
        if inspector.has_table("study_sessions"):
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_study_user_pomodoro_cycle ON study_sessions (user_id, pomodoro_cycle)"))
        # Levels now represent pet evolution stages derived from cumulative XP.
        conn.execute(text("""
            UPDATE users SET level = CASE
                WHEN xp >= 5000 THEN 6
                WHEN xp >= 3500 THEN 5
                WHEN xp >= 2400 THEN 4
                WHEN xp >= 1500 THEN 3
                WHEN xp >= 800 THEN 2
                WHEN xp >= 300 THEN 1
                ELSE 0 END
        """))
        # Pets past Lv.0 before hatching was confirmed by the app have hatched; an egg waiting to hatch stays Lv.0.
        conn.execute(text("UPDATE pet_evolutions SET hatched_at = updated_at WHERE hatched_at IS NULL AND level >= 1"))
        conn.execute(text("""
            UPDATE users SET level = 0 WHERE level > 0 AND pet_name IS NOT NULL AND EXISTS (
                SELECT 1 FROM pet_evolutions pe WHERE pe.user_id = users.id AND pe.pet_id = users.pet
                AND pe.hatched_at IS NULL)
        """))


def backfill_collected_walks(conn) -> None:
    """Walks collected before automatic rewards existed: put their find in the inventory once, with no EXP."""
    legacy = conn.execute(text(
        "SELECT user_id, item_id, COUNT(*) FROM pet_walks WHERE collected_at IS NOT NULL AND rewarded_at IS NULL "
        "GROUP BY user_id, item_id")).all()
    for user_id, item_id, count in legacy:
        params = {"user_id": user_id, "item_id": item_id, "count": count}
        added = conn.execute(text("UPDATE user_inventory_items SET quantity = quantity + :count "
                                  "WHERE user_id = :user_id AND item_id = :item_id"), params)
        if added.rowcount == 0:
            conn.execute(text("INSERT INTO user_inventory_items (user_id, item_id, quantity, updated_at) "
                              "VALUES (:user_id, :item_id, :count, CURRENT_TIMESTAMP)"), params)
    if legacy:
        log.info("Moved %d legacy pet walk finds into inventories", sum(row[2] for row in legacy))
    conn.execute(text(
        """UPDATE pet_walks SET rewarded_at = collected_at, reward_exp = 0,
               rewards = '[{"item_id": "' || item_id || '", "quantity": 1}]'
           WHERE collected_at IS NOT NULL AND rewarded_at IS NULL"""))


def backfill_learning_games(conn) -> None:
    """Learning sessions created before the game was stored: derive it from the game type and the grammar variant."""
    from .learning_engine import game_of
    rows = conn.execute(text("SELECT id, game_type, scoring_json FROM learning_sessions WHERE game IS NULL")).all()
    for session_id, game_type, scoring in rows:
        try:
            variant = json.loads(scoring or "{}").get("variant")
        except ValueError:
            variant = None
        conn.execute(text("UPDATE learning_sessions SET game = :game WHERE id = :id"),
                     {"game": game_of(game_type, variant), "id": session_id})


def backfill_vocab_difficulty(conn) -> None:
    """Vocabulary rows imported before the internal difficulty: their editorial A1..C2 level becomes difficulty 1..6
    (no CEFR label is claimed). The next import of the data files rewrites them the same way."""
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_learning_vocab_entry_status_difficulty "
                      "ON learning_vocab_entries (status, difficulty)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_learning_vocab_entry_word ON learning_vocab_entries (word)"))
    conn.execute(text("""UPDATE learning_vocab_entries SET difficulty = CASE level
                             WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5
                             WHEN 'C2' THEN 6 ELSE 1 END
                         WHERE difficulty IS NULL"""))


# Study Together tables, children first. They are created by `upgrade_schema` (create_all) like every new table.
STUDY_TOGETHER_TABLES = (
    "friend_pet_exp_grants", "room_visit_interactions", "study_room_messages", "social_notifications", "team_quest_events", "team_quest_members", "team_quests", "study_room_participants",
    "study_room_sessions", "study_room_invitations", "study_room_members", "user_reports", "study_rooms",
    "user_blocks", "friendships", "social_profiles",
)


def downgrade_study_together_schema(engine: Engine) -> None:
    """Remove only the Study Together tables (irreversible data loss). Group minutes already written to
    study_sessions (pomodoro_cycle 'room<id>') and their EXP stay, like any other study history."""
    with engine.begin() as conn:
        for table in STUDY_TOGETHER_TABLES:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}"'))
