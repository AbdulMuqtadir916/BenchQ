"""The request body size cap (backend/body_limit.py; docs/team/uzair.md §1): 413 over 1 MB, or over 11 MB on the file
uploads, judged from Content-Length when there is one and by reading up to the cap when the body is chunked."""
import json

from backend.body_limit import FILE_TOO_LARGE, LIMIT, TOO_LARGE, UPLOAD_LIMIT

TOO_LARGE_BODY = {"detail": TOO_LARGE}


def _sign_in_body(size):
    """A sign-in body of about `size` bytes."""
    return json.dumps({"email": "owner@acme.test", "password": "x" * max(0, size - 50)})


def _chunks(total, chunk=64 * 1024):
    """`total` bytes as a stream with no Content-Length (chunked)."""
    sent = 0
    while sent < total:
        n = min(chunk, total - sent)
        sent += n
        yield b"x" * n


def test_a_json_body_over_1_mb_is_refused_with_413(anonymous_client):
    r = anonymous_client.post("/api/auth/sign-in", content=_sign_in_body(LIMIT + 1024),
                              headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert r.json() == TOO_LARGE_BODY


def test_a_json_body_under_1_mb_reaches_the_route(anonymous_client):
    r = anonymous_client.post("/api/auth/sign-in", content=_sign_in_body(LIMIT - 1024),
                              headers={"Content-Type": "application/json"})
    assert r.status_code == 422          # the route's own answer: the password is over its length


def test_an_oversized_request_is_refused_before_the_session_is_checked(anonymous_client, accounts):
    r = anonymous_client.post(f"/api/firms/{accounts.firm_id}/candidates", content=b"x" * (LIMIT + 1),
                              headers={"Content-Type": "application/json"})
    assert r.status_code == 413          # not 401: nothing past the cap ran


def test_an_upload_over_11_mb_is_refused_with_the_file_message(anonymous_client, accounts):
    files = {"file": ("ravi.pdf", b"%PDF" + b"0" * UPLOAD_LIMIT, "application/pdf")}
    r = anonymous_client.post(f"/api/firms/{accounts.firm_id}/candidates/parse-resume", files=files)
    assert r.status_code == 413
    assert r.json() == {"detail": FILE_TOO_LARGE}


def test_an_upload_over_1_mb_but_under_the_upload_cap_reaches_the_route(api_client, accounts):
    files = {"file": ("ravi.txt", b"x" * (2 * LIMIT), "text/plain")}
    r = api_client.post(f"/api/firms/{accounts.firm_id}/candidates/parse-resume", files=files)
    assert (r.status_code, r.json()) == (415, {"detail": "PDF or Word only."})   # the route's own check


def test_a_chunked_body_over_1_mb_is_refused(anonymous_client):
    r = anonymous_client.post("/api/auth/sign-in", content=_chunks(LIMIT + 1),
                              headers={"Content-Type": "application/json"})
    assert "content-length" not in {k.lower() for k in r.request.headers}
    assert r.status_code == 413
    assert r.json() == TOO_LARGE_BODY


def test_a_small_chunked_body_is_handed_on_whole(anonymous_client):
    body = json.dumps({"email": "nobody@acme.test", "password": "wrong-password"}).encode()
    r = anonymous_client.post("/api/auth/sign-in", content=iter([body[:10], body[10:]]),
                              headers={"Content-Type": "application/json"})
    assert r.status_code == 401          # the route read the whole body: a wrong password, not a parse error


def test_requests_without_a_body_are_untouched(anonymous_client):
    assert anonymous_client.get("/health").status_code == 200
