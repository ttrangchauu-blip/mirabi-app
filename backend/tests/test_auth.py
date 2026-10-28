from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
import pytest
from sqlalchemy import select
from app.config import Settings, settings
from app.models import RefreshToken, User
from app.security import ALGORITHM
from conftest import PASSWORD, bearer, login, register, signup

# ---------- registration ----------

def test_register_returns_public_profile_without_session(client):
    res = register(client, display_name="Aqua Fan")
    assert res.status_code == 201
    body = res.json()
    assert "access_token" not in body and "refresh_token" not in body
    assert body["email"] == "aqua@example.com"
    assert body["display_name"] == "Aqua Fan"
    assert body["pet_name"] is None and body["onboarded"] is False
    assert "password_hash" not in body and "password" not in body

def test_register_then_login_works(client):
    register(client)
    assert login(client).status_code == 200

def test_register_normalizes_email(client, db):
    assert register(client, email="  Aqua.Fan@Example.COM ").status_code == 201
    assert db.scalar(select(User).where(User.email == "aqua.fan@example.com")) is not None

def test_register_defaults_display_name_from_email(client):
    assert register(client, email="luna@example.com").json()["display_name"] == "luna"

@pytest.mark.parametrize("email", ["not-an-email", "a@", "@example.com", ""])
def test_register_invalid_email(client, email):
    res = register(client, email=email)
    assert res.status_code == 422
    assert res.json()["code"] == "validation_error"

@pytest.mark.parametrize("password", ["short1", "allletters", "12345678", " Padded123", "x1" * 70])
def test_register_weak_or_invalid_password(client, password):
    assert register(client, password=password).status_code == 422

def test_validation_errors_do_not_echo_password(client):
    res = register(client, password="secretonly")
    assert res.status_code == 422
    assert "secretonly" not in res.text

def test_register_duplicate_email_is_case_insensitive(client):
    assert register(client).status_code == 201
    res = register(client, email="AQUA@example.com")
    assert res.status_code == 409
    assert res.json() == {"detail": "Email already registered", "code": "email_taken"}

@pytest.mark.parametrize("payload", [{}, {"email": "aqua@example.com"}, {"password": PASSWORD}])
def test_register_missing_fields(client, payload):
    assert client.post("/api/auth/register", json=payload).status_code == 422

def test_password_is_stored_hashed_with_argon2id(client, db):
    register(client)
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    assert user.password_hash != PASSWORD
    assert PASSWORD not in user.password_hash
    assert user.password_hash.startswith("$argon2id$")

# ---------- login ----------

def test_login_success(client):
    register(client)
    res = login(client, email="Aqua@Example.com")
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["email"] == "aqua@example.com"
    assert client.get("/api/auth/me", headers=bearer(body["access_token"])).status_code == 200

def test_login_wrong_password_and_unknown_account_are_indistinguishable(client):
    register(client)
    wrong = login(client, password="Wrong12345")
    unknown = login(client, email="nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Email or password is incorrect", "code": "invalid_credentials"}

@pytest.mark.parametrize("payload", [{}, {"email": "aqua@example.com"}, {"password": PASSWORD}, {"email": "aqua@example.com", "password": ""}])
def test_login_missing_fields(client, payload):
    assert client.post("/api/auth/login", json=payload).status_code == 422

def test_legacy_bcrypt_hash_still_logs_in_and_is_upgraded(client, db):
    legacy = bcrypt.hashpw(b"OldPass99", bcrypt.gensalt()).decode()
    db.add(User(email="legacy@example.com", password_hash=legacy, display_name="Legacy")); db.commit()
    assert login(client, email="legacy@example.com", password="OldPass99").status_code == 200
    db.expire_all()
    assert db.scalar(select(User).where(User.email == "legacy@example.com")).password_hash.startswith("$argon2id$")

def test_disabled_account(client, db):
    tokens = signup(client).json()
    db.scalar(select(User).where(User.email == "aqua@example.com")).status = "disabled"; db.commit()
    assert login(client, password="Wrong12345").status_code == 401  # wrong password: no hint the account exists
    assert login(client).json()["code"] == "account_disabled"
    assert client.get("/api/auth/me", headers=bearer(tokens["access_token"])).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401

# ---------- access tokens / protected endpoints ----------

def _token(**overrides):
    now = datetime.now(timezone.utc)
    claims = {"sub": "1", "type": "access", "ver": 0, "iat": now, "exp": now + timedelta(minutes=5),
              "iss": settings.jwt_issuer, "aud": settings.jwt_audience}
    claims.update(overrides)
    secret = claims.pop("secret", settings.jwt_secret)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, secret, algorithm=ALGORITHM)

def test_me_requires_token(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401
    assert res.json()["code"] == "not_authenticated"
    assert res.headers["WWW-Authenticate"] == "Bearer"

@pytest.mark.parametrize("token", ["garbage", "a.b.c"])
def test_me_rejects_malformed_token(client, token):
    assert client.get("/api/auth/me", headers=bearer(token)).json()["code"] == "invalid_token"

def test_me_rejects_expired_token(client):
    user_id = signup(client).json()["user"]["id"]
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    res = client.get("/api/auth/me", headers=bearer(_token(sub=str(user_id), iat=past, exp=past + timedelta(minutes=1))))
    assert res.status_code == 401
    assert res.json()["code"] == "token_expired"

@pytest.mark.parametrize("override", [
    {"secret": "another-secret-0123456789abcdef012345"},
    {"aud": "someone-else"},
    {"iss": "evil"},
    {"type": "refresh"},
    {"ver": 7},
    {"exp": None},
    {"sub": "999999"},
])
def test_me_rejects_tampered_or_incomplete_tokens(client, override):
    user_id = signup(client).json()["user"]["id"]
    override = {"sub": str(user_id), **override}
    res = client.get("/api/auth/me", headers=bearer(_token(**override)))
    assert res.status_code == 401

def test_me_rejects_unsigned_token(client):
    user_id = signup(client).json()["user"]["id"]
    unsigned = jwt.encode({"sub": str(user_id), "type": "access"}, None, algorithm="none")
    assert client.get("/api/auth/me", headers=bearer(unsigned)).status_code == 401

def test_protected_endpoints(client):
    for path in ["/api/auth/me", "/api/dashboard", "/api/profile", "/api/study/sessions"]:
        assert client.get(path).status_code == 401, path
    token = signup(client).json()["access_token"]
    for path in ["/api/auth/me", "/api/dashboard", "/api/profile", "/api/study/sessions"]:
        assert client.get(path, headers=bearer(token)).status_code == 200, path

# ---------- refresh / logout ----------

def test_refresh_rotates_tokens(client):
    first = signup(client).json()
    res = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert res.status_code == 200
    second = res.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert client.get("/api/auth/me", headers=bearer(second["access_token"])).status_code == 200

def test_refresh_token_replay_revokes_session_family(client):
    first = signup(client).json()
    second = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]}).json()
    replay = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert replay.status_code == 401
    # The legitimately rotated token is now dead as well.
    assert client.post("/api/auth/refresh", json={"refresh_token": second["refresh_token"]}).status_code == 401

def test_refresh_rejects_unknown_and_expired_tokens(client, db):
    assert client.post("/api/auth/refresh", json={"refresh_token": "x" * 40}).status_code == 401
    tokens = signup(client).json()
    row = db.scalar(select(RefreshToken))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    res = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 401
    assert res.json()["code"] == "refresh_token_expired"

def test_refresh_tokens_are_stored_hashed(client, db):
    raw = signup(client).json()["refresh_token"]
    stored = db.scalars(select(RefreshToken.token_hash)).all()
    assert raw not in stored and len(stored) == 1 and len(stored[0]) == 64

def test_logout_revokes_refresh_token(client):
    tokens = signup(client).json()
    assert client.post("/api/auth/logout", json={"refresh_token": tokens["refresh_token"]}).status_code == 204
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    # Idempotent, and tolerant of a missing token (client may have lost it).
    assert client.post("/api/auth/logout", json={"refresh_token": tokens["refresh_token"]}).status_code == 204
    assert client.post("/api/auth/logout", json={}).status_code == 204

def test_logout_only_ends_that_device_session(client):
    register(client)
    phone = login(client).json()
    tablet = login(client).json()
    client.post("/api/auth/logout", json={"refresh_token": phone["refresh_token"]})
    assert client.post("/api/auth/refresh", json={"refresh_token": tablet["refresh_token"]}).status_code == 200

# ---------- password recovery ----------

@pytest.fixture()
def outbox(monkeypatch):
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(settings, "email_backend", "console")
    monkeypatch.setattr("app.auth.send_password_reset_email", lambda to, token: sent.append((to, token)))
    return sent

def test_forgot_password_reports_unconfigured_email_honestly(client):
    register(client)
    for email in ["aqua@example.com", "nobody@example.com"]:
        res = client.post("/api/auth/password/forgot", json={"email": email})
        assert res.status_code == 503
        assert res.json()["code"] == "email_not_configured"

def test_forgot_password_does_not_enumerate_accounts(client, outbox):
    register(client)
    known = client.post("/api/auth/password/forgot", json={"email": "aqua@example.com"})
    unknown = client.post("/api/auth/password/forgot", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert [to for to, _ in outbox] == ["aqua@example.com"]

def test_password_reset_flow(client, outbox):
    old = signup(client).json()
    client.post("/api/auth/password/forgot", json={"email": "aqua@example.com"})
    token = outbox[-1][1]
    res = client.post("/api/auth/password/reset", json={"token": token, "new_password": "NewSparkle456"})
    assert res.status_code == 200
    assert login(client).status_code == 401
    assert login(client, password="NewSparkle456").status_code == 200
    # Existing sessions are ended everywhere.
    assert client.get("/api/auth/me", headers=bearer(old["access_token"])).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": old["refresh_token"]}).status_code == 401
    # Single use.
    again = client.post("/api/auth/password/reset", json={"token": token, "new_password": "Another789x"})
    assert again.status_code == 400 and again.json()["code"] == "invalid_reset_token"

def test_newer_reset_request_invalidates_older_token(client, outbox):
    register(client)
    client.post("/api/auth/password/forgot", json={"email": "aqua@example.com"})
    client.post("/api/auth/password/forgot", json={"email": "aqua@example.com"})
    (_, older), (_, newer) = outbox
    assert client.post("/api/auth/password/reset", json={"token": older, "new_password": "NewSparkle456"}).status_code == 400
    assert client.post("/api/auth/password/reset", json={"token": newer, "new_password": "NewSparkle456"}).status_code == 200

def test_password_reset_rejects_bad_token_and_weak_password(client, outbox):
    register(client)
    assert client.post("/api/auth/password/reset", json={"token": "y" * 40, "new_password": "NewSparkle456"}).status_code == 400
    client.post("/api/auth/password/forgot", json={"email": "aqua@example.com"})
    assert client.post("/api/auth/password/reset", json={"token": outbox[-1][1], "new_password": "weak"}).status_code == 422

# ---------- hardening ----------

def test_login_rate_limit(client, monkeypatch):
    register(client)
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_login", "3/60")
    codes = [login(client, password="Wrong12345").status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]
    blocked = login(client)
    assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) >= 1

def test_auth_responses_are_not_cached(client):
    assert register(client).headers["Cache-Control"] == "no-store"

def test_env_example_is_loadable():
    from pathlib import Path
    example = Path(__file__).resolve().parents[1] / ".env.example"
    loaded = Settings(_env_file=str(example))
    assert loaded.email_backend == "disabled" and loaded.https_required is False

def test_production_settings_reject_insecure_values():
    base = {"_env_file": None, "environment": "production", "jwt_secret": "z" * 40}
    with pytest.raises(ValueError):
        Settings(**{**base, "jwt_secret": "dev-only-change-me"})
    with pytest.raises(ValueError):
        Settings(**{**base, "jwt_secret": "short"})
    with pytest.raises(ValueError):
        Settings(**{**base, "cors_origins": "*"})
    with pytest.raises(ValueError):
        Settings(**{**base, "email_backend": "console"})
    assert Settings(**base).https_required is True
