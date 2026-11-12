"""The ledger's rules, checked on every PR (docs/integration/01-ledger.md, "Writes log to the ledger").

A grep-like check over the backend, as `test_firm_scoping_lint.py` does for firm scoping:

1. Every route that changes data writes a ledger entry, directly or through a helper it calls. A route that doesn't
   is listed in `NOT_LOGGED` with the reason. A listed route that starts logging must leave the list, so it shrinks.
2. Every ledger write states `candidate_id`, even as None, and goes through `backend/auth/ledger.py`.
3. Only the listed routes read `ActivityEntry`, so no new endpoint skips the role limit in `routes_ledger.py`.
"""
import ast
from functools import lru_cache
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROUTE_FILES = sorted((BACKEND / "api").glob("routes_*.py")) + [BACKEND / "main.py"]
SOURCE_FILES = [path for path in sorted(BACKEND.rglob("*.py"))
                if not {"tests", "migrations", "__pycache__"} & set(path.relative_to(BACKEND).parts)]
TEST_FILES = sorted((BACKEND / "tests").glob("*.py"))
WRITE_METHODS = {"post", "put", "patch", "delete"}
WRITERS = {("auth/ledger.py", "record"), ("auth/ledger.py", "record_automated")}
# Background work's own rows, for the Super Admin. They say a run or an AI call happened, not that a person's change was
# logged, so reaching one doesn't count as a route writing its entry.
BACKGROUND_LOGGING = {("activity.py", "log_activity"), ("analyzer/llm_logger.py", "_log_work"), ("job_monitor.py", "_log_run")}

# Why a route that changes something writes no entry. Each reason is a decision. A new route doesn't belong here unless
# a reason below is true of it.
RETIRED = "the old job pool's write route: it answers 410 (job search PR 2) and goes with the pool in the clean-up PR"
COVER_LETTERS_REMOVED = "cover letters are being removed from BenchQ (decided 2026-11-12), so nothing logs them"
NOT_FIRM_ACTIVITY = "a Super Admin operation, not a firm's activity"
PERSONA_REMOVED = "the Persona table is being removed; its fields live on the candidate, whose edits routes_candidates logs"
REFERENCE_DATA = "global reference data, not a firm's record (07 tenancy: Company is global)"
NO_READ_ENTRIES = "no ledger entry for reads and manual sync (Abdul, 2026-11-03)"
NOTHING_SAVED = "saves nothing about a firm's records"

NOT_LOGGED: dict[tuple[str, str], str] = {
    ("api/routes_cover_letters.py", "create_cover_letter"): COVER_LETTERS_REMOVED,
    ("api/routes_cover_letters.py", "update_cover_letter"): COVER_LETTERS_REMOVED,
    ("api/routes_cover_letters.py", "delete_cover_letter"): COVER_LETTERS_REMOVED,
    ("api/routes_cover_letters.py", "generate_cover_letter"): COVER_LETTERS_REMOVED,
    ("api/routes_jobs.py", "linkedin_import"): RETIRED,
    ("api/routes_jobs.py", "save_from_extension"): RETIRED,
    ("api/routes_jobs.py", "create_manual_job"): RETIRED,
    ("api/routes_jobs.py", "bulk_update_jobs"): RETIRED,
    ("api/routes_jobs.py", "update_job"): RETIRED,
    ("main.py", "trigger_analysis"): RETIRED,
    ("api/routes_persona.py", "update_persona"): PERSONA_REMOVED,
    ("api/routes_persona.py", "append_qa_bank"): PERSONA_REMOVED,

    ("api/routes_inbox.py", "sync_candidate_inbox"): NO_READ_ENTRIES,
    ("api/routes_inbox.py", "mark_candidate_message_read"): NO_READ_ENTRIES,
    ("api/routes_notifications.py", "mark_read"): NO_READ_ENTRIES,

    ("api/routes_applications.py", "extract_posting"): NOTHING_SAVED,
    ("api/routes_candidates.py", "parse_resume"): NOTHING_SAVED,
    ("api/routes_auth.py", "first_run_done"): "the welcome screen's own flag, not a business event",
    ("api/routes_jobs.py", "cache_applied_jobs"): "keeps a copy of job pages; changes no firm record",
    ("api/routes_inbox.py", "start_candidate_google_oauth"): "only starts Google's consent; confirm_mailbox logs the connection",
    ("api/routes_inbox.py", "cancel_mailbox"): "drops an unconfirmed attempt; nothing was connected",

    ("api/routes_companies.py", "create_company"): REFERENCE_DATA,
    ("api/routes_companies.py", "update_company"): REFERENCE_DATA,
    ("api/routes_companies.py", "acknowledge_company_warning"): REFERENCE_DATA,
    ("api/routes_companies.py", "delete_company"): REFERENCE_DATA,
    ("api/routes_companies.py", "auto_create_from_jobs"): REFERENCE_DATA,
    ("api/routes_companies.py", "bulk_activate"): REFERENCE_DATA,
    ("api/routes_companies.py", "refresh_h1b_all"): REFERENCE_DATA,
    ("api/routes_companies.py", "backfill_h1b_jobs"): REFERENCE_DATA,
    ("api/routes_companies.py", "test_scrape_company"): REFERENCE_DATA,

    ("api/routes_linkedin.py", "session_refresh"): NOT_FIRM_ACTIVITY,
    ("api/routes_linkedin.py", "session_pin"): NOT_FIRM_ACTIVITY,
    ("api/routes_searches.py", "create_search"): NOT_FIRM_ACTIVITY,
    ("api/routes_searches.py", "update_search"): NOT_FIRM_ACTIVITY,
    ("api/routes_searches.py", "acknowledge_search_warning"): NOT_FIRM_ACTIVITY,
    ("api/routes_searches.py", "delete_search"): NOT_FIRM_ACTIVITY,
    ("api/routes_searches.py", "trigger_search"): NOT_FIRM_ACTIVITY,
    ("api/routes_searches.py", "test_search"): NOT_FIRM_ACTIVITY,
    ("api/routes_settings.py", "update_settings"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_all_scrapes"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_email_check"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_h1b_refresh"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_job_cleanup"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_auto_reject"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_backfill_descriptions"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_db_backup"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_digest"): NOT_FIRM_ACTIVITY,
    ("main.py", "trigger_company_scrape"): NOT_FIRM_ACTIVITY,
    ("main.py", "telegram_webhook"): NOT_FIRM_ACTIVITY,
    ("main.py", "telegram_register_webhook"): NOT_FIRM_ACTIVITY,
    ("main.py", "telegram_rotate_webhook_secret"): NOT_FIRM_ACTIVITY,
    ("main.py", "telegram_test"): NOT_FIRM_ACTIVITY,
}

# (file, function) -> why it builds a ActivityEntry itself instead of calling backend/auth/ledger.py.
DIRECT_WRITES = {
    ("auth/ledger.py", "record"): "the writer",
    ("auth/ledger.py", "record_automated"): "the writer",
    ("auth/password_reset.py", "system_entry"): "a SYSTEM entry with no acting user; `record` needs an actor",
    ("scripts/create_platform_admin.py", "create_platform_admin"): "a staff script, no signed-in actor",
    ("scripts/reset_password.py", "reset_password"): "a staff script, no signed-in actor",
}

# (file, function) that may read ActivityEntry.
LEDGER_READERS = {
    ("api/routes_ledger.py", "_visible"): "a firm's log, limited by role",
    ("api/routes_ledger.py", "list_ledger"): "pages what `_visible` allows",
    ("api/routes_ledger.py", "_after_cursor"): "pages what `_visible` allows",
    ("api/routes_admin.py", "list_audit"): "the Super Admin's audit across the platform",
    ("scripts/seed_demo.py", "reset"): "clears local demo data; serves no one",
}


@lru_cache(maxsize=None)
def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"))


def _functions(tree: ast.AST):
    return (node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)))


def _relative(path: Path) -> str:
    return path.relative_to(BACKEND).as_posix()


def _module_file(dotted: str) -> str | None:
    """`backend.auth.ledger` -> `auth/ledger.py`, or None for anything outside the backend."""
    parts = dotted.split(".")
    if parts[0] != "backend":
        return None
    file = "/".join(parts[1:]) + ".py"
    return file if (BACKEND / file).exists() else None


def _imports(tree: ast.Module) -> tuple[dict[str, tuple[str, str]], dict[str, str]]:
    """What a file imports, wherever the import sits: functions as name -> (file, original name), modules as
    name -> file. `from backend.auth import ledger` is a module; `from backend.auth.ledger import record` a function."""
    functions, modules = {}, {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and not node.level:
            for alias in node.names:
                local = alias.asname or alias.name
                module = _module_file(f"{node.module}.{alias.name}")
                if module is not None:
                    modules[local] = module
                elif (source := _module_file(node.module)) is not None:
                    functions[local] = (source, alias.name)
    return functions, modules


def _callee(call: ast.Call, file: str, defined: set[str], functions: dict, modules: dict) -> tuple[str, str] | None:
    """The backend function a call reaches: a bare name or `module.name`, never a method like `db.commit`."""
    func = call.func
    if isinstance(func, ast.Name):
        return (file, func.id) if func.id in defined else functions.get(func.id)
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id in modules:
        return modules[func.value.id], func.attr
    return None


def _ledger_writes() -> list[tuple[str, ast.Call]]:
    """Every call of `record` / `record_automated` in backend/auth/ledger.py, under any name it was imported as."""
    found = []
    for path in SOURCE_FILES + TEST_FILES:
        file, tree = _relative(path), _parse(path)
        defined = {function.name for function in _functions(tree)}
        functions, modules = _imports(tree)
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and file != "auth/ledger.py"
                    and _callee(node, file, defined, functions, modules) in WRITERS):
                found.append((file, node))
    return found


def _logging_functions() -> set[tuple[str, str]]:
    """Every (file, function) that writes the ledger, directly or through another function it calls."""
    calls: dict[tuple[str, str], set] = {}
    logging = set(WRITERS)
    for path in SOURCE_FILES:
        file, tree = _relative(path), _parse(path)
        defined = {function.name for function in _functions(tree)}
        functions, modules = _imports(tree)
        for function in _functions(tree):
            key = (file, function.name)
            for node in ast.walk(function):
                if isinstance(node, ast.Call):
                    calls.setdefault(key, set()).add(_callee(node, file, defined, functions, modules))
                    if isinstance(node.func, ast.Name) and node.func.id == "ActivityEntry":
                        logging.add(key)
                elif isinstance(node, ast.Name) and node.id in defined:   # passed by name, to a thread pool say
                    calls.setdefault(key, set()).add((file, node.id))
    grew = True
    while grew:
        found = {key for key, called in calls.items() if (called - BACKGROUND_LOGGING) & logging} - logging
        logging |= found
        grew = bool(found)
    return logging


def _write_routes() -> list[tuple[str, str]]:
    routes = []
    for path in ROUTE_FILES:
        for function in _functions(_parse(path)):
            for decorator in function.decorator_list:
                if (isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute)
                        and decorator.func.attr in WRITE_METHODS):
                    routes.append((_relative(path), function.name))
    return routes


def unlogged_routes(allowed: dict | None = None) -> list[str]:
    allowed = NOT_LOGGED if allowed is None else allowed
    logging = _logging_functions()
    return [f"{file} {name}()" for file, name in _write_routes() if (file, name) not in logging | set(allowed)]


def test_every_route_that_changes_data_writes_the_ledger():
    missing = unlogged_routes()
    assert not missing, ("These routes change data and write no ledger entry. Call backend/auth/ledger.py in the same "
                         "transaction, or list the route in NOT_LOGGED with the reason:\n" + "\n".join(missing))


def test_a_route_that_logs_or_is_gone_leaves_the_list():
    logging, routes = _logging_functions(), set(_write_routes())
    stale = sorted(f"{file} {name}()" for file, name in NOT_LOGGED if (file, name) in logging or (file, name) not in routes)
    assert not stale, "Remove these from NOT_LOGGED, they log now or no longer exist:\n" + "\n".join(stale)


def test_every_ledger_write_states_its_candidate():
    """`candidate_id` is required by `record`; this also catches a write on a path no test runs."""
    missing = [f"{file}:{call.lineno}" for file, call in _ledger_writes()
               if not any(keyword.arg == "candidate_id" for keyword in call.keywords)]
    assert not missing, "State candidate_id, or candidate_id=None for an entry about no candidate:\n" + "\n".join(missing)


def _enclosing_calls(accept) -> set[tuple[str, str]]:
    """(file, outermost function) of every call `accept` takes, across the backend."""
    found = set()
    for path in SOURCE_FILES:
        def visit(node, function):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and function is None:
                function = node.name
            if isinstance(node, ast.Call) and accept(node):
                found.add((_relative(path), function or "<module>"))
            for child in ast.iter_child_nodes(node):
                visit(child, function)
        visit(_parse(path), None)
    return found


def test_a_ledger_entry_is_built_only_by_the_writer():
    built = _enclosing_calls(lambda call: isinstance(call.func, ast.Name) and call.func.id == "ActivityEntry")
    assert built <= set(DIRECT_WRITES), f"Write through backend/auth/ledger.py instead: {sorted(built - set(DIRECT_WRITES))}"


def test_the_old_ledger_table_is_only_cleared_by_the_demo_reset():
    """`activity_logs` replaced `ledger_entries` (migration 0028); an entry written there would never be seen."""
    used = _enclosing_calls(lambda call: any(isinstance(node, ast.Name) and node.id == "LedgerEntry"
                                             for node in ast.walk(call)))
    assert used <= {("scripts/seed_demo.py", "reset")}, f"Use ActivityEntry instead: {sorted(used)}"


def _reads_the_ledger(call: ast.Call) -> bool:
    name = call.func.id if isinstance(call.func, ast.Name) else getattr(call.func, "attr", None)
    return name in {"query", "scoped", "select", "get", "join", "outerjoin"} and any(
        isinstance(node, ast.Name) and node.id == "ActivityEntry" for arg in call.args for node in ast.walk(arg))


def test_only_the_listed_routes_read_the_ledger():
    """A new read would skip the role limit in `routes_ledger.py`: add to that route instead."""
    reads = _enclosing_calls(_reads_the_ledger)
    assert reads <= set(LEDGER_READERS), f"These read ActivityEntry outside the role limit: {sorted(reads - set(LEDGER_READERS))}"
