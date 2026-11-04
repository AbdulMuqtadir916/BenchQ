"""R4-T1 · /api/cover-letters and /api/persona contract (the /api/resumes part went with its routes, PR 6).

These three carry the largest free-form JSON blobs in the app (`json_data`,
persona nodes), so wrong-typed and oversized payloads matter most here.
"""
import pytest

from backend.tests.r4_support import (  # noqa: F401
    client, _clear_running_state, _no_outbound, assert_clean, assert_no_leak,
    make_job, make_resume, make_persona, set_setting, big_string, EMOJI, MISSING_UUID,
)
from backend.models.tenancy import DEFAULT_FIRM_ID

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")

PERSONA_NODES = ["contact", "work_auth", "demographics", "compensation",
                 "preferences", "resume_content", "qa_bank"]


# The /api/resumes routes went in résumé versioning PR 6; test_resume_versions.py covers their replacements.


# ══ Cover letters ════════════════════════════════════════════════════════════

def test_create_cover_letter_requires_a_name(client):
    assert_clean(client.post("/api/cover-letters", json={}), 400)


@pytest.mark.parametrize("name", ["", "  ", None])
def test_create_cover_letter_rejects_a_blank_name(client, name):
    assert_clean(client.post("/api/cover-letters", json={"name": name}), 400)


@pytest.mark.parametrize("name", [5, ["L"], {"n": 1}])
def test_create_cover_letter_wrongly_typed_name_is_400_not_500(client, name):
    assert client.post("/api/cover-letters", json={"name": name}).status_code in (400, 422)


def test_create_cover_letter_unicode_and_defaults(client):
    r = assert_clean(client.post("/api/cover-letters", json={"name": EMOJI}), 201)
    assert r.json()["name"] == EMOJI
    assert r.json()["page_format"] == "letter"


def test_create_cover_letter_ten_megabyte_body(client):
    r = client.post("/api/cover-letters",
                    json={"name": "Big", "json_data": {"body": big_string(10)}})
    assert_clean(r, 201, 400, 413, 422)


def test_get_cover_letter_missing_id_is_404(client):
    assert_clean(client.get(f"/api/cover-letters/{MISSING_UUID}"), 404)


def test_patch_cover_letter_missing_id_is_404(client):
    assert_clean(client.patch(f"/api/cover-letters/{MISSING_UUID}", json={"name": "x"}), 404)


def test_patch_cover_letter_drops_keys_outside_the_allow_list(client):
    cl = client.post("/api/cover-letters", json={"name": "L"}).json()
    assert_clean(client.patch(f"/api/cover-letters/{cl['id']}",
                              json={"id": MISSING_UUID, "created_at": "2020-01-01",
                                    "name": "kept"}), 200)
    r = client.get(f"/api/cover-letters/{cl['id']}").json()
    assert r["name"] == "kept" and r["id"] == cl["id"]


def test_delete_cover_letter_missing_id_is_404(client):
    assert_clean(client.delete(f"/api/cover-letters/{MISSING_UUID}"), 404)


def test_delete_cover_letter_twice_is_404_the_second_time(client):
    cl = client.post("/api/cover-letters", json={"name": "L"}).json()
    assert_clean(client.delete(f"/api/cover-letters/{cl['id']}"), 200)
    assert_clean(client.delete(f"/api/cover-letters/{cl['id']}"), 404)


def test_export_cover_letter_pdf_missing_id_is_404(client):
    assert_clean(client.get(f"/api/cover-letters/{MISSING_UUID}/pdf"), 404)


@pytest.mark.parametrize("body", [{}, {"resume_id": MISSING_UUID}, {"job_id": MISSING_UUID}])
def test_generate_cover_letter_requires_both_ids(client, body):
    assert_clean(client.post("/api/cover-letters/generate", json=body), 400)


def test_generate_cover_letter_unknown_resume_is_404(client, test_db):
    job = make_job(test_db, description="JD")
    assert_clean(client.post("/api/cover-letters/generate", json={
        "resume_id": MISSING_UUID, "job_id": str(job.id)}), 404)


def test_generate_cover_letter_unknown_job_is_404(client, test_db):
    res = make_resume(test_db)
    assert_clean(client.post("/api/cover-letters/generate", json={
        "resume_id": str(res.id), "job_id": MISSING_UUID}), 404)


def test_generate_cover_letter_job_without_any_jd_source_is_400(client, test_db):
    """A job with no description, no URL and no cached page has nothing to write from.
    A job with a URL alone (hand-logged) is accepted -- the worker resolves the text."""
    res = make_resume(test_db)
    job = make_job(test_db, url="")
    assert_clean(client.post("/api/cover-letters/generate", json={
        "resume_id": str(res.id), "job_id": str(job.id)}), 400)


def test_generate_cover_letter_empty_resume_is_400(client, test_db):
    res = make_resume(test_db, json_data={})
    job = make_job(test_db, description="JD")
    assert_clean(client.post("/api/cover-letters/generate", json={
        "resume_id": str(res.id), "job_id": str(job.id)}), 400)


def test_generate_cover_letter_unknown_target_letter_is_404(client, test_db):
    res = make_resume(test_db)
    job = make_job(test_db, description="JD")
    assert_clean(client.post("/api/cover-letters/generate", json={
        "resume_id": str(res.id), "job_id": str(job.id),
        "cover_letter_id": MISSING_UUID}), 404)


def test_generate_cover_letter_second_call_on_the_same_pair_is_409(client, test_db, monkeypatch):
    import asyncio
    import backend.api.routes_cover_letters as rcl
    gate = asyncio.Event()

    async def _slow(**kw):
        await gate.wait()
    monkeypatch.setattr(rcl, "_generate_impl", _slow, raising=False)

    set_setting(test_db, "cover_letter_prompt", "write it")
    res = make_resume(test_db)
    job = make_job(test_db, description="JD")
    body = {"resume_id": str(res.id), "job_id": str(job.id)}
    assert_clean(client.post("/api/cover-letters/generate", json=body), 202)
    assert_clean(client.post("/api/cover-letters/generate", json=body), 409)
    gate.set()


def test_list_cover_letters_by_job(client, test_db):
    job = make_job(test_db)
    assert_clean(client.get(f"/api/cover-letters?job_id={job.id}"), 200)


# ══ Persona ══════════════════════════════════════════════════════════════════

def test_get_persona_returns_the_singleton(client, test_db):
    make_persona(test_db)
    r = assert_clean(client.get("/api/persona"), 200)
    assert r.json()["id"] == 1


@pytest.mark.parametrize("key", ["bogus", "id", "created_at", "updated_at", "CONTACT", ""])
def test_patch_persona_rejects_unknown_nodes(client, test_db, key):
    make_persona(test_db)
    r = assert_clean(client.patch("/api/persona", json={key: {}}), 400)
    assert "Unknown persona node" in r.text


def test_patch_persona_rejects_a_mixed_known_and_unknown_batch(client, test_db):
    """All-or-nothing: one bad key rejects the whole PATCH, including the good one."""
    make_persona(test_db)
    assert_clean(client.patch("/api/persona",
                              json={"contact": {"name": "A"}, "bogus": 1}), 400)
    assert client.get("/api/persona").json()["contact"] == {}


@pytest.mark.parametrize("node", PERSONA_NODES)
def test_patch_persona_replaces_a_node_wholesale(client, test_db, node):
    make_persona(test_db)
    value = [{"question": "q", "answer": "a"}] if node == "qa_bank" else {"k": "v"}
    r = assert_clean(client.patch("/api/persona", json={node: value}), 200)
    assert r.json()[node] == value


@pytest.mark.parametrize("bad", ["a string", 5, True])
def test_patch_persona_wrongly_typed_node_never_500(client, test_db, bad):
    make_persona(test_db)
    assert_clean(client.patch("/api/persona", json={"contact": bad}), 200, 400, 422)


def test_patch_persona_empty_body_is_a_noop_200(client, test_db):
    make_persona(test_db)
    assert_clean(client.patch("/api/persona", json={}), 200)


@pytest.mark.parametrize("body", [[1], "x", 3, None])
def test_patch_persona_non_object_body_is_422(client, test_db, body):
    make_persona(test_db)
    assert_clean(client.patch("/api/persona", json=body), 422)


def test_patch_persona_ten_megabyte_node(client, test_db):
    make_persona(test_db)
    r = client.patch("/api/persona", json={"resume_content": {"summary": big_string(10)}})
    assert_clean(r, 200, 400, 413, 422)


def test_patch_persona_unicode_round_trips(client, test_db):
    make_persona(test_db)
    r = assert_clean(client.patch("/api/persona", json={"contact": {"name": EMOJI}}), 200)
    assert r.json()["contact"]["name"] == EMOJI


@pytest.mark.parametrize("body", [{}, {"question": "q"}, {"answer": "a"},
                                  {"question": "", "answer": "a"},
                                  {"question": "q", "answer": "  "}])
def test_qa_bank_requires_both_fields(client, test_db, body):
    make_persona(test_db)
    assert_clean(client.post("/api/persona/qa-bank", json=body), 400)


def test_qa_bank_appends_and_counts(client, test_db):
    make_persona(test_db)
    r1 = assert_clean(client.post("/api/persona/qa-bank",
                                 json={"question": "q1", "answer": "a1"}), 200)
    r2 = assert_clean(client.post("/api/persona/qa-bank",
                                 json={"question": "q2", "answer": EMOJI}), 200)
    assert r1.json()["count"] == 1 and r2.json()["count"] == 2


@pytest.mark.parametrize("bad", [5, ["q"], {"a": 1}])
def test_qa_bank_wrongly_typed_fields_are_400_not_500(client, test_db, bad):
    make_persona(test_db)
    assert client.post("/api/persona/qa-bank",
                       json={"question": bad, "answer": "a"}).status_code in (400, 422)


@pytest.mark.parametrize("bad", [5, ["q"], {"a": 1}])
def test_qa_bank_wrongly_typed_fields_never_leak_internals(client, test_db, bad):
    make_persona(test_db)
    assert_no_leak(client.post("/api/persona/qa-bank", json={"question": bad, "answer": "a"}))


def test_qa_bank_ten_megabyte_answer(client, test_db):
    make_persona(test_db)
    r = client.post("/api/persona/qa-bank",
                    json={"question": "q", "answer": big_string(10)})
    assert_clean(r, 200, 400, 413, 422)


# ── R4 fix-loop regressions (R4-T1-20) ───────────────────────────────────────

@pytest.mark.parametrize("bad", [5, 1.5, [], {}, True, ["x"], {"n": 1}])
def test_create_cover_letter_rejects_every_wrongly_typed_name(client, bad):
    assert_clean(client.post("/api/cover-letters", json={"name": bad}), 400)


@pytest.mark.parametrize("field", ["question", "answer"])
@pytest.mark.parametrize("bad", [5, ["x"], {"n": 1}, True])
def test_qa_bank_rejects_every_wrongly_typed_field(client, test_db, field, bad):
    make_persona(test_db)
    body = {"question": "q", "answer": "a"}
    body[field] = bad
    assert_clean(client.post("/api/persona/qa-bank", json=body), 400)


def test_qa_bank_still_appends_a_well_typed_pair(client, test_db):
    make_persona(test_db)
    r = assert_clean(client.post("/api/persona/qa-bank",
                                 json={"question": "q", "answer": "a"}), 200)
    assert r.json()["count"] == 1


def test_cover_letters_malformed_job_id_filter_is_422_not_404(client):
    """R4-T1-09: the list used to answer "Not found" for a bad filter value."""
    assert_clean(client.get("/api/cover-letters?job_id=not-a-uuid"), 422)


def test_cover_letters_valid_job_id_filter_still_works(client, test_db):
    from backend.models.db import CoverLetter
    job = make_job(test_db)
    test_db.add(CoverLetter(firm_id=DEFAULT_FIRM_ID, name="L", job_id=job.id, json_data={}))
    test_db.commit()
    r = assert_clean(client.get(f"/api/cover-letters?job_id={job.id}"), 200)
    assert len(r.json()) == 1
