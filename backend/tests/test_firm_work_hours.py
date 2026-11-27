"""A firm's work hours and the candidate's Days (backend/job_search/workday.py; decided 2026-11-17, Q152–Q174): a work
day runs from one start to the next; Day 1 is the assignment's work day inside the hours, else the next; a new BDE
starts again; the hours are required at creation and the OWNER changes them; a change never moves past work; the
daily limits reset at the firm's start; the history numbers batches across Days and the list filters by a Day.
Fake sources only: no network; every job is made up."""
import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from backend.job_search import limits, workday
from backend.models.job_search import ScrapeJob
from backend.tests.test_candidates_api import _assign, _create, world  # noqa: F401  (the fixture)
from backend.tests.test_job_search_api import _job, _open, _run, _url, adnans, fake  # noqa: F401  (the fixtures)

IST = ZoneInfo("Asia/Kolkata")
NIGHT = workday.Hours(time(18, 30), time(4, 0), IST)
DAYTIME = workday.Hours(time(9, 0), time(18, 0), ZoneInfo("America/New_York"))


def _ist(text):
    return datetime.fromisoformat(text).replace(tzinfo=IST)


# ── the rules ────────────────────────────────────────────────────────────────

def test_a_work_day_runs_from_one_start_to_the_next():
    """Q161: at 6:35 PM on the 12th, the 12th's 10 AM search belongs to the work day of the 11th."""
    assert workday.work_date(_ist("2026-11-12T10:00"), NIGHT) == date(2026, 11, 11)
    assert workday.work_date(_ist("2026-11-12T18:35"), NIGHT) == date(2026, 11, 12)
    assert workday.work_date(_ist("2026-11-13T03:59"), NIGHT) == date(2026, 11, 12)
    assert workday.day_start(_ist("2026-11-12T10:00"), NIGHT) == _ist("2026-11-11T18:30")


@pytest.mark.parametrize("assigned,day_one", [
    ("2026-11-12T20:00", "2026-11-12"),          # inside the hours: that work day
    ("2026-11-13T03:00", "2026-11-12"),          # inside, past midnight: still the 12th's work day
    ("2026-11-12T13:00", "2026-11-12"),          # between shifts: the next one (the 12th's evening)
    ("2026-11-13T05:00", "2026-11-13"),          # after the shift ended: the next evening
])
def test_day_one_is_the_assignments_shift_else_the_next(assigned, day_one):
    """Q164."""
    assert workday.day_one(_ist(assigned), NIGHT) == date.fromisoformat(day_one)


def test_work_between_the_assignment_and_the_next_shift_is_day_one():
    """Q169: assigned at 1 PM, searched at 3 PM the same day."""
    first = workday.day_one(_ist("2026-11-12T13:00"), NIGHT)
    assert workday.day_number(workday.work_date(_ist("2026-11-12T15:00"), NIGHT), first) == 1
    assert workday.day_number(workday.work_date(_ist("2026-11-12T19:00"), NIGHT), first) == 1
    assert workday.day_number(workday.work_date(_ist("2026-11-14T19:00"), NIGHT), first) == 3   # every day counts


def test_a_daytime_shift_and_daylight_saving():
    """Q162: a shift that doesn't cross midnight; a US firm's work day is 23 hours when the clocks go forward."""
    new_york = DAYTIME.zone
    assert workday.day_one(datetime(2026, 3, 7, 20, 0, tzinfo=new_york), DAYTIME) == date(2026, 3, 8)
    assert workday.in_hours(datetime(2026, 3, 9, 17, 59, tzinfo=new_york), DAYTIME)
    assert not workday.in_hours(datetime(2026, 3, 9, 18, 0, tzinfo=new_york), DAYTIME)
    start, end = workday.start_of(date(2026, 3, 7), DAYTIME), workday.start_of(date(2026, 3, 8), DAYTIME)
    assert end.astimezone(IST) - start.astimezone(IST) == timedelta(hours=23)   # real time, not the wall clock
    assert DAYTIME.label() == "9:00 AM – 6:00 PM"


def test_the_daily_limits_reset_at_the_firms_start():
    """Q157."""
    assert limits.day_start(_ist("2026-11-12T10:00"), NIGHT) == _ist("2026-11-11T18:30")
    assert limits.next_reset(_ist("2026-11-12T10:00"), NIGHT) == _ist("2026-11-12T18:30")
    nine = datetime(2026, 11, 12, 9, 0, tzinfo=DAYTIME.zone)
    assert limits.day_start(nine + timedelta(minutes=5), DAYTIME) == nine


# ── the firm ─────────────────────────────────────────────────────────────────

def test_the_owner_changes_the_hours_and_past_work_keeps_its_day(anonymous_client, world, test_db):
    from backend.models.tenancy import ActivityEntry
    firm_id = world["firm"].id
    batch = ScrapeJob(firm_id=firm_id, candidate_id=uuid.UUID(_create(anonymous_client, world, bde="adnan").json()["id"]),
                      user_id=world["people"]["adnan"].id, batch_id=uuid.uuid4(), kind="search", state="success",
                      finished_at=_ist("2026-11-12T10:00"), created_at=_ist("2026-11-12T10:00"))
    test_db.add(batch)
    test_db.commit()
    assert batch.work_date == date(2026, 11, 11)                          # stamped when written (Q170)
    url = f"/api/firms/{firm_id}/work-hours"
    for who in ("fatima", "adnan", "rohan"):
        assert anonymous_client.patch(url, json={"work_start": "09:00", "work_end": "18:00"},
                                      headers=world["as"][who]).status_code == 403
    assert anonymous_client.patch(url, json={"work_start": "09:00", "work_end": "09:00"},
                                  headers=world["as"]["owner"]).status_code == 400
    r = anonymous_client.patch(url, json={"work_start": "09:00", "work_end": "18:00"}, headers=world["as"]["owner"])
    assert r.status_code == 200 and (r.json()["work_start"], r.json()["work_end"]) == ("09:00", "18:00")
    entry = test_db.query(ActivityEntry).filter(ActivityEntry.firm_id == firm_id, ActivityEntry.entity_type == "firm").one()
    assert entry.summary == "Work hours 9:00 AM – 6:00 PM (was 6:30 PM – 4:00 AM)"
    test_db.expire_all()
    assert test_db.get(ScrapeJob, batch.id).work_date == date(2026, 11, 11)   # 10 AM is the 12th's now, but not moved


# ── the candidate's Days ─────────────────────────────────────────────────────

def _search(world, candidate):
    """One finished search; its batch id."""
    batch_id = _open(world, candidate)
    _run(world, candidate, batch_id=batch_id)
    return batch_id


def _history(client, world, candidate, who="adnan"):
    r = client.get(_url(world, candidate, "job-searches"), headers=world["as"][who])
    assert r.status_code == 200, r.text
    return r.json()


def _shift(test_db, batch_id, work_date):
    """The batch as if it ran on another work day (its window stays: the list reads the jobs it found)."""
    test_db.query(ScrapeJob).filter(ScrapeJob.batch_id == batch_id).update({ScrapeJob.work_date: work_date})
    test_db.commit()


def test_an_assignment_starts_day_one_and_a_new_bde_starts_again(anonymous_client, world, test_db):
    from backend.models.candidates import Candidate
    c = _create(anonymous_client, world, bde="adnan").json()
    row = test_db.get(Candidate, uuid.UUID(c["id"]))
    assert row.bde_assigned_at is not None
    assert row.bde_day_one == workday.day_one(row.bde_assigned_at, NIGHT)
    assert _assign(anonymous_client, world, "owner", c, "fatima").status_code == 200        # back to the queue
    test_db.expire_all()
    row = test_db.get(Candidate, uuid.UUID(c["id"]))
    assert (row.bde_assigned_at, row.bde_day_one) == (None, None)                            # no BDE, no Days (Q174)
    assert _assign(anonymous_client, world, "owner", c, "fatima", bde="sneha").status_code == 200
    test_db.expire_all()
    assert test_db.get(Candidate, uuid.UUID(c["id"])).bde_assigned_at is not None


def test_batches_are_numbered_across_days_and_the_list_filters_by_a_day(anonymous_client, world, adnans, fake,
                                                                        test_db):
    from backend.models.candidates import Candidate
    first = test_db.get(Candidate, uuid.UUID(adnans["id"])).bde_day_one
    fake.next_cursor = "more"
    fake.jobs = [_job(1), _job(2)]
    one = _search(world, adnans)
    fake.jobs = [_job(3)]
    two = _search(world, adnans)
    fake.jobs = [_job(4)]
    three = _search(world, adnans)
    for batch_id, on in ((one, first), (two, first), (three, first + timedelta(days=2))):
        _shift(test_db, batch_id, on)
    body = _history(anonymous_client, world, adnans)
    numbers = {s["batch_id"]: (s["day"], s["batch"]) for s in body["searches"]}
    assert numbers[str(one)] == (1, 1) and numbers[str(two)] == (1, 2) and numbers[str(three)] == (3, 3)
    days = body["workday"]
    assert days["days_worked"] == [1, 3]                                  # Day 2 had none (Q156)
    assert (days["start"], days["end"], days["timezone"]) == ("18:30", "04:00", "Asia/Kolkata")
    assert days["day_one"] == first.isoformat() and days["today_day"] >= 1
    jobs = anonymous_client.get(f"/api/firms/{world['firm'].id}/job-postings",
                                params={"candidate_id": adnans["id"], "day": 1}, headers=world["as"]["adnan"])
    assert jobs.status_code == 200 and jobs.json()["total"] == 3          # batches 1 and 2
    day_two = anonymous_client.get(f"/api/firms/{world['firm'].id}/job-postings",
                                   params={"candidate_id": adnans["id"], "day": 2}, headers=world["as"]["adnan"])
    assert day_two.json()["total"] == 0
    no_candidate = anonymous_client.get(f"/api/firms/{world['firm'].id}/job-postings", params={"day": 1},
                                        headers=world["as"]["adnan"])
    assert no_candidate.status_code == 422


def test_a_new_bdes_days_leave_the_earlier_searches_unnumbered(anonymous_client, world, adnans, fake, test_db):
    """Q168, Q174: the earlier batches keep no Day; the new BDE's start at Day 1, batch 1."""
    fake.jobs = [_job(1)]
    earlier = _search(world, adnans)
    assert _assign(anonymous_client, world, "owner", adnans, "fatima", bde="sneha").status_code == 200
    body = _history(anonymous_client, world, adnans, who="owner")
    found = next(s for s in body["searches"] if s["batch_id"] == str(earlier))
    assert (found["day"], found["batch"]) == (None, None) and found["work_date"]
    assert body["workday"]["days_worked"] == [] and body["workday"]["today_day"] == 1
