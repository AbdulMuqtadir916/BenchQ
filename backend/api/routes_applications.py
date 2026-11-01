"""Application management endpoints."""
import logging
import uuid
from typing import Annotated, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc
from backend.models.db import get_db, Application, Job, Company, Setting, utcnow, SessionLocal
from backend.models.tenancy import link_job_to_firm
from backend.api.routes_auth import current_principal
from backend.api._input import uuid_filter
from backend.auth.scoping import reader_firm_id, scoped, writer_firm_id
from backend.auth.sessions import Principal
from backend.scraper._shared.bot_wall import is_bot_wall

logger = logging.getLogger("jobnavigator.applications")

_BOT_WALL_ERROR = "blocked by bot protection"

# Statuses a board answers with when it refuses a server-side read of a posting.
_BLOCKED_STATUSES = {401, 403, 429}


class _ReadBlocked(Exception):
    """The posting site refused the read; the page parse is skipped."""

router = APIRouter(prefix="/applications", tags=["applications"])


VALID_STATUSES = {"applied", "interview", "offer", "rejected"}
from backend.applications.tracking import STATUSES as CANDIDATE_STATUSES


def _parse_dt(value):
    """Lenient ISO parse for calendar inputs ('2026-09-09T14:00' has no zone)."""
    if not value:
        return None
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


class ApplicationCreate(BaseModel):
    title: str
    company: str
    url: str
    # Candidate-scoped Saved jobs are created from an existing canonical job; the
    # title/company/url above remain required for the legacy manual-application path.
    candidate_id: Optional[uuid.UUID] = None
    job_id: Optional[uuid.UUID] = None
    cv_version_used: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None          # applied|interview|offer (Log-application modal)
    applied_at: Optional[str] = None      # ISO date/datetime for back-dated entries
    location: Optional[str] = None        # optional; the feed's territorial filter reads it


class InterviewCreate(BaseModel):
    what: str
    when_at: Optional[str] = None      # ISO datetime from the calendar picker
    where_text: Optional[str] = None
    status: Optional[str] = "scheduled"
    prep: Optional[str] = None


class ExtractRequest(BaseModel):
    url: str


def _extract_clean_content(raw_html: str) -> tuple:
    """Extract clean, readable HTML from raw page. Returns (clean_html, plain_text)."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(raw_html, "html.parser")

    for tag in soup.find_all([
        "script", "style", "nav", "footer", "header", "noscript",
        "iframe", "svg", "img", "video", "audio", "picture", "source",
        "form", "input", "button", "select", "textarea", "label",
        "figure", "figcaption", "canvas", "map", "area",
    ]):
        tag.decompose()

    for tag in soup.find_all(True, attrs={"aria-hidden": "true"}):
        tag.decompose()
    for tag in soup.find_all(True, style=lambda s: s and "display:none" in s.replace(" ", "").lower()):
        tag.decompose()

    KEEP_TAGS = {
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "ul", "ol", "li", "dl", "dt", "dd",
        "strong", "b", "em", "i", "a", "br",
        "div", "span", "section", "article", "main",
        "table", "tr", "td", "th", "thead", "tbody",
        "blockquote", "pre", "code", "hr",
    }

    # Strip all attributes except href on <a> tags
    for tag in soup.find_all(True):
        if tag.name not in KEEP_TAGS:
            tag.unwrap()
        elif tag.name == "a":
            href = tag.get("href", "")
            tag.attrs = {"href": href, "target": "_blank"} if href else {}
        else:
            tag.attrs = {}

    body = soup.body if soup.body else soup
    clean_html = str(body)

    # Collapse excessive whitespace / empty divs
    import re
    clean_html = re.sub(r'(<br\s*/?>[\s]*){3,}', '<br><br>', clean_html)
    clean_html = re.sub(r'(<div>\s*</div>\s*){2,}', '', clean_html)
    clean_html = re.sub(r'\n{3,}', '\n\n', clean_html)

    # Plain text for search/analysis
    text = soup.get_text(separator="\n", strip=True)[:50_000]

    return clean_html[:500_000], text


async def _fetch_with_playwright(url: str) -> str:
    """Fetch a page using Playwright for SPA/JS-rendered sites. Returns raw HTML."""
    from backend.scraper._shared.browser import _get_browser, _new_page, _close_page
    from backend.scraper._shared.url_safety import assert_public_http_url
    # Revalidate here too — this function is also reachable directly, and a
    # single missed caller elsewhere would reopen the SSRF hole.
    assert_public_http_url(url)
    pw, browser = await _get_browser()
    try:
        page = await _new_page(browser)
        try:
            await page.goto(url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)  # Extra time for JS rendering
            return await page.content()
        finally:
            await _close_page(page)
    finally:
        # pw.stop() kills the node driver process; it must run even if closing
        # the browser fails, or the driver outlives every failed fetch.
        try:
            await browser.close()
        except Exception as e:
            logger.warning(f"Playwright browser close failed: {e}")
        await pw.stop()


def _set_job_cache_error(job_id: str, msg: str) -> None:
    """Record why caching gave up, in its own short session."""
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.cache_error = (msg or "")[:500]
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


async def _cache_job_page(job_id: str, url: str):
    """Fetch and cache the job page as clean readable HTML.

    No DB session is open while the page is fetched or parsed: the fetch is an
    HTTP round trip and, for thin pages, a whole Chromium launch. Holding a
    pooled connection across that is what drained the pool when a bulk action
    kicked off dozens of these at once, and running dozens of Chromiums at once
    is what took the container to 2.5 GB -- hence the `page_cache` gate.
    """
    from datetime import datetime, timezone
    from backend.scraper._shared.url_safety import safe_get, assert_public_http_url, UnsafeURLError
    from backend.job_monitor import get_limiter

    if not url:
        return

    db = SessionLocal()
    try:
        if not db.query(Job.id).filter(Job.id == job_id).first():
            return
    finally:
        db.close()

    # SSRF gate: user-submitted job URLs from the extension land here; without
    # it an attacker could cache http://169.254.169.254/ and read it via the UI.
    try:
        assert_public_http_url(url)
    except UnsafeURLError as e:
        logger.warning(f"Rejected unsafe job URL for {job_id}: {e}")
        _set_job_cache_error(job_id, f"unsafe URL: {e}")
        return

    # Track the last error so it can be surfaced to the UI via job.cache_error
    last_error: str | None = None
    clean_html, text = "", ""

    async with get_limiter("page_cache"):
        try:
            # Try httpx first (fast, works for most sites)
            html = None
            try:
                resp = await safe_get(url, timeout=20, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                })
                resp.raise_for_status()
                html = resp.text[:1_000_000]
            except UnsafeURLError as e:
                # Caught mid-redirect -- don't fall back to Playwright for unsafe URLs.
                logger.warning(f"Unsafe redirect target for job {job_id}: {e}")
                _set_job_cache_error(job_id, f"unsafe redirect: {e}")
                return
            except Exception as e:
                logger.info(f"httpx failed for job {job_id}, will try Playwright: {e}")
                last_error = f"httpx: {e}"

            # A challenge page has enough text to pass as content, and the cached
            # text is what tailoring falls back to as the JD.
            if is_bot_wall(html):
                last_error = f"httpx: {_BOT_WALL_ERROR}"
                html = None

            clean_html, text = _extract_clean_content(html) if html else ("", "")
            # Up to 1 MB of raw markup plus the soup built from it; drop the
            # reference before the (slow) Playwright branch so it is not pinned
            # for the length of a browser launch.
            html = None

            # If too little content, fall back to Playwright (handles SPAs like Meta, Apple)
            if len(text) < 200:
                logger.info(f"Thin content ({len(text)} chars) for job {job_id}, trying Playwright")
                try:
                    pw_html = await _fetch_with_playwright(url)
                    if is_bot_wall(pw_html):
                        last_error = f"playwright: {_BOT_WALL_ERROR}"
                    elif pw_html:
                        clean_html, text = _extract_clean_content(pw_html)
                        logger.info(f"Playwright got {len(text)} text chars for job {job_id}")
                    pw_html = None
                except Exception as e:
                    logger.warning(f"Playwright fallback failed for job {job_id}: {e}")
                    last_error = f"playwright: {e}"
        except Exception as e:
            logger.warning(f"Failed to cache page for job {job_id}: {e}")
            _set_job_cache_error(job_id, str(e))
            return

    if len(text) > 50:
        db = SessionLocal()
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if not job:
                return
            job.cached_page_html = clean_html
            job.cached_page_text = text
            job.page_cached_at = datetime.now(timezone.utc)
            job.cache_error = None
            db.commit()
            logger.info(f"Cached page for job {job_id}: {len(clean_html)} clean HTML, {len(text)} text chars")
        except Exception as e:
            db.rollback()
            logger.warning(f"Failed to store cached page for job {job_id}: {e}")
        finally:
            db.close()
    else:
        msg = last_error or f"no usable content ({len(text)} chars)"
        logger.warning(f"No usable content for job {job_id} ({url}): {msg}")
        _set_job_cache_error(job_id, msg)


async def _fetch_and_store_description(job_id: str, url: str) -> None:
    """Write the ATS-quality JD onto a job that has none. `_resolve_tailoring_jd`
    owns the fetch, the SSRF gate and the write, so this adds no second cascade."""
    from types import SimpleNamespace
    from backend.api.routes_resumes import _resolve_tailoring_jd
    try:
        await _resolve_tailoring_jd(
            SimpleNamespace(id=job_id, description="", url=url, cached_page_text="")
        )
    except Exception as e:
        logger.warning(f"Could not fetch a description for job {job_id}: {e}")
        return

    # The description is the only arrangement signal a hand-added job has, and it
    # arrives here rather than at insert time.
    from backend.analyzer.work_arrangement import apply_arrangement_to_job
    from backend.models.db import Job, SessionLocal
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            apply_arrangement_to_job(job)
            db.commit()
    except Exception as e:
        logger.warning(f"Could not read the arrangement for job {job_id}: {e}")
    finally:
        db.close()


@router.post("")
def create_application(
    data: ApplicationCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    firm_id: uuid.UUID = Depends(writer_firm_id),
    principal: Principal = Depends(current_principal),
):
    """Create application (used by Chrome extension). Also creates job record if needed."""
    if data.candidate_id is not None or data.job_id is not None or (data.status or "").lower() == "saved":
        from backend.api.routes_candidates import _candidate
        from backend.auth.ledger import record as record_ledger
        from backend.auth.policy import can
        from backend.auth.scoping import scoped_jobs
        from backend.models.candidates import CandidateJob, FavoriteJob
        from backend.models.tenancy import User

        if not can(principal, "job.apply"):
            raise HTTPException(status_code=403, detail="You don't have permission to save jobs.")
        if data.candidate_id is None or data.job_id is None or (data.status or "").lower() != "saved":
            raise HTTPException(status_code=400, detail="Saving requires candidate_id, job_id, and status='saved'.")

        candidate = _candidate(db, firm_id, principal, data.candidate_id, lock=True)
        job = scoped_jobs(db, firm_id).filter(Job.id == data.job_id).first()
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found.")
        candidate_job = scoped(db, CandidateJob, firm_id).filter(
            CandidateJob.candidate_id == candidate.id, CandidateJob.job_id == job.id
        ).first()
        if candidate_job is None:
            raise HTTPException(status_code=404, detail="Job not found for this candidate.")

        actor = db.get(User, principal.user_id)
        favorite = scoped(db, FavoriteJob, firm_id).filter(
            FavoriteJob.candidate_id == candidate.id, FavoriteJob.job_id == job.id
        ).first()
        if favorite is None:
            favorite = FavoriteJob(
                firm_id=firm_id,
                candidate_id=candidate.id,
                job_id=job.id,
                marked_by_user_id=principal.user_id,
            )
            db.add(favorite)
            db.flush()
            record_ledger(
                db, actor=actor, action="CREATE", entity_type="favorite_job", entity_id=favorite.id,
                entity_label=job.title or "Saved job", summary=f"Saved {job.title or 'a job'} for {candidate.full_name}.",
                firm_id=firm_id, candidate_id=candidate.id,
            )

        application = scoped(db, Application, firm_id).filter(
            Application.candidate_id == candidate.id, Application.job_id == job.id
        ).first()
        if application is None:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            application = Application(
                firm_id=firm_id,
                candidate_id=candidate.id,
                job_id=job.id,
                resume_id=None,
                submitted_by_user_id=None,
                status="saved",
                applied_at=None,
                status_transitions=[{"from": None, "to": "saved", "at": now.isoformat(), "source": "ui"}],
            )
            db.add(application)
            db.flush()
            record_ledger(
                db, actor=actor, action="CREATE", entity_type="application", entity_id=application.id,
                entity_label=job.title or "Saved job", summary=f"Added {job.title or 'a job'} to Saved for {candidate.full_name}.",
                firm_id=firm_id, candidate_id=candidate.id,
            )

        db.commit()
        return {
            "id": str(application.id),
            "job_id": str(job.id),
            "candidate_id": str(candidate.id),
            "status": application.status,
            "favorite": True,
        }

    # Generate external_id for dedup (use same normalization as scrapers)
    from backend.scraper._shared.dedup import make_external_id
    external_id = make_external_id(data.company, data.title, data.url)

    job = db.query(Job).filter(Job.external_id == external_id).first()
    if not job:
        job = Job(
            external_id=external_id,
            company=data.company,
            title=data.title,
            url=data.url,
            source="manual",   # APPS-15: hand-logged via the Log modal / extension, not a scrape
            status="applied",
            location=data.location or None,
            seen=True,
        )
        # A hand-logged job has to answer the feed's Location and Work filters
        # like any other. There is no description yet, so only the title and a
        # typed-in location say anything; the background fetch below covers the
        # rest once the JD lands.
        from backend.analyzer.location import apply_location_to_job
        from backend.analyzer.work_arrangement import apply_arrangement_to_job
        apply_arrangement_to_job(job)
        apply_location_to_job(job)
        db.add(job)
        db.flush()
    else:
        job.status = "applied"
    # The firm sees the job it logged, whether it was new or already in the shared pool (07 Q37).
    link_job_to_firm(db, firm_id, job.id, "CAPTURED", captured_by_user_id=principal.user_id)

    # One application per job — a duplicate log is refused with 409.
    from backend.models.db import record_transition
    new_status = data.status if data.status in VALID_STATUSES else "applied"
    applied_at = None
    if data.applied_at:
        from datetime import datetime
        try:
            applied_at = datetime.fromisoformat(data.applied_at.replace("Z", "+00:00"))
        except ValueError:
            logger.info("ignoring unparseable applied_at %r", data.applied_at)

    app = scoped(db, Application, firm_id).filter(Application.job_id == job.id).first()
    if app:
        # Refuse a second log for the same posting — it would silently overwrite
        # notes and reset the stage, creating a bogus funnel edge.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"message": "An application already exists for this job", "application_id": str(app.id)},
        )
    app = Application(
        firm_id=firm_id,
        job_id=job.id,
        status=new_status,
        cv_version_used=data.cv_version_used,
        notes=data.notes,
        # seed the funnel edge so this application shows an initial edge in the Sankey chart
        status_transitions=[{
            "from": None, "to": new_status,
            "at": utcnow().isoformat(), "source": "ui",
        }],
    )
    if applied_at:
        app.applied_at = applied_at
    db.add(app)
    db.commit()

    # Auto-create company if it doesn't exist (only on application, not during scraping)
    if data.company and data.company.strip():
        company_name = data.company.strip()
        from backend.models.db import find_company_by_name
        existing_co = find_company_by_name(db, company_name)
        if not existing_co:
            default_resume_row = db.query(Setting).filter(Setting.key == "default_resume_id").first()
            default_resume_ids = [default_resume_row.value] if default_resume_row and default_resume_row.value else []
            new_co = Company(
                name=company_name, tier=None, active=False, playwright_enabled=False,
                selected_resume_ids=default_resume_ids,
            )
            db.add(new_co)
            db.flush()
            db.commit()
            logger.info(f"Auto-created company '{company_name}' from application")
            from backend.analyzer.h1b_checker import fetch_h1b_for_company_id
            background_tasks.add_task(fetch_h1b_for_company_id, str(new_co.id))

    if data.url and not job.has_cached_page:
        background_tasks.add_task(_cache_job_page, str(job.id), data.url)

    # A hand-logged job arrives with no description, which every LLM step needs.
    # Fetch it once here instead of on first use, so the first score, tailor or
    # cover letter does not pay for it.
    if data.url and not (job.description or "").strip():
        background_tasks.add_task(_fetch_and_store_description, str(job.id), data.url)

    return {
        "id": str(app.id),
        "job_id": str(job.id),
        "status": app.status,
        "company": job.company,
        "title": job.title,
    }


@router.get("")
def list_applications(
    status: Optional[str] = None,
    candidate_id: Optional[str] = None,
    tracked_only: bool = False,
    limit: Annotated[int, Query(ge=0, le=2000)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
    db: Session = Depends(get_db), firm_id=Depends(reader_firm_id),
    principal: Principal = Depends(current_principal),
):
    from sqlalchemy.orm import selectinload
    from backend.api.routes_candidates import _candidate

    q = scoped(db, Application, firm_id).options(selectinload(Application.interviews), selectinload(Application.reviews))
    from backend.api.routes_candidates import _visible
    from backend.models.candidates import Candidate
    from backend.auth.scoping import own_scope, team_scope
    visible_candidates = _visible(db, firm_id, principal).with_entities(Candidate.id)
    if tracked_only or own_scope(principal) is not None or team_scope(principal) is not None:
        q = q.filter(Application.candidate_id.in_(visible_candidates))
    if status:
        q = q.filter(Application.status == status)
    candidate_uuid = uuid_filter(candidate_id, "candidate_id")
    if candidate_uuid is not None:
        candidate = _candidate(db, firm_id, principal, candidate_uuid)
        q = q.filter(Application.candidate_id == candidate.id)

    total = q.count()
    apps = q.order_by(desc(Application.updated_at), Application.id).offset(offset).limit(limit).all()

    from backend.models.db import build_company_lookup, Resume, CoverLetter
    lookup = build_company_lookup(db)
    job_ids = [a.job_id for a in apps]
    with_letter = set()
    if job_ids:
        with_letter = {str(r[0]) for r in scoped(db, CoverLetter, firm_id, CoverLetter.job_id)
                       .filter(CoverLetter.job_id.in_(job_ids)).distinct().all()}
    tailored = {}
    if job_ids:
        resume_candidate_scope = Resume.candidate_id.in_([a.candidate_id for a in apps if a.candidate_id])
        if any(a.candidate_id is None for a in apps):
            resume_candidate_scope = resume_candidate_scope | Resume.candidate_id.is_(None)
        for r in (scoped(db, Resume, firm_id)
                  .filter(Resume.job_id.in_(job_ids), resume_candidate_scope,
                          Resume.is_base == False)  # noqa: E712
                  .order_by(Resume.updated_at.desc(), Resume.created_at.desc()).all()):
            key = (str(r.candidate_id), str(r.job_id))
            tailored.setdefault(key, r)
    return {
        "total": total,
        "applications": [_app_to_dict(a, lookup, tailored.get((str(a.candidate_id), str(a.job_id))),
                                      str(a.job_id) in with_letter) for a in apps],
    }


@router.get("/{app_id}")
def get_application(app_id: str, principal: Principal = Depends(current_principal),
                    db: Session = Depends(get_db), firm_id=Depends(reader_firm_id)):
    from backend.models.db import build_company_lookup
    app = _scoped_application(db, firm_id, principal, app_id)
    return _app_to_dict(app, build_company_lookup(db))


@router.patch("/{app_id}/candidate-status")
def move_candidate_application_status(app_id: str, updates: dict,
                                      principal: Principal = Depends(current_principal),
                                      db: Session = Depends(get_db), firm_id=Depends(reader_firm_id)):
    from backend.applications.tracking import accessible_application, move
    from backend.models.db import build_company_lookup
    try:
        app = accessible_application(db, firm_id, principal, app_id, lock=True)
        if set(updates) - {"status", "expected_revision", "note", "command_id"}:
            raise HTTPException(400, "Unexpected status command fields.")
        move(db, app, principal, status=updates.get("status"),
             expected_revision=updates.get("expected_revision"), note=updates.get("note"),
             command_id=updates.get("command_id"))
        db.commit()
        return _app_to_dict(app, build_company_lookup(db))
    except Exception:
        db.rollback()
        raise


@router.patch("/{app_id}/review")
def resolve_application_review(app_id: str, updates: dict,
                                principal: Principal = Depends(current_principal),
                                db: Session = Depends(get_db), firm_id=Depends(reader_firm_id)):
    from backend.applications.tracking import accessible_application, move
    from backend.models.db import ApplicationReview, build_company_lookup
    try:
        app = accessible_application(db, firm_id, principal, app_id, lock=True)
        if set(updates) - {"review_id", "status", "expected_revision", "expected_review_revision", "note", "command_id"}:
            raise HTTPException(400, "Unexpected review fields.")
        review_id = uuid_filter(updates.get("review_id"), "review_id")
        review = scoped(db, ApplicationReview, firm_id).filter_by(
            id=review_id, application_id=app.id, candidate_id=app.candidate_id).with_for_update().first()
        if review is None:
            raise HTTPException(404, "Review not found")
        if review.state != "PENDING":
            # The shared command service validates any replay before checking revisions.
            if not updates.get("command_id"):
                raise HTTPException(409, "Review was already resolved.")
            from backend.models.db import ApplicationStatusEvent
            command = uuid_filter(updates['command_id'], 'command_id')
            previous = scoped(db, ApplicationStatusEvent, firm_id).filter_by(
                application_id=app.id, command_id=command, review_id=review.id).first()
            if previous is None:
                raise HTTPException(409, "Review was already resolved.")
        elif (type(updates.get("expected_review_revision")) is not int
              or updates["expected_review_revision"] != review.revision):
            raise HTTPException(409, "Review changed. Reload before confirming.")
        move(db, app, principal, status=updates.get("status"),
             expected_revision=updates.get("expected_revision"), note=updates.get("note"),
             command_id=updates.get("command_id"), review=review)
        db.commit()
        return _app_to_dict(app, build_company_lookup(db))
    except Exception:
        db.rollback()
        raise


@router.patch("/{app_id}")
def update_application(app_id: str, updates: dict, principal: Principal = Depends(current_principal),
                       db: Session = Depends(get_db), firm_id=Depends(reader_firm_id)):
    app = scoped(db, Application, firm_id).filter(Application.id == app_id).with_for_update().first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    if "unfavorite" in updates:
        from backend.api.routes_candidates import _candidate
        from backend.auth.ledger import record as record_ledger
        from backend.auth.policy import can
        from backend.models.candidates import FavoriteJob
        from backend.models.tenancy import User

        unfavorite = updates.pop("unfavorite")
        if unfavorite is not True or updates:
            raise HTTPException(status_code=400, detail="Send only {unfavorite: true} to remove a favorite.")
        if not can(principal, "job.apply"):
            raise HTTPException(status_code=403, detail="You don't have permission to remove saved jobs.")
        if app.candidate_id is None:
            raise HTTPException(status_code=404, detail="Application not found")
        candidate = _candidate(db, firm_id, principal, app.candidate_id, lock=True)
        actor = db.get(User, principal.user_id)
        favorite = scoped(db, FavoriteJob, firm_id).filter(
            FavoriteJob.candidate_id == candidate.id, FavoriteJob.job_id == app.job_id
        ).first()
        if favorite is not None:
            record_ledger(
                db, actor=actor, action="DELETE", entity_type="favorite_job", entity_id=favorite.id,
                entity_label=app.job.title or "Saved job", summary=f"Removed {app.job.title or 'a job'} from favorites for {candidate.full_name}.",
                firm_id=firm_id, candidate_id=candidate.id,
            )
            db.delete(favorite)

        transitions = app.status_transitions or []
        untouched = (
            app.status == "saved"
            and not app.notes
            and app.resume_id is None
            and not app.cv_version_used
            and not app.next_action
            and app.next_action_date is None
            and app.last_email_received is None
            and not app.last_email_snippet
            and not app.interviews
            and not app.reviews
            and not app.status_events
            and len(transitions) <= 1
        )
        application_id = str(app.id)
        application_status = app.status
        if untouched:
            record_ledger(
                db, actor=actor, action="DELETE", entity_type="application", entity_id=app.id,
                entity_label=app.job.title or "Saved job", summary=f"Removed untouched Saved draft for {candidate.full_name}.",
                firm_id=firm_id, candidate_id=candidate.id,
            )
            db.delete(app)
        db.commit()
        return {
            "favorite": False,
            "application_id": application_id,
            "application_preserved": not untouched,
            "status": application_status if not untouched else None,
        }

    app = _scoped_application(db, firm_id, principal, app.id, write=True)
    if app.candidate_id is not None:
        from backend.applications.tracking import accessible_application, move
        from backend.auth.policy import can
        app = accessible_application(db, firm_id, principal, app_id, lock=True)
        if not can(principal, "application.move"):
            raise HTTPException(403, "You don't have permission to update applications.")
        if set(updates) - {"status", "expected_revision", "command_id", "note", "notes"}:
            raise HTTPException(400, "Use the candidate status command; unsupported application fields.")
        try:
            if "status" in updates:
                move(db, app, principal, status=updates['status'], expected_revision=updates.get('expected_revision'),
                     note=updates.get('note'), command_id=updates.get('command_id'))
            if "notes" in updates:
                if updates['notes'] is not None and not isinstance(updates['notes'], str):
                    raise HTTPException(400, "Notes must be text.")
                if app.notes != updates['notes']:
                    app.notes = updates['notes']
                    app.updated_at = utcnow()
                    _audit_application_edit(db, app, principal, 'Updated application notes.')
            db.commit()
            from backend.models.db import build_company_lookup
            return _app_to_dict(app, build_company_lookup(db))
        except Exception:
            db.rollback()
            raise

    allowed = {"status", "notes", "next_action", "next_action_date", "cv_version_used", "applied_at"}
    if "status" in updates and updates["status"] not in VALID_STATUSES:
        raise HTTPException(status_code=400,
                            detail=f"status must be one of {sorted(VALID_STATUSES)}")
    changed = False
    undo = bool(updates.pop("undo", False))   # the toast's Undo: reverse the last move, do not log a new one
    if "status" in updates:
        if updates["status"] != app.status:
            from backend.models.db import record_transition, revert_transition
            if undo:
                revert_transition(app, updates["status"])
            else:
                record_transition(app, updates["status"], "ui")
            changed = True
        # Same status = click on the already-active stage; record_transition() already
        # skips logging it, so skip updated_at too — bumping it would reset the ageing signal.
        del updates["status"]
    for key, value in updates.items():
        if key in allowed:
            setattr(app, key, value)
            changed = True
    if changed:
        app.updated_at = utcnow()
        _audit_application_edit(db, app, principal, "Updated application details.")
    db.commit()
    from backend.models.db import build_company_lookup
    lookup = build_company_lookup(db)
    return _app_to_dict(app, lookup)


def _audit_application_edit(db, app, principal, summary):
    from backend.auth.ledger import record
    from backend.models.tenancy import User
    actor = scoped(db, User, app.firm_id).filter_by(id=principal.user_id).one()
    record(db, actor=actor, action="UPDATE", entity_type="application", entity_id=app.id,
           entity_label=app.job.title or "Application", summary=summary,
           firm_id=app.firm_id, candidate_id=app.candidate_id)


def _guard_application_history(db, firm_id, app_id):
    from backend.models.db import ApplicationStatusEvent, ApplicationReview, EmailClassification
    from backend.models.candidates import InboxMessage
    for model in (ApplicationStatusEvent, ApplicationReview, EmailClassification, InboxMessage):
        if scoped(db, model, firm_id).filter(model.application_id == app_id).first() is not None:
            raise HTTPException(409, "Application has retained history or email. Change its status instead of deleting it.")


@router.delete("/{app_id}")
def delete_application(app_id: str, principal: Principal = Depends(current_principal),
                       db: Session = Depends(get_db), firm_id=Depends(reader_firm_id)):
    app = _scoped_application(db, firm_id, principal, app_id, write=True)
    from backend.auth.policy import can
    if not can(principal, "application.move"):
        raise HTTPException(403, "You don't have permission to delete applications.")
    if app.candidate_id is not None:
        from backend.api.routes_candidates import _candidate
        _candidate(db, firm_id, principal, app.candidate_id)
        raise HTTPException(409, "Candidate applications are removed through Saved/favorite actions; move their status instead.")
    _guard_application_history(db, firm_id, app.id)
    # Deleting the application must also release the job, otherwise it stays
    # status='applied' forever and keeps counting in the Companies "Apps" column.
    job = app.job
    if job is not None and job.status == "applied":
        job.status = "saved"
    db.delete(app)
    db.commit()
    return {"deleted": True}


# ── Bulk actions (the Applications screen's selection bar) ───────────────────
# Same shape as POST /jobs/bulk-update: a malformed id is reported in
# `not_found` rather than aborting the batch with a DataError, and every bad
# body shape answers 400, never a 500.
def _bulk_ids(body: dict) -> list:
    """The `ids` list off a bulk body, as a list — any other shape is a 400."""
    ids = (body or {}).get("ids")
    if ids is None:
        return []
    if not isinstance(ids, (list, tuple)):
        raise HTTPException(status_code=400, detail="ids must be a list")
    return list(ids)


def _parse_app_id(raw):
    """A single bulk id as a UUID, or None when it is not one."""
    import uuid as _uuid
    try:
        return _uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        return None


@router.post("/bulk-update")
def bulk_update_applications(body: dict, db: Session = Depends(get_db), firm_id=Depends(reader_firm_id),
                             principal: Principal = Depends(current_principal)):
    """Move several applications to one status.

    Each row goes through the same path as PATCH /{app_id}: record_transition()
    with source "ui", then a fresh updated_at. A row already in that status is
    skipped entirely (no transition, no updated_at bump — the ageing signal on
    the row must not reset because it was caught in a selection).
    """
    from backend.api._input import str_field
    from backend.models.db import record_transition, revert_transition
    from backend.auth.policy import can
    if not can(principal, "application.move"):
        raise HTTPException(403, "You don't have permission to update applications.")

    ids = _bulk_ids(body)
    status = str_field(body, "status", required=True)
    undo = bool((body or {}).get("undo", False))   # the bulk toast's Undo, see PATCH
    if status not in VALID_STATUSES | CANDIDATE_STATUSES:
        raise HTTPException(status_code=400,
                            detail=f"status must be one of {sorted(VALID_STATUSES)}")

    updated = 0
    skipped = 0
    not_found: list[str] = []
    for raw in ids:
        parsed = _parse_app_id(raw)
        if parsed is None:
            not_found.append(str(raw))
            continue
        app = scoped(db, Application, firm_id).filter(Application.id == parsed).first()
        if app is None:
            not_found.append(str(raw))
            continue
        app = _scoped_application(db, firm_id, principal, app.id, write=True)
        if app.candidate_id is not None:
            from backend.applications.tracking import accessible_application, move
            app = accessible_application(db, firm_id, principal, app.id, lock=True)
            revisions = body.get("expected_revisions", {})
            move(db, app, principal, status=status, expected_revision=revisions.get(str(app.id)))
            updated += 1
            continue
        if status not in VALID_STATUSES:
            raise HTTPException(400, "Legacy application does not support this status.")
        if app.status == status:
            skipped += 1
            continue
        if undo:
            revert_transition(app, status)
        else:
            record_transition(app, status, "ui")
        app.updated_at = utcnow()
        _audit_application_edit(db, app, principal, "Updated application status.")
        updated += 1
    db.commit()
    return {"updated": updated, "skipped": skipped, "not_found": not_found}


@router.post("/bulk-delete")
def bulk_delete_applications(body: dict, principal: Principal = Depends(current_principal),
                             db: Session = Depends(get_db), firm_id=Depends(reader_firm_id)):
    """Delete several applications, exactly as DELETE /{app_id} deletes one.

    The job each row points at is released back to 'saved' so it stops counting
    as applied, and the row's interviews go with it (delete-orphan cascade).
    """
    ids = _bulk_ids(body)
    from backend.auth.policy import can
    if not can(principal, "application.move"):
        raise HTTPException(403, "You don't have permission to delete applications.")
    deleted = 0
    not_found: list[str] = []
    applications = {}
    for raw in ids:
        parsed = _parse_app_id(raw)
        if parsed is None:
            not_found.append(str(raw))
            continue
        app = scoped(db, Application, firm_id).filter(Application.id == parsed).first()
        if app is None:
            not_found.append(str(raw))
            continue
        if app.candidate_id is not None:
            from backend.api.routes_candidates import _candidate
            _candidate(db, firm_id, principal, app.candidate_id)
            raise HTTPException(409, "Candidate applications are removed through Saved/favorite actions; move their status instead.")
        app = _scoped_application(db, firm_id, principal, app.id, write=True)
        _guard_application_history(db, firm_id, app.id)
        applications[app.id] = app
    # Validate the complete batch before the first mutation.
    for app in applications.values():
        job = app.job
        if job is not None and job.status == "applied":
            job.status = "saved"
        db.delete(app)
        deleted += 1
    db.commit()
    return {"deleted": deleted, "not_found": not_found}


# ── Employer detection for the posting-URL reader ────────────────────────────
# og:site_name/hostname on an ATS-hosted board return the board's own brand
# (e.g. "Greenhouse"), not the employer, so ATS URL slugs are tried first and
# brand-looking fallbacks are dropped rather than guessed.

# Squashed (lowercase, alphanumeric-only) names of job boards/aggregators that
# must never be returned as an employer.
_ATS_BRAND_KEYS = {
    "greenhouse", "lever", "ashby", "ashbyhq", "workday", "myworkdayjobs",
    "smartrecruiters", "rippling", "phenom", "talentbrew", "icims", "taleo",
    "eightfold", "jobvite", "workable", "breezy", "breezyhr", "bamboohr",
    "teamtailor", "recruitee", "linkedin", "indeed", "ziprecruiter",
    "glassdoor", "monster", "dice", "wellfound", "angellist", "builtin",
    "levelsfyi", "jobright", "jobspy",
}

# Path segments that are board chrome rather than a company slug.
_SLUG_NOISE = {
    "jobs", "job", "careers", "career", "embed", "api", "search", "postings",
    "posting", "job_board", "job_app", "users", "self", "login", "signin",
    "sessions", "en-us", "en",
}


def _title_slug(slug: str) -> str:
    """'clear-street' -> 'Clear Street'; only the first letter of each word is forced, so already-cased slugs ('BoschGroup') survive intact."""
    import re
    words = [w for w in re.split(r"[-_+.\s]+", (slug or "").strip()) if w]
    return " ".join(w[0].upper() + w[1:] for w in words)


def _is_ats_brand(name) -> bool:
    """True if a detected 'company' is really the job board's own brand or pure board chrome (e.g. 'Careers'), used to suppress the og:site_name/hostname fallback."""
    import re
    raw = (name or "").strip()
    if not raw:
        return False
    n = re.sub(r"\b(jobs?|boards?|careers?|site|com|io|inc|ltd|llc|software)\b", " ", raw.lower())
    n = re.sub(r"[^a-z0-9]+", "", n)
    if not n:
        return True  # "Jobs", "Careers", "Job Board" — chrome, not an employer
    return n in _ATS_BRAND_KEYS


def _company_from_url(url: str):
    """Derive the employer from a known ATS board URL (path slug or tenant subdomain); returns None for anything unrecognised so the caller falls back to page metadata, reusing the scraper's is_* host predicates to stay in sync with the ATS matrix."""
    from urllib.parse import parse_qs, urlparse
    from backend.scraper.ats.ashby import is_ashby
    from backend.scraper.ats.greenhouse import is_greenhouse
    from backend.scraper.ats.lever import is_lever
    from backend.scraper.ats.rippling import is_rippling, _parse_rippling_url
    from backend.scraper.ats.smartrecruiters import is_smartrecruiters, _extract_company_slug
    from backend.scraper.ats.workday import is_workday

    if not url:
        return None
    try:
        parsed = urlparse(url)
    except Exception:
        return None
    host = (parsed.hostname or "").lower()
    parts = [p for p in (parsed.path or "").strip("/").split("/") if p]

    def _first_slug():
        for part in parts:
            if part.lower() not in _SLUG_NOISE:
                return part
        return None

    slug = None
    try:
        if is_greenhouse(url):
            # boards.greenhouse.io/<slug>/jobs/<id>, job-boards.greenhouse.io/<slug>/...,
            # and the embed form boards.greenhouse.io/embed/job_board?for=<slug>.
            slug = (parse_qs(parsed.query).get("for") or [None])[0] or _first_slug()
        elif is_lever(url):            # jobs.lever.co/<slug>/<id>
            slug = _first_slug()
        elif is_ashby(url):            # jobs.ashbyhq.com/<slug>/<id>
            slug = _first_slug()
        elif is_smartrecruiters(url):  # jobs|careers|api.smartrecruiters.com/<slug>/...
            slug = _extract_company_slug(url)
        elif is_workday(url):          # <company>.wd5.myworkdayjobs.com/<site>/...
            sub = host.split(".")[0]
            slug = sub if sub not in ("www", "jobs", "careers") else None
        elif is_rippling(url):         # ats.rippling.com/<slug>/jobs
            slug, _ = _parse_rippling_url(url)
    except Exception:  # a malformed board URL must never break the reader
        return None

    if not slug or slug.lower() in _SLUG_NOISE:
        return None
    return _title_slug(slug) or None


def _decode_entities(value):
    """Strip HTML entities from an extracted field; JSON-LD lives in raw script text so json.loads never unescapes it (e.g. LinkedIn's "&amp;" titles), and unescaping repeats to also catch double-encoded "&amp;amp;" cases."""
    import html
    if not value:
        return value
    text = str(value)
    for _ in range(3):
        decoded = html.unescape(text)
        if decoded == text:
            break
        text = decoded
    return text


def _known_posting(url: str):
    """(title, company) of a job already stored under this URL's dedup identity, or None.

    Boards that wall off server-side fetches (Indeed, LinkedIn) are exactly the
    ones the scrapers already read through their own APIs.
    """
    from backend.scraper._shared.dedup import make_external_id
    db = SessionLocal()
    try:
        row = (db.query(Job.title, Job.company)
               .filter(Job.external_id == make_external_id("", "", url)).first())
    except Exception as e:  # a shortcut only: the page read below still answers
        logger.warning("extract: stored-job lookup failed for %s: %s", url, e)
        return None
    finally:
        db.close()
    if row and (row.title or "").strip() and (row.company or "").strip():
        return row.title, row.company
    return None


@router.post("/extract")
async def extract_posting(payload: ExtractRequest):
    """Read title + company off a posting URL for the Log-application modal: a job already stored under that URL first, then the page (JSON-LD JobPosting, OpenGraph, <title>/hostname); always returns 200 with whatever it found so form fields stay editable, and `blocked` says the site refused the read."""
    import json
    import re
    from urllib.parse import urlparse
    from bs4 import BeautifulSoup
    from backend.scraper._shared.url_safety import safe_get, assert_public_http_url, UnsafeURLError

    url = (payload.url or "").strip()
    try:
        assert_public_http_url(url)
    except UnsafeURLError as e:
        raise HTTPException(status_code=400, detail=f"Unsafe URL: {e}")

    known = _known_posting(url)
    if known:
        return {"title": known[0].strip(), "company": known[1].strip(), "blocked": False}

    title = company = None
    blocked = False
    try:
        resp = await safe_get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
        # Checked before the status: a challenge can arrive as a 200, and its
        # <title> ("Just a moment...") would otherwise become the job title.
        blocked = resp.status_code in _BLOCKED_STATUSES or is_bot_wall(resp.text)
        if blocked:
            logger.warning("extract: %s refused the read (HTTP %s)", url, resp.status_code)
            raise _ReadBlocked()
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text[:1_000_000], "html.parser")

        # 1. JSON-LD JobPosting (most ATS emit this)
        for tag in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(tag.string or "{}")
            except Exception:
                continue
            for node in (data if isinstance(data, list) else [data]):
                if not isinstance(node, dict):
                    continue
                if node.get("@type") == "JobPosting":
                    title = title or node.get("title")
                    org = node.get("hiringOrganization")
                    if isinstance(org, dict):
                        company = company or org.get("name")
                    elif isinstance(org, str):
                        company = company or org
        # 2. OpenGraph
        if not title:
            og = soup.find("meta", property="og:title")
            if og and og.get("content"):
                title = og["content"]
        if not company:
            og = soup.find("meta", property="og:site_name")
            # ATS boards set og:site_name to their own brand, so a brand-looking
            # value is dropped and the slug layer below wins.
            if og and og.get("content") and not _is_ats_brand(og["content"]):
                company = og["content"]
        # 3. <title>, minus the trailing " | Company" / " at Company" tail
        if not title and soup.title and soup.title.string:
            title = re.split(r"\s+[|–—-]\s+", soup.title.string.strip())[0]
    except HTTPException:
        raise
    except _ReadBlocked:
        pass  # already logged; the URL-only readings below still apply
    except Exception as e:
        logger.info("extract failed for %s: %s", url, e)

    # Known ATS board URLs carry the employer in the path/subdomain — read it
    # there before falling back to the hostname, which on those hosts is the ATS brand.
    if not company:
        company = _company_from_url(url)

    if not company:
        host = (urlparse(url).hostname or "").replace("www.", "")
        parts = [p for p in host.split(".") if p not in ("com", "io", "co", "org", "net", "ai", "jobs", "careers")]
        candidate = parts[-1].title() if parts else None
        # Leave it empty rather than fill the Company field with a board name.
        company = candidate if candidate and not _is_ats_brand(candidate) else None

    return {"title": (_decode_entities(title) or "").strip() or None,
            "company": (_decode_entities(company) or "").strip() or None,
            "blocked": blocked}


def _scoped_application(db, firm_id, principal, app_id, *, write=False):
    """Use candidate visibility for tracked rows; legacy rows have no own/team scope."""
    from backend.auth.policy import can
    from backend.auth.scoping import own_scope, team_scope
    from backend.api.routes_candidates import _candidate
    if write and not can(principal, "application.move"):
        raise HTTPException(403, "You don't have permission to edit interviews.")
    app_id = uuid_filter(str(app_id), "app_id")
    app = scoped(db, Application, firm_id).filter(Application.id == app_id).first()
    if app is None:
        raise HTTPException(404, "Application not found")
    if app.candidate_id is not None:
        _candidate(db, firm_id, principal, app.candidate_id)
    elif own_scope(principal) is not None or team_scope(principal) is not None:
        raise HTTPException(404, "Application not found")
    return app


@router.post("/{app_id}/interviews", status_code=201)
def add_interview(app_id: str, data: InterviewCreate, db: Session = Depends(get_db), firm_id=Depends(reader_firm_id),
                  principal: Principal = Depends(current_principal)):
    from backend.models.db import Interview
    app = _scoped_application(db, firm_id, principal, app_id, write=True)
    iv = Interview(firm_id=app.firm_id, application_id=app.id, what=data.what, where_text=data.where_text,
                   when_at=_parse_dt(data.when_at), status=data.status or "scheduled", prep=data.prep)
    db.add(iv)
    app.updated_at = utcnow()
    db.commit()
    return _interview_to_dict(iv)


@router.patch("/interviews/{interview_id}")
def update_interview(interview_id: str, updates: dict, db: Session = Depends(get_db), firm_id=Depends(reader_firm_id),
                     principal: Principal = Depends(current_principal)):
    from backend.models.db import Interview
    iv = scoped(db, Interview, firm_id).filter(Interview.id == interview_id).first()
    if not iv:
        raise HTTPException(status_code=404, detail="Interview not found")
    _scoped_application(db, firm_id, principal, iv.application_id, write=True)
    for key in ("what", "where_text", "status", "prep"):
        if key in updates:
            setattr(iv, key, updates[key])
    if "when_at" in updates:
        iv.when_at = _parse_dt(updates["when_at"])
    db.commit()
    return _interview_to_dict(iv)


@router.delete("/interviews/{interview_id}")
def delete_interview(interview_id: str, db: Session = Depends(get_db), firm_id=Depends(reader_firm_id),
                     principal: Principal = Depends(current_principal)):
    from backend.models.db import Interview
    iv = scoped(db, Interview, firm_id).filter(Interview.id == interview_id).first()
    if not iv:
        raise HTTPException(status_code=404, detail="Interview not found")
    _scoped_application(db, firm_id, principal, iv.application_id, write=True)
    db.delete(iv)
    db.commit()
    return {"deleted": True}


@router.get("/{app_id}/prep")
def prep_bundle(app_id: str, db: Session = Depends(get_db), firm_id=Depends(reader_firm_id),
                 principal: Principal = Depends(current_principal)):
    """Assemble the interview prep handover (role, résumé, posting, and the editable `prep_ask` closing question) as plain context for an external model; no LLM call happens here."""
    from backend.models.db import Resume
    app = _scoped_application(db, firm_id, principal, app_id)
    job = app.job

    def money(lo, hi):
        def k(v):
            return "$" + str(round(v / 1000)) + "K"
        if lo and hi and lo != hi:
            return k(lo) + "–" + k(hi)
        return k(lo or hi) if (lo or hi) else None

    # Which optional sections to include (Settings -> Interview prep).
    inc_row = db.query(Setting).filter(Setting.key == "prep_include").first()
    inc = {x.strip() for x in ((inc_row.value if inc_row else None) or "resume,posting,notes").split(",") if x.strip()}

    L = []
    add = L.append
    title = (job.title if job else None) or "Unknown Role"
    company = (job.company if job else None) or "Unknown Company"

    # ── 1. the role ──────────────────────────────────────────────────────────
    add("# " + title + " at " + company)
    add("")
    add("## The role")
    add("- Company: " + company)
    add("- Title: " + title)
    if job:
        if job.location:
            add("- Location: " + job.location + (" (remote)" if job.remote else ""))
        sal = money(job.salary_min, job.salary_max)
        if sal:
            add("- Listed salary: " + sal)
        if job.url:
            add("- Posting: " + job.url)
    add("- Stage: " + (app.status or "applied").capitalize())
    if app.interviews:
        add("- Interviews booked:")
        for iv in app.interviews:
            when = iv.when_at.strftime("%a %d %b %Y, %H:%M") if iv.when_at else "unscheduled"
            where = (" · " + iv.where_text) if iv.where_text else ""
            row = "  - " + iv.what + " — " + when + where + " (" + (iv.status or "scheduled") + ")"
            if iv.prep:
                row += "\n    prep note: " + iv.prep
            add(row)
    if app.notes and "notes" in inc:
        add("- My notes on this application: " + " ".join(app.notes.split()))

    # ── 2. my résumé, flattened to plain text ────────────────────────────────
    tailored = None
    if app.job_id:
        tailored = (scoped(db, Resume, firm_id)
                    .filter(Resume.job_id == app.job_id, Resume.is_base == False,  # noqa: E712
                            Resume.candidate_id == app.candidate_id)
                    .order_by(Resume.updated_at.desc()).first())
    cv_name = (tailored.name if tailored else None) or app.cv_version_used or (job.best_cv if job else None)
    src = tailored
    if not src and cv_name:
        src = scoped(db, Resume, firm_id).filter(Resume.name == cv_name,
                                                Resume.candidate_id == app.candidate_id).first()
    resume_text = ""
    if src and src.json_data:
        try:
            from backend.analyzer.cv_scorer import _flatten_resume
            resume_text = _flatten_resume(src.json_data)
        except Exception as e:
            logger.info("prep: could not flatten résumé %s: %s", cv_name, e)
    if "resume" in inc:
        add("")
        add("## My résumé" + (" — " + cv_name if cv_name else ""))
    # _flatten_resume emits its own "## Summary"/"## Experience" headings — demote
    # them so they read as parts of the résumé, not siblings of "The posting".
        body = resume_text.strip() or "[résumé content unavailable]"
        add("\n".join(("#" + ln) if ln.startswith("##") else ln for ln in body.splitlines()))

    # ── 3. the posting, plain text ───────────────────────────────────────────
    if "posting" in inc:
        posting = ((job.cached_page_text or job.description) if job else "") or ""
        add("")
        add("## The posting")
        add(posting.strip() or "[no posting text was captured]")

    # ── 4. the ask — editable in Settings → AI ───────────────────────────────
    ask = db.query(Setting).filter(Setting.key == "prep_ask").first()
    add("")
    add("## What I need from you")
    add((ask.value.strip() if ask and ask.value else "") or "Prepare me for this interview.")
    return {"text": "\n".join(L)}


def _app_to_dict(a: Application, lookup=None, tailored=None, has_cover_letter=False) -> dict:
    """Serialize an Application; pass lookup={lowercase: Company} (from build_company_lookup) to populate company_canonical for alias-aware grouping, else it falls back to the raw company name."""
    job = a.job
    raw = job.company if job else None
    canonical_co = (lookup or {}).get((raw or "").lower())
    return {
        "id": str(a.id),
        "job_id": str(a.job_id),
        "candidate_id": str(a.candidate_id) if a.candidate_id else None,
        "submitted_by_user_id": str(a.submitted_by_user_id) if a.submitted_by_user_id else None,
        "status": a.status,
        "status_revision": a.status_revision,
        "status_effective_at": a.status_effective_at.isoformat() if a.status_effective_at else None,
        "last_manual_change_at": a.last_manual_change_at.isoformat() if a.last_manual_change_at else None,
        "pending_reviews": [{"id": str(r.id), "message_id": str(r.inbox_message_id),
                             "revision": r.revision, "reason": r.reason}
                            for r in a.reviews if r.state == "PENDING"],
        "applied_at": a.applied_at.isoformat() if a.applied_at else None,
        "cv_version_used": a.cv_version_used,
        "notes": a.notes,
        "next_action": a.next_action,
        "next_action_date": a.next_action_date.isoformat() if a.next_action_date else None,
        "last_email_received": a.last_email_received.isoformat() if a.last_email_received else None,
        "last_email_snippet": a.last_email_snippet,
        "status_transitions": a.status_transitions or [],
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        "company": raw,
        "company_canonical": canonical_co.name if canonical_co else raw,
        "title": job.title if job else None,
        "url": job.url if job else None,
        "best_cv": job.best_cv if job else None,
        "short_id": job.short_id if job else None,
        # posting details the detail pane shows, so it never has to re-fetch the job
        "location": job.location if job else None,
        "salary_min": job.salary_min if job else None,
        "salary_max": job.salary_max if job else None,
        "source": job.source if job else None,
        "has_cached_page": bool(job.cached_page_html) if job else False,
        "discovered_at": job.discovered_at.isoformat() if (job and job.discovered_at) else None,
        "tailored_resume_id": str(tailored.id) if tailored else None,
        "tailored_resume_name": tailored.name if tailored else None,
        "has_cover_letter": has_cover_letter,
        "interviews": [_interview_to_dict(i) for i in (a.interviews or [])],
    }


def _interview_to_dict(i) -> dict:
    return {
        "id": str(i.id),
        "what": i.what,
        "when_at": i.when_at.isoformat() if i.when_at else None,
        "where_text": i.where_text,
        "status": i.status or "scheduled",
        "prep": i.prep,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }
