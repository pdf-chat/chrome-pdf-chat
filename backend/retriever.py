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
