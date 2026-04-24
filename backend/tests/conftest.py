import os
import pytest

os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret-key-must-be-32-chars!!")

from fastapi.testclient import TestClient
from main import app
from auth import get_current_user

@pytest.fixture(autouse=True)
def clear_sessions():
    import session as session_store
    session_store._sessions.clear()
    yield
    session_store._sessions.clear()

@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: "user-123"
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
