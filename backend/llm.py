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
