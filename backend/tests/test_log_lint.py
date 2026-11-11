"""No log call writes a person's data into its message (CLAUDE.md, docs/team/uzair.md §1, step 4a).

The code is read (ast, not run), and people's data is followed from where it enters a function to any log call:

  enters   a route's request body, URL values and uploads; a row of a table that holds people (`db.get(Candidate,
           …)`, `db.query(User)…`); the AI's reply (`call_llm`); another service's reply (`httpx`, `requests`); a
           value in a field or variable named like a person's data (`.full_name`, `email`, `raw`)
  travels  through assignments, loops, f-strings, `%`, `.format()`, `+`, dicts and lists, `model_dump()`, `str()`,
           a helper called with it, a helper in the same file that returns it, a helper or background task in the
           same file it is passed to, and an exception raised while it was being handled
  is safe  as an id, a count, a status or a flag: `.id`, `*_id`, `len()`, `bool()`, a comparison

Every logger is a sink: `logger`, `log`, `self.logger`, `logging.getLogger(...)`, `logging.info`. The run-time
check is test_log_every_route.py; this one also reads the branches no request reaches (an `except` that logs).

What it can't follow: a value fetched inside a function in another file (`get_name(candidate_id)`), and an object
attribute set in one method and read in another. Both are the run-time check's.

Log ids, counts and timings instead: `logger.info("Created candidate %s", candidate.id)`, `len(raw)`. A call that is
safe although it matches goes in NOT_PERSONAL with the reason. KNOWN lists calls found when this check was written,
whose owners were told (uzair.md "For teammates (4a)"); delete an entry when its call is fixed, and the stale check
makes sure.
"""
import ast
import re
from functools import cache
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
LEVELS = {"debug", "info", "warning", "warn", "error", "exception", "critical", "log"}

# Tables whose rows are, or are about, a person: a row of one is people's data until reduced to an id or a count.
PEOPLE_MODELS = {
    "Candidate", "ResumeParse", "BaseResume", "CandidateMailbox", "CandidateGoogleOAuthAttempt", "InboxMessage",
    "Evidence", "Claim", "Application", "ApplicationReview", "ApplicationStatusEvent", "Interview", "Resume",
    "CoverLetter", "Persona", "User", "PlatformUser", "Invite", "SupportView", "PasswordResetRequest", "Notification",
    "LedgerEntry",
}
# A field that holds a person's data, on any object: `candidate.email`, `invite.invitee_name`.
PERSONAL_FIELDS = {"full_name", "first_name", "last_name", "invitee_name", "email", "phone", "phone_number",
                   "password", "resume_text", "resume_content", "subject", "snippet", "from_header", "filename",
                   "file_name"}
# A variable that, by this codebase's naming, holds the same: an email's parts, a password, a raw AI reply.
PERSONAL_NAMES = {"email", "phone", "password", "body", "subject", "snippet", "from_header", "filename", "file_name",
                  "resume_text", "full_name", "raw", "raw_response", "reply"}
# A field that is personal only on a given object: a search a BDE may name after the candidate.
PERSONAL_ON = {("search", "name")}
# Route parameters of these types carry no one's data.
SAFE_PARAM_TYPES = {"int", "float", "bool", "UUID", "uuid.UUID", "Session", "DbSession", "Request", "Response",
                    "BackgroundTasks", "datetime", "date", "Literal"}
# Calls that return something about a value, not the value.
SAFE_CALLS = {"len", "bool", "type", "id", "hash", "isinstance", "callable", "int", "float", "round", "sum", "any",
              "all"}
SAFE_METHODS = {"count", "isoformat", "total_seconds", "is_set", "done", "startswith", "endswith", "isdigit", "time",
                "monotonic", "perf_counter", "uuid4"}
# A part of a person's record that is not personal: its id, status, counts and timestamps.
SAFE_ATTR_ENDINGS = ("id", "_ids", "count", "status", "status_code", "state", "kind", "role", "level", "code",
                     "method", "elapsed", "duration", "attempts", "attempt", "seconds", "ms", "total", "slug", "_at",
                     "version", "__name__", "__class__", "stage", "tier", "plan", "score", "confidence",
                     "idx", "_type", "_ms", "_s")
SAFE_ATTR_PREFIXES = ("is_", "has_", "can_", "n_", "num_")
SAFE_KEYS = {"id", "status", "status_code", "usage", "model", "provider", "count", "input_tokens", "output_tokens"}
# Outside services whose replies carry people's data: Google (a mailbox, an account) and the AI providers (a reply
# about a résumé or an email). In a file that calls one of them, every HTTP reply is people's data; a job board's
# reply (titles, companies) is not.
PERSONAL_HOSTS = ("googleapis.com", "accounts.google.com", "oauth2.google", "openrouter.ai", "api.anthropic.com",
                  "api.openai.com")
HTTP_RECEIVERS = {"httpx", "requests", "client", "http", "session", "_client", "http_client", "async_client"}
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "request", "send", "stream"}
# Calls that read rows of a table: `db.query(Candidate)`, `db.get(User, …)`, `select(Invite)`.
ROW_READERS = {"query", "get", "select"}
# Calls that run a function later with the arguments given: the function's parameters receive them.
DEFERRED = {"add_task", "to_thread", "run_in_threadpool", "run_in_executor", "submit", "apply_async"}

# (file, function) -> why the match is not personal data. Reviewed 2026-11-04.
NOT_PERSONAL = {
    ("analyzer/cv_scorer.py", "_fetch_job_text"): "a job page's fetch error",
    ("analyzer/llm_client.py", "call_llm"): "the provider's error names the status, not the prompt",
    ("analyzer/llm_cost.py", "refresh_openrouter_prices"): "OpenRouter's price list",
    ("api/routes_applications.py", "_cache_job_page"): "a job posting's URL and page",
    ("api/routes_applications.py", "_fetch_and_store_description"): "a job posting's page",
    ("api/routes_applications.py", "_known_posting"): "a job posting's URL",
    ("api/routes_applications.py", "create_application"): "a company's name",
    ("api/routes_applications.py", "extract_posting"): "a job posting's URL",
    ("api/routes_autofill.py", "_events"): "the provider's error names the status, not the prompt",
    ("api/routes_autofill.py", "autofill_answer"): "the provider's error names the status, not the prompt",
    ("api/routes_jobs.py", "_score_resume_names"): "a job id and a lookup error",
    ("api/routes_jobs.py", "save_from_extension"): "the extension's body is a job posting (title, company)",
    ("api/routes_llm.py", "list_models"): "an AI provider's name",
    ("auth/throttle.py", "_refuse_if_over"): "the bucket's kind (`email`, `ip`), the part before the value",
    ("candidates/parse.py", "_setup_error"): "which parser setting is missing",
    ("candidates/parse.py", "read_resume"): "the provider's error, and a JSON error's message and position",
    ("scheduler.py", "run_auto_reject"): "a scheduler setting's error",
    ("scheduler.py", "run_db_backup"): "pg_dump's error; the password is in its environment, not its output",
    ("scraper/ats/phenom.py", "scrape"): "a job board's endpoint and fields",
    # The résumé tailor's steps (docs/team/tailoring.md): a step's name ("analyse") and fixed reasons ("not in the
    # CV", "dropped"), counted; never the CV, the résumé or the model's reply.
    ("resume_tailor/pipeline.py", "_ask"): "a step's name",
    ("resume_tailor/pipeline.py", "tailor"): "counts and fixed reasons of the edits and the fact gate",
}

# (file, function) -> who was told. Found by Abdul's review of #107, a search of every log call (2026-11-03) and this
# check (2026-11-04).
KNOWN = {
    ("analyzer/cover_letter_generator.py", "generate_cover_letter_body"): "Zuhair: raw AI reply",
    ("analyzer/cv_scorer.py", "_score_job_inner"): "Zuhair: raw AI reply",
    ("analyzer/cv_scorer.py", "analyze_unscored_jobs"): "Zuhair: a résumé's name",
    ("analyzer/legacy_tailoring.py", "_tailor_impl"): "Zuhair: raw AI reply (moved from routes_resumes.py)",
    ("api/routes_searches.py", "test_search"): "Zuhair: search name",
    ("scraper/orchestrator.py", "run_all"): "Zuhair: search name",
    ("scraper/orchestrator.py", "_run_search_by_id"): "Zuhair: search name",
    ("scraper/sources/freehire.py", "run"): "Zuhair: search name",
    ("scraper/sources/jobright.py", "run"): "Zuhair: search name",
    ("scraper/sources/jobspy.py", "_run_sync"): "Zuhair: search name",
    ("scraper/sources/levelsfyi.py", "run"): "Zuhair: search name",
    ("scraper/sources/linkedin_personal.py", "run"): "Zuhair: search name",
    ("api/routes_applications.py", "prep_bundle"): "Samad: a résumé's name",
    ("email_monitor/gmail_client.py", "_get_access_token"): "Samad: Google's whole reply",
    ("email_monitor/gmail_client.py", "check_emails"): "Samad: Google's whole reply, a sender's domain",
    ("email_monitor/response_parser.py", "classify_email_llm"): "Samad: raw AI reply",
}


def _fixed_values(value: ast.AST | None) -> bool:
    """`Field(pattern='^(A|B|C)$')`: a field that can only hold one of a few words, never a name."""
    if not (isinstance(value, ast.Call) and ast.unparse(value.func).endswith("Field")):
        return False
    pattern = next((k.value.value for k in value.keywords if k.arg == "pattern" and isinstance(k.value, ast.Constant)), "")
    return bool(re.fullmatch(r"\^\([A-Z0-9_|]+\)\$", pattern))


def _safe_attr(name: str) -> bool:
    return name.endswith(SAFE_ATTR_ENDINGS) or name.startswith(SAFE_ATTR_PREFIXES)


def _annotation(node: ast.AST | None) -> str:
    if node is None:
        return ""
    if isinstance(node, ast.Subscript):                      # Annotated[X, ...], Optional[X], Literal[...]
        return _annotation(node.value) if ast.unparse(node.value) == "Literal" else _annotation(
            node.slice.elts[0] if isinstance(node.slice, ast.Tuple) else node.slice)
    if isinstance(node, ast.BinOp):                          # X | None
        return _annotation(node.left)
    return ast.unparse(node)


def _is_route(fn: ast.AST) -> bool:
    return any(isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
               and d.func.attr in {"get", "post", "put", "patch", "delete", "api_route", "websocket"}
               for d in fn.decorator_list)


def _is_logger(node: ast.AST) -> bool:
    if isinstance(node, ast.Name):
        return "log" in node.id.lower()
    if isinstance(node, ast.Attribute):
        return "log" in node.attr.lower()
    if isinstance(node, ast.Call):                           # logging.getLogger("x").info(...)
        return isinstance(node.func, (ast.Attribute, ast.Name)) and ast.unparse(node.func).endswith("getLogger")
    return False


def _is_log_call(node: ast.AST) -> bool:
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in LEVELS
            and _is_logger(node.func.value))


def _body_nodes(fn: ast.AST):
    """The nodes of a function's own body, not of the functions and classes defined inside it."""
    stack = list(fn.body)
    while stack:
        node = stack.pop()
        yield node
        stack += [c for c in ast.iter_child_nodes(node)
                  if not isinstance(c, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda))]


def _names_in(target: ast.AST) -> list[str]:
    return [n.id for n in ast.walk(target) if isinstance(n, ast.Name)]


class _File:
    """One file's functions, which of their names carry people's data, and its log calls."""

    def __init__(self, source: str):
        self.tree = ast.parse(source)
        self.personal_http = any(host in source for host in PERSONAL_HOSTS)
        # Fields this file declares as a number, a flag, an id or a date (`years: int` on a body): never a name.
        self.typed_safe = {n.target.id for n in ast.walk(self.tree)
                           if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)
                           and (_annotation(n.annotation) in SAFE_PARAM_TYPES or _fixed_values(n.value))}
        self.functions = [n for n in ast.walk(self.tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        self.by_name: dict[str, list[ast.AST]] = {}
        for fn in self.functions:
            self.by_name.setdefault(fn.name, []).append(fn)
        self.parent: dict[ast.AST, ast.AST] = {}              # a nested function -> the one it is defined in

        def _visit(node, enclosing):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if enclosing is not None:
                        self.parent[child] = enclosing
                    _visit(child, child)
                else:
                    _visit(child, enclosing)
        _visit(self.tree, None)
        self.seeded: dict[ast.AST, set[str]] = {fn: set() for fn in self.functions}
        self.from_callers: dict[ast.AST, set[str]] = {fn: set() for fn in self.functions}
        self.tainted: dict[ast.AST, set[str]] = {fn: set() for fn in self.functions}
        self.returns_tainted: set[ast.AST] = set()
        self._seed()
        for _ in range(20):                                   # to a fixed point: helpers pass taint both ways
            if not self._spread():
                break

    # ── Where people's data enters ────────────────────────────────────────

    def _seed(self):
        for fn in self.functions:
            route = _is_route(fn)
            for arg in fn.args.posonlyargs + fn.args.args + fn.args.kwonlyargs:
                kind = _annotation(arg.annotation)
                if arg.arg in PERSONAL_NAMES or kind in PEOPLE_MODELS:
                    self.seeded[fn].add(arg.arg)
                elif route and arg.arg not in {"db", "self"} and kind not in SAFE_PARAM_TYPES \
                        and not arg.arg.endswith(("_id", "_ids")) and kind != "":
                    self.seeded[fn].add(arg.arg)             # a body, an upload, a str from the URL, the principal

    def _source(self, node: ast.AST) -> bool:
        """A call that brings people's data in by itself."""
        if not isinstance(node, ast.Call):
            return False
        func = node.func
        name = func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else ""
        if name.startswith("call_") and name.endswith(("llm", "llm_stream")):   # call_llm, call_cover_letter_llm, …
            return True
        if self.personal_http and isinstance(func, ast.Attribute) and func.attr in HTTP_METHODS \
                and isinstance(func.value, ast.Name) and func.value.id in HTTP_RECEIVERS:
            return True
        # db.get(Candidate, …), db.query(User).filter(…).first(), select(Invite).where(…): the call the chain starts at
        base = node
        while isinstance(base.func, ast.Attribute) and base.func.attr not in ROW_READERS \
                and isinstance(base.func.value, ast.Call):
            base = base.func.value
        reader = base.func.attr if isinstance(base.func, ast.Attribute) else getattr(base.func, "id", "")
        return reader in ROW_READERS and bool(base.args) and isinstance(base.args[0], ast.Name) \
            and base.args[0].id in PEOPLE_MODELS

    # ── How it travels ────────────────────────────────────────────────────

    def carries(self, node: ast.AST, names: set[str]) -> list[str]:
        """The parts of an expression that carry people's data, given the names that do."""
        if node is None or isinstance(node, (ast.Constant, ast.Lambda)):
            return []
        if isinstance(node, ast.Name):                        # `run_id`, `total`, `match_idx`: a number by its name
            return [node.id] if node.id in names and not _safe_attr(node.id) else []
        if isinstance(node, ast.Attribute):
            if _safe_attr(node.attr) or node.attr in self.typed_safe:
                return []
            owner = node.value.id if isinstance(node.value, ast.Name) else None
            if node.attr in PERSONAL_FIELDS or (owner, node.attr) in PERSONAL_ON or (
                    self.personal_http and owner in {"resp", "response"} and node.attr == "text"):
                return [ast.unparse(node)]
            return [ast.unparse(node)] if self.carries(node.value, names) else []
        if isinstance(node, ast.Subscript):
            key = node.slice.value if isinstance(node.slice, ast.Constant) else None
            if key in SAFE_KEYS or (isinstance(key, str) and _safe_attr(key)):
                return []
            if self.personal_http and isinstance(node.value, ast.Name) and node.value.id in {"resp", "response"}:
                return [ast.unparse(node)]                    # resp["text"]: the AI's reply
            return [ast.unparse(node)] if self.carries(node.value, names) else []
        if isinstance(node, (ast.Compare, ast.UnaryOp)) and not isinstance(getattr(node, "op", None), ast.USub):
            return []                                         # a comparison or `not x` is a flag
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in SAFE_CALLS:
                return []
            if isinstance(func, ast.Attribute) and func.attr == "get" and node.args                     and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)                     and (node.args[0].value in SAFE_KEYS or _safe_attr(node.args[0].value)):
                return []                                     # result.get("status")
            if isinstance(func, ast.Attribute) and func.attr in SAFE_METHODS:
                return []
            if self._source(node) or any(f in self.returns_tainted for f in self._callees(node)):
                return [ast.unparse(node)]
            parts = [node.func.value] if isinstance(func, ast.Attribute) else []
            parts += list(node.args) + [k.value for k in node.keywords]
            return [ast.unparse(node)] if any(self.carries(p, names) for p in parts) else []
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
            inner = set(names)
            for gen in node.generators:
                if self.carries(gen.iter, inner):
                    inner |= set(_names_in(gen.target))
            elts = [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
            return [ast.unparse(node)] if any(self.carries(e, inner) for e in elts) else []
        found = []
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.expr):
                found += self.carries(child, names)
        return found

    def _callees(self, call: ast.Call) -> list[ast.AST]:
        func = call.func
        name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
        return self.by_name.get(name, [])

    def _closure(self, fn: ast.AST, start: set[str]) -> set[str]:
        """The names in a function that carry people's data, starting from `start` (order is ignored)."""
        names = set(start)
        while True:
            before = len(names)
            for node in _body_nodes(fn):
                if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
                    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                    if node.value is not None and self.carries(node.value, names):
                        for t in targets:
                            names.update(_names_in(t))
                elif isinstance(node, (ast.For, ast.AsyncFor)) and self.carries(node.iter, names):
                    names.update(_names_in(node.target))
                elif isinstance(node, (ast.With, ast.AsyncWith)):
                    for item in node.items:
                        if item.optional_vars is not None and self.carries(item.context_expr, names):
                            names.update(_names_in(item.optional_vars))
                elif isinstance(node, ast.Try):
                    # An exception may carry the data it failed on: `int(name)`, `raise ValueError(f"… {name}")`.
                    if any(self._may_raise_with(n, names) for s in node.body for n in ast.walk(s)):
                        names.update(h.name for h in node.handlers if h.name)
            if len(names) == before:
                return names

    def _may_raise_with(self, node: ast.AST, names: set[str]) -> bool:
        """A `raise` built from people's data, or a call (not a log call) given it."""
        if isinstance(node, ast.Raise):
            return node.exc is not None and bool(self.carries(node.exc, names))
        if isinstance(node, ast.Call) and not _is_log_call(node):
            return any(self.carries(a, names) for a in list(node.args) + [k.value for k in node.keywords])
        return False

    def _outer(self, fn: ast.AST, table: dict[ast.AST, set[str]]) -> set[str]:
        outer, names = self.parent.get(fn), set()
        while outer is not None:                              # a closure sees its enclosing function's names
            names |= table[outer]
            outer = self.parent.get(outer)
        return names

    def _names(self, fn: ast.AST) -> set[str]:
        return self.tainted[fn]

    def _pass_to(self, callee: ast.AST, args: list[ast.AST], keywords: list[ast.keyword], names: set[str],
                 is_method: bool) -> bool:
        params = [a.arg for a in callee.args.posonlyargs + callee.args.args]
        if is_method and params and params[0] in {"self", "cls"}:
            params = params[1:]
        given = {p for p, a in zip(params, args) if self.carries(a, names)}
        given |= {k.arg for k in keywords if k.arg and self.carries(k.value, names)}
        if given <= self.from_callers[callee]:
            return False
        self.from_callers[callee] |= given
        return True

    def _spread(self) -> bool:
        changed = False
        own: dict[ast.AST, set[str]] = {}
        for fn in sorted(self.functions, key=lambda f: f.lineno):
            own[fn] = self._closure(fn, self.seeded[fn] | self._outer(fn, own) if fn in self.parent else self.seeded[fn])
            if fn not in self.returns_tainted and any(
                    isinstance(n, ast.Return) and n.value is not None and self.carries(n.value, own[fn])
                    for n in _body_nodes(fn)):
                self.returns_tainted.add(fn)
                changed = True
        for fn in sorted(self.functions, key=lambda f: f.lineno):
            names = self._closure(fn, self.seeded[fn] | self.from_callers[fn] | self._outer(fn, self.tainted))
            if names != self.tainted[fn]:
                self.tainted[fn] = names
                changed = True
            for node in _body_nodes(fn):
                if not isinstance(node, ast.Call):
                    continue
                for callee in self._callees(node):
                    changed |= self._pass_to(callee, node.args, node.keywords, names,
                                             isinstance(node.func, ast.Attribute))
                if isinstance(node.func, ast.Attribute) and node.func.attr in DEFERRED and node.args                         and isinstance(node.args[0], ast.Name):
                    for callee in self.by_name.get(node.args[0].id, []):
                        changed |= self._pass_to(callee, node.args[1:], node.keywords, names, False)
        return changed

    # ── Where it must not go ──────────────────────────────────────────────

    def log_violations(self, path: str) -> dict[tuple[str, str], list[str]]:
        found: dict[tuple[str, str], list[str]] = {}
        owners = [(fn, self._names(fn)) for fn in self.functions]
        for call in ast.walk(self.tree):
            if not _is_log_call(call):
                continue
            inner = min((f for f, _ in owners if f.lineno <= call.lineno <= f.end_lineno),
                        key=lambda f: f.end_lineno - f.lineno, default=None)
            names = self._names(inner) if inner is not None else set()
            values = sorted({v for arg in call.args for v in self.carries(arg, names)})
            if values:
                key = (path, inner.name if inner else "<module>")
                found.setdefault(key, []).append(f"line {call.lineno}: {', '.join(values)}")
        return found


def _log_violations(source: str, path: str) -> dict[tuple[str, str], list[str]]:
    """(file, function) -> 'line: values' for each log call that writes people's data."""
    return _File(source).log_violations(path)


@cache
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
        "these log calls write a person's data (a name, an email, a record, a raw reply, a request body) into the "
        "log. Log ids, counts and timings instead (`candidate.id`, `len(raw)`); if a match is not personal data, add "
        f"it to NOT_PERSONAL in this file with the reason:\n" + "\n".join(f"  {f} {fn}(): {v}" for (f, fn), v in
                                                                          new.items()))


def test_every_listed_call_still_exists():
    """A fixed call leaves KNOWN, so the list only shrinks and a new match can't hide behind an old entry."""
    current = _backend_violations()
    stale = sorted(k for k in {**KNOWN, **NOT_PERSONAL} if k not in current)
    assert not stale, f"these no longer log anything personal-looking; delete them from this file: {stale}"


# What the check misses among log_leak_cases.py's leaks, and why; the run-time check is the one that catches them.
MISSED_CASES = {
    "/leak/http-reply": "a reply from a host not in PERSONAL_HOSTS: read as a job board's",
    "/leak/http-json": "a reply from a host not in PERSONAL_HOSTS: read as a job board's",
}


def _case_sources() -> dict[str, str]:
    """Each route of log_leak_cases.py alone, with the imports, the body model and the helpers it calls, so a case
    is caught or missed on its own."""
    source = (BACKEND / "tests" / "log_leak_cases.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    defs = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
    header = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))
              or (isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) in {"logger", "router"})
              or (isinstance(n, ast.ClassDef) and n.name == "PersonIn")]

    def helpers(node, seen):
        for sub in ast.walk(node):
            d = defs.get(sub.id) if isinstance(sub, ast.Name) else None
            if d is not None and d not in seen and d not in header:
                seen.append(d)
                helpers(d, seen)
        return seen

    cases = {}
    for fn in tree.body:
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) and _is_route(fn):
            used = sorted(helpers(fn, []), key=lambda n: n.lineno)
            cases[fn.decorator_list[0].args[0].value] = "\n\n".join(ast.unparse(n) for n in header + used + [fn])
    return cases


def test_the_check_catches_the_leak_cases():
    """Measured, not assumed: every leak in log_leak_cases.py is caught but the ones MISSED_CASES names, and none of
    its safe routes is flagged."""
    cases = _case_sources()
    caught = {path for path, source in cases.items() if _log_violations(source, "case.py")}
    leaks = {p for p in cases if p.startswith("/leak/")}
    assert leaks - caught == set(MISSED_CASES), f"missed: {sorted(leaks - caught - set(MISSED_CASES))}; "                                                 f"now caught, remove from MISSED_CASES: {sorted(set(MISSED_CASES) & caught)}"
    assert not {p for p in caught if p.startswith("/safe/")}, f"safe routes flagged: {sorted(caught - leaks)}"


# One-off programs a person runs by hand; they print to that person's terminal, not to the server's log.
PRINTING_PROGRAMS = {"scripts", "gmail_oauth_setup.py", "refresh_linkedin_session.py"}


def test_the_server_never_prints():
    """`print()` skips the one log handler, so nothing it writes is masked or carries a request id."""
    found = []
    for path in sorted(BACKEND.rglob("*.py")):
        relative = path.relative_to(BACKEND)
        if relative.parts[0] in PRINTING_PROGRAMS | {"tests"}:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        # `if __name__ == "__main__":` is a command-line tool's report to whoever runs it, not the server's log.
        main = [n for n in tree.body if isinstance(n, ast.If) and "__main__" in ast.unparse(n.test)]
        in_main = {id(sub) for block in main for sub in ast.walk(block)}
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "print"                     and id(node) not in in_main:
                found.append(f"{relative.as_posix()}:{node.lineno}")
    assert not found, f"use logging.getLogger('jobnavigator.<area>') instead of print(): {found}"
