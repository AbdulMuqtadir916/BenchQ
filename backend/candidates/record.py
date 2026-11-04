"""The candidate's Record, started from a résumé version (docs/team/zuhair.md §1.3; docs/team/resume-versioning.md §3.4).

One claim per item of the version: the summary, each skill, each job and project and each of their bullets, each
education, certification and award (languages are never printed, so they carry none). A claim points at its item's id
(`claims.entity_ref`), so it follows that exact text from version to version.

Every claim starts UNVERIFIED and this module never makes one VERIFIED: verification is a person's act, with evidence,
and the database refuses it without (`ck_claims_verified_has_evidence`). A claim made from an uploaded file points at one
evidence row for that upload (`evidence.resume_parse_id`); it carries no quote. The parser rewrites the résumé, so
there is no honest per-claim excerpt to take from it: the quote is added when a person verifies a claim. A claim made
from the form alone (a `MANUAL` base) has no evidence.
"""
from backend.auth.scoping import scoped
from backend.models.candidates import Claim, Evidence
from backend.models.db import Resume


def _line(*parts: str | None, sep: str = ", ") -> str:
    return sep.join(p.strip() for p in parts if p and p.strip())


def claim_items(version: Resume):
    """(entity type, item id, text) for every item of the version that carries a claim, in the order it prints."""
    if version.summary and version.summary_id:
        yield "summary", version.summary_id, version.summary
    for skill in version.skills or []:
        yield "skill", skill.get("id"), _line(skill.get("name"))
    for job in version.experiences or []:
        yield "experience", job.get("id"), _line(job.get("job_title"), job.get("company"), job.get("dates"))
        for bullet in job.get("bullets") or []:
            yield "experience", bullet.get("id"), _line(bullet.get("text"))
    for project in version.projects or []:
        yield "project", project.get("id"), _line(project.get("name"), project.get("technologies"))
        for bullet in project.get("bullets") or []:
            yield "project", bullet.get("id"), _line(bullet.get("text"))
    for education in version.educations or []:
        yield "education", education.get("id"), _line(education.get("degree"), education.get("institution"),
                                                      education.get("graduation_date"))
    for certification in version.certifications or []:
        yield "certificate", certification.get("id"), _line(certification.get("name"), certification.get("issuer"),
                                                            certification.get("date"))
    for award in version.awards or []:
        yield "award", award.get("id"), _line(award.get("name"), award.get("issuer"), award.get("date"))


def _upload_evidence(db, candidate, parse_row) -> Evidence:
    """The one evidence row for an upload: made the first time, reused after."""
    row = scoped(db, Evidence, candidate.firm_id).filter(Evidence.resume_parse_id == parse_row.id).first()
    if row is None:
        row = Evidence(firm_id=candidate.firm_id, candidate_id=candidate.id, resume_parse_id=parse_row.id,
                       source="RESUME_UPLOAD")
        db.add(row)
        db.flush()
    return row


def write_record(db, candidate, version: Resume, parse_row=None, skill_sources: dict[str, str] | None = None) -> int:
    """Add the UNVERIFIED claims for `version`'s items; returns how many. `parse_row` is the upload the version came
    from (None for a form-only base); `skill_sources` maps a skill's name to the source the form recorded for it."""
    default_source = "RESUME_UPLOAD" if parse_row is not None else "MANUAL"
    evidence_id = _upload_evidence(db, candidate, parse_row).id if parse_row is not None else None
    made = 0
    for entity_type, item_id, text in claim_items(version):
        if not item_id or not text:
            continue
        source = (skill_sources or {}).get(text, default_source) if entity_type == "skill" else default_source
        db.add(Claim(firm_id=candidate.firm_id, candidate_id=candidate.id, entity_type=entity_type, entity_ref=item_id,
                     state="UNVERIFIED", text=text, evidence_id=evidence_id, source=source))
        made += 1
    db.flush()
    return made
