"""Sliding-window rate limiting for brute-force-sensitive endpoints.

State lives in process memory, so limits apply per worker. For multiple workers or
instances, enforce the same rules at the gateway/reverse proxy or move this to Redis.
"""
import math
import threading
import time
from collections import deque
from fastapi import Request
from .config import settings
from .errors import APIError

def parse_rule(rule: str) -> tuple[int, float]:
    count, seconds = rule.split("/", 1)
    return int(count), float(seconds)

class SlidingWindowLimiter:
    def __init__(self):
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._calls = 0

    def hit(self, key: str, limit: int, window: float) -> float | None:
        """Record a hit; return seconds until retry if the limit is exceeded, else None."""
        now = time.monotonic()
        with self._lock:
            self._calls += 1
            if self._calls % 1000 == 0:
                self._sweep(now, window)
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - window:
                hits.popleft()
            if len(hits) >= limit:
                return max(0.0, hits[0] + window - now)
            hits.append(now)
            return None

    def _sweep(self, now: float, window: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= now - window]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

limiter = SlidingWindowLimiter()

def client_ip(request: Request) -> str:
    # Behind a proxy, run uvicorn with --proxy-headers --forwarded-allow-ips=<proxy ip> so this is the real client.
    return request.client.host if request.client else "unknown"

def enforce(scope: str, rule: str, key: str) -> None:
    if not settings.rate_limit_enabled:
        return
    limit, window = parse_rule(rule)
    retry_after = limiter.hit(f"{scope}:{key}", limit, window)
    if retry_after is not None:
        raise APIError(429, "rate_limited", "Too many attempts. Please try again later.",
                       headers={"Retry-After": str(max(1, math.ceil(retry_after)))})
