"""AI execution process. Business API authenticates users and forwards authorized runs."""
import hmac
import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
# The AI process shares the existing SQL database and ORM contract in this monorepo.
# Add the business backend source root for the existing DB/models/provider-neutral engine.
BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from ai_engine.engine import run_text_feature  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import AIAgent, AIFeatureConfig, AIModel  # noqa: E402


class RunRequest(BaseModel):
    user_id: int = Field(gt=0)
    feature_key: str = Field(min_length=1, max_length=80)
    user_input: str = Field(min_length=1, max_length=5000)
    context: dict[str, str] = Field(default_factory=dict)
    prompt_override: str | None = Field(default=None, max_length=12000)
    prompt_version: str | None = Field(default=None, max_length=40)


def require_service_token(token: str | None = Header(default=None, alias="X-AI-Service-Token")):
    expected = os.environ.get("AI_SERVICE_TOKEN", "")
    if not expected or not token or not hmac.compare_digest(token, expected):
        raise HTTPException(401, detail={"code": "invalid_service_credentials"})


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The business backend owns migrations. The AI process never runs business migrations.
    yield


app = FastAPI(title="Mirabi AI Engine", version="1.0.0", lifespan=lifespan)


@app.get("/internal/health", dependencies=[Depends(require_service_token)])
def health():
    return {"available": True, "provider_configured": bool(os.environ.get("OPENAI_API_KEY"))}


@app.post("/internal/v1/runs", dependencies=[Depends(require_service_token)])
async def run(request: RunRequest):
    with SessionLocal() as db:
        agent = db.get(AIAgent, request.feature_key)
        config = db.get(AIFeatureConfig, request.feature_key)
        if not agent or not config:
            raise HTTPException(404, detail={"code": "ai_feature_not_found"})
        if not agent.enabled or not config.enabled:
            raise HTTPException(503, detail={"code": "ai_feature_disabled"})
        model = db.scalar(select(AIModel).where(AIModel.provider == config.provider,
                                               AIModel.model == config.model,
                                               AIModel.enabled.is_(True)))
        if model is None:
            raise HTTPException(503, detail={"code": "ai_model_not_registered"})
        try:
            result = await run_text_feature(
                db, user_id=request.user_id, feature_key=request.feature_key,
                user_input=request.user_input, system_prompt=config.system_prompt,
                context=request.context or {"user_input": request.user_input},
                prompt_override=request.prompt_override,
                prompt_version_override=request.prompt_version,
            )
            return {"text": result.text, "run_id": result.run_id,
                    "provider": result.provider, "model": result.model}
        except RuntimeError as exc:
            db.rollback()
            code = str(exc) if str(exc).startswith(("ai_", "unsupported_")) else "ai_provider_error"
            status = 503 if code in {"ai_provider_not_configured", "ai_feature_disabled"} else 502
            raise HTTPException(status, detail={"code": code}) from exc
        except Exception as exc:
            db.rollback()
            raise HTTPException(502, detail={"code": "ai_provider_error"}) from exc


@app.get("/health")
def public_health():
    return {"service": "mirabi-ai-engine", "status": "healthy"}
