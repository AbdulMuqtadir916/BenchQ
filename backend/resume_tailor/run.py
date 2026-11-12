"""One tailoring: a stored version and a posting in, the tailored version's content and the report's counts out
(docs/team/tailoring.md §2).

The caller (the tailoring route, part 2) reads the version (`versions.content_of`), the posting and the setup
(`settings.read_setup`), and settles the content's ids and stores it as a TAILORED version. Nothing here touches the
database but the five calls' llm_call_log rows.
"""
from collections import Counter
from dataclasses import dataclass

from backend.resume_tailor import pipeline
from backend.resume_tailor.settings import Setup
from backend.resume_tailor.stored import prepared_posting, tailor_input, version_content

STEPS = ("analyse", "draft", "review", "revise", "verify")
# The keyword coverage statuses (schemas.COVERAGE) as count keys.
_COVERAGE_KEYS = {"covered": "covered", "synonym-only": "synonym_only", "missing (have it)": "missing_have_it",
                  "missing (gap)": "missing_gap"}


@dataclass(frozen=True)
class Tailored:
    content: dict          # the tailored version's content, ids not yet settled (versions._with_ids)
    counts: dict           # report_counts: what is kept of the report (job_runs.meta)


async def tailor_version(content: dict, posting: str, job_title: str = "", *, setup: Setup, firm_id=None,
                         on_step=None) -> Tailored:
    """Tailor one version for one posting. Raises pipeline.TailorFailed when a step fails: no partial copy.
    `on_step(name)` is awaited as each model step starts."""
    given = tailor_input(content)
    copy = await pipeline.tailor(given.base, prepared_posting(posting), job_title, setup=setup, firm_id=firm_id,
                                 on_step=on_step)
    return Tailored(content=version_content(copy, content, given),
                    counts=report_counts(copy.get(pipeline.REPORT_KEY) or {}))


def report_counts(report: dict) -> dict:
    """What is kept of a tailoring's report (decided 2026-11-12, Q3c): counts only, never résumé or model text. The
    gaps and stretch flags themselves, the edits and the checklist go no further than the run (Q4b: the BDE sees
    only the tailored résumé)."""
    coverage = Counter(row.get("status") for row in report.get("keyword_coverage") or [] if isinstance(row, dict))
    usage = report.get("usage") or {}
    return {
        "gaps": len(report.get("gaps") or []),
        "fact_gate_changes": len(report.get("fact_gate_changes") or []),
        "review_edits_applied": int(report.get("review_edits_applied") or 0),
        "review_edits_missed": len(report.get("review_edits_missed") or []),
        "verify_edits_applied": int(report.get("verify_edits_applied") or 0),
        "verify_edits_missed": len(report.get("verify_edits_missed") or []),
        "keywords": {key: coverage.get(status, 0) for status, key in _COVERAGE_KEYS.items()},
        "seconds": {step: (report.get("seconds") or {}).get(step) for step in STEPS},
        "tokens": {step: {"input": int((usage.get(step) or {}).get("input_tokens") or 0),
                          "output": int((usage.get(step) or {}).get("output_tokens") or 0)} for step in STEPS},
    }
