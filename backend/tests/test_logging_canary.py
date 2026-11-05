"""The canary (docs/team/uzair.md §1, step 4a): plant a name, an email, a phone number, résumé text, a password and a
token in real requests, including the ones that fail, and fail if any of them reaches the log. It reads what the one
handler of backend/logging_setup.py writes, at the production level (INFO), so it sees exactly what production would.

A new route that handles people's data belongs in here."""
import io
import logging
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import backend.main  # noqa: F401  configures logging, as the running app does
import backend.models.db as db_mod
from backend.tests.auth_support import make_user
from backend.tests.test_resume_parse import _pdf  # builds a one-page PDF; no parser setup from that file

NAME = "Zorvath Quillane"
EMAIL = "zorvath.quillane@canary-mail.test"
PHONE = "+1 555-013-7799"
RESUME = "Xylophonic Brigantine Consulting, Principal Canarysmith, 2019 - Present"
PASSWORD = "Wombat-Lantern-Pass-77"
TOKEN = "cAnArYtOkEn7Qx9Lp2Wm4Rt8Yb6Nv3Hj5Kd1Fs0Gz"
# What must never appear, in any case: each marker, and the parts a masked or reformatted copy would keep.
MARKERS = ("zorvath", "quillane", "canary-mail", "013-7799", "0137799", "xylophonic", "brigantine", "canarysmith",
           "wombat-lantern", TOKEN.lower())


def _assert_clean(buffer: io.StringIO) -> str:
    written = buffer.getvalue()
    assert written, "nothing was logged: the canary would pass without looking"
    leaked = [m for m in MARKERS if m in written.lower()]
    assert not leaked, f"planted values reached the log: {leaked}\n{written}"
    return written


@pytest.fixture
def parser_model(test_db, monkeypatch):
    """The résumé parser set up as seeded (its key filled in), and a stubbed model whose reply carries the planted
    values, so a parse that logged its reply would leak them. The canary's own: it needs nothing from the parser's
    tests."""
    import json

    from backend.models.db import Setting
    from backend.seed import DEFAULT_SETTINGS
    values = {key: DEFAULT_SETTINGS[key][0] for key in DEFAULT_SETTINGS if key.startswith("resume_parse_")}
    values["resume_parse_llm_api_key"] = "test-key"
    for key, value in values.items():
        row = test_db.query(Setting).filter(Setting.key == key).first()
        if row is None:
            test_db.add(Setting(key=key, value=value))
        else:
            row.value = value
    test_db.commit()
    answer = {"header": {"name": NAME, "email": EMAIL, "phone": PHONE}, "professional_summary": RESUME}

    async def planted_reply(prompt, system, max_tokens=1200, **kwargs):
        return {"text": json.dumps(answer), "usage": {"input_tokens": 1, "output_tokens": 1},
                "provider": kwargs.get("provider"), "model": kwargs.get("model")}

    monkeypatch.setattr("backend.analyzer.llm_client.call_llm", planted_reply)


def _cookie(token):
    return {"cookie": f"bq_session={token}"}


@contextmanager
def _route_session(make):
    from backend.main import app
    previous = app.dependency_overrides.get(db_mod.get_db)
    app.dependency_overrides[db_mod.get_db] = make
    try:
        yield
    finally:
        app.dependency_overrides[db_mod.get_db] = previous


def test_the_canary_sees_what_is_logged(log):
    """The check isn't vacuous: a planted value logged outright is found."""
    logging.getLogger("jobnavigator.test").info("Hello %s", NAME)
    with pytest.raises(AssertionError, match="planted values reached the log"):
        _assert_clean(log)


def test_sign_in(anonymous_client, log):
    for _ in range(7):                                       # past the email limit: the throttle logs a warning
        anonymous_client.post("/api/auth/sign-in", json={"email": EMAIL, "password": PASSWORD})
    anonymous_client.post("/api/auth/sign-in", json={"email": "owner@acme.test", "password": PASSWORD})
    _assert_clean(log)


def test_invite_links(anonymous_client, log):
    anonymous_client.get(f"/api/invites/{TOKEN}")
    anonymous_client.post(f"/api/invites/{TOKEN}/accept", json={"name": NAME, "password": PASSWORD})
    anonymous_client.get(f"/invite/{TOKEN}")                 # not a backend route: logged as "(no route)"
    written = _assert_clean(log)
    assert "/api/invites/{token}" in written


def test_a_password_reset_from_request_to_new_password(api_client, anonymous_client, accounts, test_db, log):
    from backend.models.tenancy import Firm
    bde = make_user(test_db, test_db.get(Firm, accounts.firm_id), email=EMAIL, role="BDE", name=NAME)
    test_db.commit()
    assert anonymous_client.post("/api/auth/password-reset/request", json={"email": EMAIL}).status_code == 202
    notice = next(i for i in api_client.get("/api/notifications").json()["items"] if i["type"] == "PASSWORD_RESET")
    approved = api_client.post(f"/api/notifications/{notice['id']}/password-reset-decision", json={"approve": True})
    real_token = approved.json()["resetLink"].split("#", 1)[1]
    anonymous_client.post("/api/auth/password-reset/complete", json={"token": TOKEN, "password": PASSWORD})
    anonymous_client.post("/api/auth/password-reset/complete", json={"token": real_token, "password": "Wombat"})
    done = anonymous_client.post("/api/auth/password-reset/complete", json={"token": real_token, "password": PASSWORD})
    assert done.status_code == 200, done.text
    assert anonymous_client.post("/api/auth/sign-in", json={"email": EMAIL, "password": PASSWORD}).status_code == 200
    assert bde.id is not None
    assert real_token not in _assert_clean(log)


def test_creating_and_editing_a_candidate(anonymous_client, accounts, test_db, log):
    from backend.models.tenancy import Firm
    manager = make_user(test_db, test_db.get(Firm, accounts.firm_id), email="manager@acme.test", role="MANAGER")
    test_db.commit()
    url = f"/api/firms/{accounts.firm_id}/candidates"
    body = {"full_name": NAME, "primary_role": "Java Developer", "email": EMAIL, "phone": PHONE, "work_auth": "H1B",
            "employment_types": ["C2C"], "manager_id": str(manager.id), "summary": RESUME,
            "skills": [{"name": "Xylophonic", "source": "RESUME_UPLOAD"}]}
    created = anonymous_client.post(url, json=body, headers=_cookie(accounts.firm_token))
    assert created.status_code == 201, created.text
    cid = created.json()["id"]
    anonymous_client.post(url, json=body | {"email": "zorvath[at]canary-mail.test"}, headers=_cookie(accounts.firm_token))
    anonymous_client.post(url, json=body | {"years_experience": 212}, headers=_cookie(accounts.firm_token))
    anonymous_client.patch(f"{url}/{cid}", json={"phone": PHONE, "full_name": NAME + " Jr"},
                           headers=_cookie(accounts.firm_token))
    _assert_clean(log)


def test_parsing_a_resume(anonymous_client, accounts, parser_model, monkeypatch, log):
    resume = f"{NAME}\n{EMAIL} | {PHONE}\n{RESUME}"
    url = f"/api/firms/{accounts.firm_id}/candidates/parse-resume"
    files = {"file": (f"{NAME}.pdf", _pdf(resume), "application/pdf")}
    assert anonymous_client.post(url, files=files, headers=_cookie(accounts.firm_token)).status_code == 200

    async def junk_reply(prompt, system, max_tokens=1200, **kwargs):  # the model answers with no JSON at all
        return {"text": f"Sorry, I can't read {NAME} {PHONE}", "usage": {"input_tokens": 1, "output_tokens": 1},
                "provider": kwargs.get("provider"), "model": kwargs.get("model")}

    monkeypatch.setattr("backend.analyzer.llm_client.call_llm", junk_reply)
    anonymous_client.post(url, files={"file": (f"{NAME}.pdf", _pdf(resume), "application/pdf")},
                          headers=_cookie(accounts.firm_token))
    _assert_clean(log)


def test_database_errors_name_no_values(api_client, accounts, log):
    """Postgres repeats a value in its own message ("invalid input syntax … 'Zorvath'") and in DETAIL ("Key (v)=(…)
    already exists"); neither reaches the log."""
    from backend.main import app

    def _bad_cast():
        db = db_mod.SessionLocal()
        try:
            db.execute(text("SELECT CAST(:v AS integer)"), {"v": NAME})
            yield db
        finally:
            db.close()

    def _duplicate():
        db = db_mod.SessionLocal()
        try:
            db.execute(text("CREATE TEMP TABLE canary (v text UNIQUE)"))
            db.execute(text("INSERT INTO canary VALUES (:v), (:v)"), {"v": NAME})
            yield db
        finally:
            db.close()

    with TestClient(app, raise_server_exceptions=False) as client:
        for make in (_bad_cast, _duplicate):
            with _route_session(make):
                assert client.get("/api/auth/me", headers=_cookie(accounts.firm_token)).status_code == 500
    written = _assert_clean(log)
    assert "SQLSTATE 22P02" in written and "SQLSTATE 23505" in written


def test_a_caught_database_error_logged_in_the_message_names_no_values(api_client, accounts, log):
    """The ~120 calls like `logger.warning(f"Failed to log activity: {e}")` (backend/activity.py) put the error in
    the message itself, where Postgres has already quoted the value; the traceback path never sees them."""
    from sqlalchemy.exc import DataError

    from backend.main import app

    app_log = logging.getLogger("jobnavigator.activity")

    def _caught():
        db = db_mod.SessionLocal()
        try:
            for value_sql in ("CAST(:v AS integer)", "CAST(:v AS uuid)"):
                try:
                    db.execute(text(f"SELECT {value_sql}"), {"v": NAME})
                except DataError as e:
                    db.rollback()
                    app_log.warning(f"Failed to log activity: {e}")
                    app_log.warning(f"Failed to log activity: {e.orig}")
            yield db
        finally:
            db.close()

    with TestClient(app, raise_server_exceptions=False) as client:
        with _route_session(_caught):
            assert client.get("/api/auth/me", headers=_cookie(accounts.firm_token)).status_code == 200
    written = _assert_clean(log)
    assert "Failed to log activity" in written


def test_unexpected_errors_carry_no_input(api_client, accounts, log):
    """A validation error raised in code (not the request's own 422) and a crash with a body in flight."""
    from pydantic import BaseModel

    from backend.main import app

    class Person(BaseModel):
        age: int
        phone: int

    def _invalid():
        Person.model_validate({"age": NAME, "phone": PHONE})
        yield  # pragma: no cover

    with TestClient(app, raise_server_exceptions=False) as client:
        with _route_session(_invalid):
            r = client.post(f"/api/firms/{accounts.firm_id}/candidates", headers=_cookie(accounts.firm_token),
                            json={"full_name": NAME, "email": EMAIL, "phone": PHONE, "summary": RESUME})
    assert (r.status_code, r.text) == (500, "Internal Server Error")
    written = _assert_clean(log)
    assert "validation error(s) for Person" in written
