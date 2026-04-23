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
