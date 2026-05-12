# Chrome PDF Chat — Design Spec

## Overview

A Chrome extension that lets users ask questions about any PDF they have open in the browser — public URLs, local files, or proxied PDFs — without uploading the file to a third-party service. Answers are grounded strictly to the PDF and cite the exact pages they came from.

---

## Architecture

```
┌─────────────────────────────────┐      ┌──────────────────────────────┐
│        Chrome Extension          │      │      FastAPI Backend          │
│                                 │      │                              │
│  content_script.js              │      │  POST /session/upload        │
│  ├─ detects PDF tab             │─────▶│    chunk + store in memory   │
│  ├─ extracts text via PDF.js    │      │                              │
│  └─ injects floating chat panel │      │  POST /session/query         │
│                                 │─────▶│    retrieve chunks → LLM     │
│  service_worker.js              │      │    return answer + pages     │
│  └─ auth token relay +          │      │                              │
│     API request proxy           │      │  Supabase Auth (JWT verify)  │
│                                 │      │                              │
│  options/                       │      │  litellm                     │
│  └─ Supabase login + model      │      │  └─ Gemini / GPT / Sonnet    │
│     selector                    │      │                              │
│                                 │      │  BM25 retrieval (rank_bm25)  │
│  panel/ (Shadow DOM)            │      │                              │
│  └─ floating chat UI            │      └──────────────────────────────┘
└─────────────────────────────────┘

Auth: Supabase Auth (self-hostable) issues JWTs.
      Extension stores access_token + refresh_token in chrome.storage.local.
      FastAPI verifies JWTs via SUPABASE_JWT_SECRET — never calls Supabase directly.
```

---

## Chrome Extension

### Manifest V3 Components

| File | Role |
|---|---|
| `content_script.js` | Injected into PDF tabs. Detects PDF, fetches URL as ArrayBuffer, extracts text via PDF.js, injects shadow DOM chat panel, handles citation click → page scroll |
| `service_worker.js` | Background script. Reads JWT from `chrome.storage.local`, attaches `Authorization` header to all backend requests (content scripts cannot set auth headers), handles token refresh via supabase-js |
| `panel/index.html` + `panel/panel.js` + `panel/panel.css` | Floating chat UI mounted in a shadow root. Draggable, collapsible. Renders answer text + page badge chips |
| `options/index.html` + `options/options.js` | Login form (supabase-js `signInWithPassword` or OAuth). Model selector (Gemini / GPT / Sonnet). Saves preferences to `chrome.storage.local` |
| `lib/pdf.js` + `lib/pdf.worker.js` | PDF.js library bundled into extension |

### PDF Detection

Content script activates when `document.contentType === 'application/pdf'` or URL matches `*.pdf`. Works for `http://`, `https://`, and `file://` schemes.

**Local file access:** Requires the user to enable "Allow access to file URLs" in `chrome://extensions`. Content script detects missing permission and shows a link to that settings page.

### Shadow DOM Panel

The floating panel is mounted via `attachShadow({mode: 'open'})` on an injected host element. All panel CSS is scoped inside the shadow root — no style leakage to or from the host PDF page.

Panel position: bottom-right corner, draggable, collapsible to a floating button.

### PDF Text Extraction Flow

```
1. content_script: fetch(tab.url) → ArrayBuffer
2. PDF.js: pdfjsLib.getDocument({data: buffer})
3. For each page: page.getTextContent() → join spans → {page: N, text: "..."}
4. POST /session/upload  {pages: [{page, text}, ...]}
5. Store returned session_id in panel state
```

---

## Backend

### Stack

- **Python 3.11+**
- **FastAPI** — async HTTP framework
- **litellm** — unified LLM routing (Gemini, GPT, Sonnet)
- **rank_bm25** — BM25 keyword retrieval, no embeddings required
- **python-jose** — JWT verification against Supabase JWT secret
- **uvicorn** — ASGI server

### Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/auth/callback` | GET | — | Optional OAuth redirect handler if using Supabase social login |
| `/session/upload` | POST | JWT | Receive page text, chunk, store in memory |
| `/session/query` | POST | JWT | BM25 retrieve top-5 chunks, call LLM, return answer + pages |

### Session Memory

```python
sessions: dict[str, SessionData] = {}

@dataclass
class SessionData:
    chunks: list[dict]   # [{text: str, page: int}, ...]
    created_at: datetime
```

Sessions keyed by `session_id` (UUID). Each session is bound to the authenticated `user_id` from the JWT — the `/session/query` endpoint verifies `session.user_id == jwt.sub` before responding. TTL: 2 hours, enforced by a background cleanup task. No database — in-process memory only.

### Chunking Strategy

1. Split extracted text by page boundary (each page = at least one chunk)
2. Within pages longer than 500 tokens: sliding window split with 50-token overlap
3. Each chunk: `{text: str, page: int}`

### Retrieval

BM25 search over all chunks in the session. Top 5 chunks by BM25 score are sent to the LLM as context.

### LLM Call

```
System prompt:
  "You are a PDF assistant. Answer the user's question using ONLY the
   context passages below. If the answer is not in the context, say
   'I couldn't find that in this document.' Always cite the page
   numbers your answer draws from."

User message:
  Context: [chunk texts with page labels]
  Question: [user question]

Response format (structured output):
  {answer: str, pages: list[int]}
```

Model is passed per-request from the extension (`gemini/gemini-1.5-pro`, `gpt-4o`, `claude-sonnet-4-6`). API keys stored as backend env vars.

### Auth

Supabase Auth issues JWTs. FastAPI verifies each request:

```python
payload = jose.jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"])
user_id = payload["sub"]
```

No user table in the backend — Supabase owns user identity.

---

## Data Flow

### On PDF tab open
```
1. content_script detects PDF
2. fetch(tab.url) → ArrayBuffer
3. PDF.js extracts [{page, text}, ...]
4. → service_worker → POST /session/upload + JWT
5. Backend chunks, stores, returns session_id
6. Panel injected, session_id stored in panel state
```

### On user question
```
1. User sends question in panel
2. content_script → service_worker: {question, session_id, model, jwt}
3. service_worker → POST /session/query
4. Backend: BM25 top-5 chunks → litellm → {answer, pages}
5. Panel renders answer + page badge chips [p.4] [p.12]
6. User clicks [p.4] → PDFViewerApplication.page = 4
```

---

## Citation UX

Each answer includes page badge chips (e.g., `[p.4]` `[p.12]`). Clicking a badge calls `PDFViewerApplication.page = N` — Chrome's built-in PDF viewer exposes this global via its embedded PDF.js instance.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Encrypted or image-only PDF (no extractable text) | Panel: "This PDF couldn't be read — it may be encrypted or image-only" |
| Session upload fails | Panel shows retry button |
| LLM finds no grounded answer | Model returns "I couldn't find that in this document" — rendered as-is |
| JWT expired | supabase-js auto-refreshes; if refresh fails, panel prompts re-login |
| Local file access not granted | Panel shows link to `chrome://extensions` to enable file URL access |

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Extension | Manifest V3, vanilla JS, PDF.js, supabase-js |
| Chat panel | Shadow DOM, vanilla HTML/CSS/JS |
| Backend | Python 3.11, FastAPI, uvicorn |
| Auth | Supabase Auth (self-hostable or supabase.com) |
| LLM routing | litellm |
| Retrieval | rank_bm25 |
| JWT verification | python-jose |

---

## Out of Scope

- Persistent chat history (session-only by design)
- Highlight/annotation of PDF text in viewer
- Mobile / non-Chrome browsers
- Scanned image PDFs (OCR)
