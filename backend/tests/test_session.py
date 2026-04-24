import pytest
from datetime import datetime, timedelta, timezone
import session as session_store

def setup_function():
    session_store._sessions.clear()

def test_create_and_get_session():
    chunks = [{"text": "hello", "page": 1}]
    sid = session_store.create_session(chunks, "user-1")
    sess = session_store.get_session(sid, "user-1")
    assert sess.chunks == chunks
    assert sess.user_id == "user-1"

def test_get_session_wrong_user_raises_permission_error():
    chunks = [{"text": "hello", "page": 1}]
    sid = session_store.create_session(chunks, "user-1")
    with pytest.raises(PermissionError):
        session_store.get_session(sid, "user-2")

def test_get_session_not_found_raises_key_error():
    with pytest.raises(KeyError):
        session_store.get_session("nonexistent-uuid", "user-1")

def test_cleanup_removes_expired_sessions():
    chunks = [{"text": "hello", "page": 1}]
    sid = session_store.create_session(chunks, "user-1")
    session_store._sessions[sid].created_at = datetime.now(timezone.utc) - timedelta(hours=3)
    session_store.cleanup_expired()
    with pytest.raises(KeyError):
        session_store.get_session(sid, "user-1")

def test_cleanup_keeps_fresh_sessions():
    chunks = [{"text": "hello", "page": 1}]
    sid = session_store.create_session(chunks, "user-1")
    session_store.cleanup_expired()
    sess = session_store.get_session(sid, "user-1")
    assert sess is not None
