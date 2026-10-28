import os
import tempfile

# Configure before the app (and its settings singleton / engine) is imported.
_tmp = tempfile.mkdtemp(prefix="refmi-test-")
os.environ.update({
    "ENVIRONMENT": "test",
    "DATABASE_URL": f"sqlite:///{os.path.join(_tmp, 'test.db')}",
    "JWT_SECRET": "test-secret-0123456789abcdef0123456789abcdef",
    "RATE_LIMIT_ENABLED": "false",
    # Tests grant pet walk rewards explicitly instead of racing a background sweep.
    "PET_REWARD_SWEEP_SECONDS": "0",
    # Study Together tests drive the room clock and sweeps explicitly.
    "STUDY_ROOM_TICK_SECONDS": "0",
    "EMAIL_BACKEND": "disabled",
    # Never reach a real AI engine or provider from a local .env; tests opt in with the `ai_engine` fixture.
    "BACKEND_AI_SERVICE_TOKEN": "",
    "AI_SERVICE_URL": "http://ai-engine.test",
    "OPENAI_API_KEY": "",
})

import pytest
from fastapi.testclient import TestClient
from app.db import Base, engine
from app.main import app
from app.ratelimit import limiter

PASSWORD = "Sparkle123"

# The content banks (~20 000 rows) are imported once and kept between tests; a test that changed them gets a fresh copy
# of the pristine content back before the next test. Every other table is dropped and recreated as before.
CONTENT_TABLES = ("learning_vocab_entries", "learning_grammar_items", "learning_content_releases", "learning_content_imports")
_pristine: dict = {}


def _content_fingerprint():
    from sqlalchemy import text
    with engine.connect() as conn:
        return tuple(tuple(conn.execute(text(
            f"SELECT count(*), coalesce(sum(content_version), 0), coalesce(sum(length(status) * id), 0), max(updated_at) FROM {t}")).one())
            for t in ("learning_vocab_entries", "learning_grammar_items")) + tuple(
            conn.execute(text(f"SELECT count(*), max(id) FROM {t}")).one() for t in ("learning_content_releases", "learning_content_imports"))


def _copy_content(to_pristine: bool):
    path = os.path.join(_tmp, "pristine-content.db")
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("ATTACH DATABASE ? AS pristine", (path,))
        for table in CONTENT_TABLES:
            if to_pristine:
                cur.execute(f"DROP TABLE IF EXISTS pristine.{table}")
                cur.execute(f"CREATE TABLE pristine.{table} AS SELECT * FROM main.{table}")
            else:
                cur.execute(f"DELETE FROM main.{table}")
                cur.execute(f"INSERT INTO main.{table} SELECT * FROM pristine.{table}")
        raw.commit()
        cur.execute("DETACH DATABASE pristine")
    finally:
        raw.close()


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine, tables=[t for t in Base.metadata.sorted_tables if t.name not in CONTENT_TABLES])
    if _pristine and _content_fingerprint() != _pristine["fingerprint"]:
        _copy_content(to_pristine=False)
    limiter.reset()
    with TestClient(app) as c:  # runs startup: schema upgrade + seed (the content import is skipped when unchanged)
        if not _pristine:
            _copy_content(to_pristine=True)
            _pristine["fingerprint"] = _content_fingerprint()
        yield c

@pytest.fixture()
def ai_engine(monkeypatch):
    """Route backend -> AI engine calls to the in-process engine app (providers are still patched per test)."""
    import httpx
    from ai_engine.app import app as engine_app
    from app.config import settings

    monkeypatch.setattr(settings, "backend_ai_service_token", "integration-test-token")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "integration-test-token")
    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.ai_client.httpx.AsyncClient", lambda **kwargs: original_client(
        transport=httpx.ASGITransport(app=engine_app), **kwargs))
    return engine_app

@pytest.fixture()
def clock(monkeypatch):
    """Study Together's clock, frozen at a real "now" and moved forward by the test (`clock.advance(minutes=25)`)."""
    from datetime import datetime, timedelta, timezone
    from app import clock as clock_module

    class FakeClock:
        def __init__(self):
            self.t = datetime.now(timezone.utc).replace(microsecond=0)

        def now(self):
            return self.t

        def advance(self, **delta):
            self.t += timedelta(**delta)
            return self.t

    fake = FakeClock()
    monkeypatch.setattr(clock_module, "now", fake.now)
    return fake

@pytest.fixture()
def db():
    from app.db import SessionLocal
    with SessionLocal() as session:
        yield session

def register(client, email="aqua@example.com", password=PASSWORD, **extra):
    return client.post("/api/auth/register", json={"email": email, "password": password, **extra})

def signup(client, email="aqua@example.com", password=PASSWORD):
    """Register, then sign in (registration itself doesn't start a session)."""
    assert register(client, email=email, password=password).status_code == 201
    return login(client, email=email, password=password)

def login(client, email="aqua@example.com", password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})

def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
