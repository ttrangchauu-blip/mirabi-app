"""Realtime updates for Study Together over one WebSocket per app.

1. The app asks `POST /api/realtime/ticket` (Bearer) for a single-use ticket valid for 60 seconds, then opens
   `/api/realtime/ws?ticket=...`. Browsers can't set headers on a WebSocket, and a ticket keeps the JWT out of URLs and
   access logs. The socket belongs to that user and receives their notifications.
2. `{"type": "subscribe", "room_id": n}` adds a study room after a membership check; the server answers with a
   `room.snapshot`. Later changes arrive as `room.updated` with the full snapshot and the room's `version`, so a client
   keeps only the newest and never applies an older or duplicate update. `ping` (every ~25 s) is the presence heartbeat.
   Room chat arrives as `room.message` / `room.message_deleted`; `{"type": "typing", "room_id": n}` is relayed to the
   other members as `room.typing` (see room_chat.py).

Events are queued on the database session and sent only after the transaction commits (`queue_room`/`queue_user`), so
nobody sees state that was rolled back. Connections live in this process: with several workers or instances, put a
pub/sub (e.g. Redis) behind `Hub.publish` and make tickets shared.
"""
import asyncio
import json
import logging
import secrets
import threading
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from sqlalchemy import event
from sqlalchemy.orm import Session

from .config import settings
from .models import User
from .ratelimit import enforce
from .security import current_user, hash_token

log = logging.getLogger("refmi.realtime")
router = APIRouter(prefix="/api/realtime", tags=["realtime"])

TICKET_SECONDS = 60
HEARTBEAT_SECONDS = 25
# "typing" from one socket is relayed at most this often per room; the app shows it for a few seconds.
TYPING_MIN_INTERVAL = 2.0
OUTBOX = "realtime_outbox"
# A client that falls this far behind is disconnected; it reconnects and resyncs from a fresh snapshot.
MAX_QUEUED_MESSAGES = 200
# WebSocket close codes (4000-4999 are application defined).
CLOSE_UNAUTHORIZED = 4401
CLOSE_TOO_SLOW = 4408


class TicketStore:
    """Single-use tickets; only their SHA-256 is kept."""

    def __init__(self):
        self._tickets: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def issue(self, user_id: int) -> str:
        raw = secrets.token_urlsafe(32)
        expires = time.monotonic() + TICKET_SECONDS
        with self._lock:
            now = time.monotonic()
            for key in [k for k, (_, exp) in self._tickets.items() if exp <= now]:
                del self._tickets[key]
            self._tickets[hash_token(raw)] = (user_id, expires)
        return raw

    def redeem(self, raw: str) -> int | None:
        if not raw or len(raw) > 128:
            return None
        with self._lock:
            entry = self._tickets.pop(hash_token(raw), None)
        if entry is None or entry[1] <= time.monotonic():
            return None
        return entry[0]


tickets = TicketStore()


@dataclass(eq=False)
class Connection:
    websocket: WebSocket
    user_id: int
    rooms: set[int] = field(default_factory=set)
    typed_at: dict[int, float] = field(default_factory=dict)  # room_id -> monotonic time of the last relayed "typing"
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=MAX_QUEUED_MESSAGES))
    closing: bool = False

    def send(self, message: dict) -> None:
        if self.closing:
            return
        try:
            self.queue.put_nowait(message)
        except asyncio.QueueFull:
            self.closing = True
            asyncio.get_running_loop().create_task(self._close(CLOSE_TOO_SLOW))

    async def _close(self, code: int) -> None:
        try:
            await self.websocket.close(code=code)
        except Exception:  # already closed
            pass

    async def pump(self) -> None:
        try:
            while True:
                message = await self.queue.get()
                await self.websocket.send_text(json.dumps(jsonable_encoder(message), ensure_ascii=False))
        except asyncio.CancelledError:
            raise
        except Exception:  # the socket went away; the receive loop cleans up
            return


class Hub:
    """Fan-out of committed events to connected sockets. Mutated only on the event loop thread."""

    def __init__(self):
        self.loop: asyncio.AbstractEventLoop | None = None
        self.by_user: dict[int, set[Connection]] = {}
        self.by_room: dict[int, set[Connection]] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def add(self, conn: Connection) -> None:
        self.by_user.setdefault(conn.user_id, set()).add(conn)

    def remove(self, conn: Connection) -> None:
        self.by_user.get(conn.user_id, set()).discard(conn)
        for room_id in list(conn.rooms):
            self.unsubscribe(conn, room_id)

    def subscribe(self, conn: Connection, room_id: int) -> None:
        conn.rooms.add(room_id)
        self.by_room.setdefault(room_id, set()).add(conn)

    def unsubscribe(self, conn: Connection, room_id: int) -> None:
        conn.rooms.discard(room_id)
        subscribers = self.by_room.get(room_id)
        if subscribers is not None:
            subscribers.discard(conn)
            if not subscribers:
                del self.by_room[room_id]

    def user_watches_room(self, user_id: int, room_id: int) -> bool:
        return any(room_id in conn.rooms for conn in self.by_user.get(user_id, ()))

    def publish(self, kind: str, target: int, message: dict, revoke: tuple[int, ...] = (), close: bool = False,
                skip: frozenset[int] = frozenset()) -> None:
        """Thread-safe. `revoke` drops those users' room subscriptions first (they left); `close` drops everyone after.
        `skip` users don't receive this room message (e.g. chat between people who blocked each other)."""
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._deliver, kind, target, message, revoke, close, skip)
        except RuntimeError:  # loop shut down between the check and the call
            pass

    def _deliver(self, kind: str, target: int, message: dict, revoke: tuple[int, ...], close: bool,
                 skip: frozenset[int] = frozenset()) -> None:
        if kind == "user":
            for conn in list(self.by_user.get(target, ())):
                conn.send(message)
            return
        for conn in list(self.by_room.get(target, ())):
            if conn.user_id in revoke:
                self.unsubscribe(conn, target)
                conn.send({"type": "room.removed", "room_id": target, "version": message.get("version")})
        for conn in list(self.by_room.get(target, ())):
            if conn.user_id not in skip:
                conn.send(message)
        if close:
            for conn in list(self.by_room.get(target, ())):
                self.unsubscribe(conn, target)


hub = Hub()


def queue_room(db: Session, room_id: int, message: dict, revoke: tuple[int, ...] = (), close: bool = False,
               skip: frozenset[int] = frozenset()) -> None:
    db.info.setdefault(OUTBOX, []).append(("room", room_id, message, tuple(revoke), close, frozenset(skip)))


def queue_user(db: Session, user_id: int, message: dict) -> None:
    db.info.setdefault(OUTBOX, []).append(("user", user_id, message, (), False, frozenset()))


@event.listens_for(Session, "after_commit")
def _send_outbox(session: Session) -> None:
    for kind, target, message, revoke, close, skip in session.info.pop(OUTBOX, None) or ():
        hub.publish(kind, target, message, revoke, close, skip)


@event.listens_for(Session, "after_rollback")
def _drop_outbox(session: Session) -> None:
    session.info.pop(OUTBOX, None)


@router.post("/ticket")
def create_ticket(user: User = Depends(current_user)):
    enforce("realtime-ticket", settings.rate_limit_realtime_ticket, str(user.id))
    return {"ticket": tickets.issue(user.id), "expires_in": TICKET_SECONDS, "path": "/api/realtime/ws",
            "heartbeat_seconds": HEARTBEAT_SECONDS}


def _room_id(message: dict) -> int | None:
    value = message.get("room_id")
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


@router.websocket("/ws")
async def realtime_socket(websocket: WebSocket, ticket: str = ""):
    from . import room_chat, study_rooms  # imported here: both queue events through this module

    user_id = tickets.redeem(ticket)
    if user_id is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return
    await websocket.accept()
    hub.bind_loop(asyncio.get_running_loop())
    conn = Connection(websocket, user_id)
    hub.add(conn)
    pump = asyncio.create_task(conn.pump())
    conn.send({"type": "hello", "user_id": user_id, "heartbeat_seconds": HEARTBEAT_SECONDS})
    try:
        while True:
            try:
                message = json.loads(await websocket.receive_text())
            except (ValueError, TypeError):
                conn.send({"type": "error", "code": "invalid_message"})
                continue
            if not isinstance(message, dict):
                conn.send({"type": "error", "code": "invalid_message"})
                continue
            kind = message.get("type")
            if kind == "ping":
                await asyncio.to_thread(study_rooms.heartbeat_user, user_id, tuple(conn.rooms))
                conn.send({"type": "pong"})
            elif kind == "subscribe" and (room_id := _room_id(message)) is not None:
                if not await asyncio.to_thread(study_rooms.realtime_join, user_id, room_id):
                    conn.send({"type": "error", "code": "room_not_found", "room_id": room_id})
                    continue
                hub.subscribe(conn, room_id)
                snapshot = await asyncio.to_thread(study_rooms.load_snapshot, room_id)
                if snapshot is not None:
                    conn.send({"type": "room.snapshot", "room_id": room_id, "version": snapshot["version"], "room": snapshot})
            elif kind == "typing" and (room_id := _room_id(message)) is not None:
                # Relayed, never stored. Only for rooms this socket subscribed to (membership was checked then).
                now = time.monotonic()
                if room_id in conn.rooms and now - conn.typed_at.get(room_id, 0.0) >= TYPING_MIN_INTERVAL:
                    conn.typed_at[room_id] = now
                    skip = await asyncio.to_thread(room_chat.hidden_from, user_id)
                    hub.publish("room", room_id, {"type": "room.typing", "room_id": room_id, "user_id": user_id},
                                skip=skip | {user_id})
            elif kind == "unsubscribe" and (room_id := _room_id(message)) is not None:
                hub.unsubscribe(conn, room_id)
                if not hub.user_watches_room(user_id, room_id):
                    await asyncio.to_thread(study_rooms.realtime_leave, user_id, room_id)
            else:
                conn.send({"type": "error", "code": "invalid_message"})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("Realtime connection failed for user %s", user_id)
    finally:
        rooms = tuple(conn.rooms)
        hub.remove(conn)
        pump.cancel()
        for room_id in rooms:
            if not hub.user_watches_room(user_id, room_id):
                try:
                    await asyncio.to_thread(study_rooms.realtime_leave, user_id, room_id)
                except Exception:
                    log.exception("Could not mark user %s away in room %s", user_id, room_id)
