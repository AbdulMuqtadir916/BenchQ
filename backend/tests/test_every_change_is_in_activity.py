"""Every route that changes data leaves an entry in the activity log, when it runs (Activity logs).

test_ledger_rules.py proves a route *can* log: its code reaches the log's writer. This proves it *does*: each write route
is sent the sweep's request (backend/tests/route_sweep.py, a database with a row in every table) as the person its class
needs, and when it goes through, the log must have a new row. A route that goes through and writes nothing is either a gap
(fix it) or changed nothing on purpose (list it in NO_ENTRY with why).

Routes the sweep's request doesn't get through (a 4xx) are in test_log_every_route.py's NOT_REACHED; the route's own
tests cover their logging. Routes in test_ledger_rules.py's NOT_LOGGED are left out by design, each with its reason.
"""
import uuid

import backend.main
import pytest
from fastapi.routing import APIRoute
from sqlalchemy import text as sql_text

from backend.models.tenancy import ActivityEntry
from backend.tests.test_ledger_rules import NOT_LOGGED
from backend.tests.test_log_every_route import ROUTE_STATE, _send, swept  # noqa: F401 (swept is a fixture)
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import pipeline  # noqa: F401 (fixture)
from backend.tests.test_pr4_automation import automation  # noqa: F401 (fixture)
from backend.tests.test_resume_versions import world  # noqa: F401 (fixture)

WRITE = {"POST", "PUT", "PATCH", "DELETE"}

# "METHOD path" -> why a request that goes through still writes no entry.
NO_ENTRY: dict[str, str] = {
    "DELETE /api/support-views/current":
        "no support view was open, so nothing ended; closing an open one logs ADMIN_ACCESS_END (test_support_views.py)",
    "PATCH /api/applications/interviews/{interview_id}":
        "an edit that changes no field writes nothing; a real change logs with before and after (test_activity_applications.py)",
    "POST /api/auth/password-reset/request":
        "an unknown, inactive or already-pending email gets the same answer and stores nothing; a real one logs (below)",
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/review/open":
        "an email that already has a pending review gets that review back; opening a new one logs (below)",
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/resumes/bases/{base_id}/show":
        "a base that isn't hidden is already shown; showing a hidden one logs (below)",
    "POST /api/firms/{firm_id}/candidates/{candidate_id}/resumes/{resume_id}/use-as-base":
        "a base that is already the active one changes nothing; switching to another logs (below)",
}


def _file(module: str) -> str:
    return module.removeprefix("backend.").replace(".", "/") + ".py"


def _logged_routes() -> list[str]:
    """Write routes the log is expected to cover, as "METHOD path"."""
    out = []
    for route in backend.main.app.router.routes:
        if not isinstance(route, APIRoute) or (_file(route.endpoint.__module__), route.endpoint.__name__) in NOT_LOGGED:
            continue
        out.extend(f"{method} {route.path}" for method in sorted(route.methods & WRITE))
    return sorted(out)


def _count(test_db) -> int:
    test_db.expire_all()
    return test_db.query(ActivityEntry).count()


@pytest.mark.parametrize("route", _logged_routes())
def test_a_route_that_changes_data_leaves_an_entry(route, swept, api_client, test_db):
    ids, _ = swept
    for table, values in ROUTE_STATE.get(route, {}).items():
        test_db.execute(sql_text(f'UPDATE "{table}" SET ' + ", ".join(f"{k} = :{k}" for k in values)), values)
    test_db.commit()
    before = _count(test_db)
    response = _send(api_client, backend.main.app, route, ids)
    if response.status_code >= 400:
        pytest.skip(f"the sweep's request doesn't get through ({response.status_code}); see NOT_REACHED")
    wrote = _count(test_db) - before
    if route in NO_ENTRY:
        assert wrote == 0, f"{route} writes an entry now: remove it from NO_ENTRY"
    else:
        assert wrote >= 1, (f"{route} went through ({response.status_code}) and wrote no entry in the activity log. Log it, or "
                            f"list it in NO_ENTRY with why it changes nothing.")


def test_the_no_entry_list_names_only_routes_that_exist_and_are_expected_to_log():
    assert set(NO_ENTRY) <= set(_logged_routes()), sorted(set(NO_ENTRY) - set(_logged_routes()))


# ── The cases the exemptions above stand for, each one logging ───────────────────────────────────────────────────

def test_switching_the_base_and_showing_a_hidden_one_are_entries_and_repeating_them_is_not(anonymous_client, test_db, world):
    from backend.models.candidates import BaseResume
    from backend.models.db import utcnow
    from backend.tests.test_resume_versions import _candidate, _save, _url, _v
    c = _candidate(anonymous_client, test_db, world, bde="adnan")
    owner, bde = world["as"]["owner"], world["as"]["adnan"]
    v2 = _save(anonymous_client, world, c, _v(anonymous_client, world, c), who="adnan", summary="Edited.").json()
    summaries = lambda: [e.summary for e in test_db.query(ActivityEntry).filter_by(entity_type="resume").order_by(
        ActivityEntry.created_at, ActivityEntry.id).all() if e.summary.startswith(("Made", "Showed"))]
    test_db.expire_all()

    base2 = anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=bde).json()
    assert summaries() == ["Made Base 2 from Base 1 v2; the workflow uses it"]
    anonymous_client.post(_url(world, c, f"/{v2['id']}/use-as-base"), headers=bde)           # already the base: nothing
    assert len(summaries()) == 1
    v1 = _v(anonymous_client, world, c, base_number=1)
    assert anonymous_client.post(_url(world, c, f"/{v1['id']}/use-as-base"), headers=bde).status_code == 200
    assert summaries()[-1] == "Made Base 1 the base the workflow uses"

    base = test_db.get(BaseResume, uuid.UUID(base2["id"]))
    base.archived_at = utcnow()                                                              # hidden, as a used base is
    test_db.commit()
    assert anonymous_client.post(_url(world, c, f"/bases/{base2['id']}/show"), headers=bde).status_code == 200
    assert summaries()[-1] == "Showed Base 2 again"
    count = len(summaries())
    assert anonymous_client.post(_url(world, c, f"/bases/{base2['id']}/show"), headers=bde).status_code == 200   # not hidden
    assert len(summaries()) == count


def test_a_password_reset_for_a_real_account_is_an_entry(anonymous_client, api_client, test_db, accounts):
    from backend.tests.test_password_reset_races import _bde_with_request
    _bde_with_request(anonymous_client, api_client, test_db, accounts, "needs-reset@acme.test")
    test_db.expire_all()
    entry = test_db.query(ActivityEntry).filter(ActivityEntry.summary.like("% asked for a password reset; sent to %")).one()
    assert (entry.action, entry.actor_type, entry.firm_id) == ("CREATE", "SYSTEM", entry.firm_id) and entry.firm_id is not None
    assert "needs-reset@acme.test" not in entry.summary


def test_opening_an_irrelevant_email_for_review_is_an_entry_and_opening_it_again_is_not(
        test_db, api_client, pipeline, automation):   # noqa: F811
    from backend.inbox import classification_worker as worker
    from backend.tests.test_pr3_pipeline import decision
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: decision("other", .95))
    from backend.models.candidates import InboxMessage
    message = test_db.get(InboxMessage, message_id)
    url = f"/api/firms/{message.firm_id}/candidates/{message.candidate_id}/inbox-messages/{message.id}/review/open"
    opened = lambda: [e for e in test_db.query(ActivityEntry).filter_by(summary="Opened an email marked Irrelevant for review")]
    test_db.expire_all()
    first = api_client.post(url)
    assert first.status_code == 200, first.text
    test_db.expire_all()
    assert len(opened()) == 1
    assert api_client.post(url).json() == first.json()          # the pending review it already has
    test_db.expire_all()
    assert len(opened()) == 1
