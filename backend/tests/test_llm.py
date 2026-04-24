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

def test_ask_returns_answer_and_pages():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response(
            '{"answer": "Revenue grew 23%.", "pages": [4]}'
        )
        result = ask("What was revenue growth?", CHUNKS, "gpt-4o")
    assert result["answer"] == "Revenue grew 23%."
    assert result["pages"] == [4]

def test_ask_handles_invalid_json_gracefully():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response("not valid json at all")
        result = ask("test question", CHUNKS, "gpt-4o")
    assert "answer" in result
    assert "pages" in result

def test_ask_passes_correct_model():
    with patch("llm.litellm.completion") as mock_completion:
        mock_completion.return_value = make_mock_response('{"answer": "ok", "pages": []}')
        ask("test", CHUNKS, "gemini/gemini-1.5-pro")
    call_kwargs = mock_completion.call_args[1]
    assert call_kwargs["model"] == "gemini/gemini-1.5-pro"
