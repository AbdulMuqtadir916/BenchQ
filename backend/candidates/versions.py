"""A candidate's résumé versions and bases (docs/team/resume-versioning.md §4.3, §4.6, §4.7; PR 5).

Every write here runs with the candidate row locked by the caller (`SELECT … FOR UPDATE`), which is what an
assignment locks too: a save, a promote, an upload and a delete for one candidate happen one at a time, and a
permission checked under the lock can't change before the commit. Nothing here commits; the route does, once.

- **Save:** the next version of the résumé the edit came from, whatever was saved in between (two saves from v2 give
  v3 and v4, Abdul); the second is told. An id stands for one exact text (§3.4, §4.5): an item kept as it was keeps
  its id; a changed or new item, bullet or summary gets a new id, while the versions that hold the old text keep theirs.
- **Use as base / pick:** a base's v1 makes that base active; any other version is copied as v1 of a new PROMOTED
  base, or the base already made from it is made active.
- **Upload:** a new UPLOAD base, active, its v1 from the parse (`first_base()` without a form).
- **Delete:** by who made it and by what uses it: deleted, hidden (`archived_at`), or refused (§4.7). Deleting is soft:
  the row stays with `deleted_at`, out of every list and the workflow, so its text and its number are kept.
"""
import copy
import uuid
from dataclasses import dataclass, field

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import load_only

from backend.auth import ledger
from backend.auth.policy import is_lead_role
from backend.auth.scoping import scoped
from backend.candidates import autofill, profile
from backend.candidates.first_base import first_base
from backend.models.candidates import BaseResume, ResumeParse
from backend.models.db import Application, Resume, utcnow
from backend.models.tenancy import User

HEADER = ("full_name", "title", "city", "state", "country", "email", "phone", "work_authorization", "github",
          "linkedin", "summary")
SECTIONS = ("skills", "experiences", "projects", "educations", "certifications", "awards", "languages")
WITH_BULLETS = ("experiences", "projects")


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Not found.")


def _bad(detail) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


# ── Content and item ids ─────────────────────────────────────────────────────

def content_of(row: Resume) -> dict:
    """A version's content: the header columns, the summary and its id, and every section, as stored."""
    return {**{k: getattr(row, k) for k in HEADER}, "summary_id": row.summary_id,
            **{k: copy.deepcopy(getattr(row, k) or []) for k in SECTIONS}}


def _items(content: dict):
    """Every item with an id, bullets included: (id, its fields without the id). A job's or project's fields hold its
    bullets' text, since its claim covers them: a changed, added or removed bullet changes the job too (§4.5). The
    summary is one more item (`summary_id`)."""
    for section in SECTIONS:
        for item in content.get(section) or []:
            bullets = item.get("bullets") or [] if section in WITH_BULLETS else []
            fields = {k: v for k, v in item.items() if k not in ("id", "bullets")}
            if section in WITH_BULLETS:
                fields["bullets"] = [{k: v for k, v in b.items() if k != "id"} for b in bullets]
            yield item.get("id"), fields
            for bullet in bullets:
                yield bullet.get("id"), {k: v for k, v in bullet.items() if k != "id"}
    if content.get("summary_id"):
        yield content["summary_id"], {"summary": content.get("summary")}


def item_ids(content: dict) -> set[str]:
    return {item_id for item_id, _ in _items(content) if item_id}


def _with_ids(source: dict, submitted: dict) -> dict:
    """The submitted content with every id settled (§3.4, §4.5): an item, bullet or summary kept exactly as it was in
    the version edited keeps its id; a changed or new one gets a new id, and the versions holding the old text keep
    theirs. An id the version edited doesn't have is refused, so a save can't take over another item's id."""
    before = dict(_items(source))
    content, seen = copy.deepcopy(submitted), set()

    def settle(item: dict, fields: dict) -> None:
        item_id = item.get("id")
        if item_id and (item_id not in before or item_id in seen):
            raise _bad("This version names an item it doesn't have. Reload the résumé and edit it again.")
        if not item_id or before[item_id] != fields:
            item["id"] = str(uuid.uuid4())
        seen.add(item["id"])

    for item, fields in list(_with_fields(content)):
        settle(item, fields)
    summary = content.get("summary") or None
    if summary is None:
        content["summary_id"] = None
    elif summary == source.get("summary") and source.get("summary_id"):
        content["summary_id"] = source["summary_id"]
    else:
        content["summary_id"] = str(uuid.uuid4())
    return content


def _with_fields(content: dict):
    """(item dict, its fields as _items compares them) for every item and bullet of `content`."""
    for section in SECTIONS:
        for item in content.get(section) or []:
            bullets = item.get("bullets") or [] if section in WITH_BULLETS else []
            fields = {k: v for k, v in item.items() if k not in ("id", "bullets")}
            if section in WITH_BULLETS:
                fields["bullets"] = [{k: v for k, v in b.items() if k != "id"} for b in bullets]
            for bullet in bullets:
                yield bullet, {k: v for k, v in bullet.items() if k != "id"}
            yield item, fields


# ── Reading ──────────────────────────────────────────────────────────────────

def base_numbers(db, candidate) -> dict:
    """"Base 1, 2…" in the order they were made (hidden ones keep their number; deleted ones aren't counted)."""
    ids = scoped(db, BaseResume, candidate.firm_id, BaseResume.id).filter(BaseResume.candidate_id == candidate.id,
                                                                          BaseResume.deleted_at.is_(None)) \
        .order_by(BaseResume.created_at, BaseResume.id).all()
    return {row.id: n for n, row in enumerate(ids, start=1)}


def candidate_base(db, candidate, base_id) -> BaseResume:
    base = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.id == base_id, BaseResume.candidate_id == candidate.id,
                                                            BaseResume.deleted_at.is_(None)).first()
    if base is None:
        raise _not_found()
    return base


def candidate_version(db, candidate, resume_id) -> Resume:
    """One of the candidate's versions (a deleted one is gone, as a missing one)."""
    row = scoped(db, Resume, candidate.firm_id).filter(Resume.id == resume_id, Resume.candidate_id == candidate.id,
                                                       Resume.deleted_at.is_(None)).first()
    if row is None:
        raise _not_found()
    return row


def _group(db, row: Resume):
    """The rows of one résumé: same base, category and job. Deleted rows count: their numbers are never reused."""
    query = scoped(db, Resume, row.firm_id).filter(Resume.base_resume_id == row.base_resume_id,
                                                   Resume.category == row.category)
    return query.filter(Resume.job_id.is_(None) if row.job_id is None else Resume.job_id == row.job_id)


def version_json(row: Resume, *, with_content: bool = False) -> dict:
    out = {"id": str(row.id), "candidate_id": str(row.candidate_id), "base_resume_id": str(row.base_resume_id),
           "category": row.category,
           "job_id": str(row.job_id) if row.job_id else None, "version": row.version, "name": row.name,
           # The headline, so a list can name a base by its role (`<Candidate> · <Role> · Base 2`, docs/04 §4.3).
           "title": row.title,
           "template": row.template, "page_format": row.page_format,
           "created_by_user_id": str(row.created_by_user_id) if row.created_by_user_id else None,
           "created_at": row.created_at.isoformat() if row.created_at else None}
    return {**out, **content_of(row)} if with_content else out


def opened_json(row: Resume, candidate, *, with_autofill: bool = False) -> dict:
    """One version as it is opened: its content and, with `with_autofill` (`?autofill=true`), its autofill, built
    for this read (`autofill.merged`: nothing is written). Only these answers carry it, never the list or a save."""
    out = version_json(row, with_content=True)
    return {**out, "autofill": autofill.merged(candidate, row)} if with_autofill else out


def base_json(base: BaseResume, number: int) -> dict:
    return {"id": str(base.id), "candidate_id": str(base.candidate_id), "number": number, "source": base.source,
            "is_active": base.is_active,
            "resume_parse_id": str(base.resume_parse_id) if base.resume_parse_id else None,
            "promoted_from_resume_id": str(base.promoted_from_resume_id) if base.promoted_from_resume_id else None,
            "archived_at": base.archived_at.isoformat() if base.archived_at else None,
            "created_by_user_id": str(base.created_by_user_id), "created_at": base.created_at.isoformat()}


_LISTED = (Resume.id, Resume.candidate_id, Resume.base_resume_id, Resume.category, Resume.job_id, Resume.version,
           Resume.name, Resume.title, Resume.template, Resume.page_format, Resume.created_by_user_id, Resume.created_at)


def listing(db, candidate) -> dict:
    """Every base with its versions, and the tailored résumés, for the base dropdown and the history. A version some
    base was promoted from carries that base's id (`promoted_to_base_id`): the dropdown leaves it out (§3.2), and so
    does it leave out a hidden base (`archived_at`); the history shows both."""
    return listing_many(db, candidate.firm_id, [candidate.id])[candidate.id]


def listing_many(db, firm_id, candidate_ids) -> dict:
    """`listing()` for many candidates of one firm in two queries: {candidate_id: {"bases", "tailored"}}. Each base
    and tailored résumé names its candidate. `candidate_ids` may be a list or a subquery of ids."""
    bases = scoped(db, BaseResume, firm_id).filter(BaseResume.candidate_id.in_(candidate_ids),
                                                    BaseResume.deleted_at.is_(None)) \
        .order_by(BaseResume.created_at, BaseResume.id).all()
    # The list shows each version's details, never its content: only those columns are read.
    rows = scoped(db, Resume, firm_id).filter(Resume.candidate_id.in_(candidate_ids), Resume.base_resume_id.isnot(None),
                                              Resume.deleted_at.is_(None)) \
        .options(load_only(*_LISTED)).order_by(Resume.version).all()
    promoted_to = {b.promoted_from_resume_id: b.id for b in bases if b.promoted_from_resume_id}
    numbers, counted = {}, {}
    for base in bases:  # "Base 1, 2…" in the order they were made, per candidate (as base_numbers)
        counted[base.candidate_id] = counted.get(base.candidate_id, 0) + 1
        numbers[base.id] = counted[base.candidate_id]

    # Who made what: the BDE can't delete what an owner or manager made (version_removal, base_removal), so the list
    # says so and the tree offers no delete there.
    makers = {b.created_by_user_id for b in bases} | {r.created_by_user_id for r in rows}
    leads = {uid for uid, role in db.query(User.id, User.role).filter(User.id.in_([m for m in makers if m])).all()
             if is_lead_role(role)}

    def entry(row: Resume) -> dict:
        target = promoted_to.get(row.id)
        return {**version_json(row), "promoted_to_base_id": str(target) if target else None,
                "made_by_lead": row.created_by_user_id in leads}

    out = {cid: {"bases": [], "tailored": []} for cid in ({b.candidate_id for b in bases} | {r.candidate_id for r in rows})}
    if isinstance(candidate_ids, (list, tuple, set)):
        for cid in candidate_ids:
            out.setdefault(cid, {"bases": [], "tailored": []})
    by_base: dict = {}
    tailored: dict[tuple, list] = {}
    for row in rows:
        if row.category == "BASE":
            by_base.setdefault(row.base_resume_id, []).append(entry(row))
        else:
            tailored.setdefault((row.candidate_id, row.base_resume_id, row.job_id), []).append(entry(row))
    for base in bases:
        versions = by_base.get(base.id, [])
        out[base.candidate_id]["bases"].append({**base_json(base, numbers[base.id]),
                                                "made_by_lead": base.created_by_user_id in leads
                                                or any(v["made_by_lead"] for v in versions),
                                                "versions": versions})
    jobs = _job_names(db, firm_id, {j for (_, _, j) in tailored})
    for (cid, b, j), v in tailored.items():
        out[cid]["tailored"].append({"candidate_id": str(cid), "base_resume_id": str(b), "job_id": str(j),
                                     "job": jobs.get(j), "versions": v})
    return out


def _job_names(db, firm_id, job_ids) -> dict:
    """{posting id: {"title", "company"}} for the tailored résumés' jobs, so a list names each copy by its own job
    without the screen loading any jobs (Zuhair 2026-11-12: a candidate's screens read only that candidate's jobs).
    Only the two fields are read, never the posting's description; each source's reader cleans them."""
    if not job_ids:
        return {}
    from backend.job_search import providers
    from backend.models.job_search import JobPosting
    rows = scoped(db, JobPosting, firm_id).filter(JobPosting.id.in_(job_ids)) \
        .with_entities(JobPosting.id, JobPosting.source, JobPosting.content["title"].astext,
                       JobPosting.content["company"].astext).all()
    out = {}
    for posting_id, source, title, company in rows:
        reader = providers.reader_for(source)
        fields = reader.read({"title": title, "company": company}) if reader else None
        out[posting_id] = {"title": fields.title if fields else (title or ""),
                           "company": fields.company if fields else (company or "")}
    return out


# ── Writing ──────────────────────────────────────────────────────────────────

def _label(candidate, number: int, row: Resume | None = None) -> str:
    text = f"{candidate.full_name} · Base {number}"
    return f"{text} v{row.version}" if row is not None else text


def _record(db, actor: User, candidate, action: str, entity_id, label: str, summary: str) -> None:
    ledger.record(db, actor=actor, action=action, entity_type="resume", entity_id=entity_id, entity_label=label,
                  firm_id=candidate.firm_id, summary=summary, candidate_id=candidate.id)


def _activate(db, candidate, base: BaseResume) -> None:
    """`base` becomes the one the workflow uses; the previous one is switched off first (the database allows one)."""
    scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.candidate_id == candidate.id, BaseResume.is_active,
                                                     BaseResume.id != base.id) \
        .update({BaseResume.is_active: False}, synchronize_session="fetch")
    db.flush()
    base.is_active = True
    db.flush()
    # The candidate's name and contact are the active base's (07 Q57): forget the ones read from the old base, so the
    # ledger entry written next and the response carry the new ones (Abdul's PR 7 review, #3).
    profile.refresh(candidate)


@dataclass
class Saved:
    row: Resume
    notice: str | None = None


def save_version(db, actor: User, candidate, source: Resume, submitted: dict) -> Saved:
    """The next version of `source`'s résumé with `submitted` as its content (§4.3)."""
    before = content_of(source)
    content = _with_ids(before, submitted)
    if content == before:
        raise _bad("No changes to save.")
    latest = _group(db, source).with_entities(func.max(Resume.version)).scalar() or source.version
    # The autofill entries the user typed go to the next version with the résumé (the built answers aren't stored). An
    # edit applies there only while its built answer is the one it replaced, so the new text still shows.
    row = Resume(firm_id=candidate.firm_id, candidate_id=candidate.id, base_resume_id=source.base_resume_id,
                 category=source.category, job_id=source.job_id, version=latest + 1, name=source.name,
                 template=source.template, page_format=source.page_format, created_by_user_id=actor.id,
                 autofill=copy.deepcopy(autofill.entries_of(source)), **content)
    db.add(row)
    db.flush()
    profile.refresh(candidate)              # a new newest version may change the name (07 Q57; review #3)
    number = base_numbers(db, candidate)[source.base_resume_id]
    kind = "" if source.category == "BASE" else " (tailored)"
    _record(db, actor, candidate, "UPDATE", row.id, _label(candidate, number, row),
            f"Saved Base {number}{kind} v{row.version} (from v{source.version})")
    notice = None
    if latest > source.version:
        notice = (f"v{latest} was saved while you were editing; your v{row.version} doesn't include those changes.")
    return Saved(row, notice)


def use_as_base(db, actor: User, candidate, row: Resume) -> BaseResume:
    """"Use this as the base?" Yes, or a pick in the base dropdown: the base the workflow uses from now on (§4.3)."""
    numbers = base_numbers(db, candidate)
    if row.category == "BASE" and row.version == 1:
        target = candidate_base(db, candidate, row.base_resume_id)
    else:                                                       # (deleted ones included: they come back, see below)
        target = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.promoted_from_resume_id == row.id).first()
    if target is not None and target.deleted_at is not None:
        # Promoted before, deleted since: it comes back, named by the version it was made from.
        how = f"by using Base {numbers[row.base_resume_id]}{'' if row.category == 'BASE' else ' (tailored)'} v{row.version} again"
        return restore_base(db, actor, candidate, target, how=how)
    if target is not None:
        if target.archived_at is not None:
            raise HTTPException(status_code=409, detail=f"Base {numbers[target.id]} is hidden. Show it again first.")
        if not target.is_active:
            _activate(db, candidate, target)
            _record(db, actor, candidate, "STATE_CHANGE", target.id, _label(candidate, numbers[target.id]),
                    f"Made Base {numbers[target.id]} the base the workflow uses")
        return target

    base = BaseResume(id=uuid.uuid4(), firm_id=candidate.firm_id, candidate_id=candidate.id, source="PROMOTED",
                      promoted_from_resume_id=row.id, created_by_user_id=actor.id)
    db.add(base)
    db.flush()
    _activate(db, candidate, base)
    copied = Resume(firm_id=candidate.firm_id, candidate_id=candidate.id, base_resume_id=base.id, category="BASE",
                    job_id=None, version=1, name=row.name, template=row.template, page_format=row.page_format,
                    created_by_user_id=actor.id, autofill=copy.deepcopy(autofill.entries_of(row)), **content_of(row))
    db.add(copied)
    db.flush()
    number = len(numbers) + 1
    source = f"Base {numbers[row.base_resume_id]}{'' if row.category == 'BASE' else ' (tailored)'} v{row.version}"
    _record(db, actor, candidate, "CREATE", base.id, _label(candidate, number),
            f"Made Base {number} from {source}; the workflow uses it")
    return base


def kept_file(db, candidate, sha256: str) -> ResumeParse | None:
    """The candidate's kept upload of this exact file, if any (§4.6)."""
    return scoped(db, ResumeParse, candidate.firm_id).filter(ResumeParse.candidate_id == candidate.id,
                                                             ResumeParse.content_sha256 == sha256).first()


def uploaded_file(db, candidate, row: Resume) -> ResumeParse | None:
    """The kept upload `row` is: an uploaded base's version 1 is its file as read (§4.6), so the file can stand for it
    on a form. A later version, a tailored one or a promoted base's has no file of its own (07 Q49)."""
    if row.category != "BASE" or row.version != 1 or row.job_id is not None:
        return None
    base = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.id == row.base_resume_id,
                                                            BaseResume.deleted_at.is_(None)).first()
    if base is None or base.source != "UPLOAD" or base.resume_parse_id is None:
        return None
    return scoped(db, ResumeParse, candidate.firm_id).filter(ResumeParse.id == base.resume_parse_id,
                                                             ResumeParse.candidate_id == candidate.id).first()


def deleted_base_for(db, candidate, parse_row: ResumeParse) -> BaseResume | None:
    """The deleted base this kept upload made, if any: uploading the same file again brings it back (§4.7)."""
    return scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.resume_parse_id == parse_row.id,
                                                            BaseResume.deleted_at.isnot(None)).first()


def restore_base(db, actor: User, candidate, base: BaseResume, how: str = "from the same file") -> BaseResume:
    """A deleted base back, from what was stored: no new read of the file, no AI. Only its v1 (the file's own content)
    comes back; later edits stay deleted. It becomes the base the workflow uses, as any upload does (§4.7). `how` says
    what brought it back for the ledger: the same file uploaded again, or the version it was promoted from used again."""
    base.deleted_at = None
    base.archived_at = None
    db.flush()
    scoped(db, Resume, candidate.firm_id).filter(Resume.base_resume_id == base.id, Resume.category == "BASE",
                                                 Resume.version == 1).update({Resume.deleted_at: None},
                                                                              synchronize_session="fetch")
    _activate(db, candidate, base)
    db.flush()
    number = base_numbers(db, candidate)[base.id]
    _record(db, actor, candidate, "STATE_CHANGE", base.id, _label(candidate, number),
            f"Restored Base {number} (its v1) {how}; the workflow uses it")
    return base


def already_uploaded(db, candidate, parse_row: ResumeParse) -> HTTPException | None:
    """The answer for a file the candidate already has: its base, or an offer to show a hidden one. None when the
    upload has no base yet (a candidate created before bases existed), so it can still become one."""
    base = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.resume_parse_id == parse_row.id,
                                                            BaseResume.deleted_at.is_(None)).first()
    if base is None:
        return None
    number = base_numbers(db, candidate)[base.id]
    if base.archived_at is not None:
        message = f"This résumé is Base {number} (hidden). Show it again?"
    else:
        message = f"This résumé is already Base {number}."
    return HTTPException(status_code=409, detail={"message": message, "base_resume_id": str(base.id),
                                                  "hidden": base.archived_at is not None})


def upload_base(db, actor: User, candidate, parse_row: ResumeParse) -> BaseResume:
    """A new UPLOAD base from a kept upload, active, its v1 from the parse alone (§4.6)."""
    base, version = first_base(parse_row, candidate, None, actor.id)
    base.is_active = False
    db.add(base)
    db.flush()
    _activate(db, candidate, base)
    db.add(version)
    db.flush()
    number = base_numbers(db, candidate)[base.id]
    _record(db, actor, candidate, "CREATE", base.id, _label(candidate, number),
            f"Uploaded a new résumé ({parse_row.file_name}) as Base {number}; the workflow uses it")
    return base


def show_again(db, actor: User, candidate, base: BaseResume) -> BaseResume:
    """A hidden base back in the dropdown, not active: the BDE picks it to use it (§4.7)."""
    if base.archived_at is not None:
        base.archived_at = None
        number = base_numbers(db, candidate)[base.id]
        _record(db, actor, candidate, "STATE_CHANGE", base.id, _label(candidate, number), f"Showed Base {number} again")
    return base


# ── Deleting ─────────────────────────────────────────────────────────────────

@dataclass
class Removal:
    """What a delete would do, for the warning and for the delete itself: DELETE, HIDE or REFUSED."""
    outcome: str
    message: str
    uses: dict = field(default_factory=dict)
    rest: dict = field(default_factory=dict)      # HIDE: what "keep what is in use, delete the rest" would delete
    plan: tuple = field(default=(), repr=False)   # HIDE: the (versions, tailored) rows `rest` counts; never sent

    def json(self) -> dict:
        return {"outcome": self.outcome, "message": self.message, "uses": self.uses, "rest": self.rest}


_USE_WORDS = {"applications": ("used by {} live application", "used by {} live applications"),
              "tailored": ("{} tailored résumé sent in a live application", "{} tailored résumés sent in live applications")}


def _phrase(uses: dict) -> str:
    parts = [_USE_WORDS[k][0 if n == 1 else 1].format(n) for k, n in uses.items() if n]
    text = ", ".join(parts)
    return text[:1].upper() + text[1:]


# An application stops keeping a résumé in use when it is rejected: `move_on` in the application tracker, `rejected` in the
# older API (docs/team/resume-versioning.md §4.7). Anything else, or no status, is live.
NOT_LIVE = ("move_on", "rejected")


def _live_applications(db, firm_id):
    return scoped(db, Application, firm_id).filter(
        or_(Application.status.is_(None), func.lower(Application.status).notin_(NOT_LIVE)))


def _live_counts(db, firm_id) -> dict:
    """{résumé id: how many live applications were sent with it}, in one query. Computed once per request and passed
    on, so a preview or a cleanup over many versions doesn't scan the firm's applications for each."""
    rows = _live_applications(db, firm_id).filter(Application.resume_id.isnot(None)) \
        .with_entities(Application.resume_id, func.count(Application.id)).group_by(Application.resume_id).all()
    return {rid: n for rid, n in rows}


def _tailored_of(db, candidate, base: BaseResume) -> list[Resume]:
    return scoped(db, Resume, candidate.firm_id).filter(
        Resume.base_resume_id == base.id, Resume.category == "TAILORED", Resume.deleted_at.is_(None)).all()


def _uses(db, candidate, rows: list[Resume], base: BaseResume | None = None, live: dict | None = None) -> dict:
    """What keeps these rows (and, for a whole base, the base) in use: a live application sent with them, or a
    tailored résumé of the base sent in a live application. Cover letters and tracking links aren't counted (Zuhair,
    2026-11-04: not planned for BenchQ yet)."""
    firm_id, ids = candidate.firm_id, [r.id for r in rows]
    live = _live_counts(db, firm_id) if live is None else live
    uses = {"applications": sum(live.get(rid, 0) for rid in ids), "tailored": 0}
    if base is not None:
        uses["tailored"] = sum(1 for t in _tailored_of(db, candidate, base) if t.id in live)
    return uses


def _made_by_lead(db, user_ids) -> bool:
    roles = db.query(User.role).filter(User.id.in_([u for u in user_ids if u is not None])).all()
    return any(is_lead_role(role) for (role,) in roles)


def version_removal(db, candidate, row: Resume) -> Removal:
    if row.category != "BASE":
        return Removal("REFUSED", "A tailored résumé isn't deleted here.")
    if row.version == 1:
        return Removal("REFUSED", "Version 1 is the base itself. Delete the whole base instead.")
    if _made_by_lead(db, [row.created_by_user_id]):
        return Removal("REFUSED", f"v{row.version} was added by an owner or manager, so it can't be deleted.")
    uses = _uses(db, candidate, [row])
    if any(uses.values()):
        return Removal("REFUSED", f"Can't delete v{row.version}: {_phrase(uses).lower()}.", uses)
    return Removal("DELETE", f"Delete v{row.version}? It's removed from view; the ledger keeps the record.", uses)


def base_removal(db, candidate, base: BaseResume, numbers: dict | None = None) -> Removal:
    number = (numbers or base_numbers(db, candidate))[base.id]
    if base.is_active:
        return Removal("REFUSED", f"Base {number} is the base the workflow uses. Pick another base first.")
    if base.archived_at is not None:
        return Removal("REFUSED", f"Base {number} is already hidden.")
    rows = scoped(db, Resume, candidate.firm_id).filter(Resume.base_resume_id == base.id, Resume.category == "BASE",
                                                        Resume.deleted_at.is_(None)).all()
    if _made_by_lead(db, [base.created_by_user_id, *(r.created_by_user_id for r in rows)]):
        return Removal("REFUSED", f"Base {number} holds what an owner or manager added, so it can't be deleted.")
    live = _live_counts(db, candidate.firm_id)
    uses = _uses(db, candidate, rows, base, live)
    tailored = _tailored_of(db, candidate, base)
    if any(uses.values()):
        rest = _rest(db, candidate, base, rows, tailored, live)
        counts = {"versions": len(rest[0]), "tailored": len(rest[1])}
        return Removal("HIDE", f"{_phrase(uses)}. Base {number} will be hidden: out of the base list, kept in the "
                               "history and on everything that uses it. Keep what is in use and delete the rest "
                               f"({_rest_words(counts)})?", uses, counts, rest)
    extra = f" and {len(tailored)} tailored résumé{'' if len(tailored) == 1 else 's'} nobody sent" if tailored else ""
    return Removal("DELETE", f"Delete Base {number} and its {len(rows)} version{'' if len(rows) == 1 else 's'}{extra}? "
                             "They're removed from view; the ledger keeps the record. Uploading the same file again "
                             "brings the base's version 1 back.", uses)


def _rest(db, candidate, base: BaseResume, rows: list[Resume], tailored: list[Resume], live: dict):
    """What "keep what is in use, delete the rest" deletes from a base that is in use: its versions after v1 that nothing
    uses (v1 is the base itself and stays), and the tailored résumés no live application was sent with."""
    versions = [r for r in rows if r.version > 1 and not _made_by_lead(db, [r.created_by_user_id])
                and not any(_uses(db, candidate, [r], live=live).values())]
    return versions, [t for t in tailored if t.id not in live]


def _rest_words(counts: dict) -> str:
    parts = [f"{n} unused version{'' if n == 1 else 's'}" if k == "versions" else
             f"{n} tailored résumé{'' if n == 1 else 's'} nobody sent" for k, n in counts.items() if n]
    return ", ".join(parts) or "nothing else"


def delete_version(db, actor: User, candidate, row: Resume) -> Removal:
    removal = version_removal(db, candidate, row)
    if removal.outcome == "REFUSED":
        raise HTTPException(status_code=409, detail=removal.message)
    number = base_numbers(db, candidate)[row.base_resume_id]
    _record(db, actor, candidate, "DELETE", row.id, _label(candidate, number, row),
            f"Deleted Base {number} v{row.version}")
    row.deleted_at = utcnow()
    db.flush()
    return removal


def delete_base(db, actor: User, candidate, base: BaseResume, keep_used: bool = False) -> Removal:
    """Delete a base, or hide it when something uses it. With `keep_used`, a base that is in use is hidden and what
    nothing uses is deleted with a soft delete: its versions after v1 and the tailored résumés no live application was
    sent with (docs/team/resume-versioning.md §4.7)."""
    numbers = base_numbers(db, candidate)
    removal = base_removal(db, candidate, base, numbers)
    if removal.outcome == "REFUSED":
        raise HTTPException(status_code=409, detail=removal.message)
    number = numbers[base.id]
    if removal.outcome == "HIDE":
        base.archived_at = utcnow()
        summary = f"Hid Base {number}"
        if keep_used:
            versions, tailored = removal.plan                  # worked out once, by the preview above
            now = utcnow()
            for row in (*versions, *tailored):
                row.deleted_at = now
            summary += f" and deleted {_rest_words({'versions': len(versions), 'tailored': len(tailored)})}"
        _record(db, actor, candidate, "STATE_CHANGE", base.id, _label(candidate, number), summary)
        db.flush()
        return removal
    # Soft delete: a base with version rows can't be removed from the table anyway (the versions point at it), and
    # nothing is lost: its versions are marked with it, its upload stays (so the same file is recognised later).
    now = utcnow()
    _record(db, actor, candidate, "DELETE", base.id, _label(candidate, number), f"Deleted Base {number}")
    scoped(db, Resume, candidate.firm_id).filter(Resume.base_resume_id == base.id, Resume.deleted_at.is_(None)) \
        .update({Resume.deleted_at: now}, synchronize_session="fetch")
    base.deleted_at = now
    db.flush()
    return removal
