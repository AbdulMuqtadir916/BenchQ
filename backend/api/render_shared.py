"""Rendering and job-description helpers shared by cover letters, interview prep and the settings page. They lived in
the old `/api/resumes` router (JobNavigator's), which résumé versioning PR 6 removed (docs/team/resume-versioning.md
§8); moved here unchanged.

- The tailoring gate (`tailoring_max_concurrent`), also taken by cover-letter generation.
- The warm Playwright browser and the template-folder lookup for cover-letter PDFs.
- Tracer links: contact URLs swapped for tracking links on export.
- `_resolve_tailoring_jd`: the job description to write from, fetched once if the job has none.
"""
import functools as _functools
import logging
import re
from pathlib import Path

from fastapi import HTTPException

from backend.models.db import CoverLetter, Job, Resume, SessionLocal, Setting, TracerLink

logger = logging.getLogger("jobnavigator.resumes")


def _get_tailoring_semaphore():
    """The process-wide tailoring gate (`tailoring_max_concurrent`).

    Lives in job_monitor so launch_background can take it before the worker
    opens its first DB session; re-entrant per task, so a worker already inside
    the gate is not blocked by its own `async with` here.
    """
    from backend.job_monitor import get_limiter
    return get_limiter("tailoring")


def reset_tailoring_semaphore():
    """Drop the gate so the next call re-reads the limit from DB."""
    from backend.job_monitor import reset_limiter
    reset_limiter("tailoring")


# Warm Playwright browser singleton for fast PDF generation (~3-13ms warm vs ~500ms cold)
_pw_instance = None
_pw_browser = None

async def _get_browser():
    """Get or create a warm Playwright browser instance."""
    global _pw_instance, _pw_browser
    if _pw_browser and _pw_browser.is_connected():
        return _pw_browser
    from playwright.async_api import async_playwright
    _pw_instance = await async_playwright().start()
    _pw_browser = await _pw_instance.chromium.launch(headless=True, args=['--font-render-hinting=none'])
    logger.info("Warm Playwright browser started for PDF generation")
    return _pw_browser


# A template name is a folder name, never a path: `pathlib` joins an absolute or
# `../`-prefixed value by escaping the base directory, and the reachable set was the
# whole container filesystem (R4-T5-01). Nothing here ever *builds* a path out of the
# request: template_paths() lists the folders that exist and the request name is only
# ever a key looked up in that mapping, so the Path that gets opened always comes from
# the directory listing.
_TEMPLATE_NAME_RE = re.compile(r"^[a-z0-9_]+$")


def template_paths(templates_dir: Path) -> dict:
    """{folder name: Path} for every real template directly under `templates_dir`.

    Both keys and values come from `iterdir()`, never from user input; a symlink that
    points outside the tree is dropped because its resolved parent is not the base dir.
    """
    found: dict[str, Path] = {}
    try:
        base = templates_dir.resolve()
        entries = sorted(templates_dir.iterdir())
    except OSError:
        return found
    for d in entries:
        if not d.is_dir() or not (d / "template.html.j2").is_file():
            continue
        try:
            if d.resolve().parent != base:
                continue  # a symlink escaping the template tree
        except OSError:
            continue
        found[d.name] = d
    return found


def resolve_template_dir(name, templates_dir: Path) -> Path:
    """Return the on-disk folder for template `name`, or 422 (never 500, never a path escape)."""
    if not isinstance(name, str):
        raise HTTPException(status_code=422, detail=f"Unknown template: {name!r}")
    path = template_paths(templates_dir).get(name)
    if path is None:
        raise HTTPException(status_code=422, detail=f"Unknown template: {name!r}")
    return path


def validate_template_name(name, templates_dir: Path) -> str:
    """Return the folder name as it is spelled on disk when `name` names a real template; 422 otherwise."""
    return resolve_template_dir(name, templates_dir).name


@_functools.lru_cache(maxsize=32)
def _load_template_fonts(fonts_dir_str: str) -> dict:
    """Read + base64-encode a template's fonts once per process; fonts never change at runtime but were being re-read on every render, and the cache is keyed by directory path so resume and cover-letter template trees share it."""
    import base64
    from pathlib import Path as _Path
    fonts = {}
    fonts_dir = _Path(fonts_dir_str)
    if fonts_dir.exists():
        for pattern in ("*.TTF", "*.ttf"):
            for font_file in fonts_dir.glob(pattern):
                with open(font_file, "rb") as f:
                    fonts[font_file.name] = "data:font/truetype;base64," + base64.b64encode(f.read()).decode()
    return fonts


# Anything that already names a scheme: `tel:`, `mailto:`, `sms:`, `skype:`…
_SCHEME_RE = re.compile(r'^([a-zA-Z][a-zA-Z0-9+.\-]*):')


def _is_traceable_url(url: str) -> bool:
    """True only for a web address a tracer link can stand in for.

    A non-web scheme used to be prefixed with `https://` (`https://tel:+1555…`), and a
    bare address became `https://someone@gmail.com` — valid-looking tracer links whose
    destination cannot resolve (R4-T5-12). Those values pass through untouched.
    """
    url = (url or "").strip()
    if not url:
        return False
    m = _SCHEME_RE.match(url)
    if m:
        return m.group(1).lower() in ("http", "https")
    # No scheme: an email address (`@` before any path separator) is not a URL.
    return "@" not in url.split("/", 1)[0]


def _rewrite_urls_with_tracers(json_data: dict, resume_id: str, db,
                               cover_letter_id: str = None, job_id=None) -> dict:
    """Replace header contact URLs with tracer redirect URLs, returning a modified copy; owner is exactly one of a resume (resume_id) or a cover letter (cover_letter_id), with job_id resolving the short_id for job_id token styles."""
    import secrets, json as _json

    enabled_row = db.query(Setting).filter(Setting.key == "tracer_links_enabled").first()
    if not enabled_row or enabled_row.value != "true":
        return json_data

    base_url_row = db.query(Setting).filter(Setting.key == "tracer_links_base_url").first()
    base_url = (base_url_row.value if base_url_row else "").rstrip("/")
    if not base_url:
        return json_data

    style_row = db.query(Setting).filter(Setting.key == "tracer_links_url_style").first()
    url_style = style_row.value if style_row else "path"

    owner_is_cl = cover_letter_id is not None
    owner_filter = (TracerLink.cover_letter_id == cover_letter_id) if owner_is_cl \
        else (TracerLink.resume_id == resume_id)

    # A link belongs to its document's firm (F2b).
    owner_model = CoverLetter if owner_is_cl else Resume
    owner_firm_id = db.query(owner_model.firm_id).filter(
        owner_model.id == (cover_letter_id if owner_is_cl else resume_id)).scalar()

    def _new_link(token, dest_url, label):
        kwargs = {"firm_id": owner_firm_id, "token": token, "destination_url": dest_url, "source_label": label}
        if owner_is_cl:
            kwargs["cover_letter_id"] = cover_letter_id
        else:
            kwargs["resume_id"] = resume_id
        return TracerLink(**kwargs)

    def _repoint(link, dest_url, label):
        # A résumé and the cover letter for the same job derive the same token by
        # design, so this claims the token for the current owner without releasing the other side — both FKs stay set so each document's own stats stay correct.
        if owner_is_cl:
            link.cover_letter_id = cover_letter_id
        else:
            link.resume_id = resume_id
        link.destination_url = dest_url
        link.source_label = label

    # Resolve the owning job's short_id once (for *_jobid token styles).
    job_short_id = None
    if url_style in ("path_jobid", "param_jobid"):
        resolved_job_id = job_id
        if not resolved_job_id and not owner_is_cl:
            resume_obj = db.query(Resume).filter(Resume.id == resume_id).first()
            resolved_job_id = resume_obj.job_id if resume_obj else None
        if resolved_job_id:
            job_obj = db.query(Job).filter(Job.id == resolved_job_id).first()
            job_short_id = job_obj.short_id if job_obj else None

    data = _json.loads(_json.dumps(json_data))
    header = data.get("header", {})

    items = header.get("contact_items", [])
    for i, item in enumerate(items):
        url = item.get("url")
        if not url or not url.strip() or not _is_traceable_url(url):
            continue

        url = url.strip()
        label = item.get("text", f"Link {i+1}")
        dest_url = url if url.lower().startswith(("http://", "https://")) else f"https://{url}"
        # Suffix for per-link distinction in job_id modes (user stub or first 3 chars)
        stub = item.get("stub")
        label_suffix = stub or label.lower()[:3]

        jobid_style = url_style in ("path_jobid", "param_jobid")
        if job_short_id:
            token = f"{job_short_id}{label_suffix}"
        elif jobid_style and stub:
            # Base resume (no job → no short_id) with an explicit stub: reserve "0"
            # as the no-job prefix so the token is 0{stub} instead of random.
            token = f"0{stub}"
        else:
            token = None

        from sqlalchemy.exc import IntegrityError
        existing = db.query(TracerLink).filter(
            owner_filter, TracerLink.destination_url == dest_url,
        ).first()

        # The deterministic token is a preference, never a guarantee: only a
        # job-derived {short_id}{stub} is unique by construction, so the job-less 0{stub} fallback may only be taken when nothing else holds it.
        def _taken_by_other(tok):
            q = db.query(TracerLink).filter(TracerLink.token == tok)
            if existing is not None:
                q = q.filter(TracerLink.id != existing.id)
            return q.first()

        if existing:
            if token and existing.token != token and _taken_by_other(token) is None:
                try:
                    existing.token = token
                    db.commit()
                except IntegrityError:
                    db.rollback()   # lost a race for it; keep the token we have
            # whatever happened above, the row's own token is the truth
            token = existing.token
        else:
            holder = _taken_by_other(token) if token else None
            if holder is not None and not job_short_id:
                # 0{stub} already belongs to a different job-less owner — taking
                # it would break their links, so fall back to a random token.
                token = None
            if token:
                if holder is not None:
                    # Same job → a resume and its cover letter intentionally share
                    # this token; hand it to whoever is rendering now.
                    _repoint(holder, dest_url, label)
                    db.commit()
                else:
                    # concurrent PDF renders can race here (same deterministic token);
                    # on the unique-violation, recover the row the other request inserted.
                    try:
                        db.add(_new_link(token, dest_url, label))
                        db.commit()
                    except IntegrityError:
                        db.rollback()
                        winner = db.query(TracerLink).filter(TracerLink.token == token).first()
                        if winner:
                            _repoint(winner, dest_url, label)
                            db.commit()
            if not token:
                # secrets, not random: the fallback token is the only entropy a
                # link without a job short_id has (R4-T5-07). 8 bytes ≈ 11 chars.
                for _ in range(100):
                    token = secrets.token_urlsafe(8)
                    if db.query(TracerLink).filter(TracerLink.token == token).first():
                        continue
                    try:
                        db.add(_new_link(token, dest_url, label))
                        db.commit()
                        break
                    except IntegrityError:
                        db.rollback()
                        continue

        if url_style in ("param", "param_jobid"):
            tracer_url = f"{base_url}?cv={token}"
        else:
            tracer_url = f"{base_url}/cv/{token}"

        items[i]["url"] = tracer_url

    data["header"] = header
    return data


def _persist_job_description(job_id, description: str) -> None:
    """Write a freshly fetched JD back to the job in its own short session."""
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.description = description
            db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"Could not persist fetched description for job {job_id}: {e}")
    finally:
        db.close()


async def _resolve_tailoring_jd(job, db=None) -> str:
    """Resolve the JD text to tailor against, best-quality first: job.description, then a live fetch persisted back to job.description, then the noisier job.cached_page_text as a last resort; returns "" when nothing usable exists.

    `job` may be a detached snapshot: with db=None the fetched text is persisted
    through a short session of its own, so no connection is held across the
    fetch. Callers that already own a session pass it and keep the old
    "caller commits" behaviour.
    """
    if (job.description or "").strip():
        return job.description
    if (job.url or "").strip():
        from backend.scraper.ats._descriptions import _fetch_job_description
        fetched = await _fetch_job_description(job.url)
        if fetched and fetched.strip():
            job.description = fetched
            if db is not None:
                db.commit()
            else:
                _persist_job_description(job.id, fetched)
            return fetched
    return job.cached_page_text or ""
