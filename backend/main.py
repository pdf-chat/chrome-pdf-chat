import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from limiter import limiter
from dotenv import load_dotenv
import session as session_store
from routes.session_routes import router as session_router
from routes.auth_routes import router as auth_router

load_dotenv()

# TODO: Set EXTENSION_ID in your .env to your Chrome extension's ID once published.
# Find it at chrome://extensions after loading the extension.
# Example: EXTENSION_ID=abcdefghijklmnopqrstuvwxyzabcdef
_extension_id = os.getenv("EXTENSION_ID", "")
ALLOWED_ORIGINS = [f"chrome-extension://{_extension_id}"] if _extension_id else []

@asynccontextmanager
async def lifespan(app: FastAPI):
    async def cleanup_task():
        while True:
            await asyncio.sleep(300)
            session_store.cleanup_expired()
    task = asyncio.create_task(cleanup_task())
    yield
    task.cancel()

app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(session_router)
app.include_router(auth_router)

@app.get("/health")
def health():
    return {"status": "ok"}
