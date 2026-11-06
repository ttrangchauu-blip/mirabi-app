"""A refresh whose answer was lost: the app retries the same token, saying so, and keeps its session. Anything else that
presents a rotated token is still a replay."""
from datetime import timedelta

from sqlalchemy import select

from app import auth
from app.models import RefreshToken, User, utcnow
from app.security import hash_token
from conftest import bearer, signup

RETRY = {"Idempotency-Key": "lost-answer-retry"}


def refresh(client, token, headers=None):
    return client.post("/api/auth/refresh", json={"refresh_token": token}, headers=headers or {})


def age_rotation(db, token, by):
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(token)))
    row.revoked_at = row.revoked_at - by
    db.commit()


def test_retry_after_a_lost_answer_keeps_the_session(client):
    first = signup(client).json()
    assert refresh(client, first["refresh_token"]).status_code == 200  # this answer never reached the app
    retried = refresh(client, first["refresh_token"], RETRY)
    assert retried.status_code == 200
    session = retried.json()
    assert session["refresh_token"] != first["refresh_token"]
    assert client.get("/api/auth/me", headers=bearer(session["access_token"])).status_code == 200
    # The session goes on as usual from there.
    assert refresh(client, session["refresh_token"]).status_code == 200


def test_the_answer_lost_twice_is_still_the_same_retry(client):
    first = signup(client).json()
    assert refresh(client, first["refresh_token"]).status_code == 200
    assert refresh(client, first["refresh_token"], RETRY).status_code == 200
    third = refresh(client, first["refresh_token"], RETRY)
    assert third.status_code == 200
    assert refresh(client, third.json()["refresh_token"]).status_code == 200


def test_the_lost_token_cannot_be_used_after_the_retry(client):
    first = signup(client).json()
    lost = refresh(client, first["refresh_token"]).json()
    retried = refresh(client, first["refresh_token"], RETRY).json()
    # Someone else held the answer after all: that is a replay, and it ends the session everywhere.
    assert refresh(client, lost["refresh_token"]).status_code == 401
    assert refresh(client, retried["refresh_token"]).status_code == 401


def test_replay_without_the_retry_header_revokes_the_family(client):
    first = signup(client).json()
    second = refresh(client, first["refresh_token"]).json()
    assert refresh(client, first["refresh_token"]).status_code == 401
    assert refresh(client, second["refresh_token"]).status_code == 401


def test_retry_after_the_window_is_a_replay(client, db):
    first = signup(client).json()
    second = refresh(client, first["refresh_token"]).json()
    age_rotation(db, first["refresh_token"], auth.REFRESH_RETRY_WINDOW + timedelta(seconds=1))
    assert refresh(client, first["refresh_token"], RETRY).status_code == 401
    assert refresh(client, second["refresh_token"]).status_code == 401


def test_retry_just_inside_the_window_is_allowed(client, db):
    first = signup(client).json()
    refresh(client, first["refresh_token"])
    age_rotation(db, first["refresh_token"], auth.REFRESH_RETRY_WINDOW - timedelta(seconds=5))
    assert refresh(client, first["refresh_token"], RETRY).status_code == 200


def test_retry_of_a_token_whose_successor_was_used_is_a_replay(client):
    first = signup(client).json()
    second = refresh(client, first["refresh_token"]).json()
    third = refresh(client, second["refresh_token"]).json()  # the app did get the answer: it has moved on
    assert refresh(client, first["refresh_token"], RETRY).status_code == 401
    assert refresh(client, third["refresh_token"]).status_code == 401


def test_retry_cannot_bring_back_a_session_that_logged_out(client):
    first = signup(client).json()
    second = refresh(client, first["refresh_token"]).json()
    assert client.post("/api/auth/logout", json={"refresh_token": second["refresh_token"]}).status_code == 204
    assert refresh(client, first["refresh_token"], RETRY).status_code == 401


def test_retry_cannot_bring_back_a_token_that_was_logged_out_itself(client):
    first = signup(client).json()
    assert client.post("/api/auth/logout", json={"refresh_token": first["refresh_token"]}).status_code == 204
    assert refresh(client, first["refresh_token"], RETRY).status_code == 401


def test_retry_is_refused_for_a_disabled_account(client, db):
    first = signup(client).json()
    second = refresh(client, first["refresh_token"]).json()
    user = db.scalar(select(User).where(User.email == first["user"]["email"]))
    user.status = "disabled"
    db.commit()
    assert refresh(client, first["refresh_token"], RETRY).status_code == 401
    user.status = "active"
    db.commit()
    assert refresh(client, second["refresh_token"]).status_code == 401


def test_retry_of_an_expired_session_is_refused(client, db):
    first = signup(client).json()
    second = refresh(client, first["refresh_token"]).json()
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(second["refresh_token"])))
    row.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert refresh(client, first["refresh_token"], RETRY).status_code == 401
