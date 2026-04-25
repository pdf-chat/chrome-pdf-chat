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

class Citation(BaseModel):
    page: int
    quote: str

class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]

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
        top_chunks = sess.chunks
    if not top_chunks:
        return QueryResponse(answer="I couldn't find that in this document.", citations=[])
    result = llm.ask(req.question, top_chunks, req.model)
    return QueryResponse(**result)
