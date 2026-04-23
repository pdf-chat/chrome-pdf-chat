from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict
import uuid

SESSION_TTL_HOURS = 2

@dataclass
class SessionData:
    chunks: list[dict]
    user_id: str
    created_at: datetime = field(default_factory=datetime.utcnow)

_sessions: Dict[str, SessionData] = {}

def create_session(chunks: list[dict], user_id: str) -> str:
    session_id = str(uuid.uuid4())
    _sessions[session_id] = SessionData(chunks=chunks, user_id=user_id)
    return session_id

def get_session(session_id: str, user_id: str) -> SessionData:
    session = _sessions.get(session_id)
    if session is None:
        raise KeyError(f"Session {session_id} not found")
    if session.user_id != user_id:
        raise PermissionError(f"Access denied to session {session_id}")
    return session

def cleanup_expired():
    cutoff = datetime.utcnow() - timedelta(hours=SESSION_TTL_HOURS)
    expired = [sid for sid, s in _sessions.items() if s.created_at < cutoff]
    for sid in expired:
        del _sessions[sid]
