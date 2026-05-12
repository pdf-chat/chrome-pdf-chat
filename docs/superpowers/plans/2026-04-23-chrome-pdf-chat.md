# Chrome PDF Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension + FastAPI backend that lets users ask questions about any PDF open in their browser, with page-cited answers grounded strictly to the PDF.

**Architecture:** Extension detects PDF tabs, extracts text via PDF.js client-side, uploads to FastAPI backend once per session. Backend uses BM25 retrieval to find relevant chunks and calls litellm (Gemini/GPT/Sonnet). Supabase Auth issues JWTs; FastAPI verifies them without calling Supabase directly.

**Tech Stack:** Python 3.11 / FastAPI / rank-bm25 / litellm / python-jose / uvicorn · Chrome MV3 / vanilla JS / PDF.js / supabase-js

---

## File Structure

```
chrome-pdf-chat/
├── backend/
│   ├── main.py                   # FastAPI app, CORS, lifespan cleanup task
│   ├── auth.py                   # JWT verification FastAPI dependency
│   ├── session.py                # SessionData, in-memory store, TTL cleanup
│   ├── chunker.py                # Split page text into ≤2000-char chunks
│   ├── retriever.py              # BM25 search over session chunks
│   ├── llm.py                    # litellm call + JSON response parsing
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── session_routes.py     # POST /session/upload, POST /session/query
│   │   └── auth_routes.py        # GET /auth/callback (OAuth redirect stub)
│   ├── requirements.txt
│   ├── .env.example
│   └── tests/
│       ├── conftest.py           # TestClient fixture, mock auth override
│       ├── test_chunker.py
│       ├── test_retriever.py
│       ├── test_session.py
│       ├── test_auth.py
│       └── test_routes.py
└── extension/
    ├── manifest.json
    ├── content_script.js         # PDF detect, PDF.js extract, shadow DOM panel + all panel logic
    ├── service_worker.js         # Auth relay, fetch proxy to backend
    ├── panel/
    │   ├── panel.html            # Shadow DOM structure (no JS)
    │   └── panel.css             # Panel styles
    ├── options/
    │   ├── options.html          # Login form + model selector
    │   └── options.js            # Supabase sign-in, chrome.storage.local save
    └── lib/
        ├── pdf.js                # PDF.js library (downloaded)
        ├── pdf.worker.js         # PDF.js worker (downloaded)
        └── supabase.js           # supabase-js UMD bundle (downloaded)
```

---

### Task 1: Project scaffold + git init

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/routes/__init__.py`
- Create: `backend/tests/__init__.py`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git and create directories**

```bash
cd C:/Users/ARCLP/Documents/Code/chrome-pdf-chat
git init
mkdir -p backend/routes backend/tests extension/panel extension/options extension/lib
```

- [ ] **Step 2: Write .gitignore**

Create `.gitignore`:
```
__pycache__/
*.py[cod]
.env
venv/
.venv/
*.egg-info/
.pytest_cache/
.superpowers/
extension/lib/pdf.js
extension/lib/pdf.worker.js
extension/lib/supabase.js
```

- [ ] **Step 3: Write requirements.txt**

Create `backend/requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
python-jose[cryptography]==3.3.0
litellm==1.50.0
rank-bm25==0.2.2
python-dotenv==1.0.0
pydantic==2.9.0
httpx==0.27.0
pytest==8.3.0
pytest-asyncio==0.24.0
```

- [ ] **Step 4: Write .env.example**

Create `backend/.env.example`:
```
SUPABASE_JWT_SECRET=your-supabase-jwt-secret-from-project-settings
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 5: Create empty route/test init files**

Create `backend/routes/__init__.py` — empty file.
Create `backend/tests/__init__.py` — empty file.

- [ ] **Step 6: Install dependencies**

```bash
cd backend
python -m venv venv
source venv/Scripts/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Expected: all packages install without errors.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: project scaffold with requirements and directory structure"
```

---

### Task 2: Chunker (TDD)

**Files:**
- Create: `backend/tests/test_chunker.py`
- Create: `backend/chunker.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_chunker.py`:
```python
from chunker import chunk_pages

def test_short_page_produces_single_chunk():
    pages = [{"page": 1, "text": "Short text."}]
    chunks = chunk_pages(pages)
    assert len(chunks) == 1
    assert chunks[0]["page"] == 1
    assert chunks[0]["text"] == "Short text."

def test_long_page_produces_multiple_chunks_same_page():
    long_text = "word " * 600  # ~3000 chars, exceeds 2000-char limit
    pages = [{"page": 3, "text": long_text}]
    chunks = chunk_pages(pages)
    assert len(chunks) > 1
    assert all(c["page"] == 3 for c in chunks)

def test_multiple_pages_retain_page_numbers():
    pages = [
        {"page": 1, "text": "Page one content."},
        {"page": 2, "text": "Page two content."},
    ]
    chunks = chunk_pages(pages)
    assert len(chunks) == 2
    assert chunks[0]["page"] == 1
    assert chunks[1]["page"] == 2

def test_empty_page_is_skipped():
    pages = [{"page": 1, "text": "   "}, {"page": 2, "text": "Hello world"}]
    chunks = chunk_pages(pages)
    assert len(chunks) == 1
    assert chunks[0]["page"] == 2

def test_overlap_keeps_chunks_within_page():
    long_text = "x " * 1200  # 2400 chars
    pages = [{"page": 5, "text": long_text}]
    chunks = chunk_pages(pages)
    assert all(c["page"] == 5 for c in chunks)
    assert all(len(c["text"]) <= 2000 for c in chunks)
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
cd backend
pytest tests/test_chunker.py -v
```
Expected: `ImportError: No module named 'chunker'`

- [ ] **Step 3: Implement chunker.py**

Create `backend/chunker.py`:
```python
CHUNK_SIZE = 2000   # ~500 tokens
CHUNK_OVERLAP = 200  # ~50 tokens

def chunk_pages(pages: list[dict]) -> list[dict]:
    chunks = []
    for page in pages:
        text = page["text"].strip()
        page_num = page["page"]
        if not text:
            continue
        if len(text) <= CHUNK_SIZE:
            chunks.append({"text": text, "page": page_num})
        else:
            start = 0
            while start < len(text):
                end = min(start + CHUNK_SIZE, len(text))
                chunks.append({"text": text[start:end], "page": page_num})
                start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks
```

- [ ] **Step 4: Run to confirm PASS**

```bash
pytest tests/test_chunker.py -v
```
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/chunker.py backend/tests/test_chunker.py
git commit -m "feat: chunker splits page text into overlapping chunks"
```

---

### Task 3: BM25 Retriever (TDD)

**Files:**
- Create: `backend/tests/test_retriever.py`
- Create: `backend/retriever.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_retriever.py`:
```python
from retriever import search

CHUNKS = [
    {"text": "The company revenue grew 23% in Q3 driven by enterprise sales.", "page": 4},
    {"text": "Employee headcount increased to 500 people this quarter.", "page": 7},
    {"text": "The CEO announced three new product launches for next year.", "page": 12},
]

def test_returns_relevant_chunk_for_revenue_query():
    results = search(CHUNKS, "What was the revenue growth?")
    assert len(results) > 0
    assert any("revenue" in c["text"] for c in results)

def test_top_k_limits_results():
    results = search(CHUNKS, "company", top_k=1)
    assert len(results) <= 1

def test_unmatched_query_returns_empty():
    results = search(CHUNKS, "xyzzy frobnicator quantum")
    assert results == []

def test_results_include_page_number():
    results = search(CHUNKS, "revenue")
    assert all("page" in c for c in results)
    assert all("text" in c for c in results)
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
pytest tests/test_retriever.py -v
```
Expected: `ImportError: No module named 'retriever'`

- [ ] **Step 3: Implement retriever.py**

Create `backend/retriever.py`:
```python
from rank_bm25 import BM25Okapi

def search(chunks: list[dict], query: str, top_k: int = 5) -> list[dict]:
    if not chunks:
        return []
    corpus = [c["text"].lower().split() for c in chunks]
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(query.lower().split())
    indexed = [(scores[i], chunks[i]) for i in range(len(chunks))]
    top = sorted(indexed, key=lambda x: x[0], reverse=True)[:top_k]
    return [chunk for score, chunk in top if score > 0]
```

- [ ] **Step 4: Run to confirm PASS**

```bash
pytest tests/test_retriever.py -v
```
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/retriever.py backend/tests/test_retriever.py
git commit -m "feat: BM25 retriever returns top-k relevant chunks"
```

---

### Task 4: Session memory (TDD)

**Files:**
- Create: `backend/tests/test_session.py`
- Create: `backend/session.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_session.py`:
```python
import pytest
from datetime import datetime, timedelta
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
    session_store._sessions[sid].created_at = datetime.utcnow() - timedelta(hours=3)
    session_store.cleanup_expired()
    with pytest.raises(KeyError):
        session_store.get_session(sid, "user-1")

def test_cleanup_keeps_fresh_sessions():
    chunks = [{"text": "hello", "page": 1}]
    sid = session_store.create_session(chunks, "user-1")
    session_store.cleanup_expired()
    sess = session_store.get_session(sid, "user-1")
    assert sess is not None
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
pytest tests/test_session.py -v
```
Expected: `ImportError: No module named 'session'`

- [ ] **Step 3: Implement session.py**

Create `backend/session.py`:
```python
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
```

- [ ] **Step 4: Run to confirm PASS**

```bash
pytest tests/test_session.py -v
```
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/session.py backend/tests/test_session.py
git commit -m "feat: in-memory session store with user binding and TTL cleanup"
```

---

### Task 5: Auth middleware (TDD)

**Files:**
- Create: `backend/auth.py`
- Create: `backend/tests/test_auth.py`
- Create: `backend/main.py` (minimal, needed for TestClient)

- [ ] **Step 1: Write minimal main.py for TestClient**

Create `backend/main.py`:
```python
from fastapi import FastAPI
from dotenv import load_dotenv
load_dotenv()

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 2: Write failing tests**

Create `backend/tests/test_auth.py`:
```python
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
```

- [ ] **Step 3: Run to confirm FAIL**

```bash
pytest tests/test_auth.py -v
```
Expected: `ImportError: No module named 'auth'`

- [ ] **Step 4: Implement auth.py**

Create `backend/auth.py`:
```python
import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

bearer_scheme = HTTPBearer()

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    token = credentials.credentials
    secret = os.environ["SUPABASE_JWT_SECRET"]
    try:
        payload = jwt.decode(
            token, secret, algorithms=["HS256"],
            options={"verify_aud": False},
        )
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
```

- [ ] **Step 5: Run to confirm PASS**

```bash
pytest tests/test_auth.py -v
```
Expected: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/auth.py backend/main.py backend/tests/test_auth.py
git commit -m "feat: JWT auth middleware verifies Supabase-issued tokens"
```

---

### Task 6: LLM integration (TDD)

**Files:**
- Create: `backend/llm.py`
- Create: `backend/tests/test_llm.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_llm.py`:
```python
from unittest.mock import patch, MagicMock
from llm import ask

CHUNKS = [
    {"text": "Revenue grew 23% in Q3 driven by enterprise sales.", "page": 4},
    {"text": "Headcount increased to 500 employees.", "page": 7},
]

def make_mock_response(content: str):
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp

def test_ask_returns_answer_and_pages():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response(
            '{"answer": "Revenue grew 23%.", "pages": [4]}'
        )
        result = ask("What was revenue growth?", CHUNKS, "gpt-4o")
    assert result["answer"] == "Revenue grew 23%."
    assert result["pages"] == [4]

def test_ask_handles_invalid_json_gracefully():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response("not valid json at all")
        result = ask("test question", CHUNKS, "gpt-4o")
    assert "answer" in result
    assert "pages" in result

def test_ask_passes_correct_model():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response('{"answer": "ok", "pages": []}')
        ask("test", CHUNKS, "gemini/gemini-1.5-pro")
    call_kwargs = mock_completion.call_args[1]
    assert call_kwargs["model"] == "gemini/gemini-1.5-pro"
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
pytest tests/test_llm.py -v
```
Expected: `ImportError: No module named 'llm'`

- [ ] **Step 3: Implement llm.py**

Create `backend/llm.py`:
```python
import json
import litellm

SYSTEM_PROMPT = """You are a PDF assistant. Answer the user's question using ONLY the context passages below.
Respond with valid JSON in this exact format:
{"answer": "your answer here", "pages": [1, 2, 3]}
If the answer is not in the context, respond with:
{"answer": "I couldn't find that in this document.", "pages": []}
Do not include any text outside the JSON object."""

def ask(question: str, chunks: list[dict], model: str) -> dict:
    context = "\n\n".join(f"[Page {c['page']}] {c['text']}" for c in chunks)
    response = litellm.completion(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ],
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content
    try:
        result = json.loads(raw)
        return {
            "answer": str(result.get("answer", "")),
            "pages": [int(p) for p in result.get("pages", [])],
        }
    except (json.JSONDecodeError, ValueError):
        return {"answer": raw, "pages": []}
```

- [ ] **Step 4: Run to confirm PASS**

```bash
pytest tests/test_llm.py -v
```
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/llm.py backend/tests/test_llm.py
git commit -m "feat: LLM integration with litellm and structured JSON output"
```

---

### Task 7: Session routes (TDD)

**Files:**
- Create: `backend/routes/session_routes.py`
- Create: `backend/routes/auth_routes.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_routes.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write conftest.py**

Create `backend/tests/conftest.py`:
```python
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
```

- [ ] **Step 2: Write session_routes.py**

Create `backend/routes/session_routes.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth import get_current_user
from chunker import chunk_pages
import session as session_store
import retriever
import llm

router = APIRouter(prefix="/session")

class UploadRequest(BaseModel):
    pages: list[dict]

class UploadResponse(BaseModel):
    session_id: str

class QueryRequest(BaseModel):
    session_id: str
    question: str
    model: str

class QueryResponse(BaseModel):
    answer: str
    pages: list[int]

@router.post("/upload", response_model=UploadResponse)
async def upload(req: UploadRequest, user_id: str = Depends(get_current_user)):
    chunks = chunk_pages(req.pages)
    if not chunks:
        raise HTTPException(status_code=422, detail="No text could be extracted from the provided pages")
    session_id = session_store.create_session(chunks, user_id)
    return UploadResponse(session_id=session_id)

@router.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest, user_id: str = Depends(get_current_user)):
    try:
        sess = session_store.get_session(req.session_id, user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied")
    top_chunks = retriever.search(sess.chunks, req.question)
    if not top_chunks:
        return QueryResponse(answer="I couldn't find that in this document.", pages=[])
    result = llm.ask(req.question, top_chunks, req.model)
    return QueryResponse(**result)
```

- [ ] **Step 3: Write auth_routes.py**

Create `backend/routes/auth_routes.py`:
```python
from fastapi import APIRouter

router = APIRouter(prefix="/auth")

@router.get("/callback")
async def auth_callback():
    return {"status": "ok"}
```

- [ ] **Step 4: Update main.py**

Replace `backend/main.py` with:
```python
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
```

- [ ] **Step 5: Write failing route tests**

Create `backend/tests/test_routes.py`:
```python
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
        mock_ask.return_value = {"answer": "Revenue grew 23%.", "pages": [4]}
        resp = client.post("/session/query", json={
            "session_id": session_id,
            "question": "What was revenue growth?",
            "model": "gpt-4o",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["answer"] == "Revenue grew 23%."
    assert data["pages"] == [4]

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
```

- [ ] **Step 6: Run all backend tests**

```bash
pytest tests/ -v
```
Expected: `all tests passed` (15+ tests)

- [ ] **Step 7: Smoke test the running server**

In one terminal:
```bash
cp .env.example .env
# Edit .env and fill in real values, or leave blank for smoke test
uvicorn main:app --reload
```

In another terminal:
```bash
curl http://localhost:8000/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat: session upload/query routes with auth, chunking, BM25, and LLM"
```

---

### Task 8: Extension scaffold

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/content_script.js` (stub)
- Create: `extension/service_worker.js` (stub)

- [ ] **Step 1: Download PDF.js**

Go to https://github.com/mozilla/pdf.js/releases and download the latest prebuilt zip (e.g. `pdfjs-4.x.x-dist.zip`). Extract and copy:
- `build/pdf.mjs` → `extension/lib/pdf.js`
- `build/pdf.worker.mjs` → `extension/lib/pdf.worker.js`

Or via curl (replace version as needed):
```bash
cd extension/lib
curl -L "https://github.com/mozilla/pdf.js/releases/download/v4.9.155/pdfjs-4.9.155-dist.zip" -o pdfjs.zip
unzip pdfjs.zip build/pdf.mjs build/pdf.worker.mjs
mv build/pdf.mjs pdf.js
mv build/pdf.worker.mjs pdf.worker.js
rm -rf build pdfjs.zip
```

- [ ] **Step 2: Download supabase-js UMD bundle**

```bash
cd extension/lib
curl -L "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js" -o supabase.js
```

- [ ] **Step 3: Write manifest.json**

Create `extension/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "PDF Chat",
  "version": "1.0.0",
  "description": "Ask questions about any PDF open in your browser",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["http://*/*", "https://*/*", "file:///*"],
  "background": {
    "service_worker": "service_worker.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["lib/pdf.js", "content_script.js"],
      "run_at": "document_idle"
    }
  ],
  "options_page": "options/options.html",
  "web_accessible_resources": [
    {
      "resources": ["lib/pdf.worker.js", "panel/panel.html", "panel/panel.css"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- [ ] **Step 4: Write stub scripts**

Create `extension/service_worker.js`:
```javascript
console.log('PDF Chat service worker loaded');
```

Create `extension/content_script.js`:
```javascript
console.log('PDF Chat content script loaded', document.contentType);
```

- [ ] **Step 5: Load extension in Chrome**

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" → select the `extension/` folder
4. Open any webpage
5. Open DevTools → Console — confirm: `PDF Chat content script loaded`
6. Open a PDF URL — confirm the same message with `application/pdf`

- [ ] **Step 6: Commit**

```bash
git add extension/manifest.json extension/content_script.js extension/service_worker.js
git commit -m "feat: Chrome extension scaffold with MV3 manifest"
```

---

### Task 9: Chat panel HTML + CSS

**Files:**
- Create: `extension/panel/panel.html`
- Create: `extension/panel/panel.css`

- [ ] **Step 1: Write panel.html**

Create `extension/panel/panel.html`:
```html
<div id="pdf-chat-panel">
  <div id="pdf-chat-header">
    <span id="pdf-chat-title">📄 PDF Chat</span>
    <button id="pdf-chat-toggle" title="Collapse">−</button>
  </div>
  <div id="pdf-chat-body">
    <div id="pdf-chat-status">Initializing...</div>
    <div id="pdf-chat-messages"></div>
    <div id="pdf-chat-input-row">
      <textarea id="pdf-chat-input" placeholder="Ask a question about this PDF..." disabled rows="2"></textarea>
      <button id="pdf-chat-send" disabled>Send</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Write panel.css**

Create `extension/panel/panel.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }

#pdf-chat-panel {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 340px;
  background: #1e1e2e;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  font-family: system-ui, sans-serif;
  font-size: 14px;
  color: #cdd6f4;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
}

#pdf-chat-panel.collapsed #pdf-chat-body { display: none; }

#pdf-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #181825;
  border-radius: 12px 12px 0 0;
  cursor: move;
  user-select: none;
  border-bottom: 1px solid #313244;
}

#pdf-chat-panel.collapsed #pdf-chat-header {
  border-radius: 12px;
}

#pdf-chat-title { font-weight: 600; color: #cba6f7; font-size: 13px; }

#pdf-chat-toggle {
  background: none; border: none; color: #a6adc8;
  cursor: pointer; font-size: 18px; line-height: 1; padding: 0 2px;
}
#pdf-chat-toggle:hover { color: #cdd6f4; }

#pdf-chat-body { display: flex; flex-direction: column; }

#pdf-chat-status {
  padding: 6px 16px;
  font-size: 11px;
  color: #a6adc8;
  background: #181825;
  border-bottom: 1px solid #313244;
}
#pdf-chat-status.error { color: #f38ba8; }
#pdf-chat-status.ready { color: #a6e3a1; }

#pdf-chat-messages {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 180px;
  max-height: 280px;
  overflow-y: auto;
}

.message {
  padding: 8px 12px;
  border-radius: 8px;
  line-height: 1.5;
  word-wrap: break-word;
  font-size: 13px;
}
.message.user { background: #313244; align-self: flex-end; max-width: 90%; }
.message.assistant { background: #181825; border: 1px solid #313244; align-self: flex-start; max-width: 95%; }
.message.loading { color: #585b70; font-style: italic; }

.page-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

.page-badge {
  background: #1e1e2e;
  border: 1px solid #cba6f7;
  color: #cba6f7;
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
  cursor: pointer;
}
.page-badge:hover { background: #313244; }

#pdf-chat-input-row {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #313244;
  align-items: flex-end;
}

#pdf-chat-input {
  flex: 1;
  background: #313244;
  border: 1px solid #45475a;
  border-radius: 8px;
  color: #cdd6f4;
  padding: 7px 10px;
  font-size: 13px;
  resize: none;
  font-family: inherit;
  line-height: 1.4;
}
#pdf-chat-input:focus { outline: none; border-color: #cba6f7; }
#pdf-chat-input:disabled { opacity: 0.4; }

#pdf-chat-send {
  background: #cba6f7;
  color: #1e1e2e;
  border: none;
  border-radius: 8px;
  padding: 7px 14px;
  font-weight: 700;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
#pdf-chat-send:hover:not(:disabled) { background: #b4befe; }
#pdf-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 3: Commit**

```bash
git add extension/panel/
git commit -m "feat: chat panel HTML and CSS with shadow DOM structure"
```

---

### Task 10: Content script — PDF extraction + panel injection

**Files:**
- Modify: `extension/content_script.js` (replace stub with full implementation)

- [ ] **Step 1: Replace content_script.js**

Create `extension/content_script.js`:
```javascript
(async function () {
  const isPdf =
    document.contentType === 'application/pdf' ||
    /\.pdf(\?|#|$)/i.test(location.href);
  if (!isPdf) return;
  if (document.getElementById('__pdf-chat-host')) return;

  const panel = await injectPanel();

  panel.setStatus('Extracting PDF text...');
  let pages;
  try {
    pages = await extractPdfText(location.href);
  } catch (err) {
    panel.setError('Could not read PDF: ' + err.message);
    return;
  }

  if (!pages.length) {
    panel.setError('This PDF couldn\'t be read — it may be encrypted or image-only.');
    return;
  }

  panel.setStatus('Uploading to server...');
  let sessionId;
  try {
    const result = await apiRequest('/session/upload', { pages });
    sessionId = result.session_id;
  } catch (err) {
    panel.setError('Upload failed: ' + err.message, true);
    return;
  }

  panel.setReady(sessionId);

  async function sendQuestion(question, sessionId) {
    const { model } = await chrome.storage.local.get('model');
    return apiRequest('/session/query', {
      session_id: sessionId,
      question,
      model: model || 'gpt-4o',
    });
  }

  panel.onSend(async (question) => {
    try {
      return await sendQuestion(question, sessionId);
    } catch (err) {
      throw new Error(err.message || 'Request failed');
    }
  });
})();

async function extractPdfText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();

  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.js');
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ').trim();
    if (text) pages.push({ page: i, text });
  }
  return pages;
}

function apiRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'API_REQUEST', endpoint, method: 'POST', body },
      (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response && response.__error) return reject(new Error(response.__error));
        resolve(response);
      }
    );
  });
}

async function injectPanel() {
  const host = document.createElement('div');
  host.id = '__pdf-chat-host';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const [htmlText, cssText] = await Promise.all([
    fetch(chrome.runtime.getURL('panel/panel.html')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('panel/panel.css')).then((r) => r.text()),
  ]);

  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = htmlText;
  shadow.appendChild(wrapper);

  const panelEl = shadow.getElementById('pdf-chat-panel');
  const statusEl = shadow.getElementById('pdf-chat-status');
  const messagesEl = shadow.getElementById('pdf-chat-messages');
  const inputEl = shadow.getElementById('pdf-chat-input');
  const sendBtn = shadow.getElementById('pdf-chat-send');
  const toggleBtn = shadow.getElementById('pdf-chat-toggle');

  let sendHandler = null;

  // Collapse/expand
  toggleBtn.addEventListener('click', () => {
    const collapsed = panelEl.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '+' : '−';
  });

  // Draggable
  let dragging = false, sx, sy, sr, sb;
  shadow.getElementById('pdf-chat-header').addEventListener('mousedown', (e) => {
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const r = panelEl.getBoundingClientRect();
    sr = window.innerWidth - r.right;
    sb = window.innerHeight - r.bottom;
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panelEl.style.right = Math.max(0, sr - (e.clientX - sx)) + 'px';
    panelEl.style.bottom = Math.max(0, sb - (e.clientY - sy)) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  async function doSend() {
    if (!sendHandler) return;
    const question = inputEl.value.trim();
    if (!question) return;
    inputEl.value = '';
    appendMessage('user', question);
    sendBtn.disabled = true;
    inputEl.disabled = true;
    const loadingEl = appendMessage('assistant', 'Thinking...', 'loading');
    try {
      const result = await sendHandler(question);
      loadingEl.remove();
      appendMessage('assistant', result.answer, null, result.pages);
    } catch (err) {
      loadingEl.remove();
      appendMessage('assistant', '⚠ ' + err.message);
    } finally {
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', doSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  function appendMessage(role, text, cls, pages) {
    const msg = document.createElement('div');
    msg.className = 'message ' + role + (cls ? ' ' + cls : '');
    msg.textContent = text;
    if (pages && pages.length) {
      const badges = document.createElement('div');
      badges.className = 'page-badges';
      pages.forEach((p) => {
        const badge = document.createElement('span');
        badge.className = 'page-badge';
        badge.textContent = 'p.' + p;
        badge.addEventListener('click', () => scrollToPage(p));
        badges.appendChild(badge);
      });
      msg.appendChild(badges);
    }
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  return {
    setStatus(msg, cls) {
      statusEl.textContent = msg;
      statusEl.className = cls || '';
    },
    setError(msg, showRetry) {
      statusEl.textContent = '⚠ ' + msg;
      statusEl.className = 'error';
    },
    setReady(sid) {
      statusEl.textContent = '✓ Ready — ask a question';
      statusEl.className = 'ready';
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    },
    onSend(fn) { sendHandler = fn; },
  };
}

function scrollToPage(pageNum) {
  try {
    if (window.PDFViewerApplication) window.PDFViewerApplication.page = pageNum;
  } catch (_) {}
}
```

- [ ] **Step 2: Test manually**

1. Open a PDF URL in Chrome (e.g. `https://www.w3.org/WAI/WCAG21/wcag21.pdf`)
2. The floating panel should appear in the bottom-right corner
3. It should show "Extracting PDF text..." then "Uploading to server..." (will fail until backend is running — that's expected)
4. Confirm no console errors related to PDF.js or shadow DOM

- [ ] **Step 3: Commit**

```bash
git add extension/content_script.js
git commit -m "feat: content script extracts PDF text and injects shadow DOM chat panel"
```

---

### Task 11: Service worker — auth relay

**Files:**
- Modify: `extension/service_worker.js`

- [ ] **Step 1: Write service_worker.js**

Create `extension/service_worker.js`:
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'API_REQUEST') return;
  handleApiRequest(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ __error: err.message }));
  return true; // keep channel open for async response
});

async function handleApiRequest({ endpoint, method = 'POST', body }) {
  const storage = await chrome.storage.local.get([
    'access_token', 'refresh_token', 'backend_url', 'supabase_url',
  ]);
  const backendUrl = (storage.backend_url || 'http://localhost:8000').replace(/\/$/, '');
  let token = storage.access_token;

  let resp = await fetchWithAuth(backendUrl + endpoint, method, body, token);

  if (resp.status === 401 && storage.refresh_token && storage.supabase_url) {
    const newToken = await refreshToken(storage.supabase_url, storage.refresh_token);
    if (newToken) {
      token = newToken;
      resp = await fetchWithAuth(backendUrl + endpoint, method, body, token);
    } else {
      throw new Error('Session expired. Please log in again in extension settings.');
    }
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Server error ${resp.status}`);
  }
  return resp.json();
}

async function fetchWithAuth(url, method, body, token) {
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function refreshToken(supabaseUrl, refreshToken) {
  try {
    const resp = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    await chrome.storage.local.set({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    return data.access_token;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Test manually**

1. Reload the extension in `chrome://extensions`
2. Open a PDF
3. In DevTools → Application → Service Workers — confirm the SW is active
4. Panel should now attempt to contact backend (will get a network error if backend is offline — confirm the error message shows in the panel status, not a crash)

- [ ] **Step 3: Commit**

```bash
git add extension/service_worker.js
git commit -m "feat: service worker proxies API requests with JWT auth and token refresh"
```

---

### Task 12: Options page — Supabase login + model selector

**Files:**
- Create: `extension/options/options.html`
- Create: `extension/options/options.js`

- [ ] **Step 1: Write options.html**

Create `extension/options/options.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PDF Chat Settings</title>
  <style>
    body { font-family: system-ui,sans-serif; max-width: 420px; margin: 40px auto; padding: 0 20px; background: #1e1e2e; color: #cdd6f4; }
    h1 { color: #cba6f7; font-size: 20px; margin-bottom: 24px; }
    h2 { color: #a6adc8; font-size: 14px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
    .section { margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid #313244; }
    .field { margin-bottom: 12px; }
    label { display: block; font-size: 12px; color: #a6adc8; margin-bottom: 5px; }
    input, select { width: 100%; padding: 8px 12px; background: #313244; border: 1px solid #45475a; border-radius: 8px; color: #cdd6f4; font-size: 14px; }
    input:focus, select:focus { outline: none; border-color: #cba6f7; }
    button { width: 100%; padding: 10px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; margin-top: 6px; font-size: 14px; }
    .btn-primary { background: #cba6f7; color: #1e1e2e; }
    .btn-primary:hover { background: #b4befe; }
    .btn-danger { background: #f38ba8; color: #1e1e2e; }
    .btn-danger:hover { background: #eba0ac; }
    #status { margin-top: 10px; font-size: 13px; min-height: 20px; }
    .ok { color: #a6e3a1; }
    .err { color: #f38ba8; }
  </style>
</head>
<body>
  <h1>PDF Chat Settings</h1>

  <div class="section">
    <h2>Supabase Auth</h2>
    <div class="field"><label>Supabase Project URL</label>
      <input id="supabase-url" type="url" placeholder="https://xxxx.supabase.co"></div>
    <div class="field"><label>Supabase Anon Key</label>
      <input id="supabase-anon-key" type="text" placeholder="eyJ..."></div>
    <div class="field"><label>Email</label>
      <input id="email" type="email" placeholder="you@example.com"></div>
    <div class="field"><label>Password</label>
      <input id="password" type="password"></div>
    <button class="btn-primary" id="login-btn">Sign In</button>
    <button class="btn-danger" id="logout-btn">Sign Out</button>
    <div id="status"></div>
  </div>

  <div class="section">
    <h2>Backend</h2>
    <div class="field"><label>Backend URL</label>
      <input id="backend-url" type="url" placeholder="http://localhost:8000"></div>
  </div>

  <div class="section">
    <h2>Model</h2>
    <div class="field"><label>LLM Model</label>
      <select id="model">
        <option value="gpt-4o">GPT-4o (OpenAI)</option>
        <option value="gemini/gemini-1.5-pro">Gemini 1.5 Pro (Google)</option>
        <option value="claude-sonnet-4-6">Claude Sonnet (Anthropic)</option>
      </select>
    </div>
  </div>

  <button class="btn-primary" id="save-btn">Save Settings</button>

  <script src="../lib/supabase.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write options.js**

Create `extension/options/options.js`:
```javascript
const statusEl = document.getElementById('status');

function showStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'err' : 'ok';
}

// Restore saved values
chrome.storage.local.get(
  ['supabase_url', 'supabase_anon_key', 'backend_url', 'model', 'access_token']
).then((data) => {
  if (data.supabase_url) document.getElementById('supabase-url').value = data.supabase_url;
  if (data.supabase_anon_key) document.getElementById('supabase-anon-key').value = data.supabase_anon_key;
  if (data.backend_url) document.getElementById('backend-url').value = data.backend_url;
  if (data.model) document.getElementById('model').value = data.model;
  if (data.access_token) showStatus('✓ Currently signed in');
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const supabaseUrl = document.getElementById('supabase-url').value.trim();
  const anonKey = document.getElementById('supabase-anon-key').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!supabaseUrl || !anonKey) {
    showStatus('Enter Supabase URL and Anon Key first.', true);
    return;
  }
  showStatus('Signing in...');

  try {
    await chrome.storage.local.set({ supabase_url: supabaseUrl, supabase_anon_key: anonKey });
    const { createClient } = supabase;
    const client = createClient(supabaseUrl, anonKey);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await chrome.storage.local.set({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    showStatus('✓ Signed in as ' + data.user.email);
  } catch (err) {
    showStatus('Error: ' + err.message, true);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['access_token', 'refresh_token']);
  showStatus('Signed out.');
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const model = document.getElementById('model').value;
  const backendUrl = document.getElementById('backend-url').value.trim() || 'http://localhost:8000';
  await chrome.storage.local.set({ model, backend_url: backendUrl });
  showStatus('✓ Settings saved.');
});
```

- [ ] **Step 3: Test manually**

1. Reload extension, right-click extension icon → "Options"
2. Enter your Supabase project URL and anon key (from Supabase project settings → API)
3. Enter email/password for a user registered in Supabase
4. Click Sign In — confirm "✓ Signed in as you@example.com"
5. Select a model and click Save Settings

- [ ] **Step 4: Commit**

```bash
git add extension/options/
git commit -m "feat: options page with Supabase login and model/backend configuration"
```

---

### Task 13: End-to-end test

**Files:** No new files — verification only.

- [ ] **Step 1: Start the backend**

```bash
cd backend
source venv/Scripts/activate
cp .env.example .env
# Fill in SUPABASE_JWT_SECRET from: Supabase Dashboard → Project Settings → API → JWT Secret
# Fill in at least one LLM API key (e.g. OPENAI_API_KEY)
uvicorn main:app --reload
```

- [ ] **Step 2: Configure the extension**

1. Open extension Options
2. Set Backend URL to `http://localhost:8000`
3. Set Supabase URL + Anon Key, sign in
4. Select model (e.g. GPT-4o), save

- [ ] **Step 3: Test with a public PDF**

1. Open: `https://www.w3.org/WAI/WCAG21/wcag21.pdf`
2. Panel appears → shows "Extracting PDF text..." → "Uploading to server..." → "✓ Ready"
3. Ask: "What is the purpose of this document?"
4. Answer appears with page badge (e.g. `p.1`)
5. Click page badge — PDF viewer jumps to that page

- [ ] **Step 4: Test with a local PDF**

1. In `chrome://extensions` → PDF Chat → Details → enable "Allow access to file URLs"
2. Open a local PDF: drag any `.pdf` file onto a Chrome tab
3. Panel appears and works as above

- [ ] **Step 5: Test error states**

Open an image-only/encrypted PDF (e.g. a scanned document with no text layer).
Expected panel status: "⚠ This PDF couldn't be read — it may be encrypted or image-only."

- [ ] **Step 6: Run full backend test suite**

```bash
cd backend
pytest tests/ -v
```
Expected: all tests pass.

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "feat: complete Chrome PDF Chat extension and backend"
```

---

## Verification Checklist

- [ ] `pytest tests/ -v` — all backend tests green
- [ ] `curl http://localhost:8000/health` → `{"status":"ok"}`
- [ ] Extension loads in Chrome with no manifest errors
- [ ] Panel appears on a PDF tab, extracts text, uploads, shows Ready
- [ ] Question answered with page badges; clicking badge scrolls PDF
- [ ] Local `file://` PDF works after enabling file access
- [ ] Image-only PDF shows correct error message
- [ ] Expired/missing auth token shows "log in again" message in panel
