import asyncio

import pytest
from sqlalchemy import select

from ai_engine.engine import run_text_feature
from app.models import AIConversation, AIMessage, AIRun, AIUsageLog
from conftest import bearer, signup


def test_memories_are_scoped_to_authenticated_user(client):
    first = signup(client, email="first@example.com").json()["access_token"]
    second = signup(client, email="second@example.com").json()["access_token"]
    created = client.post("/api/ai/memories", headers=bearer(first),
                          json={"content": "Prefers short study sessions"})
    assert created.status_code == 201
    memory_id = created.json()["id"]

    assert len(client.get("/api/ai/memories", headers=bearer(first)).json()) == 1
    assert client.get("/api/ai/memories", headers=bearer(second)).json() == []
    assert client.delete(f"/api/ai/memories/{memory_id}", headers=bearer(second)).status_code == 204
    assert len(client.get("/api/ai/memories", headers=bearer(first)).json()) == 1


def test_ai_service_persists_successful_messages_and_usage(client, db, monkeypatch):
    from app.config import settings
    from ai_engine import engine as ai_service

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    async def fake_provider(model, prompt, parameters, max_output_tokens):
        return "A supportive reply", 12, 8

    monkeypatch.setitem(ai_service.PROVIDERS, "openai", fake_provider)
    result = asyncio.run(run_text_feature(db, user_id=1, feature_key="test-feature",
                                         user_input="Hello", system_prompt="Be kind"))
    db.expire_all()
    run = db.get(AIRun, result.run_id)
    conversation = db.get(AIConversation, run.conversation_id)
    assert conversation.user_id == 1
    assert [m.role for m in db.scalars(select(AIMessage).where(
        AIMessage.conversation_id == conversation.id).order_by(AIMessage.id))] == ["user", "assistant"]
    usage = db.scalar(select(AIUsageLog).where(AIUsageLog.run_id == run.id))
    assert run.status == "succeeded" and usage.outcome == "success"
    assert (usage.prompt_tokens, usage.completion_tokens) == (12, 8)


def test_ai_service_records_provider_failure_without_content_in_usage(client, db, monkeypatch):
    from app.config import settings
    from ai_engine import engine as ai_service

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "ai_max_retries", 0)

    async def failed_provider(model, prompt, parameters, max_output_tokens):
        raise OSError("private provider detail")

    monkeypatch.setitem(ai_service.PROVIDERS, "openai", failed_provider)
    with pytest.raises(OSError):
        asyncio.run(run_text_feature(db, user_id=1, feature_key="failing-feature",
                                     user_input="private prompt", system_prompt="Be kind"))
    db.expire_all()
    run = db.scalar(select(AIRun).where(AIRun.feature_key == "failing-feature"))
    usage = db.scalar(select(AIUsageLog).where(AIUsageLog.run_id == run.id))
    assert run.status == "failed" and run.error_code == "provider_error"
    assert usage.outcome == "error"


def test_admin_routes_require_admin_and_prompt_can_be_published_and_rolled_back(client):
    user_token = signup(client, email="ordinary@example.com").json()["access_token"]
    assert client.get("/api/admin/ai/overview", headers=bearer(user_token)).status_code == 403

    from app.db import SessionLocal
    from app.models import User
    with SessionLocal() as db:
        admin = db.query(User).filter_by(email="ordinary@example.com").one()
        admin.role = "admin"
        db.commit()
    admin_token = user_token  # admin checks the current DB role, not a stale JWT role claim
    initial = client.get("/api/admin/ai/overview", headers=bearer(admin_token))
    assert initial.status_code == 200
    draft = client.post("/api/admin/ai/agents/task_planner/prompts", headers=bearer(admin_token),
                        json={"system_prompt": "Make a short plan: {user_input}"})
    assert draft.status_code == 201
    prompt_id = draft.json()["id"]
    assert client.post(f"/api/admin/ai/prompts/{prompt_id}/publish", headers=bearer(admin_token)).status_code == 200
    versions = client.get("/api/admin/ai/agents/task_planner/prompts", headers=bearer(admin_token)).json()
    published = next(item for item in versions if item["id"] == prompt_id)
    previous = next(item for item in versions if item["id"] != prompt_id)
    assert published["status"] == "published" and previous["status"] == "archived"
    assert client.post(f"/api/admin/ai/prompts/{previous['id']}/publish", headers=bearer(admin_token)).status_code == 200


def test_tool_registry_executes_only_registered_handlers():
    from app.ai_tools import ToolRegistry
    registry = ToolRegistry()
    registry.register("sum", lambda left, right: left + right)
    assert registry.execute("sum", {"left": 2, "right": 3}) == 5
    with pytest.raises(ValueError, match="tool_not_registered"):
        registry.execute("delete_all_data", {})


def test_task_planner_api_runs_registered_module_without_business_mutations(client, ai_engine, monkeypatch):
    from ai_engine import engine as ai_service
    from app.config import settings
    from app.models import UserTask
    from app.db import SessionLocal

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    async def fake_provider(model, prompt, parameters, max_output_tokens):
        return "1. Read chapter 1\n2. Review notes", 20, 12

    monkeypatch.setitem(ai_service.PROVIDERS, "openai", fake_provider)
    token = signup(client, email="planner@example.com").json()["access_token"]
    before = client.get("/api/profile", headers=bearer(token)).json()
    response = client.post("/api/ai/task-planner", headers=bearer(token),
                           json={"request": "Help me study this week"})
    assert response.status_code == 200 and "Read chapter" in response.json()["suggestions"]
    after = client.get("/api/profile", headers=bearer(token)).json()
    with SessionLocal() as db:
        assert db.query(UserTask).filter_by(user_id=before["id"]).count() == 0
    assert after["xp"] == before["xp"] and after["level"] == before["level"]


def test_admin_can_test_prompt_draft_and_run_records_draft_version(client, ai_engine, monkeypatch):
    from ai_engine import engine as ai_service
    from app.config import settings
    from app.db import SessionLocal
    from app.models import AIRun, User

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setitem(ai_service.PROVIDERS, "openai", lambda model, prompt, parameters, tokens: _reply(prompt))
    token = signup(client, email="prompt-admin@example.com").json()["access_token"]
    with SessionLocal() as db:
        db.query(User).filter_by(email="prompt-admin@example.com").one().role = "admin"
        db.commit()
    headers = bearer(token)
    draft = client.post("/api/admin/ai/agents/task_planner/prompts", headers=headers,
                        json={"system_prompt": "Plan this: {user_input}"}).json()
    tested = client.post(f"/api/admin/ai/prompts/{draft['id']}/test", headers=headers,
                         json={"user_input": "study"})
    assert tested.status_code == 200
    with SessionLocal() as db:
        run = db.get(AIRun, tested.json()["run_id"])
        assert run.prompt_version == f"draft:{draft['version']}"


async def _reply(prompt):
    return "A realistic draft response", 4, 5
