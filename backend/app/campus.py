from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from .models import Activity, User
from .security import current_user
from .companion import maybe_start_walk

router = APIRouter(prefix="/api/campus", tags=["campus"])

COURSES = [
    {"id": "c1", "title": "Tư duy sáng tạo", "category": "Sáng tạo", "description": "Xây dựng thói quen giải quyết vấn đề một cách sáng tạo", "lessons": 12, "xp": 120},
    {"id": "c2", "title": "Lập trình cơ bản", "category": "Công nghệ", "description": "Tìm hiểu cách ứng dụng và trang web hoạt động", "lessons": 18, "xp": 180},
    {"id": "c3", "title": "Trí tuệ cảm xúc", "category": "Sức khỏe tinh thần", "description": "Hiểu cảm xúc của bản thân và giao tiếp rõ ràng hơn", "lessons": 10, "xp": 100},
    {"id": "c4", "title": "Quản lý tài chính cá nhân", "category": "Kỹ năng sống", "description": "Tự tin đưa ra các quyết định chi tiêu hằng ngày", "lessons": 8, "xp": 80},
    {"id": "c5", "title": "Khám phá nghề nghiệp", "category": "Nghề nghiệp", "description": "Khám phá điểm mạnh, sở thích và phong cách làm việc", "lessons": 9, "xp": 90},
    {"id": "c6", "title": "Nền tảng thiết kế", "category": "Sáng tạo", "description": "Học về bố cục thị giác và tư duy sản phẩm", "lessons": 14, "xp": 140},
]


@router.get("/courses")
def courses():
    return COURSES


@router.post("/courses/{course_id}/explore")
def explore_course(course_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Record a lesson visit for the daily quest."""
    if not any(course["id"] == course_id for course in COURSES):
        raise HTTPException(status_code=404, detail="Course not found")
    db.add(Activity(user_id=user.id, kind="lesson", ref=course_id))
    db.commit()
    maybe_start_walk(user, db)
    return {"course_id": course_id}
