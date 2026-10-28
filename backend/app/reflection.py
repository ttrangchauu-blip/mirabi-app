from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai_client import AIServiceError, call_ai_engine
from .ai_features import reflection as reflection_feature
from .ai_context import build_context
from .db import get_db
from .models import AIMemory, User
from .schemas import ReflectionInput
from .security import current_user

router = APIRouter(prefix="/api/ai", tags=["ai"])

class MemoryInput(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    category: str = Field(default="general", min_length=1, max_length=40)


class StudyTutorInput(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@router.post("/reflection")
async def ai_reflection(data: ReflectionInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    context = build_context(reflection_feature.build_context(data), allowed={"user_input", "mood"})
    try:
        result = await call_ai_engine({"user_id": user.id, "feature_key": "reflection",
                                       "user_input": data.text[:5000], "context": context})
        return {"reply": result["text"], "provider": result["provider"], "run_id": result["run_id"]}
    except AIServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": "AI service is unavailable"})
    except Exception:
        raise HTTPException(status_code=502, detail={"code": "ai_provider_error", "message": "AI request failed"})


@router.get("/memories")
def list_memories(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(AIMemory).where(AIMemory.user_id == user.id).order_by(AIMemory.updated_at.desc())).all()
    return [{"id": row.id, "content": row.content, "category": row.category,
             "created_at": row.created_at, "updated_at": row.updated_at} for row in rows]


@router.post("/memories", status_code=201)
def create_memory(data: MemoryInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = AIMemory(user_id=user.id, content=data.content.strip(), category=data.category.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "content": row.content, "category": row.category,
            "created_at": row.created_at, "updated_at": row.updated_at}


@router.delete("/memories/{memory_id}", status_code=204)
def delete_memory(memory_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.scalar(select(AIMemory).where(AIMemory.id == memory_id, AIMemory.user_id == user.id))
    if row is None:
        return Response(status_code=204)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


class TaskPlannerInput(BaseModel):
    request: str = Field(min_length=1, max_length=2000)


@router.post("/task-planner")
async def task_planner(data: TaskPlannerInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .ai_features import task_planner as planner
    context = build_context(planner.build_context(data.request), allowed={"user_input"})
    try:
        result = await call_ai_engine({"user_id": user.id, "feature_key": planner.FEATURE_KEY,
                                       "user_input": data.request, "context": context})
        return {"suggestions": result["text"], "provider": result["provider"], "run_id": result["run_id"]}
    except AIServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": "AI service is unavailable"})
    except Exception:
        raise HTTPException(status_code=502, detail={"code": "ai_provider_error", "message": "AI request failed"})


@router.post("/study/tutor")
async def ai_study_tutor(data: StudyTutorInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .ai_features import study_tutor
    context = build_context(study_tutor.build_context(data.text), allowed={"user_input"})
    try:
        result = await call_ai_engine({"user_id": user.id, "feature_key": study_tutor.FEATURE_KEY,
                                       "user_input": data.text, "context": context})
        return {"answer": result["text"], "provider": result["provider"], "run_id": result["run_id"]}
    except AIServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": "AI service is unavailable"})
    except Exception:
        raise HTTPException(status_code=502, detail={"code": "ai_provider_error", "message": "AI request failed"})
