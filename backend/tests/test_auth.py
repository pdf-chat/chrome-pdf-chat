import os
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from jose import jwt

os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret-key-must-be-32-chars!!")

from main import app
from auth import get_current_user

SECRET = "test-secret-key-must-be-32-chars!!"

def make_token(user_id: str, expired: bool = False):
    exp = datetime.utcnow() + (timedelta(seconds=-1) if expired else timedelta(hours=1))
    return jwt.encode({"sub": user_id, "exp": exp}, SECRET, algorithm="HS256")

def test_valid_token_extracts_user_id():
    from auth import get_current_user
    from fastapi.security import HTTPAuthorizationCredentials
    token = make_token("user-abc")
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    user_id = get_current_user(creds)
    assert user_id == "user-abc"

def test_invalid_token_raises_401():
    from fastapi import HTTPException
    from fastapi.security import HTTPAuthorizationCredentials
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad.token.here")
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds)
    assert exc.value.status_code == 401

def test_expired_token_raises_401():
    from fastapi import HTTPException
    from fastapi.security import HTTPAuthorizationCredentials
    token = make_token("user-abc", expired=True)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds)
    assert exc.value.status_code == 401
