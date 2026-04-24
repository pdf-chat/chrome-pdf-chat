import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import session as session_store
from routes.session_routes import router as session_router
from routes.auth_routes import router as auth_router

load_dotenv()

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session_router)
app.include_router(auth_router)

@app.get("/health")
def health():
    return {"status": "ok"}
