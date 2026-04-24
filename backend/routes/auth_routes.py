from fastapi import APIRouter

router = APIRouter(prefix="/auth")

@router.get("/callback")
async def auth_callback():
    return {"status": "ok"}
