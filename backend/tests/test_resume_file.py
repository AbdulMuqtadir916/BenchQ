"""A résumé version as a file (07 Q49, docs/02 §8.2), for the extension to attach to a form: an uploaded base's version
1 is served as it was uploaded; any other version's file is made from its own text when asked (a PDF, or Word with
`?format=docx`). `X-Resume-File` says which."""
import io
import uuid
from types import SimpleNamespace

import pytest
from docx import Document

from backend.api import routes_candidate_resumes
from backend.candidates import resume_file
from backend.problem import RESUME_FILE_FAILED
from backend.tests.problem_support import body_of, expected
from backend.tests.test_candidates_api import world  # noqa: F401  (the fixture)
from backend.tests.test_resume_versions import ONBOARDING_FILE, _candidate, _pdf, _save, _url, _v, parser  # noqa: F401

LATER_FILE = b"%PDF-1.7 a later resume"
MADE_PDF = b"%PDF-1.4 made from the text"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
NOT_MADE = expected(503, "This résumé's file couldn't be made. Try again.", RESUME_FILE_FAILED)


def _file(client, world, candidate, resume_id, who="owner", kind=None):
    query = f"?format={kind}" if kind else ""
    return client.get(_url(world, candidate, f"/{resume_id}/file{query}"), headers=world["as"][who])


@pytest.fixture
def printer(monkeypatch):
    """Chromium's stand-in: keeps each page it's given and the print options, and prints MADE_PDF."""
    printed = {"pages": [], "options": []}

    class Page:
        async def set_content(self, html, **kwargs):
            printed["pages"].append(html)

        async def pdf(self, **kwargs):
            printed["options"].append(kwargs)
            return MADE_PDF

        async def close(self):
            return None

    class Browser:
        async def new_page(self):
            return Page()

    async def browser():
        return Browser()

    monkeypatch.setattr(routes_candidate_resumes, "_get_browser", browser)
    return printed


def test_an_uploads_first_version_is_its_file_as_uploaded(anonymous_client, test_db, world, parser):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    r = _file(anonymous_client, world, c, _v(anonymous_client, world, c, who="adnan")["id"], who="adnan")
    assert r.status_code == 200, r.text
    assert (r.content, r.headers["content-type"], r.headers["cache-control"]) == (ONBOARDING_FILE, "application/pdf",
                                                                                 "no-store")
    assert r.headers["x-resume-file"] == "uploaded"
    upload = anonymous_client.post(_url(world, c, "/upload"), files=_pdf(LATER_FILE), headers=world["as"]["adnan"])
    assert upload.status_code == 201, upload.text
    r = _file(anonymous_client, world, c, _v(anonymous_client, world, c, base_number=2, who="adnan")["id"], who="adnan")
    assert r.content == LATER_FILE
    assert r.headers["content-disposition"] == "attachment; filename*=UTF-8''later.pdf"


def test_an_edited_version_and_a_base_made_from_it_get_a_file_made_from_their_text(anonymous_client, test_db, world,
                                                                                    printer):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    assert _save(anonymous_client, world, c, v1, summary="An edited summary.").status_code == 201
    v2 = _v(anonymous_client, world, c, version=2)
    r = _file(anonymous_client, world, c, v2["id"])
    assert r.status_code == 200, r.text
    assert (r.content, r.headers["content-type"], r.headers["x-resume-file"]) == (MADE_PDF, "application/pdf",
                                                                                 "generated")
    assert r.headers["content-disposition"].endswith(".pdf")
    assert "An edited summary." in printed_page(printer)
    assert printer["options"][-1]["format"] == "Letter"
    assert _file(anonymous_client, world, c, v1["id"]).content == ONBOARDING_FILE   # the upload stays as uploaded
    promoted = anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=world["as"]["owner"])
    assert promoted.status_code == 200, promoted.text
    r = _file(anonymous_client, world, c, _v(anonymous_client, world, c, base_number=2)["id"])
    assert (r.status_code, r.headers["x-resume-file"]) == (200, "generated")
    assert "An edited summary." in printed_page(printer)


def printed_page(printer) -> str:
    return printer["pages"][-1]


def test_word_is_made_from_the_text_when_asked(anonymous_client, test_db, world, printer):
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    assert _save(anonymous_client, world, c, v1, summary="A summary for Word.").status_code == 201
    v2 = _v(anonymous_client, world, c, version=2)
    words = {}
    for version in (v2, v1):     # v1's upload is a PDF, so its Word file is made from its text too
        r = _file(anonymous_client, world, c, version["id"], kind="docx")
        assert (r.status_code, r.headers["content-type"], r.headers["x-resume-file"]) == (200, DOCX, "generated"), r.text
        assert r.headers["content-disposition"].endswith(".docx")
        words[version["id"]] = "\n".join(p.text for p in Document(io.BytesIO(r.content)).paragraphs)
    assert "A summary for Word." in words[v2["id"]]
    assert "A summary for Word." not in words[v1["id"]]
    assert printer["pages"] == []      # Word needs no browser
    assert _file(anonymous_client, world, c, v1["id"], kind="pdf").content == ONBOARDING_FILE
    assert _file(anonymous_client, world, c, v1["id"], kind="txt").status_code == 422


def test_a_file_that_cant_be_made_says_so(anonymous_client, test_db, world, monkeypatch):
    async def no_browser():
        raise RuntimeError("Chromium is missing")

    monkeypatch.setattr(routes_candidate_resumes, "_get_browser", no_browser)
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    assert _save(anonymous_client, world, c, v1, summary="An edited summary.").status_code == 201
    r = _file(anonymous_client, world, c, _v(anonymous_client, world, c, version=2)["id"])
    assert (r.status_code, body_of(r)) == (503, NOT_MADE)


def test_a_page_that_cant_be_built_says_so_too(anonymous_client, test_db, world, printer, monkeypatch):
    def broken(*args, **kwargs):
        raise ValueError("a layout error")

    monkeypatch.setattr(resume_file, "html", broken)
    c = _candidate(anonymous_client, test_db, world)
    v1 = _v(anonymous_client, world, c)
    assert _save(anonymous_client, world, c, v1, summary="An edited summary.").status_code == 201
    r = _file(anonymous_client, world, c, _v(anonymous_client, world, c, version=2)["id"])
    assert (r.status_code, body_of(r)) == (503, NOT_MADE)
    assert printer["pages"] == []


def test_out_of_scope_and_unknown_versions_are_not_found(anonymous_client, test_db, world):
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    v1 = _v(anonymous_client, world, c)
    assert _file(anonymous_client, world, c, v1["id"], who="vikram").status_code == 404   # another manager's BDE
    assert _file(anonymous_client, world, c, uuid.uuid4()).status_code == 404


def _row(**fields):
    columns = dict(name="Base", full_name="Asha Rao", title="Java Developer", email="asha@example.test",
                   phone="+1 555 0100", city="Austin", state="TX", country="USA", linkedin="linkedin.com/in/asha",
                   github="", summary="", skills=[], experiences=[], projects=[], educations=[], certifications=[],
                   awards=[], languages=[{"name": "Telugu"}], page_format="letter")
    columns.update(fields)
    return SimpleNamespace(**columns)


def test_the_page_escapes_the_text_and_links_only_web_addresses():
    row = _row(summary="Uses <script>alert(1)</script> & more",
               experiences=[{"job_title": "Engineer", "company": "Acme", "start": "2020", "current": True,
                             "bullets": [{"text": "Shipped <b>fast</b>"}]}],
               projects=[{"name": "Tool", "url": "javascript:alert(1)", "bullets": [{"text": "Built it"}]}],
               skills=[{"category": "Languages", "name": "Java"}, {"category": "Languages", "name": "Go"}])
    page = resume_file.html(row)
    assert "<script>" not in page and "&lt;script&gt;alert(1)&lt;/script&gt; &amp; more" in page
    assert "Shipped &lt;b&gt;fast&lt;/b&gt;" in page
    assert "javascript:" not in page
    assert 'href="https://linkedin.com/in/asha"' in page
    assert "Engineer — Acme" in page and "2020 – Present" in page
    assert "Languages:</span> Java, Go" in page and "Telugu" not in page   # the languages section isn't printed
    assert resume_file.html(row, {"linkedin": "https://t.example.test/cv/abc"}).count('href="https://t.example.test/cv/abc"') == 1


def test_control_characters_a_pdf_can_carry_dont_break_the_word_file():
    row = _row(summary="Nine years\x0b of Java\x00 and Spring.\nLeads teams.", experiences=[
        {"job_title": "Engineer\x0c", "company": "Acme", "dates": "2020", "bullets": [{"text": "Shipped\x08 it"}]}])
    words = "\n".join(p.text for p in Document(io.BytesIO(resume_file.docx(row))).paragraphs)
    assert "Nine years of Java and Spring.\nLeads teams." in words and "Engineer — Acme\t2020" in words
    assert "Shipped it" in words
    assert "\x0b" not in resume_file.html(row)


def test_the_file_name_comes_from_the_header():
    assert resume_file.file_name(_row(), "pdf") == "Asha Rao - Java Developer.pdf"
    assert resume_file.file_name(_row(full_name='A/B: "C"', title=""), "docx") == "A B C.docx"
    assert resume_file.file_name(_row(full_name="", title=""), "pdf") == "Base.pdf"
    assert resume_file.pdf_options("A4")["format"] == "A4" and resume_file.pdf_options(None)["format"] == "Letter"
