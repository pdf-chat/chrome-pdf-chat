from slowapi import Limiter
from fastapi import Request


def _get_user_id(request: Request) -> str:
    # user_id is set on request.state by get_current_user dependency
    return getattr(request.state, "user_id", request.client.host if request.client else "unknown")


limiter = Limiter(key_func=_get_user_id)
