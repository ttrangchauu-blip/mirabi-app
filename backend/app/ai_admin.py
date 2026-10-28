"""Admin-only AI catalog, configuration, prompt lifecycle, telemetry and evaluation APIs."""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .ai_client import AIServiceError, ai_engine_health, call_ai_engine
from .config import settings
from .db import get_db
from .models import (AIAgent, AIAuditLog, AIEvaluation, AIFeatureConfig, AIModel,
                     AIPromptVersion, AIRun, AIUsageLog, User)
from .security import admin_user

router = APIRouter(prefix="/api/admin/ai", tags=["ai-admin"])


class AgentUpdate(BaseModel):
    enabled: bool


class FeatureConfigUpdate(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=100)
    parameters: dict = Field(default_factory=dict)
    max_output_tokens: int = Field(ge=1, le=4000)
    timeout_seconds: int = Field(ge=1, le=120)

    @field_validator("parameters")
    @classmethod
    def supported_parameters(cls, value):
        return _verify_model_parameters(value)


class PromptDraftInput(BaseModel):
    system_prompt: str = Field(min_length=1, max_length=12000)


class PromptTestInput(BaseModel):
    user_input: str = Field(min_length=1, max_length=2000)


class EvaluationInput(BaseModel):
    score: int = Field(ge=1, le=5)
    notes: str | None = Field(default=None, max_length=1000)


class ModelInput(BaseModel):
    provider: str = Field(default="openai", min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=100)
    input_cost_microusd_per_1k: int | None = Field(default=None, ge=0)
    output_cost_microusd_per_1k: int | None = Field(default=None, ge=0)
    enabled: bool = True


def _audit(db: Session, actor: User, action: str, target_type: str, target_id: str, details: dict):
    db.add(AIAuditLog(actor_user_id=actor.id, action=action, target_type=target_type,
                      target_id=target_id, details_json=json.dumps(details, separators=(",", ":"))))


def _agent_or_404(db: Session, feature_key: str) -> AIAgent:
    agent = db.get(AIAgent, feature_key)
    if agent is None:
        raise HTTPException(404, "AI agent not found")
    return agent


def _ensure_baseline_prompt(db: Session, feature_key: str, actor: User) -> None:
    """Record the running prompt as published v1 when startup could not (no account existed yet on a fresh DB),
    so the first admin draft has a version to roll back to."""
    if db.scalar(select(AIPromptVersion.id).where(AIPromptVersion.feature_key == feature_key).limit(1)) is not None:
        return
    config = db.get(AIFeatureConfig, feature_key)
    if config is None:
        return
    db.add(AIPromptVersion(feature_key=feature_key, version=1, status="published", system_prompt=config.system_prompt,
                           created_by_user_id=actor.id, published_at=datetime.now(timezone.utc)))
    db.flush()


def _verify_model_parameters(value: dict) -> dict:
    if set(value) - {"temperature", "top_p"}:
        raise ValueError("Only temperature and top_p are supported model parameters")
    if any(isinstance(number, bool) or not isinstance(number, (float, int)) or number < 0 or number > 2
           for number in value.values()):
        raise ValueError("Model parameters must be numeric values from 0 to 2")
    return value


@router.get("/overview")
async def overview(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    agents = db.scalars(select(AIAgent).order_by(AIAgent.feature_key)).all()
    result = []
    for agent in agents:
        config = db.get(AIFeatureConfig, agent.feature_key)
        count, errors, average_latency = db.execute(select(
            func.count(AIRun.id), func.sum(case((AIRun.status == "failed", 1), else_=0)),
            func.avg(AIUsageLog.latency_ms)
        ).select_from(AIRun).outerjoin(AIUsageLog, AIUsageLog.run_id == AIRun.id)
         .where(AIRun.feature_key == agent.feature_key)).one()
        result.append({"feature_key": agent.feature_key, "name": agent.name, "description": agent.description,
                       "enabled": agent.enabled and bool(config and config.enabled),
                       "provider": config.provider if config else None, "model": config.model if config else None,
                       "prompt_version": config.prompt_version if config else None,
                       "timeout_seconds": config.timeout_seconds if config else None,
                       "max_output_tokens": config.max_output_tokens if config else None,
                       "run_count": count, "error_count": errors or 0,
                       "average_latency_ms": round(average_latency or 0)})
    health = await ai_engine_health()
    return {"agents": result, "models": list_models(db), "provider_configured": health.get("provider_configured", False),
            "ai_service_available": health.get("available", False)}


def list_models(db: Session):
    return [{"id": m.id, "provider": m.provider, "model": m.model, "enabled": m.enabled,
             "input_cost_microusd_per_1k": m.input_cost_microusd_per_1k,
             "output_cost_microusd_per_1k": m.output_cost_microusd_per_1k}
            for m in db.scalars(select(AIModel).order_by(AIModel.provider, AIModel.model))]


@router.get("/models")
def models(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return list_models(db)


@router.post("/models", status_code=201)
def register_model(data: ModelInput, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    if data.provider not in {"openai"}:
        raise HTTPException(400, "Provider adapter is not registered")
    model = db.scalar(select(AIModel).where(AIModel.provider == data.provider, AIModel.model == data.model))
    if model is None:
        model = AIModel(provider=data.provider, model=data.model)
        db.add(model)
    model.input_cost_microusd_per_1k = data.input_cost_microusd_per_1k
    model.output_cost_microusd_per_1k = data.output_cost_microusd_per_1k
    model.enabled = data.enabled
    _audit(db, actor, "model.upsert", "model", f"{data.provider}/{data.model}",
           {"enabled": data.enabled, "cost_configured": data.input_cost_microusd_per_1k is not None and data.output_cost_microusd_per_1k is not None})
    db.commit()
    return {"id": model.id, "provider": model.provider, "model": model.model, "enabled": model.enabled}


@router.patch("/agents/{feature_key}")
def update_agent(feature_key: str, data: AgentUpdate, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    agent = _agent_or_404(db, feature_key)
    config = db.get(AIFeatureConfig, feature_key)
    if config is None:
        raise HTTPException(409, "Feature config is missing")
    agent.enabled = data.enabled
    config.enabled = data.enabled
    _audit(db, actor, "agent.toggle", "agent", feature_key, {"enabled": data.enabled})
    db.commit()
    return {"feature_key": feature_key, "enabled": data.enabled}


@router.put("/features/{feature_key}/config")
def update_config(feature_key: str, data: FeatureConfigUpdate, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    _agent_or_404(db, feature_key)
    config = db.get(AIFeatureConfig, feature_key)
    model = db.scalar(select(AIModel).where(AIModel.provider == data.provider, AIModel.model == data.model,
                                            AIModel.enabled.is_(True)))
    if config is None or model is None or data.provider not in {"openai"}:
        raise HTTPException(400, "Provider/model is not registered")
    if data.timeout_seconds > settings.ai_timeout_seconds or data.max_output_tokens > settings.ai_max_output_tokens:
        raise HTTPException(400, "Requested limits exceed backend safety caps")
    config.provider, config.model = data.provider, data.model
    config.model_parameters = json.dumps(data.parameters, separators=(",", ":"))
    config.timeout_seconds, config.max_output_tokens = data.timeout_seconds, data.max_output_tokens
    _audit(db, actor, "feature.config.update", "feature", feature_key,
           {"provider": data.provider, "model": data.model, "timeout": data.timeout_seconds,
            "max_output_tokens": data.max_output_tokens})
    db.commit()
    return {"feature_key": feature_key, "provider": config.provider, "model": config.model}


@router.get("/agents/{feature_key}/prompts")
def prompt_versions(feature_key: str, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    _agent_or_404(db, feature_key)
    _ensure_baseline_prompt(db, feature_key, actor)
    db.commit()
    rows = db.scalars(select(AIPromptVersion).where(AIPromptVersion.feature_key == feature_key)
                      .order_by(AIPromptVersion.version.desc())).all()
    return [{"id": p.id, "version": p.version, "status": p.status, "system_prompt": p.system_prompt,
             "created_at": p.created_at, "published_at": p.published_at} for p in rows]


@router.post("/agents/{feature_key}/prompts", status_code=201)
def create_prompt(feature_key: str, data: PromptDraftInput, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    _agent_or_404(db, feature_key)
    _ensure_baseline_prompt(db, feature_key, actor)
    latest = db.scalar(select(func.max(AIPromptVersion.version)).where(AIPromptVersion.feature_key == feature_key)) or 0
    prompt = AIPromptVersion(feature_key=feature_key, version=latest + 1, status="draft",
                             system_prompt=data.system_prompt, created_by_user_id=actor.id)
    db.add(prompt)
    db.flush()
    _audit(db, actor, "prompt.create", "prompt", str(prompt.id), {"feature_key": feature_key, "version": prompt.version})
    db.commit()
    return {"id": prompt.id, "feature_key": feature_key, "version": prompt.version, "status": prompt.status}


@router.post("/prompts/{prompt_id}/test")
async def test_prompt(prompt_id: int, data: PromptTestInput, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    prompt = db.get(AIPromptVersion, prompt_id)
    if prompt is None:
        raise HTTPException(404, "Prompt version not found")
    try:
        result = await call_ai_engine({"user_id": actor.id, "feature_key": prompt.feature_key,
                                       "user_input": data.user_input,
                                       "context": {"user_input": data.user_input, "mood": "not specified"},
                                       "prompt_override": prompt.system_prompt,
                                       "prompt_version": f"draft:{prompt.version}"})
    except AIServiceError as exc:
        raise HTTPException(exc.status_code, "AI service is unavailable")
    except Exception:
        raise HTTPException(502, "AI prompt test failed")
    return {"run_id": result["run_id"], "reply": result["text"], "provider": result["provider"], "model": result["model"]}


@router.post("/prompts/{prompt_id}/publish")
def publish_prompt(prompt_id: int, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    prompt = db.get(AIPromptVersion, prompt_id)
    if prompt is None:
        raise HTTPException(404, "Prompt version not found")
    for current in db.scalars(select(AIPromptVersion).where(AIPromptVersion.feature_key == prompt.feature_key,
                                                            AIPromptVersion.status == "published")):
        current.status = "archived"
    prompt.status = "published"
    prompt.published_at = datetime.now(timezone.utc)
    config = db.get(AIFeatureConfig, prompt.feature_key)
    config.system_prompt = prompt.system_prompt
    config.prompt_version = str(prompt.version)
    _audit(db, actor, "prompt.publish", "prompt", str(prompt.id),
           {"feature_key": prompt.feature_key, "version": prompt.version})
    db.commit()
    return {"id": prompt.id, "feature_key": prompt.feature_key, "version": prompt.version, "status": prompt.status}


@router.get("/runs")
def runs(limit: int = 50, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    limit = min(max(limit, 1), 200)
    rows = db.execute(select(AIRun, AIUsageLog).outerjoin(AIUsageLog, AIUsageLog.run_id == AIRun.id)
                      .order_by(AIRun.started_at.desc()).limit(limit)).all()
    return [{"id": run.id, "user_id": run.user_id, "feature_key": run.feature_key, "status": run.status,
             "provider": run.provider, "model": run.model, "prompt_version": run.prompt_version,
             "error_code": run.error_code, "started_at": run.started_at,
             "latency_ms": usage.latency_ms if usage else None,
             "prompt_tokens": usage.prompt_tokens if usage else None,
             "completion_tokens": usage.completion_tokens if usage else None,
             "cost_microusd": usage.cost_microusd if usage else None} for run, usage in rows]


@router.post("/runs/{run_id}/evaluation", status_code=201)
def evaluate_run(run_id: int, data: EvaluationInput, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    if db.get(AIRun, run_id) is None:
        raise HTTPException(404, "AI run not found")
    evaluation = AIEvaluation(run_id=run_id, evaluator_user_id=actor.id, score=data.score, notes=data.notes)
    db.add(evaluation)
    db.flush()
    _audit(db, actor, "run.evaluate", "run", str(run_id), {"score": data.score})
    db.commit()
    return {"id": evaluation.id, "run_id": run_id, "score": data.score, "notes": data.notes}


@router.get("/evaluations")
def evaluations(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    rows = db.execute(select(AIEvaluation, AIRun.feature_key, AIRun.prompt_version)
                      .join(AIRun, AIRun.id == AIEvaluation.run_id)
                      .order_by(AIEvaluation.created_at.desc()).limit(200)).all()
    return [{"id": evaluation.id, "run_id": evaluation.run_id, "feature_key": feature,
             "prompt_version": version, "score": evaluation.score, "notes": evaluation.notes,
             "created_at": evaluation.created_at} for evaluation, feature, version in rows]


@router.get("/audit")
def audit_logs(limit: int = 100, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    rows = db.scalars(select(AIAuditLog).order_by(AIAuditLog.created_at.desc()).limit(min(max(limit, 1), 200)))
    return [{"id": row.id, "actor_user_id": row.actor_user_id, "action": row.action,
             "target_type": row.target_type, "target_id": row.target_id,
             "details": json.loads(row.details_json), "created_at": row.created_at} for row in rows]
