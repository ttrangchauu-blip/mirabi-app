import logging
import uuid
from datetime import timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .config import settings
from .db import get_db
from .email import email_delivery_configured, send_password_reset_email
from .errors import APIError
from .models import PasswordResetToken, RefreshToken, User, as_utc, utcnow
from .ratelimit import client_ip, enforce
from .schemas import (ForgotPasswordInput, LoginInput, LogoutInput, MessageOut, RefreshInput,
                      RegisterInput, ResetPasswordInput, TokenOut, UserOut)
from .security import (burn_password_check, create_access_token, current_user, hash_password, hash_token,
                       new_opaque_token, password_needs_rehash, verify_password)
from .streaks import record_successful_login

log = logging.getLogger("refmi.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])

INVALID_CREDENTIALS = "Email or password is incorrect"
RESET_REQUESTED = "If an account exists for this email, password reset instructions have been sent."

def _issue_session(db: Session, user: User, family_id: str | None = None) -> tuple[RefreshToken, dict]:
    raw = new_opaque_token()
    token = RefreshToken(user_id=user.id, token_hash=hash_token(raw), family_id=family_id or str(uuid.uuid4()),
                         expires_at=utcnow() + timedelta(days=settings.refresh_token_days))
    db.add(token)
    db.flush()
    return token, {"access_token": create_access_token(user), "refresh_token": raw, "token_type": "bearer",
                   "expires_in": settings.access_token_minutes * 60, "user": user}

def _revoke_family(db: Session, family_id: str) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=utcnow()))

def _invalid_refresh(code: str = "invalid_refresh_token", detail: str = "Invalid refresh token") -> APIError:
    return APIError(401, code, detail)

# Registration doesn't sign the user in: the app sends them back to the login screen with the form pre-filled.
@router.post("/register", response_model=UserOut, status_code=201)
def register(data: RegisterInput, request: Request, db: Session = Depends(get_db)):
    enforce("register-ip", settings.rate_limit_register, client_ip(request))
    if db.scalar(select(User.id).where(User.email == data.email)):
        raise APIError(409, "email_taken", "Email already registered")
    display_name = data.display_name or data.email.split("@")[0][:80] or "Lunaria"
    user = User(email=data.email, password_hash=hash_password(data.password), display_name=display_name,
                role="admin" if data.email.lower() in settings.ai_admin_email_list else "user")
    db.add(user)
    try:
        db.flush()
    except IntegrityError:  # lost a race with a concurrent registration
        db.rollback()
        raise APIError(409, "email_taken", "Email already registered")
    db.commit()
    db.refresh(user)
    return user

@router.post("/login", response_model=TokenOut)
def login(data: LoginInput, request: Request, db: Session = Depends(get_db),
          idempotency_key: str | None = Header(default=None)):
    enforce("login-ip", settings.rate_limit_login_ip, client_ip(request))
    enforce("login-account", settings.rate_limit_login, data.email)
    user = db.scalar(select(User).where(User.email == data.email))
    if not user:
        burn_password_check(data.password)
        raise APIError(401, "invalid_credentials", INVALID_CREDENTIALS)
    if not verify_password(data.password, user.password_hash):
        raise APIError(401, "invalid_credentials", INVALID_CREDENTIALS)
    # Only reached with the correct password, so this doesn't leak account existence.
    if user.status != "active":
        raise APIError(403, "account_disabled", "This account is disabled")
    # Admin assignment follows backend deployment configuration, not client input.
    expected_role = "admin" if user.email.lower() in settings.ai_admin_email_list else "user"
    if user.role != expected_role:
        user.role = expected_role
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(data.password)
    try:
        # Savepoint: a streak failure is rolled back on its own and never blocks signing in.
        with db.begin_nested():
            login_streak = record_successful_login(user, db, idempotency_key)
    except Exception:
        log.exception("Login streak could not be recorded for user %s", user.id)
        login_streak = None
    _, body = _issue_session(db, user)
    body["login_streak"] = login_streak
    db.commit()
    return body

@router.post("/refresh", response_model=TokenOut)
def refresh(data: RefreshInput, request: Request, db: Session = Depends(get_db)):
    enforce("refresh-ip", settings.rate_limit_refresh, client_ip(request))
    token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(data.refresh_token)))
    if not token:
        raise _invalid_refresh()
    if token.revoked_at is not None:
        if token.replaced_by_id is not None:
            # A rotated token was presented again: assume theft and end the whole session family.
            log.warning("Refresh token replay detected for user %s; revoking session family", token.user_id)
            _revoke_family(db, token.family_id)
            db.commit()
        raise _invalid_refresh()
    if as_utc(token.expires_at) <= utcnow():
        raise _invalid_refresh("refresh_token_expired", "Refresh token expired")
    user = db.get(User, token.user_id)
    if not user or user.status != "active":
        _revoke_family(db, token.family_id)
        db.commit()
        raise _invalid_refresh()
    # Conditional update makes rotation atomic: of two concurrent refreshes, only one wins.
    claimed = db.execute(update(RefreshToken).where(RefreshToken.id == token.id, RefreshToken.revoked_at.is_(None))
                         .values(revoked_at=utcnow()))
    if claimed.rowcount != 1:
        db.rollback()
        raise _invalid_refresh()
    new_token, body = _issue_session(db, user, family_id=token.family_id)
    db.execute(update(RefreshToken).where(RefreshToken.id == token.id).values(replaced_by_id=new_token.id))
    db.commit()
    return body

@router.post("/logout", status_code=204)
def logout(data: LogoutInput, db: Session = Depends(get_db)):
    # The refresh token itself is the credential here, so logout still works after the access token expires.
    if data.refresh_token:
        token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(data.refresh_token)))
        if token:
            _revoke_family(db, token.family_id)
            db.commit()
    return Response(status_code=204)

@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user

@router.post("/password/forgot", response_model=MessageOut, status_code=202)
def forgot_password(data: ForgotPasswordInput, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    if not email_delivery_configured():
        # Same answer for every email, so this doesn't reveal accounts; it just avoids claiming an email was sent.
        raise APIError(503, "email_not_configured", "Password recovery email delivery is not configured")
    enforce("pwreset-ip", settings.rate_limit_password_reset, client_ip(request))
    enforce("pwreset-account", settings.rate_limit_password_reset, data.email)
    user = db.scalar(select(User).where(User.email == data.email))
    if user and user.status == "active":
        now = utcnow()
        db.execute(update(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
                   .values(used_at=now))
        raw = new_opaque_token()
        db.add(PasswordResetToken(user_id=user.id, token_hash=hash_token(raw),
                                  expires_at=now + timedelta(minutes=settings.password_reset_minutes)))
        db.commit()
        background.add_task(send_password_reset_email, user.email, raw)
    return {"message": RESET_REQUESTED}

@router.post("/password/reset", response_model=MessageOut)
def reset_password(data: ResetPasswordInput, request: Request, db: Session = Depends(get_db)):
    enforce("pwreset-confirm-ip", settings.rate_limit_password_reset, client_ip(request))
    invalid = APIError(400, "invalid_reset_token", "Reset token is invalid or has expired")
    record = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(data.token)))
    if not record or record.used_at is not None or as_utc(record.expires_at) <= utcnow():
        raise invalid
    claimed = db.execute(update(PasswordResetToken).where(PasswordResetToken.id == record.id, PasswordResetToken.used_at.is_(None))
                         .values(used_at=utcnow()))
    user = db.get(User, record.user_id)
    if claimed.rowcount != 1 or not user or user.status != "active":
        db.rollback()
        raise invalid
    user.password_hash = hash_password(data.new_password)
    user.token_version = (user.token_version or 0) + 1  # kills outstanding access tokens
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=utcnow()))
    db.commit()
    return {"message": "Password has been reset. Please sign in with your new password."}
