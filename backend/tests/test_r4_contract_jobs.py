"""R4-T1 · /api/jobs contract under bad input.

Every test asserts the status code AND that nothing internal (stack trace, SQL,
container path) reaches the response body. Postgres-only behaviour (the
DataError -> 404 handler, negative LIMIT) is pinned in test_r4_live_contract.py,
because SQLite does not reproduce it.
"""
import pytest

from backend.tests.r4_support import (  # noqa: F401
    client, _clear_running_state, _no_outbound, assert_clean, assert_no_leak,
    make_job, make_search, big_string, EMOJI, MISSING_UUID,
)

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


# ── GET /api/jobs — filters and paging ───────────────────────────────────────

def test_list_jobs_empty_is_a_shaped_envelope(client):
    r = assert_clean(client.get("/api/jobs"), 200)
    assert r.json() == {"total": 0, "jobs": []}


@pytest.mark.parametrize("qs", [
    "status=zzz", "source=zzz", "company=", "title_search=",
    f"company={EMOJI}", f"title_search={EMOJI}",
    "min_score=0", "min_score=100", "max_score=0",
    "min_salary=0", "max_salary=0",
    "remote=true", "remote=false", "saved=true", "saved=false",
    "sort_by=date", "sort_by=score", "sort_by=salary", "sort_by=company",
    "limit=1", "limit=200", "offset=0",
])
def test_list_jobs_accepts_every_documented_filter(client, qs):
    assert_clean(client.get(f"/api/jobs?{qs}"), 200)


@pytest.mark.parametrize("qs,expected", [
    ("limit=201", 422),          # le=200
    ("limit=abc", 422),
    ("offset=-1", 422),          # ge=0
    ("sort_by=hax", 422),        # pattern
    ("min_score=abc", 422),
    ("remote=maybe", 422),
    ("saved=maybe", 422),
    ("min_salary=abc", 422),
])
def test_list_jobs_rejects_bad_query_types(client, qs, expected):
    assert_clean(client.get(f"/api/jobs?{qs}"), expected)


def test_list_jobs_huge_filter_string_is_not_an_error(client):
    """A 6 kB filter is silly but must not 500 or echo back a stack trace."""
    assert_clean(client.get("/api/jobs?title_search=" + "a" * 6000), 200, 414, 431)


def test_list_jobs_rejects_negative_limit(client):
    """`limit` has le=200 but no lower bound; a negative one reaches LIMIT -5."""
    assert client.get("/api/jobs?limit=-5").status_code == 422


def test_list_jobs_negative_limit_never_leaks_internals(client):
    assert_no_leak(client.get("/api/jobs?limit=-5"))


# ── GET /api/jobs/{id} ───────────────────────────────────────────────────────

def test_get_job_missing_uuid_is_404(client):
    assert_clean(client.get(f"/api/jobs/{MISSING_UUID}"), 404)


def test_get_job_found(client, test_db):
    job = make_job(test_db)
    r = assert_clean(client.get(f"/api/jobs/{job.id}"), 200)
    assert r.json()["id"] == str(job.id)


def test_get_job_path_traversal_is_404(client):
    assert_clean(client.get("/api/jobs/../etc/passwd"), 404)


# ── PATCH /api/jobs/{id} ─────────────────────────────────────────────────────


@pytest.mark.parametrize("body", [[1, 2], "hello", 5, True, None])
def test_patch_job_non_object_body_is_422(client, test_db, body):
    job = make_job(test_db)
    assert_clean(client.patch(f"/api/jobs/{job.id}", json=body), 422)


def test_patch_job_wrong_type_never_leaks_internals(client, test_db):
    job = make_job(test_db)
    assert_no_leak(client.patch(f"/api/jobs/{job.id}", json={"saved": "banana"}))


# POST /api/jobs/bulk-update is retired (job search PR 2, bot review on #135): it answers 410.


# ── POST /api/jobs/save-from-extension ───────────────────────────────────────


@pytest.mark.parametrize("bad", [5, ["T"], {"t": 1}])
def test_save_from_extension_wrongly_typed_title_never_leaks_internals(client, bad):
    assert_no_leak(client.post("/api/jobs/save-from-extension",
                               json={"title": bad, "company": "C", "url": "https://x.com/1"}))


def test_save_from_extension_ten_megabyte_description(client):
    """A pathological paste must be stored or refused — never a 500."""
    r = client.post("/api/jobs/save-from-extension", json={
        "title": "Big", "company": "Acme", "url": "https://x.com/jobs/big",
        "description": big_string(10),
    })
    assert_clean(r, 200, 400, 413, 422)


@pytest.mark.parametrize("body", [[1, 2], "hello", 5, None])
def test_save_from_extension_non_object_body_is_422(client, body):
    assert_clean(client.post("/api/jobs/save-from-extension", json=body), 422)


# ── POST /api/jobs/linkedin-import ───────────────────────────────────────────


# ── /api/jobs/{id} sub-resources ─────────────────────────────────────────────

def test_cached_page_missing_job_is_404(client):
    assert_clean(client.get(f"/api/jobs/{MISSING_UUID}/cached-page"), 404)


def test_cached_page_without_cache_is_404(client, test_db):
    job = make_job(test_db)
    assert_clean(client.get(f"/api/jobs/{job.id}/cached-page"), 404)


def test_unscored_ids_default_limit_is_fine(client):
    """Postgres-only SQL (`cv_scores::text`) — only the shape is asserted here."""
    r = client.get("/api/jobs/unscored-ids")
    assert_no_leak(r)


# ── R4 fix-loop regressions ──────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/api/jobs?limit=-5", "/api/jobs?limit=-1",
                                  "/api/jobs/unscored-ids?limit=-5"])
def test_negative_limit_is_422_on_every_job_listing(client, path):
    """R4-T1-07: `limit` had le= but no ge=, so LIMIT -5 reached Postgres."""
    assert_clean(client.get(path), 422)


@pytest.mark.parametrize("path", ["/api/jobs?limit=0", "/api/jobs/unscored-ids?limit=0"])
def test_zero_limit_stays_legal(client, path):
    """The floor is 0, not 1 — an empty page is a valid request."""
    assert_no_leak(client.get(path))


def test_malformed_search_id_filter_is_422_not_404(client):
    """R4-T1-09: a bad *filter* is a request error; a bad path id stays 404."""
    assert_clean(client.get("/api/jobs?search_id=not-a-uuid"), 422)
    assert_clean(client.get(f"/api/jobs/{MISSING_UUID}"), 404)


def test_a_valid_search_id_filter_still_filters(client, test_db):
    search = make_search(test_db)
    make_job(test_db, search_id=search.id)
    make_job(test_db, url="https://x.com/other")
    r = assert_clean(client.get(f"/api/jobs?search_id={search.id}"), 200)
    assert r.json()["total"] == 1


