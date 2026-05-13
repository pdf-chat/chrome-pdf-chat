from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from auth import get_current_user
from chunker import chunk_pages
from limiter import limiter
import session as session_store
import retriever
import llm

router = APIRouter(prefix="/session")


class PageItem(BaseModel):
    page: int
    text: str = Field(max_length=50_000)


class UploadRequest(BaseModel):
    pages: list[PageItem] = Field(max_length=500)


class UploadResponse(BaseModel):
    session_id: str


class QueryRequest(BaseModel):
    session_id: str
    question: str = Field(min_length=1, max_length=2000)


class Citation(BaseModel):
    page: int
    quote: str


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]


@router.post("/upload", response_model=UploadResponse)
@limiter.limit("10/hour")
async def upload(request: Request, req: UploadRequest, user_id: str = Depends(get_current_user)):
    chunks = chunk_pages([p.model_dump() for p in req.pages])
    if not chunks:
        raise HTTPException(status_code=422, detail="No text could be extracted from the provided pages")
    session_id = session_store.create_session(chunks, user_id)
    return UploadResponse(session_id=session_id)


@router.post("/query", response_model=QueryResponse)
@limiter.limit("20/hour")
async def query(request: Request, req: QueryRequest, user_id: str = Depends(get_current_user)):
    try:
        sess = session_store.get_session(req.session_id, user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied")
    top_chunks = retriever.search(sess.chunks, req.question)
    if not top_chunks:
        top_chunks = sess.chunks
    if not top_chunks:
        return QueryResponse(answer="I couldn't find that in this document.", citations=[])
    result = llm.ask(req.question, top_chunks)
    return QueryResponse(**result)
