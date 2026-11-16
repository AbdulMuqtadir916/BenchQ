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

# Why a route that changes something writes no entry. Firm work marked TO_LOG leaves this list as its Activity logs PR
# lands; every other reason is a decision. A new route doesn't belong here unless a reason below is true of it.
TO_LOG = "firm work with no entry yet: the Activity logs PR that logs this area removes it from this list"
NOT_FIRM_ACTIVITY = "a Super Admin operation, not a firm's activity"
PERSONA_REMOVED = "the Persona table is being removed; its fields live on the candidate, whose edits routes_candidates logs"
REFERENCE_DATA = "global reference data, not a firm's record (07 tenancy: Company is global)"
NO_READ_ENTRIES = "no ledger entry for reads and manual sync (Abdul, 2026-11-03)"
NOTHING_SAVED = "saves nothing about a firm's records"

NOT_LOGGED: dict[tuple[str, str], str] = {
    ("api/routes_applications.py", "delete_application"): TO_LOG,
    ("api/routes_applications.py", "bulk_delete_applications"): TO_LOG,
    ("api/routes_applications.py", "add_interview"): TO_LOG,
    ("api/routes_applications.py", "update_interview"): TO_LOG,
    ("api/routes_applications.py", "delete_interview"): TO_LOG,
    ("api/routes_cover_letters.py", "create_cover_letter"): TO_LOG,
    ("api/routes_cover_letters.py", "update_cover_letter"): TO_LOG,
    ("api/routes_cover_letters.py", "delete_cover_letter"): TO_LOG,
    ("api/routes_cover_letters.py", "generate_cover_letter"): TO_LOG,
    ("api/routes_jobs.py", "linkedin_import"): TO_LOG,
    ("api/routes_jobs.py", "save_from_extension"): TO_LOG,
    ("api/routes_jobs.py", "create_manual_job"): TO_LOG,
    ("api/routes_jobs.py", "bulk_update_jobs"): TO_LOG,
    ("api/routes_jobs.py", "update_job"): TO_LOG,
    ("api/routes_persona.py", "update_persona"): PERSONA_REMOVED,
    ("api/routes_persona.py", "append_qa_bank"): PERSONA_REMOVED,
    ("api/routes_autofill.py", "autofill_answer"): TO_LOG,
    ("api/routes_autofill.py", "autofill_answer_stream"): TO_LOG,
    ("main.py", "trigger_analysis"): TO_LOG,

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
    ("api/routes_ledger.py", "_has_history"): "whether a picked person has rows, inside `_limit_to_reader`",
    ("api/routes_admin.py", "list_audit"): "the Super Admin's audit across the platform",
    ("scripts/seed_demo.py", "reset"): "clears local demo data; serves no one",
}


@lru_cache(maxsize=None)
def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"))


def _functions(tree: ast.AST):
    return (node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)))


# Calls that run the function they are handed (a thread, a background task, a launcher, a FastAPI dependency). A function
# passed to any other call, or only assigned to a name, is not run by the route. A function a factory returns is run by
# whoever called the factory (a route's `Depends(factory(...))`), so returning it counts too.
# Each one's callback: (position, keyword). The other arguments are data handed to the callback, not run.
DISPATCH_CALLS = {"to_thread": (0, "func"), "run_in_threadpool": (0, "func"), "run_in_executor": (1, "func"),
                  "add_task": (0, "func"), "launch_background": (1, "coro_func"), "submit": (0, "fn"),
                  "Thread": (1, "target"), "partial": (0, "func"), "create_task": (0, "coro"),
                  "ensure_future": (0, "coro_or_future"), "Depends": (0, "dependency")}
# These two only build something: a thread runs its target once it is started, a partial once it is called. Built and
# dropped, the function never runs (`_never_run`).
BUILDERS = {"Thread", "partial"}
# The dispatchers that pass their callback's keywords as one dict; the rest pass their own keywords on.
KEYWORD_DICTS = {"Thread": "kwargs", "launch_background": "func_kwargs"}


def _scoped_functions(tree: ast.AST) -> list[tuple[tuple[str, ...], ast.AST]]:
    """Every function with its lexical path: `("route",)` at the top (a method counts as top level, its class is not a
    scope), `("route", "_do")` for a `_do` defined inside `route`. Two handlers that each define a `_do` stay apart."""
    found = []

    def visit(node, path):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                found.append(((*path, child.name), child))
                visit(child, (*path, child.name))
            else:
                visit(child, path)
    visit(tree, ())
    return found


def _resolver(path: tuple[str, ...], defined: set[tuple[str, ...]]):
    """Resolves a bare name used inside the function at `path` the way Python does: a function defined inside it, then one
    defined beside it, then one level out, up to the top of the file. Returns that function's path, or None."""
    def resolve(name: str):
        for depth in range(len(path), -1, -1):
            if (*path[:depth], name) in defined:
                return (*path[:depth], name)
        return None
    return resolve


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
    name -> file. `from backend.auth import ledger` and `import backend.auth.ledger as ledger` are modules (named by
    their alias); `import backend.auth.ledger` is one named by its full path; `from backend.auth.ledger import record`
    is a function."""
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
        elif isinstance(node, ast.Import):
            for alias in node.names:
                module = _module_file(alias.name)
                if module is not None:
                    modules[alias.asname or alias.name] = module
    return functions, modules


def _dotted(node: ast.AST) -> str | None:
    """`a.b.c` for a chain of names and attributes, else None."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    return ".".join([node.id, *reversed(parts)])


def _callee(call: ast.Call, file: str, resolve, functions: dict, modules: dict) -> tuple[str, str] | None:
    """The backend function a call reaches: a bare name (`resolve` says which function in this file, if any) or
    `module.name` (the module under whatever name it was imported, or its full path), never a method like `db.commit`."""
    func = call.func
    if isinstance(func, ast.Name):
        target = resolve(func.id)
        return (file, ".".join(target)) if target else functions.get(func.id)
    dotted = _dotted(func)
    if dotted is not None:
        module, _, name = dotted.rpartition(".")
        if module in modules:
            return modules[module], name
    return None


def _ledger_model_names(tree: ast.Module, model: str = "ActivityEntry") -> set[str]:
    """The names a model (the log's `ActivityEntry` unless told otherwise) goes by at the top of a file: an
    `import ... as` alias, and `Entry = ActivityEntry`."""
    return _assigned_names(tree, _imported_names(tree, model), model)


def _imported_names(tree: ast.Module, model: str = "ActivityEntry") -> set[str]:
    names = {model}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            names.update(alias.asname or alias.name for alias in node.names if alias.name == model)
    return names


def _assigned_names(scope: ast.AST, outer: set[str], model: str = "ActivityEntry",
                    before: ast.AST | None = None) -> set[str]:
    """The names the model goes by inside `scope` (a file or one function), given those it goes by outside: an assignment
    in this scope binds the name here only, and binding it to anything else replaces an alias, in source order. A
    function's assignments don't reach another function. With `before` (a call in this scope), only the assignments
    that end before it starts count: `model = ActivityEntry; db.query(model); model = Candidate` reads the log."""
    names = set(outer)
    assigns = sorted((node for node in _own_nodes(scope) if isinstance(node, ast.Assign)), key=lambda node: node.lineno)
    if before is not None:
        start = (before.lineno, before.col_offset)
        assigns = [node for node in assigns if (node.end_lineno, node.end_col_offset) <= start]
    for node in assigns:
        targets = {target.id for target in node.targets if isinstance(target, ast.Name)}
        names = names | targets if _is_ledger_model(node.value, names, model) else names - targets
    return names


def _names_by_scope(tree: ast.Module, model: str = "ActivityEntry") -> dict[tuple[str, ...], set[str]]:
    """The model's names in each function (by its path, as `_scoped_functions` names it), and `()` for the file."""
    found = {(): _ledger_model_names(tree, model)}
    for path, function in _scoped_functions(tree):       # a function comes after the one it sits in
        found[path] = _assigned_names(function, found[path[:-1]], model)
    return found


def _is_ledger_model(node: ast.AST, names: set[str], model: str = "ActivityEntry") -> bool:
    """The model, an alias of it, or `module.<model>`."""
    return (isinstance(node, ast.Name) and node.id in names) or (isinstance(node, ast.Attribute) and node.attr == model)


def _own_nodes(function):
    """The nodes of a function's body, without the bodies of functions defined inside it: a helper that is defined but
    never called doesn't make its route log. A nested function that is called is its own entry, reached by that call."""
    stack = list(ast.iter_child_nodes(function))
    while stack:
        node = stack.pop()
        yield node
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            stack.extend(ast.iter_child_nodes(node))


def _source_trees(files) -> list[tuple[str, ast.Module]]:
    return [(_relative(path), _parse(path)) for path in files]


def _ledger_writes(trees=None) -> list[tuple[str, ast.Call]]:
    """Every call of `record` / `record_automated` in backend/auth/ledger.py, under any name it was imported as."""
    found = []
    for file, tree in _source_trees(SOURCE_FILES + TEST_FILES) if trees is None else trees:
        if file == "auth/ledger.py":
            continue
        scoped = _scoped_functions(tree)
        defined = {path for path, _ in scoped}
        functions, modules = _imports(tree)
        for path, owner in [((), tree), *scoped]:       # each call resolved where it sits, as Python would
            resolve, idle = _resolver(path, defined), _never_run(owner)
            for node in _own_nodes(owner):
                if not isinstance(node, ast.Call) or id(node) in idle:
                    continue
                if _callee(node, file, resolve, functions, modules) in WRITERS:
                    found.append((file, node))
                # `tasks.add_task(record, db, candidate_id=...)`: the task calls the writer with what it was handed,
                # so the handing over is the write the candidate rule checks.
                elif any(_handed_over(value, file, resolve, functions, modules) in WRITERS for value in _dispatched(node)):
                    found.append((file, _forwarded(node)))
    return found


def _called_name(call: ast.Call) -> str | None:
    return call.func.id if isinstance(call.func, ast.Name) else getattr(call.func, "attr", None)


def _callback(call: ast.Call) -> ast.AST | None:
    """The argument in a DISPATCH_CALLS call's callback position or keyword, whatever it is."""
    name = _called_name(call)
    if name not in DISPATCH_CALLS:
        return None
    position, keyword = DISPATCH_CALLS[name]
    return call.args[position] if len(call.args) > position else next(
        (k.value for k in call.keywords if k.arg == keyword), None)


def _dispatched(call: ast.Call):
    """The function a call hands over to be run, when it is one of DISPATCH_CALLS: the argument in its callback's position
    or keyword, if that is a name, `module.name`, or (for `Depends`) a factory's call."""
    value = _callback(call)
    if isinstance(value, (ast.Name, ast.Attribute)) or (_called_name(call) == "Depends" and isinstance(value, ast.Call)):
        return [value]
    return []


def _never_run(owner: ast.AST) -> set[int]:
    """The `Thread(...)` and `partial(...)` calls in `owner` (by `id`) that are built and dropped, so their function
    never runs: one left as a statement of its own, or given a name nothing reads afterwards. Any other use counts as
    running it: `.start()`, a call, or handing it on (returned, passed along, or queued for later, as
    `logs_platform_action` queues its partial for the middleware)."""
    read = {node.id for node in _own_nodes(owner) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)}
    idle = set()
    for node in _own_nodes(owner):
        value = getattr(node, "value", None)
        if not (isinstance(value, ast.Call) and _called_name(value) in BUILDERS):
            continue
        if isinstance(node, ast.Expr):                                       # Thread(target=f) and nothing else
            idle.add(id(value))
        elif isinstance(node, ast.Assign) and all(isinstance(target, ast.Name) and target.id not in read
                                                  for target in node.targets):
            idle.add(id(value))                                              # worker = Thread(target=f), never used
    return idle


def _handed_over(value: ast.AST, file: str, resolve, functions: dict, modules: dict) -> tuple[str, str] | None:
    """The backend function a dispatched name or `module.name` stands for, as `_callee` finds a call's."""
    if isinstance(value, ast.Call):
        return None
    return _callee(ast.Call(func=value, args=[], keywords=[]), file, resolve, functions, modules)


def _forwarded(call: ast.Call) -> ast.Call:
    """A dispatch call with the keywords its callback gets: its own keywords, or, for a dispatcher that passes them as
    one dict (`Thread(kwargs={...})`, `launch_background(func_kwargs={...})`), that literal's keys."""
    as_dict = KEYWORD_DICTS.get(_called_name(call))
    if as_dict is None:
        keywords = list(call.keywords)
    else:
        keywords = [ast.keyword(arg=key.value, value=value)
                    for k in call.keywords if k.arg == as_dict and isinstance(k.value, ast.Dict)
                    for key, value in zip(k.value.keys, k.value.values, strict=True)
                    if isinstance(key, ast.Constant) and isinstance(key.value, str)]
    return ast.Call(func=call.func, args=call.args, keywords=keywords, lineno=call.lineno, col_offset=call.col_offset)


def _logging_functions(trees=None) -> set[tuple[str, str]]:
    """Every (file, function) that writes the ledger, directly or through another function it calls. A function is named
    by its path (`route._do` for one defined inside `route`), so same-named helpers in two routes are two functions."""
    calls: dict[tuple[str, str], set] = {}
    returns: dict[tuple[str, str], set] = {}        # factory -> the functions it hands back
    factories: dict[tuple[str, str], set] = {}      # function -> the factories whose result it gives to Depends
    logging = set(WRITERS)
    for file, tree in _source_trees(SOURCE_FILES) if trees is None else trees:
        scoped = _scoped_functions(tree)
        defined = {path for path, _ in scoped}
        functions, modules = _imports(tree)
        names_in = _names_by_scope(tree)
        for path, function in scoped:
            key, resolve, idle = (file, ".".join(path)), _resolver(path, defined), _never_run(function)
            for node in _own_nodes(function):
                if isinstance(node, ast.Call):
                    calls.setdefault(key, set()).add(_callee(node, file, resolve, functions, modules))
                    if _is_ledger_model(node.func, _assigned_names(function, names_in[path[:-1]], before=node)):
                        logging.add(key)
                    for value in _dispatched(node) if id(node) not in idle else []:   # handed to a pool or a launcher
                        if isinstance(value, ast.Call):        # Depends(factory(...)): FastAPI runs what it returns
                            if (factory := _callee(value, file, resolve, functions, modules)) is not None:
                                factories.setdefault(key, set()).add(factory)
                        elif (target := _handed_over(value, file, resolve, functions, modules)) is not None:
                            calls.setdefault(key, set()).add(target)
                elif isinstance(node, ast.Return) and isinstance(node.value, ast.Name):
                    if (target := resolve(node.value.id)) is not None:   # returned, not run: only Depends runs it
                        returns.setdefault(key, set()).add((file, ".".join(target)))
    for key, made_by in factories.items():
        for factory in made_by:
            calls.setdefault(key, set()).update(returns.get(factory, set()))
    grew = True
    while grew:
        found = {key for key, called in calls.items() if called & logging} - logging
        logging |= found
        grew = bool(found)
    return logging


def _route_methods(call: ast.Call) -> set[str]:
    """The HTTP methods a route decorator or `add_api_route(...)` call names, lower-cased: `.post(...)`, or
    `.api_route(..., methods=[...])`."""
    if not isinstance(call.func, ast.Attribute):
        return set()
    if call.func.attr in WRITE_METHODS:
        return {call.func.attr}
    if call.func.attr in {"api_route", "add_api_route"}:
        for keyword in call.keywords:
            if keyword.arg == "methods" and isinstance(keyword.value, (ast.List, ast.Tuple, ast.Set)):
                return {item.value.lower() for item in keyword.value.elts
                        if isinstance(item, ast.Constant) and isinstance(item.value, str)}
    return set()


def _write_routes(trees=None) -> list[tuple[str, str]]:
    routes = []
    for file, tree in _source_trees(ROUTE_FILES) if trees is None else trees:
        for path, function in _scoped_functions(tree):
            for decorator in function.decorator_list:
                if isinstance(decorator, ast.Call) and _route_methods(decorator) & WRITE_METHODS:
                    routes.append((file, ".".join(path)))
        for node in ast.walk(tree):             # router.add_api_route("/x", handler, methods=["POST"])
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "add_api_route":
                target = node.args[1] if len(node.args) > 1 else next(
                    (keyword.value for keyword in node.keywords if keyword.arg == "endpoint"), None)
                if isinstance(target, ast.Name) and _route_methods(node) & WRITE_METHODS:
                    routes.append((file, target.id))
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


def _enclosing_calls(accept, trees=None, model: str = "ActivityEntry") -> set[tuple[str, str]]:
    """(file, outermost function) of every call `accept(call, names)` takes, across the backend, where `names` are what
    `model` is called in that file."""
    found = set()
    for file, tree in _source_trees(SOURCE_FILES) if trees is None else trees:

        def visit(node, function, scope, outer):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # Inside a function, the names around it are what they end up as: it runs after they are all bound.
                function, scope, outer = function or node.name, node, _assigned_names(scope, outer, model)
            if isinstance(node, ast.Call) and accept(node, _assigned_names(scope, outer, model, before=node)):
                found.add((file, function or "<module>"))        # the model's names at this call, not at the end
            for child in ast.iter_child_nodes(node):
                visit(child, function, scope, outer)
        visit(tree, None, tree, _imported_names(tree, model))
    return found


def _builds_a_ledger_entry(call: ast.Call, names: set[str]) -> bool:
    return _is_ledger_model(call.func, names)


def test_a_ledger_entry_is_built_only_by_the_writer():
    built = _enclosing_calls(_builds_a_ledger_entry)
    assert built <= set(DIRECT_WRITES), f"Write through backend/auth/ledger.py instead: {sorted(built - set(DIRECT_WRITES))}"


def test_the_old_ledger_table_is_only_cleared_by_the_demo_reset():
    """`activity_logs` replaced `ledger_entries` (migration 0028); an entry written there would never be seen."""
    used = _enclosing_calls(lambda call, names: any(_is_ledger_model(node, names, "LedgerEntry") for node in ast.walk(call)),
                            model="LedgerEntry")
    assert used <= {("scripts/seed_demo.py", "reset")}, f"Use ActivityEntry instead: {sorted(used)}"


def _reads_the_ledger(call: ast.Call, names: set[str]) -> bool:
    name = call.func.id if isinstance(call.func, ast.Name) else getattr(call.func, "attr", None)
    return name in {"query", "scoped", "select", "get", "join", "outerjoin"} and any(
        _is_ledger_model(node, names)
        for arg in (*call.args, *(keyword.value for keyword in call.keywords)) for node in ast.walk(arg))


def test_only_the_listed_routes_read_the_ledger():
    """A new read would skip the role limit in `routes_ledger.py`: add to that route instead."""
    reads = _enclosing_calls(_reads_the_ledger)
    assert reads <= set(LEDGER_READERS), f"These read ActivityEntry outside the role limit: {sorted(reads - set(LEDGER_READERS))}"


# The checks above are only as good as what they can see. These feed each one a small file that does the thing a
# careless change might, so a way around a check is caught here rather than found later.

def _snippet(source: str, file: str = "api/routes_example.py") -> list[tuple[str, ast.Module]]:
    return [(file, ast.parse(source))]


def test_a_ledger_module_imported_under_a_name_or_by_its_full_path_is_still_seen():
    aliased = _snippet("import backend.auth.ledger as audit\ndef a(db):\n    audit.record(db, actor=1)\n")
    by_path = _snippet("import backend.auth.ledger\ndef b(db):\n    backend.auth.ledger.record(db, actor=1)\n")
    assert ("api/routes_example.py", "a") in _logging_functions(aliased)
    assert ("api/routes_example.py", "b") in _logging_functions(by_path)
    for trees in (aliased, by_path):                         # and the candidate check reaches them
        (_, call), = _ledger_writes(trees)
        assert not any(keyword.arg == "candidate_id" for keyword in call.keywords)


def test_a_helper_that_is_defined_but_never_called_does_not_make_its_route_log():
    unused = _snippet("from backend.auth import ledger\ndef route(db):\n    def helper():\n        ledger.record(db)\n    return 1\n")
    called = _snippet("from backend.auth import ledger\ndef route(db):\n    def helper():\n        ledger.record(db)\n    helper()\n")
    assert ("api/routes_example.py", "route") not in _logging_functions(unused)
    assert ("api/routes_example.py", "route") in _logging_functions(called)


def test_a_route_added_with_api_route_or_add_api_route_is_a_write_route():
    source = ("@router.api_route('/a', methods=['GET', 'POST'])\ndef a(): pass\n"
              "@router.api_route('/b', methods=['GET'])\ndef b(): pass\n"
              "def c(): pass\nrouter.add_api_route('/c', c, methods=['PATCH'])\n"
              "@router.post('/d')\ndef d(): pass\n")
    assert sorted(name for _, name in _write_routes(_snippet(source))) == ["a", "c", "d"]


def test_a_renamed_ledger_model_is_still_seen_when_built_or_read():
    source = ("from backend.models.tenancy import ActivityEntry as Entry\nfrom backend.models import tenancy\n"
              "def build(db):\n    return Entry(firm_id=1)\n"
              "def build_by_module(db):\n    return tenancy.ActivityEntry(firm_id=1)\n"
              "def read(db):\n    return db.query(Entry).all()\n"
              "def read_by_module(db):\n    return db.query(tenancy.ActivityEntry).all()\n")
    trees = _snippet(source)
    assert {name for _, name in _enclosing_calls(_builds_a_ledger_entry, trees)} == {"build", "build_by_module"}
    assert {name for _, name in _enclosing_calls(_reads_the_ledger, trees)} == {"read", "read_by_module"}


def test_two_routes_that_each_define_a_helper_of_the_same_name_are_told_apart():
    source = ("from backend.auth import ledger\n"
              "@router.post('/a')\ndef a(db):\n    def _do():\n        ledger.record(db)\n    _do()\n"
              "@router.post('/b')\ndef b(db):\n    def _do():\n        return 1\n    _do()\n")
    trees = _snippet(source)
    logging = _logging_functions(trees)
    assert ("api/routes_example.py", "a") in logging and ("api/routes_example.py", "b") not in logging
    assert sorted(name for _, name in _write_routes(trees)) == ["a", "b"]


def test_a_function_counts_only_when_a_call_hands_it_over_to_run():
    source = ("from backend.auth import ledger\n"
              "def write_audit(db):\n    ledger.record(db)\n"
              "def only_named(db):\n    unused = write_audit\n    return 1\n"
              "def only_listed(db):\n    return [write_audit]\n"
              "def threaded(db):\n    return asyncio.to_thread(write_audit, db)\n"
              "def launched(db):\n    return launch_background('x', write_audit)\n"
              "def tasked(db, tasks):\n    tasks.add_task(write_audit, db)\n"
              "def other_call(db):\n    return print(write_audit)\n"
              "def as_dependency(x=Depends(write_audit)):\n    return 1\n"
              "def factory():\n    def inner(db):\n        write_audit(db)\n    return inner\n"
              "def through_factory(x=Depends(factory())):\n    return 1\n"
              "def discards_it(db):\n    factory()\n    return 1\n")
    logging = {name for _, name in _logging_functions(_snippet(source))}
    assert {"threaded", "launched", "tasked", "as_dependency", "through_factory"} <= logging
    assert not {"only_named", "only_listed", "other_call", "factory", "discards_it"} & logging


def test_an_imported_writer_handed_to_a_task_counts():
    source = ("from backend.auth.ledger import record as write_audit\n"
              "def tasked(db, tasks):\n    tasks.add_task(write_audit, db, candidate_id=None)\n"
              "def named_only(db):\n    unused = write_audit\n")
    logging = {name for _, name in _logging_functions(_snippet(source))}
    assert "tasked" in logging and "named_only" not in logging


def test_a_writer_call_is_found_even_beside_a_nested_function_of_the_same_name():
    source = ("from backend.auth.ledger import record\n"
              "def other():\n    def record():\n        return 1\n    record()\n"
              "def route(db):\n    record(db, actor=1)\n")
    (file, call), = _ledger_writes(_snippet(source))
    assert call.lineno == 7 and not any(keyword.arg == "candidate_id" for keyword in call.keywords)


def test_a_model_renamed_by_assignment_is_still_seen():
    source = ("from backend.models.tenancy import ActivityEntry\nEntry = ActivityEntry\nAgain = Entry\n"
              "def read(db):\n    return db.query(Again).all()\n"
              "def build(db):\n    return Entry(firm_id=1)\n")
    trees = _snippet(source)
    assert {name for _, name in _enclosing_calls(_reads_the_ledger, trees)} == {"read"}
    assert {name for _, name in _enclosing_calls(_builds_a_ledger_entry, trees)} == {"build"}


def test_a_name_bound_to_the_model_in_one_function_is_not_the_model_in_another():
    source = ("from backend.models.tenancy import ActivityEntry, Candidate\n"
              "def reads_the_log(db):\n    model = ActivityEntry\n    return db.query(model).all()\n"
              "def reads_candidates(db):\n    model = Candidate\n    return db.query(model).all()\n"
              "def rebinds(db):\n    model = ActivityEntry\n    model = Candidate\n    return db.query(model).all()\n"
              "def reads_then_rebinds(db):\n    model = ActivityEntry\n    rows = db.query(model).all()\n    model = Candidate\n    return rows\n"
              "def binds_after_reading(db):\n    model = Candidate\n    rows = db.query(model).all()\n    model = ActivityEntry\n    return rows\n")
    trees = _snippet(source)
    assert {name for _, name in _enclosing_calls(_reads_the_ledger, trees)} == {"reads_the_log", "reads_then_rebinds"}


def test_an_entry_built_under_a_name_that_is_rebound_later_is_still_a_write():
    source = ("from backend.models.tenancy import ActivityEntry\n"
              "def builds_then_rebinds(db):\n    Row = ActivityEntry\n    db.add(Row(firm_id=1))\n    Row = dict\n"
              "def binds_after_building(db):\n    Row = dict\n    db.add(Row(firm_id=1))\n    Row = ActivityEntry\n")
    trees = _snippet(source)
    assert {name for _, name in _enclosing_calls(_builds_a_ledger_entry, trees)} == {"builds_then_rebinds"}
    logging = {name for _, name in _logging_functions(trees)}
    assert "builds_then_rebinds" in logging and "binds_after_building" not in logging


def test_only_the_argument_a_dispatcher_runs_is_handed_over():
    source = ("from backend.auth import ledger\n"
              "def write_audit(db):\n    ledger.record(db, candidate_id=None)\n"
              "def ignore(callback):\n    return 1\n"
              "def as_data(tasks):\n    tasks.add_task(ignore, write_audit)\n"
              "def as_callback(tasks):\n    tasks.add_task(write_audit, 1)\n"
              "def by_module(tasks):\n    tasks.add_task(ledger.record, 1, candidate_id=None)\n"
              "def threaded():\n    Thread(target=write_audit).start()\n")
    logging = {name for _, name in _logging_functions(_snippet(source))}
    assert {"as_callback", "by_module", "threaded"} <= logging and "as_data" not in logging


def test_a_thread_or_partial_that_is_built_and_dropped_does_not_count():
    source = ("from backend.auth import ledger\n"
              "def write_audit(db):\n    ledger.record(db, candidate_id=None)\n"
              "def never_started(db):\n    Thread(target=write_audit)\n"
              "def named_never_started(db):\n    worker = Thread(target=write_audit)\n    return 1\n"
              "def handed_back(db):\n    worker = Thread(target=write_audit)\n    return worker\n"
              "def queued(db, pending):\n    pending.append(partial(write_audit, db))\n"
              "def started(db):\n    Thread(target=write_audit).start()\n"
              "def named_started(db):\n    worker = threading.Thread(target=write_audit, args=(db,))\n    worker.start()\n"
              "def never_called(db):\n    send = partial(write_audit, db)\n    return 1\n"
              "def called(db):\n    send = partial(write_audit, db)\n    send()\n"
              "def called_at_once(db):\n    partial(write_audit, db)()\n"
              "def handed_on(tasks, db):\n    tasks.add_task(partial(write_audit, db))\n"
              "def named_handed_on(tasks, db):\n    send = partial(write_audit, db)\n    tasks.add_task(send)\n")
    file = "api/routes_example.py"
    logging = {name for found, name in _logging_functions(_snippet(source, file)) if found == file} - {"write_audit"}
    assert logging == {"started", "named_started", "called", "called_at_once", "handed_on", "named_handed_on",
                       "handed_back", "queued"}


def test_a_writer_handed_to_a_task_must_state_its_candidate():
    source = ("from backend.auth import ledger\nfrom backend.auth.ledger import record\n"
              "def missing(tasks, db):\n    tasks.add_task(record, db, actor=1)\n"
              "def stated(tasks, db):\n    tasks.add_task(ledger.record, db, actor=1, candidate_id=None)\n"
              "def launched(db):\n    launch_background('x', record, func_kwargs={'candidate_id': None})\n"
              "def threaded(db):\n    Thread(target=record, args=(db,), kwargs={'actor': 1, 'candidate_id': None}).start()\n"
              "def threaded_missing(db):\n    Thread(target=record, args=(db,), kwargs={'actor': 1}).start()\n"
              "def launched_missing(db):\n    launch_background('x', record, firm_id=1, func_kwargs={'actor': 1})\n"
              "def never_started(db):\n    Thread(target=record, args=(db,))\n")
    writes = {call.lineno: any(k.arg == "candidate_id" for k in call.keywords) for _, call in _ledger_writes(_snippet(source))}
    assert writes == {4: False, 6: True, 8: True, 10: True, 12: False, 14: False}    # the unstarted thread writes nothing


def test_a_ledger_read_passed_by_keyword_is_seen():
    source = ("from backend.models.tenancy import ActivityEntry\n"
              "def by_keyword(db, row_id):\n    return db.get(entity=ActivityEntry, ident=row_id)\n"
              "def by_position(db, row_id):\n    return db.get(ActivityEntry, row_id)\n"
              "def elsewhere(db, row_id):\n    return db.get(Other, row_id)\n")
    assert {name for _, name in _enclosing_calls(_reads_the_ledger, _snippet(source))} == {"by_keyword", "by_position"}
