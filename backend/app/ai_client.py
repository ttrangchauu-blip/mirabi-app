"""Server-to-server client for the separately deployed AI engine."""
import httpx
from .config import settings


class AIServiceError(RuntimeError):
    def __init__(self, code: str, status_code: int = 503):
        self.code = code
        self.status_code = status_code
        super().__init__(code)


async def call_ai_engine(payload: dict) -> dict:
    if not settings.ai_service_token:
        raise AIServiceError("ai_service_not_configured")
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            response = await client.post(
                f"{settings.ai_service_url.rstrip('/')}/internal/v1/runs",
                json=payload,
                headers={"X-AI-Service-Token": settings.ai_service_token},
            )
    except httpx.TimeoutException as exc:
        raise AIServiceError("ai_service_timeout", 504) from exc
    except httpx.HTTPError as exc:
        raise AIServiceError("ai_service_unavailable", 503) from exc
    if response.status_code >= 400:
        try:
            code = response.json().get("detail", {}).get("code", "ai_engine_error")
        except (ValueError, AttributeError):
            code = "ai_engine_error"
        raise AIServiceError(code, response.status_code)
    try:
        return response.json()
    except ValueError as exc:
        raise AIServiceError("ai_engine_invalid_response", 502) from exc


async def ai_engine_health() -> dict:
    if not settings.ai_service_token:
        return {"available": False, "provider_configured": False}
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get(f"{settings.ai_service_url.rstrip('/')}/internal/health",
                                        headers={"X-AI-Service-Token": settings.ai_service_token})
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError:
        return {"available": False, "provider_configured": False}
