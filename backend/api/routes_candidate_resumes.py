"""A candidate's résumé versions and bases (docs/team/resume-versioning.md §4.3, §4.6, §4.7, §6; PR 5). Under the
candidate's URL: another firm, a candidate outside the principal's scope, or a résumé that isn't the candidate's is the
same 404 as a missing one.

- GET    …/resumes                          the bases with their versions, and the tailored résumés
- GET    …/resumes/{resume_id}              one version with its content (`?autofill=true`: and its autofill)
- POST   …/resumes/{resume_id}/save         its next version (the edit), with a notice if another was saved meanwhile
- POST   …/resumes/{resume_id}/use-as-base  "Use this as the base?" Yes, and a pick in the base dropdown
- POST   …/resumes/upload                   a later résumé: a new active base from the parse (the BDE)
- GET    …/resumes/{resume_id}/removal      what deleting this version would do (for the warning)
- DELETE …/resumes/{resume_id}              delete one version
- GET    …/resumes/bases/{base_id}/removal  what deleting this base would do
- DELETE …/resumes/bases/{base_id}          delete or hide a base
- POST   …/resumes/bases/{base_id}/show     show a hidden base again (not made active)

Who (07 Q55): reads, anyone who can see the candidate; save, use as base and pick, `can_change_resume` (the
candidate's BDE, or the OWNER and a MANAGER while it has none); upload, delete and show again, `can_manage_resume`
(the candidate's BDE). Checked with the candidate row locked, so an assignment can't land in between. A support view
reads only (backend/auth/access.py).
"""
import asyncio
import uuid
from datetime import date
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate, _member_of
from backend.auth.policy import can_change_resume, can_manage_resume, require
from backend.auth.sessions import Principal
from backend.candidates import autofill as autofill_answers
from backend.candidates import versions
from backend.candidates.profile_links import ProfileLink
from backend.candidates.parse import DOCX_MIME, MAX_BYTES, PDF_MIME, extract_text, file_kind, read_resume
from backend.models.candidates import ResumeParse, file_sha256
from backend.models.db import get_db
from backend.models.tenancy import User

router = APIRouter(prefix="/firms/{firm_id}/candidates/{candidate_id}/resumes", tags=["candidate résumés"])

Short = Field(default="", max_length=300)


class BulletIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    text: str = Field(default="", max_length=2000)


class SkillIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    category: str = Short
    name: str = Field(min_length=1, max_length=300)


class ExperienceIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    job_title: str = Short
    company: str = Short
    location: str = Short
    dates: str = Short
    start: str = Short
    end: str = Short
    current: bool = False
    bullets: list[BulletIn] = Field(default_factory=list, max_length=100)


class ProjectIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    name: str = Short
    url: str = Field(default="", max_length=500)
    dates: str = Short
    technologies: str = Field(default="", max_length=1000)
    bullets: list[BulletIn] = Field(default_factory=list, max_length=100)


class EducationIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    degree: str = Short
    institution: str = Short
    graduation_date: str = Short
    grade: str = Short


class EntryIn(BaseModel):
    """A certification or an award."""
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=300)
    issuer: str = Short
    date: str = Short
    detail: str = Field(default="", max_length=1000)


class LanguageIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=100)


class ContentIn(BaseModel):
    """A version's whole content, as the editor holds it (the shape of resumes' content columns, §3.3)."""
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]     # mandatory
    title: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, max_length=300)
    state: str | None = Field(default=None, max_length=300)
    country: str | None = Field(default=None, max_length=300)
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=320)]         # mandatory
    phone: str | None = Field(default=None, max_length=300)
    work_authorization: str | None = Field(default=None, max_length=300)
    github: ProfileLink = None
    linkedin: ProfileLink = None
    summary: str | None = Field(default=None, max_length=10000)
    skills: list[SkillIn] = Field(default_factory=list, max_length=500)
    experiences: list[ExperienceIn] = Field(default_factory=list, max_length=100)
    projects: list[ProjectIn] = Field(default_factory=list, max_length=100)
    educations: list[EducationIn] = Field(default_factory=list, max_length=50)
    certifications: list[EntryIn] = Field(default_factory=list, max_length=100)
    awards: list[EntryIn] = Field(default_factory=list, max_length=100)
    languages: list[LanguageIn] = Field(default_factory=list, max_length=50)

    def stored(self) -> dict:
        """As the columns hold it: blank header text is NULL, as the first base writes it; ids left for the save."""
        data = self.model_dump()
        for key in versions.HEADER:
            data[key] = (data[key] or "").strip() or None
        for section in versions.SECTIONS:
            for item in data[section]:
                if item.get("id") is None:
                    item.pop("id")
                for bullet in item.get("bullets", []):
                    if bullet.get("id") is None:
                        bullet.pop("id")
        return data


def _forbidden() -> HTTPException:
    return HTTPException(status_code=403, detail="This candidate's BDE changes their résumés; you can view them.")


def _writer(db: DbSession, firm_id: uuid.UUID, principal: Principal, candidate_id: uuid.UUID, check):
    """The candidate, locked, once `check` (`can_change_resume` / `can_manage_resume`) allows the principal."""
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id, lock=True)
    if not check(principal, candidate):
        raise _forbidden()
    return candidate, db.get(User, principal.user_id)


@router.get("", summary="A candidate's bases with their versions, and their tailored résumés")
def list_resumes(firm_id: uuid.UUID, candidate_id: uuid.UUID, principal: Principal = Depends(current_principal),
                 db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    return versions.listing(db, _candidate(db, firm_id, principal, candidate_id))


@router.get("/{resume_id}", summary="One version of a candidate's résumé, with its content")
def get_resume(firm_id: uuid.UUID, candidate_id: uuid.UUID, resume_id: uuid.UUID, autofill: bool = False,
               editor: bool = False, principal: Principal = Depends(current_principal),
               db: DbSession = Depends(get_db)):
    """With `?autofill=true`, also its autofill: every question a form can ask, built for this read (docs/02 §8.1);
    with `&editor=true` as the Autofill screen reads it, the unanswered questions and each answer's type too (§8.3)."""
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id)
    row = versions.candidate_version(db, candidate, resume_id)
    return versions.opened_json(row, candidate, with_autofill=autofill, editor=editor)


class AutofillIn(BaseModel):
    """A change to one version's autofill (docs/02 §8.3): `edit` by key, with `built`, each edited key's built answer
    as the user was shown it, and `answered`, each edited or reset key's answer as the user was shown it (their edit,
    else the built one); `reset` keys; `add` questions with their answers; `remove` questions; `only_this` keeps it to
    this version instead of every job of the candidate (07 Q30)."""
    model_config = ConfigDict(extra="forbid")
    edit: dict[str, Any] = Field(default_factory=dict)
    built: dict[str, Any] = Field(default_factory=dict)
    answered: dict[str, Any] = Field(default_factory=dict)
    reset: list[str] = Field(default_factory=list)
    add: dict[str, str] = Field(default_factory=dict)
    remove: list[str] = Field(default_factory=list)
    only_this: bool = False


@router.patch("/{resume_id}/autofill", summary="Change a résumé version's autofill answers")
def save_resume_autofill(firm_id: uuid.UUID, candidate_id: uuid.UUID, resume_id: uuid.UUID, body: AutofillIn,
                         principal: Principal = Depends(require("resume.edit")), db: DbSession = Depends(get_db)):
    """The Autofill screen's save (07 Q7, Q14): in place on the open version, no new version, and on the rest of its
    résumé unless `only_this` (Q30, Q44). 409 when an edited question's built answer isn't the one the user was shown.
    Answers with the version's autofill as the screen reads it and how many versions changed."""
    if len(body.edit) + len(body.reset) > len(autofill_answers.QUESTIONS) or \
            len(body.answered) > len(autofill_answers.QUESTIONS) or \
            len(body.add) + len(body.remove) > autofill_answers.MAX_CUSTOM:
        raise HTTPException(status_code=400, detail="That's more than one résumé holds.")
    candidate, actor = _writer(db, firm_id, principal, candidate_id, can_change_resume)
    row = versions.candidate_version(db, candidate, resume_id)
    today = date.today()
    try:
        change = autofill_answers.checked_change(body.edit, body.reset, body.add, body.remove)
        if missing := [key for key in change["edit"] if key not in body.built]:
            raise autofill_answers.Refused(f"Send the built answer you were shown for {', '.join(missing)}.")
        if autofill_answers.unseen(candidate, row, change["edit"], body.built, today, answered=body.answered,
                                   reset=change["reset"]):
            raise HTTPException(status_code=409, detail="An answer changed since you opened this page. Reload it "
                                                        "and make your change again.")
        changed = versions.save_autofill(db, actor, candidate, row, change, only_this=body.only_this, today=today)
    except autofill_answers.Refused as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    db.commit()
    return {"autofill": autofill_answers.merged(candidate, row, today, editor=True), "changed": changed}


@router.get("/{resume_id}/file", summary="The file an uploaded résumé was read from")
def get_resume_file(firm_id: uuid.UUID, candidate_id: uuid.UUID, resume_id: uuid.UUID,
                    principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    """An uploaded base's version 1 as its PDF or Word file, as uploaded: the extension attaches it to a form (docs/02
    §8.2). Any other version has no file of its own and answers 404, so the BDE attaches that one by hand."""
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id)
    kept = versions.uploaded_file(db, candidate, versions.candidate_version(db, candidate, resume_id))
    if kept is None:
        raise HTTPException(status_code=404, detail="This version has no uploaded file.")
    return Response(content=kept.content, media_type=kept.mime_type, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(kept.file_name, safe='')}",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/{resume_id}/save", status_code=201, summary="Save an edit as the résumé's next version")
def save_resume(firm_id: uuid.UUID, candidate_id: uuid.UUID, resume_id: uuid.UUID, body: ContentIn,
                principal: Principal = Depends(require("resume.edit")), db: DbSession = Depends(get_db)):
    """`resume_id` is the version the edit was made from. The answer's `notice` says when another version was saved
    meanwhile (both are kept; the new one doesn't include the other's changes)."""
    candidate, actor = _writer(db, firm_id, principal, candidate_id, can_change_resume)
    source = versions.candidate_version(db, candidate, resume_id)
    saved = versions.save_version(db, actor, candidate, source, body.stored())
    db.commit()
    return {**versions.version_json(saved.row, with_content=True), "notice": saved.notice}


@router.post("/{resume_id}/use-as-base", summary="Make this version the base the workflow uses")
def use_resume_as_base(firm_id: uuid.UUID, candidate_id: uuid.UUID, resume_id: uuid.UUID,
                       principal: Principal = Depends(require("resume.edit")), db: DbSession = Depends(get_db)):
    """A base's v1: that base becomes active. Any other version: copied as v1 of a new base, which becomes active; if
    a base was already made from it, that one becomes active instead."""
    candidate, actor = _writer(db, firm_id, principal, candidate_id, can_change_resume)
    base = versions.use_as_base(db, actor, candidate, versions.candidate_version(db, candidate, resume_id))
    db.commit()
    return versions.base_json(base, versions.base_numbers(db, candidate)[base.id])


@router.post("/upload", status_code=201, summary="Upload a later résumé as the candidate's new base")
async def upload_resume(firm_id: uuid.UUID, candidate_id: uuid.UUID, file: UploadFile = File(...),
                        principal: Principal = Depends(require("resume.edit")), db: DbSession = Depends(get_db)):
    """PDF or Word, up to 10 MB. The same file the candidate already has is answered (409) before the parser runs,
    with the base it is; if that base was deleted, it comes back instead (its v1, `restored` true, no parser run).
    Otherwise the parser reads it and one transaction keeps the file and writes a new active base with its v1.
    Nothing is saved if the parse fails (§4.6). The database work runs off the event loop
    (`asyncio.to_thread`): waiting for the candidate lock would otherwise hold up every request on the worker."""
    await asyncio.to_thread(_may_upload, db, firm_id, principal, candidate_id)
    content = await file.read(MAX_BYTES + 1)
    kind = file_kind(file.filename or "", content)
    sha256 = file_sha256(content)
    parse = None
    if await asyncio.to_thread(_is_new_file, db, firm_id, principal, candidate_id, sha256):
        text = await asyncio.to_thread(extract_text, kind, content)
        parse = await read_resume(text, kind, db, firm_id=firm_id)
    return await asyncio.to_thread(_keep_upload, db, firm_id, principal, candidate_id, file.filename or "", kind,
                                   content, sha256, parse)


def _may_upload(db: DbSession, firm_id: uuid.UUID, principal: Principal, candidate_id: uuid.UUID) -> None:
    _member_of(firm_id, principal)
    if not can_manage_resume(principal, _candidate(db, firm_id, principal, candidate_id)):
        raise _forbidden()                   # refused before the file is parsed or kept (its bytes have arrived)
    db.commit()


def _is_new_file(db: DbSession, firm_id: uuid.UUID, principal: Principal, candidate_id: uuid.UUID,
                 sha256: str) -> bool:
    """With the candidate locked: the answer (409) for a file the candidate already has. False, still locked, for
    one kept by a candidate made before bases existed (it becomes a base now); True, unlocked, for a new file."""
    candidate, _ = _writer(db, firm_id, principal, candidate_id, can_manage_resume)
    if (kept := versions.kept_file(db, candidate, sha256)) is not None:
        if (answer := versions.already_uploaded(db, candidate, kept)) is not None:
            raise answer
        return False
    db.commit()                              # no lock, and no connection, held while the parser works
    return True


# The rules a second copy of one upload trips (resume-versioning.md §3.1, §3.2).
_SAME_FILE_RULES = ("uq_resume_parses_candidate_file", "uq_base_resumes_one_per_parse")


def _keep_upload(db: DbSession, firm_id: uuid.UUID, principal: Principal, candidate_id: uuid.UUID, file_name: str,
                 kind: str, content: bytes, sha256: str, parse: dict | None) -> dict:
    """The new active base, from `parse` (a new file) or from the kept upload `_is_new_file` found (`parse` None). A
    file whose base was deleted brings that base back instead (its v1, no new read): `restored` is true."""
    candidate, actor = _writer(db, firm_id, principal, candidate_id, can_manage_resume)
    kept = versions.kept_file(db, candidate, sha256)
    if parse is None:
        parse_row = kept                     # found above, under the same lock
        if (deleted := versions.deleted_base_for(db, candidate, parse_row)) is not None:
            base = versions.restore_base(db, actor, candidate, deleted)
            db.commit()
            return {**versions.base_json(base, versions.base_numbers(db, candidate)[base.id]), "restored": True}
    else:
        if kept is not None:                 # the same file, uploaded meanwhile
            raise versions.already_uploaded(db, candidate, kept) or HTTPException(status_code=409,
                                                                                  detail="Upload it again.")
        parse_row = ResumeParse(firm_id=firm_id, uploaded_by_user_id=actor.id, candidate_id=candidate.id,
                                file_name=file_name[:255], mime_type=PDF_MIME if kind == "pdf" else DOCX_MIME,
                                size_bytes=len(content), content=content, parse=parse, expires_at=None)
        db.add(parse_row)
    try:
        db.flush()
        base = versions.upload_base(db, actor, candidate, parse_row)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        # Only the same file arriving twice at once is "just uploaded"; any other refusal is a real error.
        if not any(rule in str(e.orig) for rule in _SAME_FILE_RULES):
            raise
        raise HTTPException(status_code=409, detail="This résumé was just uploaded for this candidate. Reload to see it.")
    return {**versions.base_json(base, versions.base_numbers(db, candidate)[base.id]), "restored": False}


@router.get("/bases/{base_id}/removal", summary="What deleting this base would do")
def base_removal(firm_id: uuid.UUID, candidate_id: uuid.UUID, base_id: uuid.UUID,
                 principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id)
    return versions.base_removal(db, candidate, versions.candidate_base(db, candidate, base_id)).json()


@router.delete("/bases/{base_id}", summary="Delete a base, or hide it if something uses it")
def delete_base(firm_id: uuid.UUID, candidate_id: uuid.UUID, base_id: uuid.UUID, keep_used: bool = False,
                principal: Principal = Depends(require("resume.edit")), db: DbSession = Depends(get_db)):
    """`keep_used=true`: a base that is in use is hidden and what nothing uses is deleted with it (the `rest` of the
    preview); without it the base is only hidden (docs/team/resume-versioning.md §4.7)."""
    candidate, actor = _writer(db, firm_id, principal, candidate_id, can_manage_resume)
    removal = versions.delete_base(db, actor, candidate, versions.candidate_base(db, candidate, base_id), keep_used)
    db.commit()
    return removal.json()


@router.post("/bases/{base_id}/show", summary="Show a hidden base again (it isn't made active)")
def show_base(firm_id: uuid.UUID, candidate_id: uuid.UUID, base_id: uuid.UUID,
              principal: Principal = Depends(require("resume.edit")), db: DbSession = Depends(get_db)):
    candidate, actor = _writer(db, firm_id, principal, candidate_id, can_manage_resume)
    base = versions.show_again(db, actor, candidate, versions.candidate_base(db, candidate, base_id))
    db.commit()
    return versions.base_json(base, versions.base_numbers(db, candidate)[base.id])


@router.get("/{resume_id}/removal", summary="What deleting this version would do")
def version_removal(firm_id: uuid.UUID, candidate_id: uuid.UUID, resume_id: uuid.UUID,
                    principal: Principal = Depends(current_principal), db: DbSession = Depends(get_db)):
    _member_of(firm_id, principal)
    candidate = _candidate(db, firm_id, principal, candidate_id)
    return versions.version_removal(db, candidate, versions.candidate_version(db, candidate, resume_id)).json()


@router.delete("/{resume_id}", summary="Delete one version (refused if something uses it)")
def delete_version(firm_id: uuid.UUID, candidate_id: uuid.UUID, resume_id: uuid.UUID,
                   principal: Principal = Depends(require("resume.edit")), db: DbSession = Depends(get_db)):
    candidate, actor = _writer(db, firm_id, principal, candidate_id, can_manage_resume)
    removal = versions.delete_version(db, actor, candidate, versions.candidate_version(db, candidate, resume_id))
    db.commit()
    return removal.json()
