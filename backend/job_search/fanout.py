"""One "Find jobs" click, several sources (decided 2026-11-17, Q90–Q93, Q145–Q146; the split since 2026-11-18, 07 Q71).

The BDE no longer picks a source. The place's mode (`places.mode_of`) says which sources one click asks, each a
"leg" (a source and a place) with how many jobs it **asks** for and how many it **keeps**, in priority order; the
day's 50 (`limits.JOBS_PER_CANDIDATE_PER_DAY`) is shared out like this:

    On-site (city)  LinkedIn, the city 25 → 20 · Indeed, the city 13 → 10              · then freehire.me, the city 20
    Hybrid (city)   LinkedIn, the city 25 → 20 · Indeed, the city 10 → 5 · Indeed, Remote 10 → 5 · then freehire.me, remote 20
    Remote          Indeed, Remote 33 → 30                                              · then freehire.me, remote 20

LinkedIn sits out Remote: its public search can't ask for remote jobs (live 2026-11-17). LinkedIn and Indeed start
together: Indeed's legs one after the other (two searches at once invite a block), LinkedIn beside them. Indeed saves
as soon as it answers, within today's room less LinkedIn's share, which is held for it (Q90, Q146); LinkedIn saves
when it answers or after `linkedin.TIME_LIMIT_SECONDS`. Then room left over goes to the jobs they brought beyond what
they keep, in priority order (Q123): LinkedIn's short share is filled by Indeed's extras first. Only if the day still
isn't full is freehire.me asked (a **filler** leg), and it fills what's left. So a higher source always comes first,
whichever answers first. With every source full, one click saves: on-site LinkedIn 25, Indeed 13, freehire.me 12;
hybrid LinkedIn 25, Indeed 10 and 10, freehire.me 5; remote Indeed 33, freehire.me 17.

- **Same job, two sources (Q91):** a job whose company and title the candidate already has from another source, or that
  an earlier leg of this click saved, isn't saved again (`skipped_duplicate_source`).
- **Jobs that didn't fit (Q92):** a leg some of whose jobs weren't saved keeps its place, so the next click reads that
  page again; a leg whose jobs were all saved moves on. Jobs that didn't fit are dropped (Q145).
- **A leg that fails (Q93)** doesn't fail the click; the search fails only when every leg failed.
- **The daily limit** is `limits.JOBS_PER_CANDIDATE_PER_DAY` new jobs per candidate (50 since 2026-11-21, 07 Q71).

The batch keeps each leg's place (`request.legs`: cursor, exhausted), its counts by source (`counts.by_source`) and any
leg's error code (`errors`). Logs carry ids, codes, counts and timings only.
"""
import asyncio
import logging
import re
import time
from dataclasses import dataclass, field

from backend.auth.scoping import scoped
from backend.job_search import limits, places
from backend.job_search.providers import REGISTRY, REMOTE, ProviderError, SearchResult
from backend.match import store as match_store
from backend.models.db import SessionLocal, utcnow
from backend.models.job_search import JobPosting

logger = logging.getLogger("benchq.job_search")

LABELS = {"linkedin": "LinkedIn", "indeed": "Indeed", "freehire": "freehire.me"}


@dataclass(frozen=True)
class Leg:
    provider: str
    place: str | None
    ask: int                    # how many jobs the source is asked for
    keep: int                   # how many it may save before the others have had their turn
    remote_only: bool = False
    filler: bool = False        # asked only if the day still isn't full once the others have saved (07 Q71)

    @property
    def key(self) -> str:
        return f"{self.provider}|{self.place or ''}"


def plan(place: str | None) -> list[Leg]:
    """The legs one click asks, in priority order (07 Q71, 2026-11-18)."""
    mode, city = places.mode_of(place)
    if mode == "remote":
        return [Leg("indeed", REMOTE, 33, 30, True), Leg("freehire", REMOTE, 20, 20, True, filler=True)]
    if mode == "hybrid":
        return [Leg("linkedin", city, 25, 20), Leg("indeed", city, 10, 5), Leg("indeed", REMOTE, 10, 5, True),
                Leg("freehire", REMOTE, 20, 20, True, filler=True)]
    return [Leg("linkedin", city, 25, 20), Leg("indeed", city, 13, 10), Leg("freehire", city, 20, 20, filler=True)]


def continue_legs(rows, query: str, country: str, legs: list[Leg]) -> dict:
    """Where each leg continues today: the latest finished click of the same role and country that ran it."""
    from backend.job_search.pipeline import _same_role
    out: dict = {}
    for row in rows:                                    # newest first
        request = (row.meta or {}).get("request") or {}
        if _same_role(request.get("query")) != _same_role(query) or request.get("country") != country:
            continue
        for leg in legs:
            if leg.key not in out and leg.key in (request.get("legs") or {}):
                out[leg.key] = request["legs"][leg.key]
    return {leg.key: out.get(leg.key) or {"cursor": None, "exhausted": False} for leg in legs}


_NORM = re.compile(r"[^a-z0-9]+")


def same_job_key(company: str | None, title: str | None) -> str:
    """Two sources' copies of one job: the same company and title, case and punctuation aside (Q91)."""
    return f"{_NORM.sub(' ', (company or '').lower()).strip()}|{_NORM.sub(' ', (title or '').lower()).strip()}"


@dataclass
class _Click:
    firm_id: object
    candidate_id: object
    user_id: object
    batch_id: object
    query: str
    country: str
    place: str | None
    scorer: object
    legs: list
    start: dict                                         # leg key -> {"cursor", "exhausted"} it started from
    counts: dict = field(default_factory=dict)          # leg key -> counts
    next_cursor: dict = field(default_factory=dict)
    held: dict = field(default_factory=dict)            # leg key -> [(job_id, content, fields)] that didn't fit
    errors: dict = field(default_factory=dict)          # leg key -> error code
    known: dict | None = None                           # same-job key -> source, the candidate's postings
    gone: bool = False                                  # the batch stopped running (marked lost): write nothing


def _known(db, click: _Click) -> dict:
    """The candidate's postings by company and title (Q91), read once per click."""
    if click.known is None:
        from backend.job_search.providers import reader_for
        click.known = {}
        rows = scoped(db, JobPosting, click.firm_id, JobPosting.source, JobPosting.content).filter(
            JobPosting.candidate_id == click.candidate_id).all()
        for source, content in rows:
            reader = reader_for(source)
            try:
                fields = reader.read(content or {}) if reader else None
            except Exception:
                fields = None
            if fields is not None:
                click.known.setdefault(same_job_key(fields.company, fields.title), source)
    return click.known


def _keep_pasted(row, content: dict, source: str) -> dict:
    """A posting pasted by the BDE (Q107) or fetched whole stays when a search refreshes the job: the search's is
    shorter, or none."""
    old = row.content or {}
    if row.source == source and (old.get("_pasted") or old.get("_full_posting")):
        marker = {k: old[k] for k in ("_pasted", "_full_posting") if old.get(k)}
        return {**content, "description": old.get("description"), **marker}
    return content


def _write(db, click: _Click, leg: Leg, items, allowed: int, counts: dict, now) -> list:
    """Save up to `allowed` new jobs of `items` and refresh the ones the candidate has. The ones over `allowed` are
    returned (they didn't fit)."""
    db.flush()                          # this transaction's own new rows count as the candidate's (the session doesn't autoflush)
    known = _known(db, click)
    keys = list(dict.fromkeys(key for key, _, _ in items))
    existing = {row.job_id: row for row in scoped(db, JobPosting, click.firm_id).filter(
        JobPosting.candidate_id == click.candidate_id, JobPosting.job_id.in_(keys))} if keys else {}
    left = []
    for key, content, fields in items:
        row = existing.get(key)
        if row is not None and row.batch_id == click.batch_id and row.last_seen_at == now:
            continue                                     # already written by this very transaction
        same = same_job_key(fields.company, fields.title)
        if row is None and same in known and known[same] != leg.provider:
            counts["skipped_duplicate_source"] = counts.get("skipped_duplicate_source", 0) + 1
            continue
        if row is not None:
            row.batch_id, row.last_seen_at = click.batch_id, now
            row.content, row.source = _keep_pasted(row, content, leg.provider), leg.provider
            counts["refreshed"] += 1
        elif allowed > 0:
            row = JobPosting(firm_id=click.firm_id, candidate_id=click.candidate_id, batch_id=click.batch_id,
                             source=leg.provider, first_source=leg.provider, job_id=key, content=content,
                             discovered_at=now, last_seen_at=now)
            db.add(row)
            existing[key] = row
            counts["saved"] += 1
            allowed -= 1
        else:
            left.append((key, content, fields))
            continue
        known.setdefault(same, leg.provider)
        if click.scorer is not None:
            match_store.apply(row, click.scorer, match_store.fields_of(row))
    return left


def _save_leg(click: _Click, leg: Leg, result: SearchResult, reserve: int) -> None:
    from backend.job_search import pipeline
    counts = pipeline.new_counts(result)
    counts["skipped_duplicate_source"] = 0
    click.counts[leg.key], click.next_cursor[leg.key] = counts, result.next_cursor
    picked = pipeline.pick(REGISTRY[leg.provider], result, leg.remote_only, click.scorer, counts)
    with SessionLocal() as db:
        if pipeline._running_batch(db, click.firm_id, click.candidate_id, click.batch_id) is None:
            click.gone = True
            return
        now = utcnow()
        room = max(0, limits.JOBS_PER_CANDIDATE_PER_DAY
                   - limits.jobs_saved_today(db, click.firm_id, click.candidate_id, now) - reserve)
        left = _write(db, click, leg, picked, min(room, leg.keep), counts, now)
        click.held[leg.key] = left
        counts["skipped_over_cap"] += len(left)
        db.commit()


def _room_left(click: _Click) -> int:
    """Today's new jobs the candidate still has room for."""
    with SessionLocal() as db:
        return max(0, limits.JOBS_PER_CANDIDATE_PER_DAY
                   - limits.jobs_saved_today(db, click.firm_id, click.candidate_id, utcnow()))


def _fill_leftover(click: _Click) -> None:
    """Room still left today goes to the jobs that didn't fit in their leg's share, in priority order (Q123)."""
    from backend.job_search import pipeline
    if not any(click.held.values()):
        return
    with SessionLocal() as db:
        if pipeline._running_batch(db, click.firm_id, click.candidate_id, click.batch_id) is None:
            click.gone = True
            return
        now = utcnow()
        room = max(0, limits.JOBS_PER_CANDIDATE_PER_DAY
                   - limits.jobs_saved_today(db, click.firm_id, click.candidate_id, now))
        for leg in click.legs:
            items = click.held.get(leg.key) or []
            if not items or room <= 0:
                continue
            counts = click.counts[leg.key]
            before = counts["saved"]
            left = _write(db, click, leg, items, room, counts, now)
            room -= counts["saved"] - before
            counts["skipped_over_cap"] -= len(items) - len(left)
            click.held[leg.key] = left
        db.commit()


def _finish(click: _Click) -> str:
    from backend.job_search import pipeline
    with SessionLocal() as db:
        batch = pipeline._running_batch(db, click.firm_id, click.candidate_id, click.batch_id)
        if batch is None or click.gone:
            return "dropped: the search was no longer running"
        now = utcnow()
        if len(click.errors) == len(click.legs):         # every leg failed (Q93)
            code = next(iter(click.errors.values()))
            pipeline._fail(db, batch, code=code, user_id=click.user_id, query=click.query, country=click.country,
                           at=now, place=click.place)
            db.commit()
            return f"failed: {code}"
        legs_meta = {}
        for leg in click.legs:
            start = click.start.get(leg.key) or {"cursor": None, "exhausted": False}
            if leg.key in click.errors or click.held.get(leg.key):
                legs_meta[leg.key] = start                   # failed, or jobs didn't fit: read it again next time (Q92)
            else:
                following = click.next_cursor.get(leg.key)
                legs_meta[leg.key] = {"cursor": following, "exhausted": following is None}
        by_source: dict = {}
        for leg in click.legs:
            for name, value in (click.counts.get(leg.key) or {}).items():
                by_source.setdefault(leg.provider, {}).setdefault(name, 0)
                by_source[leg.provider][name] += value
        totals: dict = {}
        for counts in by_source.values():
            for name, value in counts.items():
                totals[name] = totals.get(name, 0) + value
        found = totals.get("found", 0)
        request = {**((batch.meta or {}).get("request") or {}), "legs": legs_meta}
        batch.state, batch.finished_at = ("success" if found else "empty"), now
        batch.meta = {**{k: v for k, v in (batch.meta or {}).items() if k == "run_id"}, "request": request,
                      "counts": {**totals, "by_source": by_source}, "errors": click.errors}
        new = " · ".join(f"{LABELS.get(p, p)} {c.get('saved', 0)}" for p, c in by_source.items())
        summary = f"{new} new, {totals.get('refreshed', 0)} seen again"
        pipeline._ledger(db, firm_id=click.firm_id, candidate_id=click.candidate_id, user_id=click.user_id,
                         batch_id=click.batch_id, query=click.query, country=click.country,
                         summary=f"{pipeline._searched(click.query, click.place)}: {summary}")
        db.commit()
    return summary


async def run(*, firm_id, candidate_id, user_id, batch_id, query: str, country: str, place: str | None, titles,
              request: dict, scorer, years, level, search_level=None) -> str:
    """The click's legs, saved as they answer; the batch finished with every leg's counts. Returns the summary."""
    legs = plan(place)
    start = request.get("legs") or {}
    click = _Click(firm_id=firm_id, candidate_id=candidate_id, user_id=user_id, batch_id=batch_id, query=query,
                   country=country, place=place, scorer=scorer, legs=legs, start=start)
    started = time.monotonic()

    async def fetch(leg: Leg):
        state = start.get(leg.key) or {}
        if state.get("exhausted"):                      # the source had nothing more for this today
            return SearchResult(jobs=[], metadata={"exhausted": True}), None
        try:
            return await REGISTRY[leg.provider].search(
                query, country, leg.ask, state.get("cursor"), place=leg.place,
                posted_within_days=limits.POSTED_WITHIN_DAYS, titles=titles, years=years, level=level,
                search_level=search_level, firm_id=firm_id), None
        except ProviderError as error:
            return None, error.code
        except Exception as error:      # a provider's own bug: its message may hold a URL, so only its type
            logger.error("job search batch=%s leg=%s unexpected %s", batch_id, leg.provider, type(error).__name__)
            return None, "internal"

    fillers = [leg for leg in legs if leg.filler]
    click.legs = [leg for leg in legs if not leg.filler]       # a filler joins only if it is asked
    linkedin = [leg for leg in click.legs if leg.provider == "linkedin"]
    reserve = {"jobs": sum(leg.keep for leg in linkedin)}      # LinkedIn's share, held for it (Q90, Q146)
    linkedin_tasks = [(leg, asyncio.create_task(fetch(leg))) for leg in linkedin]

    async def save(leg: Leg, outcome) -> None:
        result, code = outcome
        if code is not None:
            click.errors[leg.key] = code
            click.counts.setdefault(leg.key, {})
            return
        await asyncio.to_thread(_save_leg, click, leg, result, reserve["jobs"])

    async def indeed_in_turn() -> None:
        for leg in (leg for leg in click.legs if leg.provider == "indeed"):
            await save(leg, await fetch(leg))

    async def the_others() -> None:
        others = [leg for leg in click.legs if leg.provider not in ("indeed", "linkedin")]
        outcomes = await asyncio.gather(*(fetch(leg) for leg in others))
        for leg, outcome in zip(others, outcomes):
            await save(leg, outcome)

    await asyncio.gather(indeed_in_turn(), the_others())
    reserve["jobs"] = 0
    for leg, task in linkedin_tasks:
        await save(leg, await task)
    await asyncio.to_thread(_fill_leftover, click)
    # 07 Q71: freehire.me only when the day still isn't full, and it fills what's left.
    for leg in fillers:
        if click.gone or await asyncio.to_thread(_room_left, click) <= 0:
            break
        click.legs.append(leg)
        await save(leg, await fetch(leg))
    summary = await asyncio.to_thread(_finish, click)
    logger.info("job search batch=%s candidate=%s legs=%d errors=%d ms=%d", batch_id, candidate_id, len(legs),
                len(click.errors), (time.monotonic() - started) * 1000)
    return summary

