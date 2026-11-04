"""No log call writes a person's data into its message (CLAUDE.md, docs/team/uzair.md §1, step 4a).

A grep-like check, as test_firm_scoping_lint.py does for `scoped()`: every `logger.info(...)`-style call in the backend
is read (ast, not run), and one fails when its message carries a field that holds people's data (`candidate.email`,
`user.full_name`, a raw AI reply, Google's whole response body, a search's name). The masking in
backend/logging_setup.py catches emails and phones, but it can't recognise a name; this catches the call that would
write one, the day it is written.

Log ids, counts and timings instead: `logger.info("Created candidate %s", candidate.id)`, `len(raw)`. A call that is
safe although it matches goes in NOT_PERSONAL with the reason. KNOWN lists calls found on 2026-11-03 whose owners
were told (uzair.md "For teammates (4a)"); delete an entry when its call is fixed, and the stale check makes sure.
"""
import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
LEVELS = {"debug", "info", "warning", "error", "exception", "critical", "log"}
LOGGER_NAMES = {"logger", "log", "_log", "_logger", "app_log", "logging"}

# A field that holds a person's data, on any object: `candidate.email`, `invite.invitee_name`.
PERSONAL_FIELDS = {"full_name", "first_name", "last_name", "invitee_name", "email", "phone", "phone_number",
                   "password", "resume_text", "resume_content", "body", "subject", "snippet", "from_header",
                   "filename", "file_name"}
# A variable that, by this codebase's naming, holds the same: an email's parts, a password, a raw AI reply.
PERSONAL_NAMES = {"email", "phone", "password", "body", "subject", "snippet", "from_header", "filename", "file_name",
                  "resume_text", "full_name", "raw", "raw_response", "reply"}
# A field that is personal only on a given object: a search a BDE may name after the candidate, an HTTP reply's body.
PERSONAL_ON = {("search", "name"), ("resp", "text"), ("response", "text")}
# Wrapping in these logs a property of the value, not the value.
SAFE_WRAPPERS = {"len", "bool", "type", "id", "hash"}

# (file, function) -> why the match is not personal data.
NOT_PERSONAL = {
    ("scheduler.py", "_int_setting"): "`raw` is a scheduler setting's value (an interval), not a person's",
    ("notifier/telegram.py", "_send_message"): "Telegram's error reply describes the request, not the alert's text",
}

# (file, function) -> who was told. Found by Abdul's review of #107 and a search of every log call (2026-11-03).
KNOWN = {
    ("analyzer/cover_letter_generator.py", "generate_cover_letter_body"): "Zuhair: raw AI reply",
    ("api/routes_resumes.py", "_tailor_impl"): "Zuhair: raw AI reply",
    ("api/routes_resumes.py", "parse_resume_pdf"): "Zuhair: raw AI reply",
    ("api/routes_searches.py", "test_search"): "Zuhair: search name",
    ("scraper/orchestrator.py", "run_all"): "Zuhair: search name",
    ("scraper/orchestrator.py", "_run_search_by_id"): "Zuhair: search name",
    ("scraper/sources/freehire.py", "run"): "Zuhair: search name",
    ("scraper/sources/jobright.py", "run"): "Zuhair: search name",
    ("scraper/sources/jobspy.py", "_run_sync"): "Zuhair: search name",
    ("scraper/sources/levelsfyi.py", "run"): "Zuhair: search name",
    ("scraper/sources/linkedin_personal.py", "run"): "Zuhair: search name",
    ("email_monitor/gmail_client.py", "_get_access_token"): "Samad: Google's whole reply",
    ("email_monitor/gmail_client.py", "check_emails"): "Samad: Google's whole reply",
    ("email_monitor/response_parser.py", "classify_email_llm"): "Samad: raw AI reply",
}


def _personal(node: ast.AST) -> list[str]:
    """The personal-looking values an expression puts into a message."""
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in SAFE_WRAPPERS:
        return []
    found = []
    if isinstance(node, ast.Attribute):
        owner = node.value.id if isinstance(node.value, ast.Name) else None
        if node.attr in PERSONAL_FIELDS or (owner, node.attr) in PERSONAL_ON:
            found.append(ast.unparse(node))
    elif isinstance(node, ast.Name) and node.id in PERSONAL_NAMES:
        found.append(node.id)
    elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id in {"resp", "response"}:
        found.append(ast.unparse(node))                      # resp["text"]: an AI or HTTP reply's body
    for child in ast.iter_child_nodes(node):
        if not (isinstance(node, ast.Attribute) and child is node.value):   # `candidate.id` is fine: don't flag `candidate`
            found += _personal(child)
    return found


def _is_log_call(node: ast.AST) -> bool:
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in LEVELS
            and isinstance(node.func.value, ast.Name) and node.func.value.id in LOGGER_NAMES)


def _log_violations(source: str, path: str) -> dict[tuple[str, str], list[str]]:
    """(file, function) -> 'line: values' for each log call that writes personal-looking values."""
    tree = ast.parse(source)
    functions = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    found: dict[tuple[str, str], list[str]] = {}
    for call in ast.walk(tree):
        if not _is_log_call(call):
            continue
        values = sorted({v for arg in call.args for v in _personal(arg)})
        if not values:
            continue
        inner = min((f for f in functions if f.lineno <= call.lineno <= f.end_lineno),
                    key=lambda f: f.end_lineno - f.lineno, default=None)
        key = (path, inner.name if inner else "<module>")
        found.setdefault(key, []).append(f"line {call.lineno}: {', '.join(values)}")
    return found


def _backend_violations() -> dict[tuple[str, str], list[str]]:
    found = {}
    for path in sorted(BACKEND.rglob("*.py")):
        relative = path.relative_to(BACKEND)
        if relative.parts[0] == "tests":
            continue
        found.update(_log_violations(path.read_text(encoding="utf-8"), relative.as_posix()))
    return found


def test_no_log_call_writes_a_persons_data():
    new = {k: v for k, v in _backend_violations().items() if k not in KNOWN and k not in NOT_PERSONAL}
    assert not new, (
        "these log calls write a person's data (a name, an email, a raw reply, a search name) into the log. Log ids, "
        "counts and timings instead (`candidate.id`, `len(raw)`); if a match is not personal data, add it to "
        f"NOT_PERSONAL in this file with the reason:\n" + "\n".join(f"  {f} {fn}(): {v}" for (f, fn), v in new.items()))


def test_every_listed_call_still_exists():
    """A fixed call leaves KNOWN, so the list only shrinks and a new match can't hide behind an old entry."""
    current = _backend_violations()
    stale = sorted(k for k in {**KNOWN, **NOT_PERSONAL} if k not in current)
    assert not stale, f"these no longer log anything personal-looking; delete them from this file: {stale}"


def test_the_check_catches_what_it_is_for():
    """The check isn't vacuous: each kind of leak is caught, and ids, counts and wrapped values pass."""
    leaks = '''
def f(candidate, user, resp, raw, search):
    logger.info(f"Created {candidate.full_name}")
    logger.warning("Invite for %s", user.email)
    log.error(f"Model said: {raw[:500]}")
    logger.error("Google: %s", resp.text)
    logger.info(f"Search {search.name} done")
'''
    (found,) = _log_violations(leaks, "x.py").values()
    assert len(found) == 5
    fine = '''
def g(candidate, raw, search, company):
    logger.info("Created candidate %s", candidate.id)
    logger.warning("Reply had %d characters", len(raw))
    logger.info(f"Search {search.id} at {company.name}")
'''
    assert _log_violations(fine, "y.py") == {}


# One-off programs a person runs by hand; they print to that person's terminal, not to the server's log.
PRINTING_PROGRAMS = {"scripts", "gmail_oauth_setup.py", "refresh_linkedin_session.py"}


def test_the_server_never_prints():
    """`print()` skips the one log handler, so nothing it writes is masked or carries a request id."""
    found = []
    for path in sorted(BACKEND.rglob("*.py")):
        relative = path.relative_to(BACKEND)
        if relative.parts[0] in PRINTING_PROGRAMS | {"tests"}:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "print":
                found.append(f"{relative.as_posix()}:{node.lineno}")
    assert not found, f"use logging.getLogger('jobnavigator.<area>') instead of print(): {found}"
