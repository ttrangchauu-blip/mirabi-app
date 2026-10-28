from fastapi import APIRouter

from .schemas import CareerQuiz

router = APIRouter(prefix="/api/career", tags=["career"])

CAREERS = [
    {"title": "Nhà thiết kế UI/UX", "category": "Sáng tạo", "match": 88, "description": "Tạo nên những trải nghiệm số rõ ràng và thú vị", "skills": ["Thấu cảm", "Thiết kế hình ảnh", "Nghiên cứu"]},
    {"title": "Lập trình viên game", "category": "Công nghệ", "match": 85, "description": "Xây dựng thế giới tương tác và hệ thống trò chơi", "skills": ["Lập trình", "Tư duy logic", "Làm việc nhóm"]},
    {"title": "Nhà tâm lý học", "category": "Con người", "match": 78, "description": "Giúp mọi người hiểu hành vi và cảm xúc", "skills": ["Lắng nghe", "Nghiên cứu", "Thấu cảm"]},
    {"title": "Chuyên viên phân tích dữ liệu", "category": "Công nghệ", "match": 74, "description": "Biến thông tin thành những hiểu biết hữu ích", "skills": ["Phân tích", "Thống kê", "Giao tiếp"]},
    {"title": "Nhà thiết kế sản phẩm", "category": "Sáng tạo", "match": 71, "description": "Kết nối nhu cầu người dùng, thiết kế và mục tiêu sản phẩm", "skills": ["Làm mẫu thử", "Nghiên cứu", "Tư duy hệ thống"]},
]


@router.get("/recommendations")
def career_recommendations():
    return CAREERS


@router.post("/quiz")
def career_quiz(data: CareerQuiz):
    interests = {value.lower() for value in data.interests}
    scored = []
    for career in CAREERS:
        score = career["match"] + (10 if career["category"].lower() in interests else 0)
        scored.append({**career, "match": min(score, 99)})
    return sorted(scored, key=lambda career: career["match"], reverse=True)
