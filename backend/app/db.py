from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import settings

database_url = settings.database_url
# Hosted Postgres (Neon, Render, ...) hands out postgres:// / postgresql:// URLs; use the installed psycopg 3 driver.
for prefix in ("postgres://", "postgresql://"):
    if database_url.startswith(prefix):
        database_url = "postgresql+psycopg://" + database_url[len(prefix):]
if database_url.startswith("sqlite"):
    engine = create_engine(database_url, connect_args={"check_same_thread": False}, future=True)
else:
    # Serverless Postgres closes idle connections; check them before use.
    engine = create_engine(database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
