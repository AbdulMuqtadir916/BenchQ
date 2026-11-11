"""A job as an application names it since migration 0025: one of its candidate's `job_postings`, in its own batch."""
import hashlib
import uuid


def posting_for(db, firm_id, candidate_id, *, title="Java Developer", company="Acme Corp", url=None,
                description="", location=None, source="manual", old_job_id=None):
    """A posting of `candidate_id`'s, with the fields the readers use (`backend.applications.postings.posting_job`).
    `old_job_id`: the old `jobs` row it was moved from, as the local move script records it."""
    from backend.models.job_search import JobPosting, ScrapeJob

    batch = ScrapeJob(firm_id=firm_id, candidate_id=candidate_id, batch_id=uuid.uuid4(), state="success",
                      meta={"kind": "capture", "request": {"source": source}})
    db.add(batch)
    db.flush()
    content = {key: value for key, value in {"title": title, "company": company, "url": url,
                                             "description": description, "location": location}.items() if value}
    if old_job_id is not None:
        content["old_job_id"] = str(old_job_id)
    posting = JobPosting(firm_id=firm_id, candidate_id=candidate_id, batch_id=batch.batch_id, source=source,
                         job_id=hashlib.sha256(uuid.uuid4().bytes).hexdigest(), content=content)
    db.add(posting)
    db.flush()
    return posting
