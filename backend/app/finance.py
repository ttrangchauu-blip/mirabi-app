"""Vườn tài chính (Money Garden): savings goals as trees, manual income/expense tracking, monthly budgets.

- Money is whole VND in BIGINT columns (no float anywhere); every amount is a positive integer up to 100 billion and
  the transaction type gives its direction.
- A goal's tree grows only from what the user records: deposits minus withdrawals. Nothing else (tasks, coins,
  rewards) moves it, and no bank is connected. In-game coins are not money.
- Withdrawals, edits and deletions that would take a goal below zero are refused. They are decided under a per-user
  lock (the one inventory and the walk use), so two requests at once can't both spend the same balance.
- `client_ref` makes a retried save count once.
- Only the owner ever reads any of it: no friend, town or public endpoint shows money, and amounts are never logged.
- No advice: the summary only adds up what was recorded.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .companion import lock_daily_goals
from .db import get_db
from .errors import APIError
from .life_access import life_user
from .models import FinanceBudget, FinanceCategory, FinanceGoal, FinanceTransaction, User, as_utc, utcnow
from .schemas import (FinanceBudgetUpsert, FinanceCategoryCreate, FinanceGoalCreate, FinanceGoalUpdate,
                      FinanceTransactionCreate, FinanceTransactionUpdate)

router = APIRouter(prefix="/api/finance", tags=["finance"])

MAX_ACTIVE_GOALS = 20
# The tree's stages: Hạt giống (nothing saved yet), Mầm cây (a first deposit), then by share of the target.
STAGE_NAMES = ["Hạt giống", "Mầm cây", "Cây non", "Cây phát triển", "Cây trưởng thành", "Cây nở hoa"]
STAGE_PERCENTS = (25, 50, 75, 100)
BUILT_IN = [
    ("food", "Ăn uống", "expense", "🍜"), ("transport", "Đi lại", "expense", "🛵"), ("shopping", "Mua sắm", "expense", "🛍️"),
    ("bills", "Hóa đơn", "expense", "🧾"), ("health", "Sức khỏe", "expense", "💊"), ("education", "Học tập", "expense", "📚"),
    ("fun", "Giải trí", "expense", "🎬"), ("family", "Gia đình", "expense", "👪"), ("other_out", "Chi khác", "expense", "📦"),
    ("salary", "Lương", "income", "💼"), ("bonus", "Thưởng", "income", "🎁"), ("side", "Thu nhập thêm", "income", "💡"),
    ("other_in", "Thu khác", "income", "💰"),
]


def seed_categories(db: Session) -> None:
    """Built-in categories, once each (by code); safe at every start."""
    existing = set(db.scalars(select(FinanceCategory.code).where(FinanceCategory.code.is_not(None))))
    for code, name, kind, icon in BUILT_IN:
        if code not in existing:
            db.add(FinanceCategory(user_id=None, code=code, name=name, type=kind, icon=icon))


def stage_for(saved: int, target: int) -> int:
    if saved <= 0:
        return 0
    percent = saved * 100 // target
    return 1 + sum(1 for p in STAGE_PERCENTS if percent >= p)


def goal_balance(db: Session, goal_id: int) -> int:
    rows = db.execute(select(FinanceTransaction.transaction_type, func.coalesce(func.sum(FinanceTransaction.amount), 0))
                      .where(FinanceTransaction.goal_id == goal_id, FinanceTransaction.deleted_at.is_(None))
                      .group_by(FinanceTransaction.transaction_type)).all()
    sums = {kind: int(total) for kind, total in rows}
    return sums.get("deposit", 0) - sums.get("withdraw", 0)


def estimate(db: Session, goal: FinanceGoal, saved: int) -> str | None:
    """When the target would be reached at the pace of the last 90 days' net deposits (None without a pace)."""
    if saved >= goal.target_amount:
        return None
    since = utcnow() - timedelta(days=90)
    rows = db.execute(select(FinanceTransaction.transaction_type, func.coalesce(func.sum(FinanceTransaction.amount), 0))
                      .where(FinanceTransaction.goal_id == goal.id, FinanceTransaction.deleted_at.is_(None),
                             FinanceTransaction.occurred_at >= since)
                      .group_by(FinanceTransaction.transaction_type)).all()
    sums = {kind: int(total) for kind, total in rows}
    per_day = (sums.get("deposit", 0) - sums.get("withdraw", 0)) / 90
    days = (goal.target_amount - saved) / per_day if per_day > 0 else None
    # No pace, or more than 50 years away at this pace: no date to promise.
    if days is None or days > 50 * 365:
        return None
    return (utcnow().date() + timedelta(days=int(days) + 1)).isoformat()


def goal_view(db: Session, goal: FinanceGoal) -> dict:
    saved = goal_balance(db, goal.id)
    stage = stage_for(saved, goal.target_amount)
    percent = min(100, saved * 100 // goal.target_amount) if saved > 0 else 0
    return {"id": goal.id, "name": goal.name, "target_amount": goal.target_amount, "currency": goal.currency,
            "target_date": goal.target_date.isoformat() if goal.target_date else None, "plant": goal.plant,
            "status": goal.status, "saved_amount": saved, "percent": percent, "stage": stage, "stage_name": STAGE_NAMES[stage],
            "milestones": [{"percent": p, "reached": percent >= p} for p in STAGE_PERCENTS],
            "estimated_date": estimate(db, goal, saved), "created_at": as_utc(goal.created_at).isoformat()}


def own_goal(db: Session, user: User, goal_id: int) -> FinanceGoal:
    goal = db.scalar(select(FinanceGoal).where(FinanceGoal.id == goal_id, FinanceGoal.user_id == user.id))
    if goal is None:
        raise APIError(404, "goal_not_found", "Goal not found")
    return goal


def usable_category(db: Session, user: User, category_id: int | None, kind: str | None) -> FinanceCategory | None:
    if category_id is None:
        return None
    category = db.scalar(select(FinanceCategory).where(FinanceCategory.id == category_id, FinanceCategory.archived_at.is_(None),
                                                       or_(FinanceCategory.user_id.is_(None), FinanceCategory.user_id == user.id)))
    if category is None:
        raise APIError(404, "category_not_found", "Category not found")
    if kind and category.type != kind:
        raise APIError(422, "category_type_mismatch", f"This is an {category.type} category")
    return category


def tx_view(row: FinanceTransaction, categories: dict[int, FinanceCategory] | None = None) -> dict:
    category = (categories or {}).get(row.category_id) if row.category_id else None
    return {"id": row.id, "transaction_type": row.transaction_type, "amount": row.amount, "goal_id": row.goal_id,
            "category_id": row.category_id, "category": {"name": category.name, "icon": category.icon} if category else None,
            "occurred_at": as_utc(row.occurred_at).isoformat(), "note": row.note}


def categories_of(db: Session, user: User) -> list[FinanceCategory]:
    return list(db.scalars(select(FinanceCategory).where(FinanceCategory.archived_at.is_(None),
                                                         or_(FinanceCategory.user_id.is_(None), FinanceCategory.user_id == user.id))
                           .order_by(FinanceCategory.user_id.is_not(None), FinanceCategory.id)))


# ---------------------------------------------------------------------------- goals
@router.get("/goals")
def list_goals(include_archived: bool = False, user: User = Depends(life_user), db: Session = Depends(get_db)):
    query = select(FinanceGoal).where(FinanceGoal.user_id == user.id)
    if not include_archived:
        query = query.where(FinanceGoal.status == "active")
    return [goal_view(db, g) for g in db.scalars(query.order_by(FinanceGoal.id))]


@router.post("/goals", status_code=201)
def create_goal(data: FinanceGoalCreate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    active = db.scalar(select(func.count()).select_from(FinanceGoal).where(FinanceGoal.user_id == user.id,
                                                                           FinanceGoal.status == "active")) or 0
    if active >= MAX_ACTIVE_GOALS:
        raise APIError(409, "too_many_goals", f"At most {MAX_ACTIVE_GOALS} active goals")
    goal = FinanceGoal(user_id=user.id, name=data.name, target_amount=data.target_amount, target_date=data.target_date,
                       plant=data.plant)
    db.add(goal)
    db.commit()
    return goal_view(db, goal)


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: int, data: FinanceGoalUpdate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    goal = own_goal(db, user, goal_id)
    fields = data.model_fields_set
    for name in ("name", "target_amount", "plant", "status"):
        if name in fields and getattr(data, name) is None:
            raise APIError(422, "field_required", f"{name} cannot be empty")
    for name in ("name", "target_amount", "target_date", "plant", "status"):
        if name in fields:
            setattr(goal, name, getattr(data, name))
    goal.updated_at = utcnow()
    db.commit()
    return goal_view(db, goal)


# ---------------------------------------------------------------------------- transactions
@router.get("/transactions")
def list_transactions(goal_id: int | None = None, period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
                      transaction_type: str | None = Query(default=None, pattern=r"^(deposit|withdraw|income|expense)$"),
                      limit: int = Query(default=50, ge=1, le=200), before: int | None = None,
                      user: User = Depends(life_user), db: Session = Depends(get_db)):
    where = [FinanceTransaction.user_id == user.id, FinanceTransaction.deleted_at.is_(None)]
    if goal_id is not None:
        own_goal(db, user, goal_id)
        where.append(FinanceTransaction.goal_id == goal_id)
    if transaction_type:
        where.append(FinanceTransaction.transaction_type == transaction_type)
    if period:
        start, end = month_bounds(period)
        where += [FinanceTransaction.occurred_at >= start, FinanceTransaction.occurred_at < end]
    if before:
        where.append(FinanceTransaction.id < before)
    rows = list(db.scalars(select(FinanceTransaction).where(*where)
                           .order_by(FinanceTransaction.occurred_at.desc(), FinanceTransaction.id.desc()).limit(limit + 1)))
    categories = {c.id: c for c in categories_of(db, user)}
    return {"items": [tx_view(r, categories) for r in rows[:limit]], "next_before": rows[limit - 1].id if len(rows) > limit else None}


def lock(db: Session, user: User) -> None:
    lock_daily_goals(db, user.id)


@router.post("/transactions", status_code=201)
def create_transaction(data: FinanceTransactionCreate, response: Response, user: User = Depends(life_user),
                       db: Session = Depends(get_db)):
    existing = db.scalar(select(FinanceTransaction).where(FinanceTransaction.user_id == user.id,
                                                          FinanceTransaction.client_ref == data.client_ref))
    if existing is not None:
        response.status_code = 200
        return {"transaction": tx_view(existing), "already_recorded": True,
                "goal": goal_view(db, own_goal(db, user, existing.goal_id)) if existing.goal_id else None}
    goal = own_goal(db, user, data.goal_id) if data.goal_id is not None else None
    if goal is not None and goal.status != "active":
        raise APIError(409, "goal_archived", "This goal is archived")
    usable_category(db, user, data.category_id, data.transaction_type if data.transaction_type in ("income", "expense") else None)
    occurred = (data.occurred_at if not data.occurred_at or data.occurred_at.tzinfo else data.occurred_at.replace(tzinfo=timezone.utc)) or utcnow()
    if occurred > utcnow() + timedelta(days=1):
        raise APIError(422, "occurred_in_future", "A transaction can't be in the future")
    lock(db, user)
    # Saved a moment ago by another request that held the lock first: the same answer as a retry.
    existing = db.scalar(select(FinanceTransaction).where(FinanceTransaction.user_id == user.id,
                                                          FinanceTransaction.client_ref == data.client_ref))
    if existing is not None:
        db.commit()
        response.status_code = 200
        return {"transaction": tx_view(existing), "already_recorded": True, "goal": goal_view(db, goal) if goal else None}
    if goal is not None and data.transaction_type == "withdraw" and goal_balance(db, goal.id) < data.amount:
        db.rollback()
        raise APIError(409, "insufficient_balance", "You can't withdraw more than this goal holds")
    row = FinanceTransaction(user_id=user.id, goal_id=goal.id if goal else None, transaction_type=data.transaction_type,
                             amount=data.amount, category_id=data.category_id, occurred_at=occurred.astimezone(timezone.utc),
                             note=data.note, client_ref=data.client_ref)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:  # the same save from another request got there first
        db.rollback()
        row = db.scalar(select(FinanceTransaction).where(FinanceTransaction.user_id == user.id,
                                                         FinanceTransaction.client_ref == data.client_ref))
        response.status_code = 200
        return {"transaction": tx_view(row), "already_recorded": True, "goal": goal_view(db, goal) if goal else None}
    return {"transaction": tx_view(row), "already_recorded": False, "goal": goal_view(db, goal) if goal else None}


def own_tx(db: Session, user: User, tx_id: int) -> FinanceTransaction:
    row = db.scalar(select(FinanceTransaction).where(FinanceTransaction.id == tx_id, FinanceTransaction.user_id == user.id,
                                                     FinanceTransaction.deleted_at.is_(None)))
    if row is None:
        raise APIError(404, "transaction_not_found", "Transaction not found")
    return row


def check_goal_stays_positive(db: Session, row: FinanceTransaction, new_amount: int | None) -> None:
    """After changing (or removing, `new_amount` None) a goal's deposit or withdrawal, the goal must not go below 0."""
    if row.goal_id is None:
        return
    sign = 1 if row.transaction_type == "deposit" else -1
    after = goal_balance(db, row.goal_id) - sign * row.amount + (sign * new_amount if new_amount is not None else 0)
    if after < 0:
        db.rollback()
        raise APIError(409, "balance_would_go_negative", "This change would take the goal below zero")


@router.patch("/transactions/{tx_id}")
def update_transaction(tx_id: int, data: FinanceTransactionUpdate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    lock(db, user)
    row = own_tx(db, user, tx_id)
    fields = data.model_fields_set
    if "amount" in fields:
        if data.amount is None:
            raise APIError(422, "field_required", "amount cannot be empty")
        check_goal_stays_positive(db, row, data.amount)
        row.amount = data.amount
    if "category_id" in fields:
        usable_category(db, user, data.category_id, row.transaction_type if row.transaction_type in ("income", "expense") else None)
        row.category_id = data.category_id
    if "occurred_at" in fields and data.occurred_at is not None:
        at = data.occurred_at if data.occurred_at.tzinfo else data.occurred_at.replace(tzinfo=timezone.utc)
        row.occurred_at = at.astimezone(timezone.utc)
    if "note" in fields:
        row.note = data.note
    db.commit()
    goal = db.get(FinanceGoal, row.goal_id) if row.goal_id else None
    return {"transaction": tx_view(row), "goal": goal_view(db, goal) if goal else None}


@router.delete("/transactions/{tx_id}")
def delete_transaction(tx_id: int, user: User = Depends(life_user), db: Session = Depends(get_db)):
    lock(db, user)
    row = own_tx(db, user, tx_id)
    check_goal_stays_positive(db, row, None)
    row.deleted_at = utcnow()
    db.commit()
    goal = db.get(FinanceGoal, row.goal_id) if row.goal_id else None
    return {"deleted": True, "goal": goal_view(db, goal) if goal else None}


# ---------------------------------------------------------------------------- categories, budgets, summary
@router.get("/categories")
def list_categories(user: User = Depends(life_user), db: Session = Depends(get_db)):
    return [{"id": c.id, "name": c.name, "type": c.type, "icon": c.icon, "custom": c.user_id is not None} for c in categories_of(db, user)]


@router.post("/categories", status_code=201)
def create_category(data: FinanceCategoryCreate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    count = db.scalar(select(func.count()).select_from(FinanceCategory).where(FinanceCategory.user_id == user.id)) or 0
    if count >= 30:
        raise APIError(409, "too_many_categories", "At most 30 custom categories")
    row = FinanceCategory(user_id=user.id, name=data.name, type=data.type, icon=data.icon)
    db.add(row)
    db.commit()
    return {"id": row.id, "name": row.name, "type": row.type, "icon": row.icon, "custom": True}


def month_bounds(period: str) -> tuple[datetime, datetime]:
    year, month = int(period[:4]), int(period[5:7])
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    return start, end


def spent_by_category(db: Session, user: User, period: str) -> dict[int | None, dict[str, int]]:
    start, end = month_bounds(period)
    rows = db.execute(select(FinanceTransaction.category_id, FinanceTransaction.transaction_type,
                             func.coalesce(func.sum(FinanceTransaction.amount), 0))
                      .where(FinanceTransaction.user_id == user.id, FinanceTransaction.deleted_at.is_(None),
                             FinanceTransaction.transaction_type.in_(("income", "expense")),
                             FinanceTransaction.occurred_at >= start, FinanceTransaction.occurred_at < end)
                      .group_by(FinanceTransaction.category_id, FinanceTransaction.transaction_type)).all()
    out: dict[int | None, dict[str, int]] = defaultdict(lambda: {"income": 0, "expense": 0})
    for category_id, kind, total in rows:
        out[category_id][kind] += int(total)
    return out


def budgets_view(db: Session, user: User, period: str) -> list[dict]:
    spent = spent_by_category(db, user, period)
    categories = {c.id: c for c in categories_of(db, user)}
    rows = db.scalars(select(FinanceBudget).where(FinanceBudget.user_id == user.id, FinanceBudget.period == period))
    out = []
    for b in rows:
        c = categories.get(b.category_id)
        used = spent[b.category_id]["expense"] if b.category_id in spent else 0
        out.append({"id": b.id, "category_id": b.category_id, "category": {"name": c.name, "icon": c.icon} if c else None,
                    "period": b.period, "limit_amount": b.limit_amount, "spent": used, "left": b.limit_amount - used,
                    "over": used > b.limit_amount})
    return out


def this_month() -> str:
    return utcnow().strftime("%Y-%m")


@router.get("/budgets")
def list_budgets(period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
                 user: User = Depends(life_user), db: Session = Depends(get_db)):
    return budgets_view(db, user, period or this_month())


@router.post("/budgets")
def upsert_budget(data: FinanceBudgetUpsert, user: User = Depends(life_user), db: Session = Depends(get_db)):
    usable_category(db, user, data.category_id, "expense")
    row = db.scalar(select(FinanceBudget).where(FinanceBudget.user_id == user.id, FinanceBudget.category_id == data.category_id,
                                                FinanceBudget.period == data.period))
    if row is None:
        row = FinanceBudget(user_id=user.id, category_id=data.category_id, period=data.period, limit_amount=data.limit_amount)
        try:
            with db.begin_nested():
                db.add(row)
        except IntegrityError:
            row = db.scalar(select(FinanceBudget).where(FinanceBudget.user_id == user.id, FinanceBudget.category_id == data.category_id,
                                                        FinanceBudget.period == data.period))
    row.limit_amount = data.limit_amount
    db.commit()
    return next(b for b in budgets_view(db, user, data.period) if b["id"] == row.id)


@router.get("/summary")
def summary(period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
            user: User = Depends(life_user), db: Session = Depends(get_db)):
    """The month's recorded income and expenses by category, the budgets and the goals. Only sums, no advice."""
    period = period or this_month()
    spent = spent_by_category(db, user, period)
    categories = {c.id: c for c in categories_of(db, user)}
    income = sum(v["income"] for v in spent.values())
    expense = sum(v["expense"] for v in spent.values())
    by_category = sorted(({"category_id": cid, "name": categories[cid].name if cid in categories else "Chưa phân loại",
                           "icon": categories[cid].icon if cid in categories else "❔", "income": v["income"], "expense": v["expense"]}
                          for cid, v in spent.items()), key=lambda x: -(x["expense"] + x["income"]))
    goals = [goal_view(db, g) for g in db.scalars(select(FinanceGoal).where(FinanceGoal.user_id == user.id, FinanceGoal.status == "active"))]
    return {"period": period, "income": income, "expense": expense, "net": income - expense, "by_category": by_category,
            "budgets": budgets_view(db, user, period), "goals": goals,
            "saved_total": sum(g["saved_amount"] for g in goals), "target_total": sum(g["target_amount"] for g in goals)}
