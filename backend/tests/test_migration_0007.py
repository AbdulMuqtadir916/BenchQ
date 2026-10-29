"""Migration 0007 (docs/team/00-candidate-core.md; 07 Q53): the candidate core tables and the rules the database holds."""
import pytest
from sqlalchemy.exc import IntegrityError

from backend.auth import ledger
from backend.models.candidates import Candidate, CandidateJob, CandidateMailbox, Claim, Evidence, FavoriteJob, InboxMessage
from backend.models.db import Application, Job, Resume, Search, utcnow
from backend.models.tenancy import Firm, LedgerEntry, User
from backend.tests.auth_support import make_user


@pytest.fixture
def world(test_db, accounts):
    firm = test_db.get(Firm, accounts.firm_id)
    owner = test_db.get(User, accounts.user_id)
    manager = make_user(test_db, firm, email="m@acme.test", role="MANAGER")
    bde = make_user(test_db, firm, email="b@acme.test", role="BDE")
    bde.manager_id = manager.id
    candidate = Candidate(firm_id=firm.id, manager_id=manager.id, bde_id=bde.id, created_by_user_id=owner.id,
                          full_name="Asha Rao", work_auth="H1B")
    job = Job(external_id="core-job", title="Data Engineer", company="Acme", url="https://jobs.example.test/1",
              source="manual")
    test_db.add_all([candidate, job])
    test_db.flush()
    return {"firm": firm, "owner": owner, "bde": bde, "candidate": candidate, "job": job}


def _refused(test_db, row, constraint: str) -> None:
    """The insert fails on exactly this constraint, in a savepoint so the rows the test set up stay."""
    with pytest.raises(IntegrityError, match=constraint):
        with test_db.begin_nested():
            test_db.add(row)
            test_db.flush()


def _ids(world):
    return {"firm_id": world["firm"].id, "candidate_id": world["candidate"].id}


def test_a_verified_claim_needs_evidence(test_db, world):
    """Truth Guard (D4): the database refuses it, whoever writes."""
    claim = dict(**_ids(world), entity_type="skill", text="Spark", source="RESUME_UPLOAD")
    _refused(test_db, Claim(**claim, state="VERIFIED"), "ck_claims_verified_has_evidence")
    evidence = Evidence(**_ids(world), excerpt="Built Spark pipelines at Acme", source="RESUME_UPLOAD")
    test_db.add(evidence)
    test_db.flush()
    test_db.add_all([Claim(**claim), Claim(**claim, state="VERIFIED", evidence_id=evidence.id)])
    test_db.flush()
    assert {c.state for c in test_db.query(Claim).filter(Claim.candidate_id == world["candidate"].id)} == \
        {"UNVERIFIED", "VERIFIED"}
    _refused(test_db, Claim(**claim, state="MAYBE"), "ck_claims_state")
    _refused(test_db, Claim(**{**claim, "entity_type": "hobby"}), "ck_claims_entity_type")


def test_one_base_resume_per_candidate_and_many_tailored(test_db, world):
    base = Resume(firm_id=world["firm"].id, candidate_id=world["candidate"].id, name="Base", is_base=True)
    test_db.add(base)
    test_db.flush()
    for n in range(2):
        test_db.add(Resume(firm_id=world["firm"].id, candidate_id=world["candidate"].id, name=f"Tailored {n}",
                           is_base=False, parent_id=base.id, job_id=world["job"].id))
    test_db.flush()
    _refused(test_db, Resume(firm_id=world["firm"].id, candidate_id=world["candidate"].id, name="Second base",
                             is_base=True), "uq_resumes_one_base_per_candidate")


def test_one_application_per_candidate_per_job_with_the_tailored_resume(test_db, world):
    tailored = Resume(firm_id=world["firm"].id, candidate_id=world["candidate"].id, name="Tailored", is_base=False,
                      job_id=world["job"].id)
    test_db.add(tailored)
    test_db.flush()
    app = dict(firm_id=world["firm"].id, job_id=world["job"].id, candidate_id=world["candidate"].id)
    test_db.add(Application(**app, resume_id=tailored.id, submitted_by_user_id=world["bde"].id))
    test_db.flush()
    _refused(test_db, Application(**app), "uq_applications_candidate_job")
    # Rows from before 0007 have no candidate and aren't held to it.
    test_db.add_all([Application(firm_id=world["firm"].id, job_id=world["job"].id) for _ in range(2)])
    test_db.flush()


def test_jobs_found_and_favorites_are_per_candidate(test_db, world):
    search = Search(firm_id=world["firm"].id, candidate_id=world["candidate"].id, name="Asha: data engineer")
    test_db.add(search)
    test_db.flush()
    found = dict(**_ids(world), job_id=world["job"].id)
    test_db.add_all([CandidateJob(**found, search_id=search.id, match_score=87),
                     FavoriteJob(**found, marked_by_user_id=world["bde"].id)])
    test_db.flush()
    _refused(test_db, CandidateJob(**found), "uq_candidate_jobs_candidate_job")
    _refused(test_db, FavoriteJob(**found, marked_by_user_id=world["owner"].id), "uq_favorite_jobs_candidate_job")
    _refused(test_db, CandidateJob(**found, match_score=101), "ck_candidate_jobs_match_score")


def test_one_mailbox_per_candidate_and_each_email_once(test_db, world):
    mailbox = CandidateMailbox(**_ids(world), address="asha@gmail.test", connected_by_user_id=world["bde"].id)
    test_db.add(mailbox)
    test_db.flush()
    assert (mailbox.provider, mailbox.status) == ("GOOGLE", "CONNECTED")
    _refused(test_db, CandidateMailbox(**_ids(world), address="asha2@gmail.test", connected_by_user_id=world["bde"].id),
             "candidate_mailboxes_candidate_id_key")
    message = dict(**_ids(world), mailbox_id=mailbox.id, provider_message_id="m-1", from_name="Recruiter",
                   from_email="r@acme.test", subject="Interview", snippet="Are you free?", received_at=utcnow())
    test_db.add(InboxMessage(**message))
    test_db.flush()
    _refused(test_db, InboxMessage(**message), "uq_inbox_messages_mailbox_message")


def test_the_ledger_knows_the_candidate_an_entry_is_about(test_db, world):
    """07 Q53h: an entry about a candidate gets it; another write passes it; the rest have none."""
    owner, candidate = world["owner"], world["candidate"]
    about = ledger.record(test_db, actor=owner, action="UPDATE", entity_type="candidate", entity_id=candidate.id,
                          entity_label="Asha", summary="Edited", firm_id=world["firm"].id)
    passed = ledger.record(test_db, actor=owner, action="CREATE", entity_type="application", entity_id=candidate.id,
                           entity_label="Acme", summary="Applied", firm_id=world["firm"].id, candidate_id=candidate.id)
    neither = ledger.record(test_db, actor=owner, action="UPDATE", entity_type="firm", entity_id=world["firm"].id,
                            entity_label="Acme", summary="Settings", firm_id=world["firm"].id)
    test_db.flush()
    assert (about.candidate_id, passed.candidate_id, neither.candidate_id) == (candidate.id, candidate.id, None)
    assert test_db.query(LedgerEntry).filter(LedgerEntry.candidate_id == candidate.id).count() == 2
