import json
import litellm
from secrets import get_secret

SYSTEM_PROMPT = """You are a PDF assistant. Answer the user's question using ONLY the context passages below.
Respond with valid JSON in this exact format:
{"answer": "your answer here", "citations": [{"page": 1, "quote": "exact verbatim text from the page"}]}
The "quote" must be copied verbatim from the context — same words, same casing, same punctuation, around 4-12 words long, taken directly from the passage that supports the answer. Do not paraphrase the quote.
If the answer is not in the context, respond with:
{"answer": "I couldn't find that in this document.", "citations": []}
Do not include any text outside the JSON object."""

MODEL = "gemini/gemini-2.5-flash"

def ask(question: str, chunks: list[dict], model: str = MODEL) -> dict:
    context = "\n\n".join(f"[Page {c['page']}] {c['text']}" for c in chunks)
    response = litellm.completion(
        model=model,
        api_key=get_secret("gemini-api-key"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ],
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content
    try:
        result = json.loads(raw)
        citations = []
        for c in result.get("citations", []):
            try:
                citations.append({"page": int(c["page"]), "quote": str(c.get("quote", ""))})
            except (KeyError, ValueError, TypeError):
                continue
        return {
            "answer": str(result.get("answer", "")),
            "citations": citations,
        }
    except (json.JSONDecodeError, ValueError):
        return {"answer": raw, "citations": []}
