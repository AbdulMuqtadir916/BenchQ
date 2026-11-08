"""_qa_pair must read both qa_bank shapes: the canonical {"question": ..., "answer": ...} and the legacy single-key map."""
from backend.api.routes_autofill import _qa_pair


def test_qa_pair_normalisation():
    assert _qa_pair({"question": "q", "answer": "a"}) == ("q", "a")
    assert _qa_pair({"q": "a"}) == ("q", "a")
    assert _qa_pair({}) == ("", "")
    assert _qa_pair(None) == ("", "")
    # a canonical entry with a None side must not become the string "None"
    assert _qa_pair({"question": "q", "answer": None}) == ("q", "")
