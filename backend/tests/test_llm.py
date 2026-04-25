from unittest.mock import patch, MagicMock
from llm import ask

CHUNKS = [
    {"text": "Revenue grew 23% in Q3 driven by enterprise sales.", "page": 4},
    {"text": "Headcount increased to 500 employees.", "page": 7},
]

def make_mock_response(content: str):
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp

def test_ask_returns_answer_and_citations():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response(
            '{"answer": "Revenue grew 23%.", "citations": [{"page": 4, "quote": "Revenue grew 23%"}]}'
        )
        result = ask("What was revenue growth?", CHUNKS, "gpt-4o")
    assert result["answer"] == "Revenue grew 23%."
    assert result["citations"] == [{"page": 4, "quote": "Revenue grew 23%"}]

def test_ask_handles_invalid_json_gracefully():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response("not valid json at all")
        result = ask("test question", CHUNKS, "gpt-4o")
    assert "answer" in result
    assert "citations" in result
    assert result["citations"] == []

def test_ask_passes_correct_model():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response('{"answer": "ok", "citations": []}')
        ask("test", CHUNKS, "gemini/gemini-2.5-flash")
    call_kwargs = mock_completion.call_args[1]
    assert call_kwargs["model"] == "gemini/gemini-2.5-flash"

def test_ask_skips_malformed_citations():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response(
            '{"answer": "ok", "citations": [{"page": 4, "quote": "good"}, {"page": "not-int"}, {}]}'
        )
        result = ask("test", CHUNKS, "gpt-4o")
    assert result["citations"] == [{"page": 4, "quote": "good"}]
