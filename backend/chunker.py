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
