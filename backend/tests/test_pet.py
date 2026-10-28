import pytest
from conftest import bearer, signup

@pytest.fixture()
def token(client):
    return signup(client).json()["access_token"]

def me(client, token):
    return client.get("/api/auth/me", headers=bearer(token)).json()

def test_new_user_has_no_pet_and_is_not_onboarded(client, token):
    user = me(client, token)
    assert user["pet_name"] is None and user["onboarded"] is False

def test_adopt_pet_sets_species_and_trimmed_name(client, token):
    res = client.put("/api/pet", json={"pet": "dolphin", "name": "  Bé Nami  "}, headers=bearer(token))
    assert res.status_code == 200
    assert res.json()["pet"] == "dolphin" and res.json()["pet_name"] == "Bé Nami"
    assert me(client, token)["pet_name"] == "Bé Nami"

@pytest.mark.parametrize("payload", [
    {"pet": "dragon", "name": "Rex"}, {"pet": "FOX", "name": "Rex"}, {"pet": "fox", "name": "   "},
    {"pet": "fox", "name": "x" * 31}, {"pet": "fox", "name": "a\nb"}, {"pet": "fox"}, {"name": "Rex"},
])
def test_adopt_pet_validation(client, token, payload):
    res = client.put("/api/pet", json=payload, headers=bearer(token))
    assert res.status_code == 422
    assert res.json()["code"] == "validation_error"

def test_adopt_pet_requires_auth(client):
    assert client.put("/api/pet", json={"pet": "fox", "name": "Aqua"}).status_code == 401

def test_onboarding_requires_a_pet_first(client, token):
    res = client.post("/api/onboarding/complete", headers=bearer(token))
    assert res.status_code == 409 and res.json()["code"] == "pet_not_adopted"

def test_onboarding_complete_is_idempotent(client, token):
    client.put("/api/pet", json={"pet": "cat", "name": "Mochi"}, headers=bearer(token))
    early = client.post("/api/onboarding/complete", headers=bearer(token))
    assert early.status_code == 409 and early.json()["code"] == "daily_tasks_not_selected"
    client.put("/api/onboarding/daily-tasks", json={"task_ids": ["learning"]}, headers=bearer(token))
    first = client.post("/api/onboarding/complete", headers=bearer(token))
    assert first.status_code == 200 and first.json()["onboarded"] is True
    assert client.post("/api/onboarding/complete", headers=bearer(token)).json()["onboarded"] is True
    assert me(client, token)["onboarded"] is True

def test_profile_rejects_whitespace_only_display_name(client, token):
    response = client.patch("/api/profile", json={"display_name": "   "}, headers=bearer(token))
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

def test_profile_can_change_pet(client, token):
    res = client.patch("/api/profile", json={"pet": "penguin", "pet_name": "Pip"}, headers=bearer(token))
    assert res.status_code == 200 and res.json()["pet"] == "penguin" and res.json()["pet_name"] == "Pip"
    assert client.patch("/api/profile", json={"pet": "dragon"}, headers=bearer(token)).status_code == 422

def test_web_build_may_send_put_cross_origin(client):
    # The Expo web build calls PUT /api/pet from another origin, so the CORS preflight must allow it.
    res = client.options("/api/pet", headers={"Origin": "http://localhost:8081", "Access-Control-Request-Method": "PUT",
                                              "Access-Control-Request-Headers": "authorization,content-type"})
    assert res.status_code == 200
    assert "PUT" in res.headers["access-control-allow-methods"]
