"""No hand-built error response outside backend/problem.py (docs/02-DATA-CONTRACTS.md §12.2, rule 6).

The static half of the error-shape check; the route sweep (test_log_every_route.py with problem_support.assert_problem)
is the run-time half. Every `JSONResponse(...)`, `PlainTextResponse(...)`, `HTMLResponse(...)` or `Response(...)` with a
literal status of 400 or more is an error body built by hand, which skips the one shape, its code and its request id:
raise `HTTPException` / `backend.problem.Problem`, or return `problem_response(...)`, instead.
"""
import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]
RESPONSE_CLASSES = {"JSONResponse", "PlainTextResponse", "HTMLResponse", "Response"}
SKIPPED = {"problem.py"}

# "file:line" -> why it stays. JobNavigator leftovers no BenchQ screen or the extension calls, until Abdul's clean-up
# track (docs/02 §12.1): the "already running" 409s. Delete an entry when its call goes; the stale check fails until.
KNOWN = {
    "main.py:456": "POST /api/scrape/run-all, already running",
    "main.py:476": "POST /api/email/check-now, already running",
    "main.py:503": "POST /api/h1b/refresh, already running",
    "main.py:558": "POST /api/analyze/{job_id}, already running",
    "main.py:594": "POST /api/db/cleanup, already running",
    "main.py:635": "POST /api/auto-reject/run, already running",
    "main.py:686": "POST /api/jobs/backfill-descriptions, already running",
    "main.py:734": "POST /api/db/backup, already running",
    "main.py:754": "POST /api/telegram/digest, already running",
    "main.py:807": "POST /api/scrape/company/{company_id}, already running",
    "main.py:889": "POST /api/telegram/test, already running",
    "api/routes_searches.py:245": "POST /api/searches/{search_id}/run, already running",
    "api/routes_cover_letters.py:411": "POST /api/cover-letters/generate, already running",
}


def _name(func) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _status(call: ast.Call) -> int | None:
    for keyword in call.keywords:
        if keyword.arg == "status_code" and isinstance(keyword.value, ast.Constant):
            return keyword.value.value if isinstance(keyword.value.value, int) else None
    return None


def _hand_built() -> dict[str, int]:
    found = {}
    for path in sorted(BACKEND.rglob("*.py")):
        relative = path.relative_to(BACKEND).as_posix()
        if relative.startswith(("tests/", "migrations/")) or relative in SKIPPED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=relative)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _name(node.func) in RESPONSE_CLASSES:
                status = _status(node)
                if status is not None and status >= 400:
                    found[f"{relative}:{node.lineno}"] = status
    return found


def test_no_error_response_is_built_by_hand():
    new = {where: status for where, status in _hand_built().items() if where not in KNOWN}
    assert not new, (f"error responses built by hand (docs/02 §12.2, rule 6): {new}. Raise HTTPException or "
                     f"backend.problem.Problem, or return backend.problem.problem_response(...)")


def test_every_listed_leftover_still_exists():
    stale = sorted(set(KNOWN) - set(_hand_built()))
    assert not stale, f"these are gone or moved; update KNOWN: {stale}"


def test_the_check_catches_a_hand_built_error(tmp_path, monkeypatch):
    """Measured, not assumed: a planted file with one is found."""
    import backend.tests.test_error_responses_lint as lint
    (tmp_path / "planted.py").write_text(
        "from starlette.responses import JSONResponse\n"
        "def f():\n    return JSONResponse(status_code=409, content={'detail': 'x'})\n", encoding="utf-8")
    monkeypatch.setattr(lint, "BACKEND", tmp_path)
    assert lint._hand_built() == {"planted.py:3": 409}
