"""In-game coins (xu, `users.coins`): never real money, never below zero, and every change written to coin_events.

`spend` and `earn` run inside the caller's transaction, which holds the user's lock (progression.lock_user) so the
balance written with each event is the real one. An `event_key` is recorded once per user: the same purchase, harvest or
contribution sent again changes nothing (None), and a spend the balance can't cover changes nothing either (False) — the
caller then rolls back, so nothing it did alongside the payment (seeds granted, say) stays.
"""
from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import CoinEvent, User, utcnow


def balance(db: Session, user_id: int) -> int:
    return db.scalar(select(User.coins).where(User.id == user_id)) or 0


def recorded(db: Session, user_id: int, event_key: str) -> CoinEvent | None:
    return db.scalar(select(CoinEvent).where(CoinEvent.user_id == user_id, CoinEvent.event_key == event_key))


def _change(db: Session, user_id: int, delta: int, *, kind: str, ref: str | None, event_key: str) -> bool | None:
    try:
        with db.begin_nested():
            event = CoinEvent(user_id=user_id, delta=delta, balance_after=0, kind=kind, ref=(ref or "")[:60] or None,
                              event_key=event_key, created_at=utcnow())
            db.add(event)
            db.flush()
    except IntegrityError:
        return None
    query = update(User).where(User.id == user_id)
    if delta < 0:
        query = query.where(User.coins >= -delta)  # in SQL: never below zero, whatever was read before
    if db.execute(query.values(coins=User.coins + delta).execution_options(synchronize_session=False)).rowcount != 1:
        return False
    event.balance_after = balance(db, user_id)
    return True


def spend(db: Session, user_id: int, amount: int, *, kind: str, ref: str | None, event_key: str) -> bool | None:
    """Take `amount` (> 0). False when the balance is short: roll back. None when `event_key` was paid already."""
    if amount <= 0:
        raise ValueError("a spend takes a positive amount")
    return _change(db, user_id, -amount, kind=kind, ref=ref, event_key=event_key)


def earn(db: Session, user_id: int, amount: int, *, kind: str, ref: str | None, event_key: str) -> bool | None:
    """Add `amount` (>= 0). None when `event_key` was paid already."""
    if amount < 0:
        raise ValueError("an earning is never negative")
    return _change(db, user_id, amount, kind=kind, ref=ref, event_key=event_key)
