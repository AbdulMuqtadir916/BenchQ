"""The parser on the team's test résumés (docs/team/resume-versioning.md §7, PR 2): fourteen real layouts, PDF and
Word, with placeholder contact details. They are not in the repo (shared separately; see the folder's .gitignore), so
this file is skipped without them. To run it, put them in `fixtures/resume_parse/`: `test_set/` holds each file's text
exactly as extract_text returned it; `replies/` holds the model's replies recorded in the live smoke run, so
clean_reply is tested on real output without calling a model. A reply is a JSON file named like its text
(`<name>.<kind>.json`)."""
import json
import pathlib
import re

import pytest

from backend.candidates.base_resume import _FIRST_SECTION_RE, _header_lines, _squash, clean_reply
from backend.candidates.parse_defaults import BASE_RESUME_SCHEMA
from backend.tests.test_base_resume import _matches

FIXTURES = pathlib.Path(__file__).parent / "fixtures/resume_parse"
TEXTS = sorted((FIXTURES / "test_set").glob("*.txt"))
REPLIES = sorted((FIXTURES / "replies").glob("*.json"))
pytestmark = pytest.mark.skipif(not TEXTS, reason="the test résumés are not in the repo; put them in fixtures/resume_parse/test_set/")
# Two templates print the contact labels with nothing filled in ("Name:", "Email Id:").
BLANK_HEADERS = {"John_Doe_BA_Resume", "John_Doe_Senior_Full_Stack_Java_Developer_Resume"}


def _text(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def _source_for(reply: pathlib.Path) -> str:
    return _text(FIXTURES / "test_set" / (reply.name.removesuffix(".json") + ".txt"))


def test_the_test_set_is_all_there():
    assert len(TEXTS) == 14
    assert {p.name.split(".")[-2] for p in TEXTS} == {"pdf", "docx"}
    assert len(REPLIES) in (0, len(TEXTS))                       # a reply for every résumé, once recorded


@pytest.mark.asyncio
@pytest.mark.parametrize("path", TEXTS, ids=lambda p: p.name)
async def test_each_resume_reaches_the_model_whole_and_fenced(path, test_db, monkeypatch):
    from backend.candidates import parse as parser
    from backend.seed import seed_settings
    from backend.models.db import Setting
    seed_settings(test_db)
    test_db.query(Setting).filter(Setting.key == "resume_parse_llm_api_key").update({"value": "test-key"})
    test_db.commit()
    sent = []

    async def fake_call_llm(prompt, system, max_tokens=1200, **kwargs):
        sent.append(prompt)
        return {"text": "{}", "usage": {}}

    monkeypatch.setattr("backend.analyzer.llm_client.call_llm", fake_call_llm)
    text = _text(path)
    parse = await parser.read_resume(text, path.name.split(".")[-2], test_db)
    body = sent[0].split("<<<RESUME>>>\n", 1)[1].rsplit("\n<<<END RESUME>>>", 1)[0]
    assert body == text.strip()                                  # nothing lost, nothing escapes the fence
    assert "{input_note}" not in sent[0] and "{resume}" not in sent[0]
    _matches(parse, BASE_RESUME_SCHEMA)


@pytest.mark.parametrize("path", TEXTS, ids=lambda p: p.name)
def test_the_headline_rule_finds_each_resumes_header(path):
    """The headline rule reads the lines above the first section heading; each layout must have that heading found."""
    text = _text(path)
    assert _FIRST_SECTION_RE.search(text)
    header = _squash(_header_lines(text))
    assert header
    if path.name.split(".")[0] not in BLANK_HEADERS:
        assert "johndoe" in header


def test_a_word_file_and_its_pdf_carry_the_same_link_addresses():
    for docx in (p for p in TEXTS if p.name.endswith(".docx.txt")):
        pdf = docx.with_name(docx.name.replace(".docx.txt", ".pdf.txt"))
        if pdf.exists():
            links = lambda text: re.findall(r"^(?:https?://|mailto:)\S+$", text, re.M)
            assert links(_text(docx)) == links(_text(pdf)), docx.name


# ── Recorded replies (the live smoke run) ────────────────────────────────────

@pytest.mark.skipif(not REPLIES, reason="no recorded replies yet (run the live smoke test)")
@pytest.mark.parametrize("path", REPLIES, ids=lambda p: p.name)
def test_a_real_reply_is_cleaned_into_the_format_keeping_every_bullet(path):
    reply = json.loads(_text(path))
    source = _source_for(path)
    parse = clean_reply(reply, source_text=source)
    _matches(parse, BASE_RESUME_SCHEMA)
    kept = lambda roles: [len([b for b in r.get("bullets") or [] if str(b).strip()]) for r in roles
                          if any(str(b).strip() for b in r.get("bullets") or [])]
    assert kept(parse["work_experience"]) == kept(reply.get("work_experience") or [])
    assert kept(parse["projects"]) == kept(reply.get("projects") or [])
    for link, domain in (("github", "github."), ("linkedin", "linkedin.")):
        if domain not in source.lower():
            assert parse["header"][link] == "", link             # never a profile the file doesn't name


@pytest.mark.skipif(not REPLIES, reason="no recorded replies yet (run the live smoke test)")
@pytest.mark.parametrize("path", REPLIES, ids=lambda p: p.name)
def test_a_real_reply_names_only_employers_and_schools_the_file_does(path):
    source = _squash(_source_for(path))
    parse = clean_reply(json.loads(_text(path)), source_text=_source_for(path))
    named = ([r["company"] for r in parse["work_experience"]] + [e["institution"] for e in parse["education"]])
    assert [name for name in named if name and _squash(name) not in source] == []
