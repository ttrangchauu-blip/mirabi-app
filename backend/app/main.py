import asyncio
import logging
import secrets
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from sqlalchemy import select

from . import auth, campus, career, community, companion, dashboard, profile, study, tasks, streaks
from . import friends, notifications, realtime, room_chat, study_rooms, study_together, team_quests
from . import garden, inventory, learning, learning_history, lesson_api, memories, pet_room, room_visits
from .learning_content import seed_learning_content
from .config import settings
from .db import SessionLocal, engine
from .errors import install_error_handlers
from .migrations import upgrade_schema
from .models import CommunityPost, User
from .security import hash_password


def startup():
    upgrade_schema(engine)
    with SessionLocal() as db:
        allowed_admins = settings.admin_email_list
        if allowed_admins:
            for existing_admin in db.scalars(select(User).where(User.role == "admin", ~User.email.in_(allowed_admins))):
                existing_admin.role = "user"
            for configured_admin in db.scalars(select(User).where(User.email.in_(allowed_admins))):
                configured_admin.role = "admin"
        else:
            for existing_admin in db.scalars(select(User).where(User.role == "admin")):
                existing_admin.role = "user"
        # Built-in English/Math lessons; publishes a new version only when a lesson's content changed.
        seed_learning_content(db)
        # The walk finds' catalog, next to the inventories that refer to it.
        inventory.seed_catalog(db)
        if not db.scalar(select(CommunityPost.id).limit(1)):
            # The demo post author has a random password and cannot sign in.
            demo = User(
                email="community@refmi.demo",
                password_hash=hash_password(secrets.token_urlsafe(32)),
                display_name="MaiStudy",
            )
            db.add(demo)
            db.flush()
            db.add(CommunityPost(
                user_id=demo.id,
                body="Hôm nay mình hoàn thành 3 phiên Pomodoro rồi nè! Cùng cố gắng mỗi ngày nhé ✨",
                likes=128,
            ))
        db.commit()


log = logging.getLogger("refmi.main")


async def sweep_pet_rewards(interval: int):
    """Grant pet walk rewards on time even when nobody has the app open. Safe with several workers."""
    while True:
        await asyncio.sleep(interval)
        try:
            await asyncio.to_thread(companion.sweep_returned_walks)
        except Exception:
            log.exception("Pet reward sweep failed")


async def tick_study_rooms(interval: int):
    """Advance group timers and presence even when no client asks (phase changes are pushed to members)."""
    while True:
        await asyncio.sleep(interval)
        try:
            await asyncio.to_thread(study_rooms.sweep)
        except Exception:
            log.exception("Study room sweep failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    startup()
    realtime.hub.bind_loop(asyncio.get_running_loop())
    interval = settings.pet_reward_sweep_seconds
    tasks_running = []
    if interval > 0:
        tasks_running.append(asyncio.create_task(sweep_pet_rewards(interval)))
    if settings.study_room_tick_seconds > 0:
        tasks_running.append(asyncio.create_task(tick_study_rooms(settings.study_room_tick_seconds)))
    yield
    for task in tasks_running:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="Mirabi API", version="0.2.0", description="Mobile app starter API",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
)
install_error_handlers(app)

# Native apps do not send Origin headers; CORS is for the Expo web build.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)
if settings.https_required:
    # Behind a TLS-terminating proxy, run uvicorn with --proxy-headers.
    app.add_middleware(HTTPSRedirectMiddleware)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.url.path.startswith(("/api/auth", "/api/realtime")):
        response.headers["Cache-Control"] = "no-store"
    if settings.https_required:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


for feature_router in (
    auth.router,
    streaks.router,
    dashboard.router,
    study.router,
    campus.router,
    career.router,
    community.router,
    profile.router,
    companion.router,
    companion.legacy_room_router,
    tasks.router,
    friends.router,
    study_together.router,
    team_quests.router,
    study_rooms.router,
    study_rooms.invitations_router,
    study_rooms.sessions_router,
    room_chat.router,
    notifications.router,
    realtime.router,
    pet_room.router,
    pet_room.focus_router,
    room_visits.router,
    inventory.router,
    garden.router,
    learning.router,
    learning_history.router,
    lesson_api.router,
):
    app.include_router(feature_router)

# FastAPI 0.162 keeps included routers as lazy route groups. In the current
# Uvicorn/Starlette combination the final lazy group is not reached, although
# TestClient expands it. Register the album's and the word history's and the lessons' already-built
# APIRoutes eagerly so production requests and OpenAPI expose the same endpoints as tests.
app.router.routes.extend(memories.router.routes)
app.router.routes.extend(learning_history.router.routes)
app.router.routes.extend(lesson_api.router.routes)


@app.get("/", tags=["health"])
def root():
    return {"name": "Mirabi API", "status": "ok", "docs": "/docs"}


@app.get("/health", tags=["health"])
def health():
    return {"status": "healthy"}
