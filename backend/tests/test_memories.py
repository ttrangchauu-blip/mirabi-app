import pytest

from app.models import Memory, PetEvolution, User


@pytest.fixture()
def me(client):
    email = "album-owner@example.com"
    assert client.post("/api/auth/register", json={"email": email, "password": "Sparkle123"}).status_code == 201
    login = client.post("/api/auth/login", json={"email": email, "password": "Sparkle123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def payload(key="manual-memory-0001"):
    return {"title": "Ngày đầu bên nhau", "message": "Một ngày rất vui", "client_request_id": key,
            "snapshot": {"pet_name": "Mây", "pet_id": "fox", "level": 2, "element": "Lửa",
                         "accessory": None, "background": "home"}}


def test_manual_memory_is_idempotent_private_and_editable(client, me, db):
    first = client.post("/api/memories", headers=me, json=payload())
    assert first.status_code == 201
    second = client.post("/api/memories", headers=me, json=payload())
    assert second.status_code == 201 and second.json()["id"] == first.json()["id"]
    assert db.query(Memory).filter(Memory.source_key == "manual:manual-memory-0001").count() == 1

    other = client.post("/api/auth/register", json={"email": "album-other@example.com", "password": "Sparkle123"})
    assert other.status_code == 201
    login = client.post("/api/auth/login", json={"email": "album-other@example.com", "password": "Sparkle123"}).json()
    other_headers = {"Authorization": f"Bearer {login['access_token']}"}
    assert client.get(f"/api/memories/{first.json()['id']}", headers=other_headers).status_code == 404

    changed = client.patch(f"/api/memories/{first.json()['id']}", headers=me,
                           json={"title": "Tên mới", "message": "Lời nhắn mới", "favorite": True})
    assert changed.status_code == 200
    assert changed.json()["favorite"] is True and changed.json()["snapshot"]["pet_name"] == "Mây"


def test_deleted_automatic_memory_is_a_tombstone_and_does_not_return(client, me, db):
    created = client.post("/api/memories", headers=me, json=payload("manual-memory-delete"))
    memory_id = created.json()["id"]
    assert client.delete(f"/api/memories/{memory_id}", headers=me).status_code == 204
    assert client.get(f"/api/memories/{memory_id}", headers=me).status_code == 404
    row = db.get(Memory, memory_id)
    assert row.deleted_at is not None and row.image_svg == "" and row.thumbnail_svg == ""
    retry = client.post("/api/memories", headers=me, json=payload("manual-memory-delete"))
    assert retry.status_code == 409


def test_reconcile_is_idempotent_and_does_not_resurrect_deleted_milestone(client, me, db):
    user = db.query(User).filter(User.email == "album-owner@example.com").one()
    user.level = 2
    db.add(PetEvolution(user_id=user.id, pet_id=user.pet, total_xp=800, level=2))
    db.commit()

    first = client.get("/api/memories?category=pet", headers=me)
    assert first.status_code == 200
    automatic = [x for x in first.json()["items"] if x["event_type"] != "manual"]
    assert sorted(x["event_type"] for x in automatic) == ["pet_evolved", "pet_hatched"]

    second = client.get("/api/memories?category=pet", headers=me)
    assert len([x for x in second.json()["items"] if x["event_type"] != "manual"]) == 2

    hatched = next(x for x in automatic if x["event_type"] == "pet_hatched")
    assert client.delete(f"/api/memories/{hatched['id']}", headers=me).status_code == 204
    after_delete = client.get("/api/memories?category=pet", headers=me).json()["items"]
    assert all(x["id"] != hatched["id"] for x in after_delete)
    assert db.query(Memory).filter(Memory.user_id == user.id,
                                   Memory.source_key == f"hatch:{user.pet}:1").count() == 1


def test_album_uses_cursor_pagination_and_filters_favorites(client, me):
    ids = []
    for i in range(3):
        row = client.post("/api/memories", headers=me, json=payload(f"manual-page-{i:04d}")).json()
        ids.append(row["id"])
    client.patch(f"/api/memories/{ids[-1]}", headers=me, json={"favorite": True})
    page = client.get("/api/memories?limit=2", headers=me).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    next_page = client.get(f"/api/memories?limit=2&cursor={page['next_cursor']}", headers=me).json()
    assert not ({x["id"] for x in page["items"]} & {x["id"] for x in next_page["items"]})
    favorites = client.get("/api/memories?category=favorite", headers=me).json()["items"]
    assert [x["id"] for x in favorites] == [ids[-1]]
