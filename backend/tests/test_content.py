from conftest import bearer, signup

def test_community_rejects_whitespace_only_posts(client):
    token = signup(client).json()["access_token"]
    response = client.post("/api/community/posts", json={"body": "   "}, headers=bearer(token))
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

def test_sample_content_is_vietnamese(client):
    assert client.get("/api/campus/courses").json()[0]["title"] == "Tư duy sáng tạo"
    assert client.get("/api/career/recommendations").json()[0]["title"] == "Nhà thiết kế UI/UX"

def test_career_quiz_matches_vietnamese_interests_case_insensitively(client):
    token = signup(client).json()["access_token"]
    res = client.post("/api/career/quiz", json={"interests": ["CON NGƯỜI"]}, headers=bearer(token))
    scores = {c["title"]: c["match"] for c in res.json()}
    assert scores["Nhà tâm lý học"] == 78 + 10  # boosted
    assert scores["Lập trình viên game"] == 85  # not in the chosen category
