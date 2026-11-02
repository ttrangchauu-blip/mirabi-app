import re

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable
from app.db import Base
from app.migrations import ADDED_COLUMNS, STUDY_TOGETHER_TABLES, downgrade_study_together_schema, upgrade_schema


def test_study_together_tables_upgrade_idempotently_and_roll_back_alone(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'together.db'}")
    upgrade_schema(engine)
    upgrade_schema(engine)
    inspector = inspect(engine)
    assert all(inspector.has_table(table) for table in STUDY_TOGETHER_TABLES)
    member_indexes = {i["name"]: i for i in inspector.get_indexes("study_room_members")}
    assert member_indexes["uq_study_room_one_active_room"]["unique"]
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO study_sessions (user_id, mode, duration_seconds, completed, pomodoro_cycle, created_at) "
                          "VALUES (1, 'pomodoro', 1500, 1, 'room1', CURRENT_TIMESTAMP)"))
    downgrade_study_together_schema(engine)
    inspector = inspect(engine)
    assert not any(inspector.has_table(table) for table in STUDY_TOGETHER_TABLES)
    assert inspector.has_table("users") and inspector.has_table("exp_events")
    with engine.connect() as conn:  # group minutes already recorded stay in the study history
        assert conn.execute(text("SELECT pomodoro_cycle FROM study_sessions")).scalar_one() == "room1"
    upgrade_schema(engine)  # and back up again
    assert inspect(engine).has_table("study_rooms")

def test_upgrade_records_the_study_type_and_game_of_older_sessions(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'learning.db'}")
    upgrade_schema(engine)
    with engine.begin() as conn:  # rows written before the columns existed
        conn.execute(text("INSERT INTO study_sessions (user_id, mode, study_type, duration_seconds, completed, pomodoro_cycle, created_at) "
                          "VALUES (1, 'pomodoro', 'self_study', 1500, 1, 'room7', CURRENT_TIMESTAMP), "
                          "(1, 'pomodoro', 'self_study', 1500, 1, 'cycle0000001', CURRENT_TIMESTAMP)"))
        conn.execute(text("""INSERT INTO learning_sessions (user_id, subject_id, topic_id, level_id, lesson_id, lesson_version_id, kind,
            mode, game_type, game, status, seed, scoring_json, timezone, duration_seconds, required_count, started_at, updated_at, created_at)
            VALUES (1, 1, 1, 1, 1, 1, 'lesson', 'practice', 'grammar', NULL, 'completed', 1, '{"variant": "bridge"}', 'UTC', 600, 12,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                   (1, 1, 1, 1, 1, 1, 'lesson', 'practice', 'meteor', NULL, 'completed', 1, '{}', 'UTC', 600, 12,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"""))
    upgrade_schema(engine)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT pomodoro_cycle, study_type FROM study_sessions ORDER BY id")).all() == [
            ("room7", "together"), ("cycle0000001", "self_study")]
        assert conn.execute(text("SELECT game FROM learning_sessions ORDER BY id")).scalars().all() == ["bridge", "meteor"]


def test_upgrade_adds_columns_without_losing_data(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:  # users table as created by the first release
        conn.execute(text("""CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255) UNIQUE, password_hash VARCHAR(255),
            display_name VARCHAR(80), level INTEGER, xp INTEGER, coins INTEGER, gems INTEGER, avatar_theme VARCHAR(40),
            equipped_item VARCHAR(80), created_at DATETIME)"""))
        conn.execute(text("INSERT INTO users (email, password_hash, display_name) VALUES ('old@example.com', 'h', 'Old')"))
        conn.execute(text("""CREATE TABLE pet_walks (id INTEGER PRIMARY KEY, user_id INTEGER, item_id VARCHAR(30),
            started_at DATETIME, returns_at DATETIME, collected_at DATETIME)"""))
        conn.execute(text("INSERT INTO pet_walks (user_id, item_id) VALUES (1, 'shell')"))
        conn.execute(text("CREATE TABLE study_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, mode VARCHAR(30), duration_seconds INTEGER, completed BOOLEAN, created_at DATETIME)"))
        conn.execute(text("INSERT INTO study_sessions (user_id, mode, duration_seconds, completed) VALUES (1, 'focus', 300, 1)"))

    upgrade_schema(engine)
    upgrade_schema(engine)  # idempotent

    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("users")}
    assert {"status", "token_version", "updated_at", "pet", "pet_name", "onboarded_at"} <= columns
    assert inspector.has_table("refresh_tokens") and inspector.has_table("password_reset_tokens")
    assert "role" in columns
    walk_columns = {c["name"] for c in inspector.get_columns("pet_walks")}
    assert "task_cycle_id" in walk_columns
    assert "uq_pet_walk_user_cycle" in {i["name"] for i in inspector.get_indexes("pet_walks")}
    assert {"pomodoro_cycle", "started_at", "ended_at", "timezone", "status"} <= {c["name"] for c in inspector.get_columns("study_sessions")}
    assert inspector.has_table("pomodoro_settings")
    assert "uq_study_user_pomodoro_cycle" in {i["name"] for i in inspector.get_indexes("study_sessions")}
    with engine.connect() as conn:
        row = conn.execute(text("SELECT email, status, token_version, pet, pet_name, onboarded_at FROM users")).one()
    assert tuple(row) == ("old@example.com", "active", 0, "fox", None, None)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT item_id, task_cycle_id FROM pet_walks")).one() == ("shell", None)
        assert conn.execute(text("SELECT mode, duration_seconds, pomodoro_cycle FROM study_sessions")).one() == ("focus", 300, None)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT study_type FROM study_sessions")).scalar_one() == "self_study"


def test_mirabi_life_upgrade_keeps_old_tasks_and_rolls_back_alone(tmp_path):
    from app.migrations import MIRABI_LIFE_TABLES, downgrade_mirabi_life_schema
    engine = create_engine(f"sqlite:///{tmp_path / 'life.db'}")
    with engine.begin() as conn:  # user_tasks as it was before Work Quest, with a task and its completion
        conn.execute(text("""CREATE TABLE user_tasks (id INTEGER PRIMARY KEY, user_id INTEGER, title VARCHAR(120),
            category VARCHAR(20), scheduled_date DATE, repeat VARCHAR(10), created_at DATETIME)"""))
        conn.execute(text("INSERT INTO user_tasks (id, user_id, title, category, scheduled_date, repeat, created_at) "
                          "VALUES (1, 1, 'Đọc sách', 'study', '2030-01-01', 'none', CURRENT_TIMESTAMP)"))
    upgrade_schema(engine)
    upgrade_schema(engine)  # idempotent
    inspector = inspect(engine)
    assert all(inspector.has_table(t) for t in (*MIRABI_LIFE_TABLES, "work_projects"))
    columns = {c["name"] for c in inspector.get_columns("user_tasks")}
    assert {"project_id", "priority", "due_at", "estimated_minutes", "archived_at", "updated_at"} <= columns
    with engine.connect() as conn:
        assert conn.execute(text("SELECT title, priority, project_id, archived_at FROM user_tasks")).one() == (
            "Đọc sách", "medium", None, None)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO work_projects (id, user_id, name, theme, status, created_at, updated_at) "
                          "VALUES (1, 1, 'P', 'meadow', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
        conn.execute(text("UPDATE user_tasks SET project_id = 1"))
    downgrade_mirabi_life_schema(engine)
    inspector = inspect(engine)
    assert not any(inspector.has_table(t) for t in (*MIRABI_LIFE_TABLES, "work_projects"))
    with engine.connect() as conn:  # the task itself survives the rollback
        assert conn.execute(text("SELECT title, project_id FROM user_tasks")).one() == ("Đọc sách", None)
    upgrade_schema(engine)
    assert inspect(engine).has_table("work_projects")


def test_every_boolean_default_is_one_postgresql_accepts():
    # The tests run on SQLite, which takes DEFAULT 0 on a boolean. PostgreSQL refuses it and the service does not start.
    from app import models  # noqa: F401  every table must be registered
    bare = re.compile(r"BOOLEAN\b[^,\n]*\bDEFAULT [01]\b")
    for table in Base.metadata.sorted_tables:
        assert not bare.search(str(CreateTable(table).compile(dialect=postgresql.dialect()))), table.name
    for table, columns in ADDED_COLUMNS.items():
        for name, ddl in columns:
            assert not bare.search(ddl), f"{table}.{name}"
