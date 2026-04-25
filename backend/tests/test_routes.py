from unittest.mock import patch

def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

def test_upload_returns_session_id(client):
    resp = client.post("/session/upload", json={
        "pages": [{"page": 1, "text": "Revenue grew 23% in Q3."}]
    })
    assert resp.status_code == 200
    assert "session_id" in resp.json()

def test_upload_empty_text_returns_422(client):
    resp = client.post("/session/upload", json={
        "pages": [{"page": 1, "text": "   "}]
    })
    assert resp.status_code == 422

def test_query_returns_answer_and_pages(client):
    upload_resp = client.post("/session/upload", json={
        "pages": [{"page": 4, "text": "Revenue grew 23% in Q3 driven by enterprise sales."}]
    })
    session_id = upload_resp.json()["session_id"]

    with patch("routes.session_routes.llm.ask") as mock_ask:
        mock_ask.return_value = {
            "answer": "Revenue grew 23%.",
            "citations": [{"page": 4, "quote": "Revenue grew 23%"}],
        }
        resp = client.post("/session/query", json={
            "session_id": session_id,
            "question": "What was revenue growth?",
            "model": "gpt-4o",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["answer"] == "Revenue grew 23%."
    assert data["citations"] == [{"page": 4, "quote": "Revenue grew 23%"}]

def test_query_unknown_session_returns_404(client):
    resp = client.post("/session/query", json={
        "session_id": "00000000-0000-0000-0000-000000000000",
        "question": "test",
        "model": "gpt-4o",
    })
    assert resp.status_code == 404

def test_query_other_users_session_returns_403(client):
    from main import app
    from auth import get_current_user

    app.dependency_overrides[get_current_user] = lambda: "user-A"
    upload_resp = client.post("/session/upload", json={
        "pages": [{"page": 1, "text": "Some content here for testing access control."}]
    })
    session_id = upload_resp.json()["session_id"]

    app.dependency_overrides[get_current_user] = lambda: "user-B"
    resp = client.post("/session/query", json={
        "session_id": session_id,
        "question": "test",
        "model": "gpt-4o",
    })
    assert resp.status_code == 403

    app.dependency_overrides[get_current_user] = lambda: "user-123"
