# PDF Chat

A Chrome extension that lets you ask questions about any PDF open in your browser. Answers are grounded strictly in the document and include page citations.

## How it works

1. You open a PDF in Chrome
2. The extension extracts text client-side via PDF.js
3. Text is uploaded once to a FastAPI backend, chunked and indexed with BM25
4. You ask a question — the backend retrieves the relevant chunks and calls your chosen LLM
5. The answer appears in the floating panel with clickable page badges

## Architecture

```
Chrome Extension (MV3)          FastAPI Backend
─────────────────────           ───────────────
content_script.js               main.py
  ↓ detects PDF                   ↓ CORS + lifespan cleanup
  ↓ PDF.js extraction           auth.py          ← Supabase JWT verify
  ↓ shadow DOM panel            chunker.py        ← ≤2000-char overlapping chunks
service_worker.js               retriever.py      ← BM25Okapi search
  ↓ JWT auth relay              session.py        ← in-memory store, 2h TTL
  ↓ token refresh               llm.py            ← litellm (GPT/Gemini/Sonnet)
options/options.js              routes/
  ↓ Supabase sign-in              session_routes.py  POST /session/upload
  ↓ model/backend config          session_routes.py  POST /session/query
```

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Fill in .env with your keys (see below)
uvicorn main:app --reload
```

`.env` keys:

| Key | Where to find it |
|-----|-----------------|
| `SUPABASE_JWT_SECRET` | Supabase Dashboard → Project Settings → API → JWT Secret |
| `OPENAI_API_KEY` | platform.openai.com |
| `GEMINI_API_KEY` | aistudio.google.com |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

At least one LLM key is required. The backend runs on `http://localhost:8000`.

### Extension

1. Open `chrome://extensions` and enable **Developer mode**
2. Click **Load unpacked** → select the `extension/` folder
3. The `extension/lib/` files (PDF.js, supabase-js) are not committed — download them:

```bash
cd extension/lib

# PDF.js
curl -L "https://github.com/mozilla/pdf.js/releases/download/v4.9.155/pdfjs-4.9.155-dist.zip" -o pdfjs.zip
unzip pdfjs.zip build/pdf.mjs build/pdf.worker.mjs
mv build/pdf.mjs pdf.js && mv build/pdf.worker.mjs pdf.worker.js
rm -rf build pdfjs.zip

# supabase-js
curl -L "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js" -o supabase.js
```

### Extension options

Right-click the extension icon → **Options**:

- Enter your Supabase project URL and anon key, then sign in
- Set Backend URL to `http://localhost:8000`
- Choose a model (GPT-4o, Gemini 1.5 Pro, or Claude Sonnet)
- Save

## Usage

Open any PDF in Chrome. The floating panel appears in the bottom-right corner, extracts the text, and becomes ready within a few seconds. Type a question and press Enter (or Shift+Enter for a new line). Click a page badge (e.g. `p.4`) to jump to that page in the PDF viewer.

The panel is draggable and collapsible.

## Models

| Option | Provider | Key needed |
|--------|----------|-----------|
| GPT-4o | OpenAI | `OPENAI_API_KEY` |
| Gemini 1.5 Pro | Google | `GEMINI_API_KEY` |
| Claude Sonnet | Anthropic | `ANTHROPIC_API_KEY` |

## Backend tests

```bash
cd backend
python -m pytest tests/ -v
```

27 tests covering chunker, BM25 retriever, session store, JWT auth, and API routes.

## Limitations

- Image-only / scanned PDFs with no text layer cannot be read
- Session data is in-memory only — restarting the backend clears all sessions
- Multi-user: each user's sessions are isolated by their Supabase user ID
- Local PDFs require enabling "Allow access to file URLs" in the extension details page
