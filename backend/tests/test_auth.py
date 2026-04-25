import os
import pytest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend
import jwt as pyjwt
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

os.environ.setdefault("SUPABASE_URL", "https://test-project.supabase.co")

from auth import get_current_user

_PRIVATE_KEY = rsa.generate_private_key(
    public_exponent=65537, key_size=2048, backend=default_backend()
)
_PUBLIC_KEY = _PRIVATE_KEY.public_key()

def make_token(user_id: str, expired: bool = False):
    exp = datetime.now(timezone.utc) + (timedelta(seconds=-1) if expired else timedelta(hours=1))
    return pyjwt.encode({"sub": user_id, "exp": exp}, _PRIVATE_KEY, algorithm="RS256")

class _MockSigningKey:
    key = _PUBLIC_KEY

class _MockJWKSClient:
    def get_signing_key_from_jwt(self, token):
        try:
            pyjwt.get_unverified_header(token)
        except pyjwt.exceptions.DecodeError:
            raise pyjwt.exceptions.InvalidTokenError("bad token")
        return _MockSigningKey()

@pytest.fixture(autouse=True)
def _patch_jwks():
    with patch("auth.get_jwks_client", return_value=_MockJWKSClient()):
        yield

def test_valid_token_extracts_user_id():
    token = make_token("user-abc")
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    assert get_current_user(creds) == "user-abc"

def test_invalid_token_raises_401():
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad.token.here")
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds)
    assert exc.value.status_code == 401

def test_expired_token_raises_401():
    token = make_token("user-abc", expired=True)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds)
    assert exc.value.status_code == 401
