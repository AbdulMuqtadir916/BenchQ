"""A job as an application names it since migration 0025: one of its candidate's `job_postings`, in its own batch."""
import uuid


def posting_for(db, firm_id, candidate_id, *, title="Java Developer", company="Acme Corp", url=None,
                description="", source="manual"):
    """A posting of `candidate_id`'s, with the fields the readers use (`backend.applications.postings.posting_job`)."""
    from backend.models.job_search import JobPosting, ScrapeJob

    batch = ScrapeJob(firm_id=firm_id, candidate_id=candidate_id, batch_id=uuid.uuid4(), state="success",
                      meta={"kind": "capture", "request": {"source": source}})
    db.add(batch)
    db.flush()
    content = {key: value for key, value in
               {"title": title, "company": company, "url": url, "description": description}.items() if value}
    posting = JobPosting(firm_id=firm_id, candidate_id=candidate_id, batch_id=batch.batch_id, source=source,
                         job_id=uuid.uuid4().hex, content=content)
    db.add(posting)
    db.flush()
    return posting
