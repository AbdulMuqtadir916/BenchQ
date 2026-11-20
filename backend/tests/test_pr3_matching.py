"""Read-only matching/decryption regressions; no classifier/provider/schema needed."""
from datetime import timedelta
import pytest
from backend.inbox.application_matching import classification_text, matching_application_id
from backend.inbox.google_oauth import encrypt_content
from backend.models.db import Application, ApplicationStatusEvent, Company, utcnow
from backend.tests.posting_support import posting_for
from backend.tests.test_candidate_mailbox import mailbox_case, email


def _rename(app, **fields):
    """The application's job (its posting, which matching reads) under another title or company."""
    app.posting.content = {**(app.posting.content or {}), **fields}


@pytest.fixture
def matching_case(test_db, mailbox_case):
    candidate, job, app, mailbox = mailbox_case
    _rename(app, company='Alderbyte Systems', title='Java Backend Engineer')
    app.status='applied'; app.applied_at=utcnow()-timedelta(days=1)
    app.submitted_by_user_id=mailbox.connected_by_user_id
    row=email(test_db,mailbox)
    row.source_address=mailbox.address
    row.subject='Application update'
    row.body=encrypt_content('Java Backend Engineer at Alderbyte Systems: please complete this assessment.')
    row.snippet=encrypt_content('Assessment request')
    test_db.commit()
    return candidate,job,app,mailbox,row


def test_matching_uses_encrypted_body_without_mutating_state(test_db, matching_case):
    _,_,app,box,row=matching_case
    before=(row.body,row.snippet,app.status,app.status_revision,row.application_id)
    assert matching_application_id(test_db,box,row)==app.id
    assert classification_text(row)[1].startswith('Java Backend Engineer')
    test_db.flush()
    assert (row.body,row.snippet,app.status,app.status_revision,row.application_id)==before
    assert test_db.query(ApplicationStatusEvent).count()==0


@pytest.mark.parametrize('subject',[
 'Senior Java Backend Engineer at Alderbyte Systems',
 'Java Backend Engineer II at Alderbyte Systems',
 'Java Backend Engineer at Alderbyte Systems International',
 'Backend Engineer at Alderbyte Systems','Java Backend Engineer at Alderbyte',
 'Offer interview assessment','Java Backend Engineer at Unrelated Company'])
def test_partial_or_unrelated_names_do_not_match(test_db,matching_case,subject):
    _,_,_,box,row=matching_case
    row.subject=subject; row.body=encrypt_content('Please respond.');row.snippet=''
    assert matching_application_id(test_db,box,row) is None


@pytest.mark.parametrize('field',['firm_id','candidate_id','mailbox_id','source_address','deleted_at'])
def test_wrong_scope_source_or_deleted_mail_is_not_matched(test_db,matching_case,field):
    import uuid
    _,_,_,box,row=matching_case
    value='old@example.test' if field=='source_address' else utcnow() if field=='deleted_at' else uuid.uuid4()
    setattr(row,field,value)
    assert matching_application_id(test_db,box,row) is None
    test_db.rollback()


def test_never_submitted_saved_draft_does_not_match(test_db,matching_case):
    _,_,app,box,row=matching_case
    app.status='saved';app.submitted_by_user_id=None
    test_db.commit()
    assert matching_application_id(test_db,box,row) is None


def test_deleted_or_old_source_thread_cannot_supply_identity(test_db,matching_case):
    _,_,app,box,row=matching_case
    linked=email(test_db,box,key='linked',application_id=app.id)
    linked.source_address=box.address; linked.deleted_at=utcnow()
    row.subject='Please respond';row.body=encrypt_content('Thanks.');row.snippet=''
    test_db.commit()
    assert matching_application_id(test_db,box,row,allow_thread=True) is None
    linked.deleted_at=None;linked.source_address='previous@example.test';test_db.commit()
    assert matching_application_id(test_db,box,row,allow_thread=True) is None
    linked.source_address=box.address;test_db.commit()
    assert matching_application_id(test_db,box,row) is None
    assert matching_application_id(test_db,box,row,allow_thread=True)==app.id


def test_company_alias_is_complete_and_registered(test_db,matching_case):
    _,_,app,box,row=matching_case
    test_db.add(Company(name='Alderbyte Systems',aliases=['Alderbyte Digital']))
    row.body=encrypt_content('Java Backend Engineer at Alderbyte Digital. Assessment requested.')
    test_db.commit()
    assert matching_application_id(test_db,box,row)==app.id


def test_key_failure_does_not_fall_back_to_ciphertext(test_db,matching_case,monkeypatch):
    import backend.inbox.application_matching as matcher
    _,_,_,box,row=matching_case
    def failure(value): raise RuntimeError('Email key unavailable')
    monkeypatch.setattr(matcher,'decrypt_content',failure)
    with pytest.raises(RuntimeError): matching_application_id(test_db,box,row)


def test_snippet_fallback_is_decrypted(test_db,matching_case):
    _,_,app,box,row=matching_case
    row.body=None;row.snippet=encrypt_content('Java Backend Engineer at Alderbyte Systems.')
    assert matching_application_id(test_db,box,row)==app.id


def test_no_fixture_specific_title_stripping(test_db,matching_case):
    _,_,app,box,row=matching_case
    _rename(app, title='[QA-01] Java Backend Engineer (Synthetic)')
    test_db.commit()
    assert matching_application_id(test_db,box,row) is None


@pytest.mark.parametrize('body',[
 'Please respond.\n-- \nJava Backend Engineer at Alderbyte Systems',
 'Thanks.\nOn Monday recruiter wrote:\nJava Backend Engineer at Alderbyte Systems',
 '> Java Backend Engineer at Alderbyte Systems\nPlease respond.',
 'Please respond.\nBest regards,\nJava Backend Engineer at Alderbyte Systems'])
def test_signature_and_quoted_history_are_not_identity(test_db,matching_case,body):
    _,_,_,box,row=matching_case
    row.subject='Please respond';row.body=encrypt_content(body);row.snippet=''
    assert matching_application_id(test_db,box,row) is None


def test_multiple_complete_matches_stay_ambiguous(test_db,matching_case):
    candidate,_,app,box,row=matching_case
    second=posting_for(test_db,app.firm_id,candidate.id,title='Java Backend Engineer',company='Alderbyte Systems',
                       url='https://example.test/another-posting')
    test_db.add(Application(firm_id=app.firm_id,candidate_id=candidate.id,job_id=second.id,
        status='applied',applied_at=app.applied_at,submitted_by_user_id=app.submitted_by_user_id))
    test_db.commit()
    assert matching_application_id(test_db,box,row) is None


def test_html_quoted_history_does_not_supply_identity(test_db, matching_case):
    _, _, _, box, row = matching_case
    row.subject = 'Please respond'
    row.body = encrypt_content('<html><body><p>Thanks.</p><blockquote>'
                               'Java Backend Engineer at Alderbyte Systems'
                               '</blockquote></body></html>')
    assert matching_application_id(test_db, box, row) is None


def test_ambiguous_thread_is_not_overridden_by_body(test_db, matching_case):
    candidate, _, app, box, row = matching_case
    job = posting_for(test_db, app.firm_id, candidate.id, title='Platform Engineer', company='Another Company',
                      url='https://example.test/thread-other')
    other = Application(firm_id=app.firm_id, candidate_id=candidate.id,
                        job_id=job.id, status='applied', applied_at=app.applied_at,
                        submitted_by_user_id=app.submitted_by_user_id)
    test_db.add(other)
    test_db.flush()
    for key, application in [('thread-one', app), ('thread-two', other)]:
        linked = email(test_db, box, key=key, application_id=application.id)
        linked.source_address = box.address
    test_db.commit()
    assert matching_application_id(test_db, box, row, allow_thread=True) is None


@pytest.mark.parametrize(('company', 'title', 'body'), [
    ('Alderbyte Systems', 'C++ Developer', 'C++ Developer at Alderbyte Systems.'),
    ('Alderbyte Systems', '.NET Developer', '.NET Developer at Alderbyte Systems.'),
    ('Alderbyte & Sons', 'Backend Engineer', 'Backend Engineer at Alderbyte and Sons.'),
    ('Alderbyte Systems', 'Backend Engineer', 'Ｂａｃｋｅｎｄ Engineer at Alderbyte Systems.'),
])
def test_complete_names_normalize_without_fuzzy_matching(
        test_db, matching_case, company, title, body):
    _, _, app, box, row = matching_case
    _rename(app, company=company, title=title)
    row.body = encrypt_content(body)
    test_db.commit()
    assert matching_application_id(test_db, box, row) == app.id


@pytest.mark.parametrize('body', [
    'Java Backend Engineer: please respond.',
    'Alderbyte Systems: please respond.',
    'Interview for a position: please respond.',
])
def test_company_or_title_alone_is_insufficient(test_db, matching_case, body):
    _, _, _, box, row = matching_case
    row.body = encrypt_content(body)
    assert matching_application_id(test_db, box, row) is None


def test_name_cannot_span_subject_and_body(test_db, matching_case):
    _, _, _, box, row = matching_case
    row.subject = 'Java Backend'
    row.body = encrypt_content('Engineer at Alderbyte Systems.')
    assert matching_application_id(test_db, box, row) is None


def test_deleted_content_cannot_be_decrypted(test_db, matching_case):
    _, _, _, _, row = matching_case
    row.deleted_at = utcnow()
    with pytest.raises(ValueError, match='Deleted email'):
        classification_text(row)
