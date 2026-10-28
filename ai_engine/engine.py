"""Provider-neutral AI orchestration and persistence owned by the AI Engine process."""
import asyncio
import json
import logging
import os
import string
import time
from dataclasses import dataclass

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.config import settings
from .providers import PROVIDERS
from .validation import EngineInput, EngineOutput
from app.models import AIAgent, AIConversation, AIFeatureConfig, AIMessage, AIRun, AIUsageLog, utcnow

log = logging.getLogger("mirabi.ai")


@dataclass
class AIResult:
    text: str
    run_id: int
    provider: str
    model: str


def _feature_config(db: Session, feature_key: str, default_prompt: str) -> AIFeatureConfig:
    config = db.get(AIFeatureConfig, feature_key)
    if config is None:
        config = AIFeatureConfig(feature_key=feature_key, provider="openai", model=settings.openai_model,
                                 prompt_version="v1", system_prompt=default_prompt, enabled=True)
        db.add(config)
        db.flush()
    return config


async def _invoke_openai(model: str, prompt: str, parameters: dict, max_output_tokens: int):
    return await PROVIDERS["openai"](model, prompt, parameters, max_output_tokens)


def render_prompt(template: str, context: dict[str, str]) -> str:
    fields = {name for _, name, _, _ in string.Formatter().parse(template) if name}
    missing = fields - context.keys()
    if missing:
        raise ValueError("prompt_context_missing")
    return template.format_map({key: str(value) for key, value in context.items()})


async def run_text_feature(db: Session, *, user_id: int, feature_key: str, user_input: str,
                          system_prompt: str, conversation: AIConversation | None = None,
                          context: dict[str, str] | None = None,
                          prompt_override: str | None = None,
                          prompt_version_override: str | None = None) -> AIResult:
    """Run a text feature, persist its conversation and operational metadata.

    Logs contain provider metadata only; prompt and completion text live in the
    access-controlled ai_messages table.
    """
    validated_input = EngineInput(feature_key=feature_key, user_input=user_input)
    config = _feature_config(db, feature_key, system_prompt)
    agent = db.get(AIAgent, feature_key)
    if not config.enabled or (agent is not None and not agent.enabled):
        raise RuntimeError("ai_feature_disabled")
    if conversation is None:
        conversation = AIConversation(user_id=user_id, feature_key=feature_key)
        db.add(conversation)
        db.flush()

    used_prompt_version = prompt_version_override or config.prompt_version
    run = AIRun(user_id=user_id, conversation_id=conversation.id, feature_key=feature_key,
                provider=config.provider, model=config.model, prompt_version=used_prompt_version, status="running")
    db.add(run)
    db.flush()
    db.add(AIMessage(conversation_id=conversation.id, role="user", content=validated_input.user_input))
    db.flush()
    started = time.monotonic()
    prompt_tokens = completion_tokens = None
    outcome, error_code = "error", None
    try:
        provider_call = PROVIDERS.get(config.provider)
        if provider_call is None:
            raise RuntimeError("unsupported_ai_provider")
        if config.provider == "openai" and not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("ai_provider_not_configured")
        prompt = render_prompt(prompt_override or config.system_prompt,
                               context or {"user_input": validated_input.user_input})
        try:
            parameters = json.loads(config.model_parameters or "{}")
        except ValueError:
            parameters = {}
        if not isinstance(parameters, dict):
            parameters = {}
        parameters = {key: value for key, value in parameters.items() if key in {"temperature", "top_p"}}
        max_tokens = min(max(1, config.max_output_tokens), settings.ai_max_output_tokens)
        timeout = min(max(1, config.timeout_seconds), settings.ai_timeout_seconds)
        max_retries = min(max(0, settings.ai_max_retries), 3)
        for attempt in range(max_retries + 1):
            try:
                text, prompt_tokens, completion_tokens = await asyncio.wait_for(
                    provider_call(config.model, prompt, parameters, max_tokens), timeout=timeout,
                )
                text = EngineOutput(text=text).text
                break
            except Exception:
                if attempt >= max_retries:
                    raise
                await asyncio.sleep(0.2 * (attempt + 1))
        run.status = "succeeded"
        run.finished_at = utcnow()
        db.add(AIMessage(conversation_id=conversation.id, role="assistant", content=text))
        outcome = "success"
        result = AIResult(text=text, run_id=run.id, provider=config.provider, model=config.model)
        return result
    except Exception as exc:
        error_code = str(exc) if str(exc).startswith("ai_") or str(exc).startswith("unsupported_") else "provider_error"
        run.status = "failed"
        run.error_code = error_code
        run.finished_at = utcnow()
        log.warning("AI run failed feature=%s provider=%s model=%s code=%s", feature_key, config.provider,
                    config.model, error_code)
        raise
    finally:
        from app.models import AIModel
        model_record = db.scalar(select(AIModel).where(AIModel.provider == config.provider, AIModel.model == config.model))
        cost = None
        if model_record and prompt_tokens is not None and completion_tokens is not None and \
                model_record.input_cost_microusd_per_1k is not None and model_record.output_cost_microusd_per_1k is not None:
            cost = round(prompt_tokens * model_record.input_cost_microusd_per_1k / 1000 +
                         completion_tokens * model_record.output_cost_microusd_per_1k / 1000)
        db.add(AIUsageLog(run_id=run.id, provider=config.provider, model=config.model,
                          prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                          cost_microusd=cost,
                          latency_ms=max(0, int((time.monotonic() - started) * 1000)), outcome=outcome))
        db.commit()
