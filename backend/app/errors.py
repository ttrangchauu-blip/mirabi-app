"""Consistent error bodies: {"detail": <human message>, "code": <machine code>, ...}.

`detail` stays a string so existing clients that read `body.detail` keep working.
"""
import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("refmi.errors")

class APIError(HTTPException):
    def __init__(self, status_code: int, code: str, detail: str, headers: dict[str, str] | None = None):
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code

DEFAULT_CODES = {400: "bad_request", 401: "not_authenticated", 403: "forbidden", 404: "not_found",
                 405: "method_not_allowed", 409: "conflict", 429: "rate_limited"}

def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = getattr(exc, "code", None) or DEFAULT_CODES.get(exc.status_code, "error")
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse({"detail": detail, "code": code}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Never echo submitted values back (they may contain passwords).
        errors = [{"field": ".".join(str(p) for p in e.get("loc", [])[1:]) or "body", "message": e.get("msg", "Invalid value"), "type": e.get("type", "")}
                  for e in exc.errors()]
        return JSONResponse({"detail": "Validation failed", "code": "validation_error", "errors": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Internal server error", "code": "internal_error"}, status_code=500)
