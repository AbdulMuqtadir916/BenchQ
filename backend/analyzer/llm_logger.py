"""Persist LLM call metrics to the llm_call_log table, and say what the AI did in the activity log. Non-fatal on errors.

An activity row has no firm, so only the Super Admin reads it. A person's call is one row. A scheduled run's calls become
one row for each kind of work, with the totals (`one_row_per_run`), so scoring 80 jobs doesn't write 80 rows.
"""
import contextvars
import logging
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from backend.auth import ledger
from backend.models.db import SessionLocal, LlmCallLog
from backend.analyzer.llm_cost import calc_cost

logger = logging.getLogger("jobnavigator.llm_logger")

# purpose -> (who it was, what it did once, what it did `n` times).
_WORK = {
    "score_light": ("Job scoring", "scored 1 job against the résumés", "scored {n} jobs against the résumés"),
    "score_full": ("Job scoring", "scored 1 job against the résumés", "scored {n} jobs against the résumés"),
    "tailor": ("Résumé tailoring", "tailored 1 résumé", "tailored {n} résumés"),
    "email": ("Email reading", "read 1 email", "read {n} emails"),
    "email_classification": ("Email reading", "classified 1 email", "classified {n} emails"),
    "autofill": ("Autofill", "drafted 1 answer", "drafted {n} answers"),
    "cover_letter": ("Cover letters", "wrote 1 cover letter", "wrote {n} cover letters"),
    "resume_parse": ("Résumé reading", "read 1 résumé", "read {n} résumés"),
}


@dataclass
class _Work:
    """What a kind of AI work added up to."""
    model: str
    calls: int = 0
    failed: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost: float = 0.0

    def add(self, *, success: bool, usage: dict, cost: float) -> None:
        self.calls += 1
        self.failed += 0 if success else 1
        self.input_tokens += usage.get("input_tokens", 0) or 0
        self.output_tokens += usage.get("output_tokens", 0) or 0
        self.cost += cost or 0.0


class _RunWork:
    def __init__(self):
        self.by_purpose: dict[str, _Work] = {}
        self.is_open = True


_run_work: contextvars.ContextVar[Optional[_RunWork]] = contextvars.ContextVar("llm_run_work", default=None)


def _log_work(purpose: str, work: _Work) -> None:
    actor, once, many = _WORK.get(purpose, (purpose, f"made 1 {purpose} call", f"made {{n}} {purpose} calls"))
    done = once if work.calls == 1 else many.format(n=work.calls)
    failed = f" ({work.failed} failed)" if work.failed else ""
    summary = f"AI agent {done}{failed}: {work.input_tokens:,} tokens in, {work.output_tokens:,} out, ${work.cost:.4f}"
    try:
        db = SessionLocal()
        try:
            ledger.record_automated(db, actor_type="AGENT", actor_name=actor, action="AI_GENERATE", entity_type="llm_call",
                                    entity_id=uuid.uuid4(), entity_label=actor, summary=summary, firm_id=None,
                                    candidate_id=None, model_id=work.model)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"LLM activity not logged (non-fatal): {e}")


@contextmanager
def one_row_per_run():
    """The AI calls made inside become one activity row for each kind of work, once the block ends."""
    run = _RunWork()
    token = _run_work.set(run)
    try:
        yield
    finally:
        _run_work.reset(token)
        run.is_open = False     # a task that outlives the run logs its own call
        for purpose, work in run.by_purpose.items():
            _log_work(purpose, work)


def _record_work(purpose: str, model: str, *, success: bool, usage: dict, cost: float) -> None:
    run = _run_work.get()
    if run is not None and run.is_open:
        run.by_purpose.setdefault(purpose, _Work(model=model)).add(success=success, usage=usage, cost=cost)
        return
    work = _Work(model=model)
    work.add(success=success, usage=usage, cost=cost)
    _log_work(purpose, work)


def log_llm_call(
    purpose: str,
    provider: str,
    model: str,
    usage: dict,
    duration_ms: int = 0,
    job_id: Optional[UUID] = None,
    success: bool = True,
    error: Optional[str] = None,
    firm_id: Optional[UUID] = None,
) -> None:
    """Insert a row into llm_call_log; swallows DB errors so logging never breaks scoring. usage: {input_tokens, output_tokens, cache_read_tokens, cache_write_tokens}. `firm_id`: the firm the call was for, so AI spend can be split by firm (Q33); an entry point that knows its firm passes it."""
    try:
        cost = calc_cost(
            provider,
            model,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cache_read_tokens=usage.get("cache_read_tokens", 0),
            cache_write_tokens=usage.get("cache_write_tokens", 0),
        )
        db = SessionLocal()
        try:
            row = LlmCallLog(
                purpose=purpose,
                provider=provider,
                model=model,
                job_id=job_id,
                firm_id=firm_id,
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
                cache_read_tokens=usage.get("cache_read_tokens", 0),
                cache_write_tokens=usage.get("cache_write_tokens", 0),
                cost_usd=cost,
                duration_ms=duration_ms,
                success=success,
                error=(error[:500] if error else None),  # truncate long error strings
            )
            db.add(row)
            db.commit()
        finally:
            db.close()
        _record_work(purpose, model, success=success, usage=usage, cost=cost)
    except Exception as e:
        logger.warning(f"log_llm_call failed (non-fatal): {e}")


@asynccontextmanager
async def track_llm_call(purpose: str, provider: str, model: str, job_id=None, firm_id=None):
    """Async context manager that times an LLM call and logs it to llm_call_log; the caller must set tracker.usage (or call tracker.record(resp)) so a fallback dispatch is logged as the model that actually answered."""
    started = time.monotonic()

    class _Tracker:
        def __init__(self, provider, model):
            self.usage = {"input_tokens": 0, "output_tokens": 0,
                          "cache_read_tokens": 0, "cache_write_tokens": 0}
            self.provider = provider
            self.model = model

        def record(self, resp):
            """Take usage + the dispatched provider/model off an LLM response dict."""
            if isinstance(resp, dict):
                self.usage = resp.get("usage") or self.usage
                self.provider = resp.get("provider") or self.provider
                self.model = resp.get("model") or self.model
            return resp

    t = _Tracker(provider, model)
    success = True
    error = None
    try:
        yield t
    except Exception as e:
        success = False
        error = str(e)
        raise
    finally:
        try:
            # Keep OpenRouter live pricing fresh (TTL-gated) so cost is accurate.
            if t.provider == "openrouter":
                try:
                    from backend.analyzer.llm_cost import refresh_openrouter_prices
                    await refresh_openrouter_prices()
                except Exception:
                    pass
            log_llm_call(
                purpose=purpose,
                provider=t.provider,
                model=t.model,
                usage=t.usage,
                duration_ms=int((time.monotonic() - started) * 1000),
                job_id=job_id,
                success=success,
                error=error,
                **({"firm_id": firm_id} if firm_id is not None else {}),
            )
        except Exception as e:
            logger.warning(f"track_llm_call finally block failed (non-fatal): {e}")
