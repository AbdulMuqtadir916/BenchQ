"""Reading a résumé for the new-candidate flow (docs/candidate-onboarding/06-backend.md §4; 07 Q49): PDF and Word
text, Zuhair's format, the 60-minute parse row, and the refusals. The model is stubbed; the files are real."""
import io
import json
from datetime import timedelta

import pytest
from fastapi import HTTPException

from backend.candidates import parse as parser

RESUME_TEXT = ("Ravi Teja Kommineni\nSenior Java Full Stack Developer\nIrving, TX | ravi@example.com | H1B\n"
               "Experience: Capital Payments Inc., Senior Java Developer, Mar 2021 - Present")


def _pdf(text: str) -> bytes:
    """A one-page PDF with `text` on it, built by hand so the test needs no PDF library."""
    lines = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").split("\n")
    stream = "BT /F1 11 Tf 50 750 Td 14 TL " + " ".join(f"({line}) Tj T*" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1"))
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def _docx(text: str, table: list[list[str]] | None = None) -> bytes:
    import docx
    document = docx.Document()
    for line in text.split("\n"):
        document.add_paragraph(line)
    if table:
        grid = document.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, value in enumerate(row):
                grid.cell(r, c).text = value
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


# ── The file ─────────────────────────────────────────────────────────────────

def test_the_file_kind_comes_from_the_name_and_the_bytes():
    assert parser.file_kind("Ravi.PDF", b"%PDF-1.4 ...") == "pdf"
    assert parser.file_kind("ravi.docx", b"PK\x03\x04...") == "docx"
    cases = [("ravi.doc", b"\xd0\xcf", 415, "Save it as .docx or PDF, then try again."),
             ("ravi.pdf", b"PK\x03\x04", 415, "PDF or Word only."),          # a renamed file
             ("ravi.txt", b"hello", 415, "PDF or Word only."),
             ("ravi.pdf", b"", 422, "This file is empty."),
             ("ravi.pdf", b"%PDF" + b"0" * parser.MAX_BYTES, 413, "Up to 10 MB.")]
    for name, content, status, detail in cases:
        with pytest.raises(HTTPException) as refused:
            parser.file_kind(name, content)
        assert (refused.value.status_code, refused.value.detail) == (status, detail), name


def test_text_comes_out_of_a_pdf_and_a_word_file_tables_included():
    assert "Ravi Teja Kommineni" in parser.extract_text("pdf", _pdf(RESUME_TEXT))
    text = parser.extract_text("docx", _docx(RESUME_TEXT, table=[["Languages", "Java, SQL"]]))
    assert "Capital Payments Inc." in text and "Languages | Java, SQL" in text


def test_a_scan_or_a_damaged_file_is_refused_with_the_reason():
    with pytest.raises(HTTPException, match="no readable text"):
        parser.extract_text("pdf", _pdf("Ravi"))
    with pytest.raises(HTTPException, match="damaged"):
        parser.extract_text("docx", b"PK not really a zip")


# ── The format ───────────────────────────────────────────────────────────────

def test_the_answer_is_held_to_zuhairs_format():
    answer = parser.checked({"header": {"name": "Ravi", "nickname": "R"}, "work_experience": [{"company": "Acme"}],
                             "hobbies": ["chess"]})
    assert answer["header"] == {"name": "Ravi", "title": "", "location": "", "email": "", "phone": "",
                                "work_authorization": "", "github": "", "linkedin": ""}
    assert answer["work_experience"] == [{"job_title": "", "company": "Acme", "location": "", "dates": "", "start": "",
                                          "end": "", "current": False, "bullets": []}]
    assert "hobbies" not in answer and answer["certifications"] == []
    with pytest.raises(HTTPException):
        parser.checked({"work_experience": "not a list"})


def test_the_default_prompt_names_every_rule_and_fills_in():
    filled = parser.DEFAULT_PROMPT.replace("{format}", parser.EMPTY_FORMAT).replace("{resume_text}", RESUME_TEXT)
    assert '"work_authorization"' in filled and RESUME_TEXT in filled and "{" + "resume_text}" not in filled


# ── The route ────────────────────────────────────────────────────────────────

ANSWER = {"header": {"name": "Ravi Teja Kommineni", "title": "Senior Java Full Stack Developer", "location": "Irving, TX",
                     "email": "ravi@example.com", "work_authorization": "H1B"},
          "technical_skills": [{"category": "Languages", "skills": "Java, SQL"}]}


@pytest.fixture
def model(test_db, monkeypatch):
    """The parser prompt (seeded in a real database) and a stubbed model that answers ANSWER."""
    from backend.models.db import Setting
    test_db.add(Setting(key="resume_parse_prompt", value=parser.DEFAULT_PROMPT, description="test"))
    test_db.commit()
    calls = []

    async def fake_call_llm(prompt, system, max_tokens=1200, **kwargs):
        calls.append(prompt)
        return {"text": "Here you go:\n" + json.dumps(ANSWER), "usage": {"input_tokens": 10, "output_tokens": 5},
                "provider": kwargs.get("provider"), "model": kwargs.get("model")}

    monkeypatch.setattr("backend.analyzer.llm_client.call_llm", fake_call_llm)
    return calls


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


def _upload(client, accounts, cookie, name="Ravi.pdf", content=None, mime="application/pdf", firm_id=None):
    return client.post(f"/api/firms/{firm_id or accounts.firm_id}/candidates/parse-resume",
                       files={"file": (name, content if content is not None else _pdf(RESUME_TEXT), mime)},
                       headers=cookie)


def test_a_parse_answers_in_the_format_and_waits_sixty_minutes(anonymous_client, test_db, accounts, model):
    from backend.models.candidates import Candidate, ResumeParse
    from backend.models.db import utcnow
    r = _upload(anonymous_client, accounts, _cookie(accounts.firm_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file_name"] == "Ravi.pdf"
    assert body["parse"]["header"]["work_authorization"] == "H1B"
    assert body["parse"]["header"]["github"] == "" and body["parse"]["projects"] == []
    assert "Ravi Teja Kommineni" in model[0]                     # the résumé's text went to the model
    row = test_db.get(ResumeParse, body["parse_id"])
    assert (row.candidate_id, row.firm_id, row.mime_type) == (None, accounts.firm_id, "application/pdf")
    assert timedelta(minutes=59) < row.expires_at - utcnow() <= timedelta(minutes=60)
    assert test_db.query(Candidate).count() == 0                 # nothing about a candidate is saved (Q49)


def test_a_word_file_is_read_too(anonymous_client, accounts, model):
    r = _upload(anonymous_client, accounts, _cookie(accounts.firm_token), name="Ravi.docx", content=_docx(RESUME_TEXT),
                mime=parser.DOCX_MIME)
    assert r.status_code == 200, r.text


def test_expired_unused_parses_are_cleared_on_the_next_read(anonymous_client, test_db, accounts, model):
    from backend.models.candidates import ResumeParse
    from backend.models.db import utcnow
    test_db.add(ResumeParse(firm_id=accounts.firm_id, uploaded_by_user_id=accounts.user_id, file_name="old.pdf",
                            mime_type="application/pdf", size_bytes=1, content=b"x", parse={},
                            expires_at=utcnow() - timedelta(minutes=1)))
    test_db.commit()
    assert _upload(anonymous_client, accounts, _cookie(accounts.firm_token)).status_code == 200
    assert [p.file_name for p in test_db.query(ResumeParse)] == ["Ravi.pdf"]


def test_who_may_read_a_resume(anonymous_client, test_db, accounts, model):
    from backend.models.tenancy import Firm
    from backend.auth.sessions import start_session
    from backend.tests.auth_support import make_firm, make_plan, make_user
    firm = test_db.get(Firm, accounts.firm_id)
    for role, status in (("MANAGER", 200), ("BDE", 403), ("VIEWER", 403)):
        user = make_user(test_db, firm, email=f"{role.lower()}@acme.test", role=role)
        token, _ = start_session(test_db, user)
        test_db.commit()
        assert _upload(anonymous_client, accounts, _cookie(token)).status_code == status, role
    other = make_firm(test_db, make_plan(test_db, name="Other"), slug="other")
    test_db.commit()
    assert _upload(anonymous_client, accounts, _cookie(accounts.firm_token), firm_id=other.id).status_code == 404
    assert _upload(anonymous_client, accounts, {}).status_code == 401


def test_a_model_that_answers_nonsense_is_a_clear_422(anonymous_client, accounts, model, monkeypatch):
    async def nonsense(prompt, system, max_tokens=1200, **kwargs):
        return {"text": "I can't help with that.", "usage": {}}
    monkeypatch.setattr("backend.analyzer.llm_client.call_llm", nonsense)
    r = _upload(anonymous_client, accounts, _cookie(accounts.firm_token))
    assert r.status_code == 422
    assert r.json()["detail"].startswith("Couldn't read this résumé.")
