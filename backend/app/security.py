import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from .config import settings
from .db import get_db
from .errors import APIError
from .models import User

# Argon2id with argon2-cffi's RFC 9106 defaults.
_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("refmi-timing-equalizer")
bearer_scheme = HTTPBearer(auto_error=False, description="Access token from /api/auth/login")
ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    return _hasher.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    if hashed.startswith("$argon2"):
        try:
            return _hasher.verify(hashed, password)
        except (VerificationError, InvalidHashError):
            return False
    if hashed.startswith(("$2a$", "$2b$", "$2y$")):
        # Legacy bcrypt hashes (passlib, first release). passlib truncated to 72 bytes, so we do too.
        try:
            return bcrypt.checkpw(password.encode()[:72], hashed.encode())
        except ValueError:
            return False
    return False

def password_needs_rehash(hashed: str) -> bool:
    return not hashed.startswith("$argon2") or _hasher.check_needs_rehash(hashed)

def burn_password_check(password: str) -> None:
    """Spend the same time as a real verification so unknown emails can't be detected by timing."""
    verify_password(password, _DUMMY_HASH)

def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "type": "access",
        "ver": user.token_version or 0,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)

def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)

def hash_token(token: str) -> str:
    # Opaque tokens carry 384 bits of entropy, so a fast hash is sufficient for lookup.
    return hashlib.sha256(token.encode()).hexdigest()

def _unauthorized(code: str, detail: str) -> APIError:
    return APIError(401, code, detail, headers={"WWW-Authenticate": "Bearer"})

def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme), db: Session = Depends(get_db)) -> User:
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise _unauthorized("not_authenticated", "Not authenticated")
    try:
        payload = jwt.decode(
            creds.credentials, settings.jwt_secret, algorithms=[ALGORITHM],
            audience=settings.jwt_audience, issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
        )
        if payload.get("type") != "access":
            raise jwt.InvalidTokenError("wrong token type")
        user_id = int(payload["sub"])
        version = int(payload.get("ver", -1))
    except jwt.ExpiredSignatureError:
        raise _unauthorized("token_expired", "Access token expired")
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise _unauthorized("invalid_token", "Invalid access token")
    user = db.get(User, user_id)
    if not user or user.status != "active" or (user.token_version or 0) != version:
        raise _unauthorized("invalid_token", "Invalid access token")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    """Require the persisted admin role; role changes take effect without token rotation."""
    if user.role != "admin":
        from .errors import APIError
        raise APIError(403, "admin_required", "Administrator access is required")
    return user
