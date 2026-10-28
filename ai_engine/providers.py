"""AI Engine provider adapters; credentials load only in the AI service process."""
from collections.abc import Awaitable, Callable
import os

ProviderCall = Callable[[str, str, dict, int], Awaitable[tuple[str, int | None, int | None]]]


async def openai_call(model: str, prompt: str, parameters: dict, max_output_tokens: int):
    from openai import AsyncOpenAI
    from app.config import settings

    client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""), timeout=settings.ai_timeout_seconds, max_retries=0)
    response = await client.responses.create(model=model, input=prompt, max_output_tokens=max_output_tokens,
                                             **parameters)
    usage = getattr(response, "usage", None)
    return response.output_text, getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None)


PROVIDERS: dict[str, ProviderCall] = {"openai": openai_call}
