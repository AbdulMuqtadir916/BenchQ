"""A candidate's résumé versions and bases (docs/team/resume-versioning.md §4.3, §4.6, §4.7; PR 5).

Every write here runs with the candidate row locked by the caller (`SELECT … FOR UPDATE`), which is what an
assignment locks too: a save, a promote, an upload and a delete for one candidate happen one at a time, and a
permission checked under the lock can't change before the commit. Nothing here commits; the route does, once.

- **Save:** the next version of the résumé the edit came from, whatever was saved in between (two saves from v2 give
  v3 and v4, Abdul); the second is told. Item ids come from the version edited; new items get one. Changed items'
  claims go back to UNVERIFIED (§4.5).
- **Use as base / pick:** a base's v1 makes that base active; any other version is copied as v1 of a new PROMOTED
  base, or the base already made from it is made active.
- **Upload:** a new UPLOAD base, active, its v1 from the parse (`first_base()` without a form).
- **Delete:** by who made it and by what uses it: deleted, hidden (`archived_at`), or refused (§4.7).
"""
import copy
import uuid
from dataclasses import dataclass, field

from fastapi import HTTPException
from sqlalchemy import func, or_

from backend.auth import ledger
from backend.auth.policy import is_lead_role
from backend.auth.scoping import scoped
from backend.candidates.first_base import first_base
from backend.models.candidates import BaseResume, Claim, Evidence, ResumeParse
from backend.models.db import Application, CoverLetter, Resume, TracerLink, utcnow
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
    """A version's content: the header columns, the summary and every section, as stored."""
    return {**{k: getattr(row, k) for k in HEADER}, **{k: copy.deepcopy(getattr(row, k) or []) for k in SECTIONS}}


def _items(content: dict):
    """Every item with an id, bullets included: (id, its own fields without the id or the bullets)."""
    for section in SECTIONS:
        for item in content.get(section) or []:
            yield item.get("id"), {k: v for k, v in item.items() if k not in ("id", "bullets")}
            for bullet in item.get("bullets") or [] if section in WITH_BULLETS else []:
                yield bullet.get("id"), {k: v for k, v in bullet.items() if k != "id"}


def item_ids(content: dict) -> set[str]:
    return {item_id for item_id, _ in _items(content) if item_id}


def _with_ids(source: dict, submitted: dict) -> dict:
    """The submitted content with every item's id settled: an id from the version edited is kept, an item without one
    is new and gets one. Any other id is refused, so a save can't take over another item's claim (§3.4)."""
    known, seen = item_ids(source), set()
    content = copy.deepcopy(submitted)

    def settle(item: dict) -> None:
        item_id = item.get("id")
        if not item_id:
            item["id"] = str(uuid.uuid4())
        elif item_id not in known or item_id in seen:
            raise _bad("This version names an item it doesn't have. Reload the résumé and edit it again.")
        seen.add(item["id"])

    for section in SECTIONS:
        for item in content.get(section) or []:
            settle(item)
            for bullet in item.get("bullets") or [] if section in WITH_BULLETS else []:
                settle(bullet)
    return content


def _changed_refs(source: dict, content: dict) -> set[str]:
    """The ids of items kept from the version edited whose own text changed."""
    before = dict(_items(source))
    return {item_id for item_id, fields in _items(content) if item_id in before and before[item_id] != fields}


def _reset_claims(db, candidate, refs: set[str], summary_changed: bool) -> None:
    """A changed item's claims go back to UNVERIFIED (§4.5); their evidence stays linked for the person to re-check."""
    conditions = []
    if refs:
        conditions.append(Claim.entity_ref.in_(refs))
    if summary_changed:
        conditions.append(Claim.entity_type == "summary")
    if not conditions:
        return
    scoped(db, Claim, candidate.firm_id).filter(Claim.candidate_id == candidate.id, Claim.state != "UNVERIFIED",
                                                or_(*conditions)) \
        .update({Claim.state: "UNVERIFIED", Claim.updated_at: utcnow()}, synchronize_session=False)


# ── Reading ──────────────────────────────────────────────────────────────────

def base_numbers(db, candidate) -> dict:
    """"Base 1, 2…" in the order they were made (hidden ones keep their number)."""
    ids = scoped(db, BaseResume, candidate.firm_id, BaseResume.id).filter(BaseResume.candidate_id == candidate.id) \
        .order_by(BaseResume.created_at, BaseResume.id).all()
    return {row.id: n for n, row in enumerate(ids, start=1)}


def candidate_base(db, candidate, base_id) -> BaseResume:
    base = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.id == base_id,
                                                            BaseResume.candidate_id == candidate.id).first()
    if base is None:
        raise _not_found()
    return base


def candidate_version(db, candidate, resume_id) -> Resume:
    """One of the candidate's versions."""
    row = scoped(db, Resume, candidate.firm_id).filter(Resume.id == resume_id, Resume.candidate_id == candidate.id).first()
    if row is None:
        raise _not_found()
    return row


def _group(db, row: Resume):
    """The rows of one résumé: same base, category and job."""
    query = scoped(db, Resume, row.firm_id).filter(Resume.base_resume_id == row.base_resume_id,
                                                   Resume.category == row.category)
    return query.filter(Resume.job_id.is_(None) if row.job_id is None else Resume.job_id == row.job_id)


def version_json(row: Resume, *, with_content: bool = False) -> dict:
    out = {"id": str(row.id), "base_resume_id": str(row.base_resume_id), "category": row.category,
           "job_id": str(row.job_id) if row.job_id else None, "version": row.version, "name": row.name,
           "template": row.template, "page_format": row.page_format,
           "created_by_user_id": str(row.created_by_user_id) if row.created_by_user_id else None,
           "created_at": row.created_at.isoformat() if row.created_at else None}
    return {**out, **content_of(row)} if with_content else out


def base_json(base: BaseResume, number: int) -> dict:
    return {"id": str(base.id), "number": number, "source": base.source, "is_active": base.is_active,
            "resume_parse_id": str(base.resume_parse_id) if base.resume_parse_id else None,
            "promoted_from_resume_id": str(base.promoted_from_resume_id) if base.promoted_from_resume_id else None,
            "archived_at": base.archived_at.isoformat() if base.archived_at else None,
            "created_by_user_id": str(base.created_by_user_id), "created_at": base.created_at.isoformat()}


def listing(db, candidate) -> dict:
    """Every base with its versions, and the tailored résumés, for the base dropdown and the history. A version some
    base was promoted from carries that base's id (`promoted_to_base_id`): the dropdown leaves it out (§3.2), and so
    does it leave out a hidden base (`archived_at`); the history shows both."""
    numbers = base_numbers(db, candidate)
    bases = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.candidate_id == candidate.id).all()
    promoted_to = {b.promoted_from_resume_id: b.id for b in bases if b.promoted_from_resume_id}
    rows = scoped(db, Resume, candidate.firm_id).filter(Resume.candidate_id == candidate.id,
                                                        Resume.base_resume_id.isnot(None)) \
        .order_by(Resume.version).all()

    def entry(row: Resume) -> dict:
        target = promoted_to.get(row.id)
        return {**version_json(row), "promoted_to_base_id": str(target) if target else None}

    out_bases = []
    for base in sorted(bases, key=lambda b: numbers[b.id]):
        versions = [entry(r) for r in rows if r.base_resume_id == base.id and r.category == "BASE"]
        out_bases.append({**base_json(base, numbers[base.id]), "versions": versions})
    tailored: dict[tuple, list] = {}
    for row in rows:
        if row.category == "TAILORED":
            tailored.setdefault((row.base_resume_id, row.job_id), []).append(entry(row))
    return {"bases": out_bases,
            "tailored": [{"base_resume_id": str(b), "job_id": str(j), "versions": v} for (b, j), v in tailored.items()]}


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
    row = Resume(firm_id=candidate.firm_id, candidate_id=candidate.id, base_resume_id=source.base_resume_id,
                 category=source.category, job_id=source.job_id, version=latest + 1, name=source.name,
                 template=source.template, page_format=source.page_format, created_by_user_id=actor.id, **content)
    db.add(row)
    db.flush()
    _reset_claims(db, candidate, _changed_refs(before, content), before["summary"] != content["summary"])
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
    else:
        target = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.promoted_from_resume_id == row.id).first()
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
    db.add(Resume(firm_id=candidate.firm_id, candidate_id=candidate.id, base_resume_id=base.id, category="BASE",
                  job_id=None, version=1, name=row.name, template=row.template, page_format=row.page_format,
                  created_by_user_id=actor.id, **content_of(row)))
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


def already_uploaded(db, candidate, parse_row: ResumeParse) -> HTTPException | None:
    """The answer for a file the candidate already has: its base, or an offer to show a hidden one. None when the
    upload has no base yet (a candidate created before bases existed), so it can still become one."""
    base = scoped(db, BaseResume, candidate.firm_id).filter(BaseResume.resume_parse_id == parse_row.id).first()
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

    def json(self) -> dict:
        return {"outcome": self.outcome, "message": self.message, "uses": self.uses}


_USE_WORDS = {"applications": ("sent to {} job", "sent to {} jobs"),
              "cover_letters": ("used by {} cover letter", "used by {} cover letters"),
              "tracer_links": ("tracked by {} link", "tracked by {} links"),
              "tailored": ("{} tailored résumé made from it", "{} tailored résumés made from it"),
              "evidence": ("its file backs {} piece of evidence", "its file backs {} pieces of evidence"),
              "claims": ("{} claim only it holds", "{} claims only it holds")}


def _phrase(uses: dict) -> str:
    parts = [_USE_WORDS[k][0 if n == 1 else 1].format(n) for k, n in uses.items() if n]
    text = ", ".join(parts)
    return text[:1].upper() + text[1:]


def _uses(db, candidate, rows: list[Resume], base: BaseResume | None = None) -> dict:
    """What points at these rows (and, for a whole base, at the base and its upload). Claims count only for items no
    other version of the candidate has, since a claim follows its item from version to version."""
    firm_id, ids = candidate.firm_id, [r.id for r in rows]
    uses = {
        "applications": scoped(db, Application, firm_id, func.count(Application.id))
        .filter(Application.resume_id.in_(ids)).scalar(),
        "cover_letters": scoped(db, CoverLetter, firm_id, func.count(CoverLetter.id))
        .filter(CoverLetter.resume_id.in_(ids)).scalar(),
        "tracer_links": scoped(db, TracerLink, firm_id, func.count(TracerLink.id))
        .filter(TracerLink.resume_id.in_(ids)).scalar(),
        "tailored": 0, "evidence": 0, "claims": 0,
    }
    if base is not None:
        uses["tailored"] = scoped(db, Resume, firm_id, func.count(Resume.id)) \
            .filter(Resume.base_resume_id == base.id, Resume.category == "TAILORED").scalar()
        if base.resume_parse_id is not None:
            uses["evidence"] = scoped(db, Evidence, firm_id, func.count(Evidence.id)) \
                .filter(Evidence.resume_parse_id == base.resume_parse_id).scalar()
    removed = set().union(*(item_ids(content_of(r)) for r in rows)) if rows else set()
    if removed:
        others = scoped(db, Resume, firm_id).filter(Resume.candidate_id == candidate.id,
                                                    Resume.base_resume_id.isnot(None), Resume.id.notin_(ids)).all()
        removed -= set().union(set(), *(item_ids(content_of(r)) for r in others))
    if removed:
        uses["claims"] = scoped(db, Claim, firm_id, func.count(Claim.id)) \
            .filter(Claim.candidate_id == candidate.id, Claim.entity_ref.in_(removed)).scalar()
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
    return Removal("DELETE", f"Delete v{row.version}? This can't be undone.", uses)


def base_removal(db, candidate, base: BaseResume) -> Removal:
    number = base_numbers(db, candidate)[base.id]
    if base.is_active:
        return Removal("REFUSED", f"Base {number} is the base the workflow uses. Pick another base first.")
    if base.archived_at is not None:
        return Removal("REFUSED", f"Base {number} is already hidden.")
    rows = scoped(db, Resume, candidate.firm_id).filter(Resume.base_resume_id == base.id,
                                                        Resume.category == "BASE").all()
    if _made_by_lead(db, [base.created_by_user_id, *(r.created_by_user_id for r in rows)]):
        return Removal("REFUSED", f"Base {number} holds what an owner or manager added, so it can't be deleted.")
    uses = _uses(db, candidate, rows, base)
    if any(uses.values()):
        return Removal("HIDE", f"{_phrase(uses)}. Base {number} will be hidden: out of the base list, kept in the "
                               "history and on everything that uses it.", uses)
    return Removal("DELETE", f"Delete Base {number} and its {len(rows)} version{'' if len(rows) == 1 else 's'}? "
                             "This can't be undone.", uses)


def delete_version(db, actor: User, candidate, row: Resume) -> Removal:
    removal = version_removal(db, candidate, row)
    if removal.outcome == "REFUSED":
        raise HTTPException(status_code=409, detail=removal.message)
    number = base_numbers(db, candidate)[row.base_resume_id]
    _record(db, actor, candidate, "DELETE", row.id, _label(candidate, number, row),
            f"Deleted Base {number} v{row.version}")
    db.delete(row)
    db.flush()
    return removal


def delete_base(db, actor: User, candidate, base: BaseResume) -> Removal:
    removal = base_removal(db, candidate, base)
    if removal.outcome == "REFUSED":
        raise HTTPException(status_code=409, detail=removal.message)
    number = base_numbers(db, candidate)[base.id]
    if removal.outcome == "HIDE":
        base.archived_at = utcnow()
        _record(db, actor, candidate, "STATE_CHANGE", base.id, _label(candidate, number), f"Hid Base {number}")
        return removal
    _record(db, actor, candidate, "DELETE", base.id, _label(candidate, number), f"Deleted Base {number}")
    parse_id = base.resume_parse_id
    scoped(db, Resume, candidate.firm_id).filter(Resume.base_resume_id == base.id) \
        .delete(synchronize_session=False)
    db.delete(base)
    db.flush()
    if parse_id is not None:
        # The upload goes too, so the same file can be uploaded fresh later (§4.7).
        scoped(db, ResumeParse, candidate.firm_id).filter(ResumeParse.id == parse_id) \
            .delete(synchronize_session=False)
    return removal
