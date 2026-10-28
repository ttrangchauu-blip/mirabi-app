import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .db import get_db
from .errors import APIError
from .models import User, utcnow
from .schemas import AdoptPetInput, DailyTaskSelection, ProfilePatch, UserOut
from .security import current_user
from .progression import activate_pet

router = APIRouter(prefix="/api", tags=["profile"])

DAILY_TASKS = [
    {"id": "health", "group": "Sức khỏe", "title": "Vận động ít nhất 15 phút", "description": "Đi bộ, giãn cơ hoặc tập luyện phù hợp", "exp": 10, "icon": "water"},
    {"id": "learning", "group": "Học tập", "title": "Học một điều mới trong 15 phút", "description": "Học ngoại ngữ, đọc sách hoặc phát triển kỹ năng", "exp": 10, "icon": "book"},
    {"id": "work", "group": "Công việc", "title": "Hoàn thành việc quan trọng nhất hôm nay", "description": "Hoàn thành một việc ưu tiên đã xác định từ đầu ngày", "exp": 15, "icon": "briefcase"},
    {"id": "home", "group": "Cuộc sống", "title": "Dọn dẹp không gian sống trong 10 phút", "description": "Dọn bàn, phòng hoặc khu vực thường sử dụng", "exp": 10, "icon": "home"},
    {"id": "wellbeing", "group": "Tinh thần", "title": "Dành 5 phút nhìn lại bản thân", "description": "Ghi lại cảm xúc hoặc suy nghĩ về ngày hôm nay", "exp": 10, "icon": "heart"},
]
DAILY_TASK_BY_ID = {task["id"]: task for task in DAILY_TASKS}


@router.get("/profile", response_model=UserOut)
def profile(user: User = Depends(current_user)):
    return user


@router.get("/onboarding/daily-tasks")
def get_daily_task_catalog(user: User = Depends(current_user)):
    selected = json.loads(user.daily_task_ids or "[]")
    return {"tasks": DAILY_TASKS, "selected_task_ids": selected, "selected": user.daily_tasks_selected}


@router.put("/onboarding/daily-tasks", response_model=UserOut)
def select_daily_tasks(data: DailyTaskSelection, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.pet_name is None:
        raise APIError(409, "pet_not_adopted", "Adopt a pet before selecting daily tasks")
    if len(set(data.task_ids)) != len(data.task_ids):
        raise APIError(422, "duplicate_daily_tasks", "Daily tasks must be unique")
    if any(task_id not in DAILY_TASK_BY_ID for task_id in data.task_ids):
        raise APIError(422, "invalid_daily_task", "One or more daily tasks are invalid")
    user.daily_task_ids = json.dumps(data.task_ids)
    user.daily_tasks_selected_at = utcnow()
    db.commit()
    db.refresh(user)
    return user


@router.patch("/profile", response_model=UserOut)
def update_profile(data: ProfilePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if data.display_name is not None:
        user.display_name = data.display_name.strip()
    if data.avatar_theme is not None:
        user.avatar_theme = data.avatar_theme
    if data.pet is not None:
        activate_pet(user, data.pet, db)
    if data.pet_name is not None:
        user.pet_name = data.pet_name
    db.commit()
    db.refresh(user)
    return user


@router.put("/pet", response_model=UserOut)
def adopt_pet(data: AdoptPetInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Adopt or rename the user's companion."""
    activate_pet(user, data.pet, db)
    user.pet_name = data.name
    db.commit()
    db.refresh(user)
    return user


@router.post("/onboarding/complete", response_model=UserOut)
def complete_onboarding(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.pet_name is None:
        raise APIError(409, "pet_not_adopted", "Adopt a pet before finishing onboarding")
    if not user.daily_tasks_selected:
        raise APIError(409, "daily_tasks_not_selected", "Select daily tasks before finishing onboarding")
    if user.onboarded_at is None:
        user.onboarded_at = utcnow()
        db.commit()
        db.refresh(user)
    return user
