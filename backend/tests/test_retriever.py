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
    assert len(results) == 1

def test_unmatched_query_returns_empty():
    results = search(CHUNKS, "xyzzy frobnicator quantum")
    assert results == []

def test_results_include_page_number():
    results = search(CHUNKS, "revenue")
    assert all("page" in c for c in results)
    assert all("text" in c for c in results)
