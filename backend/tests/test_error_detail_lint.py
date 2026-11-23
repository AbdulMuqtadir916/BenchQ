"""An error's `detail` is BenchQ's own words (docs/02-DATA-CONTRACTS.md §12.2 rule 2, §12.3 rule 4).

The static half beside test_error_responses_lint.py: the code is read (ast, not run). Every `Problem(...)`,
`HTTPException(...)` or `problem_response(...)` has its detail (second positional argument or `detail=`) checked:

  built from an exception   the detail names a variable bound by `except ... as <name>` around it (`str(e)`,
                            `f"...{e}"`, `e.args`, `e.job_type`), or calls `repr(...)`, reads `.args`, or formats a
                            traceback. An exception's text is a library's words, or a value: it goes to the log
                            (masked, no values), and the user gets fixed words.
  written against the rules a literal in the detail, or a module-level string constant it names, says "please",
                            "Oops" or has an exclamation mark.

KNOWN lists the JobNavigator leftovers (docs/02 §12.1, "Exceptions"; Abdul's clean-up track) by file:line, with why.
USER_WORDS lists BenchQ exceptions whose message is written for the user by design. Delete an entry when its call
goes or moves; the stale check fails until then.
"""
import ast
import pathlib
import re

BACKEND = pathlib.Path(__file__).resolve().parents[1]
ERROR_CALLS = {"Problem", "HTTPException", "problem_response"}
TRACEBACK_CALLS = {"format_exc", "format_exception", "format_exception_only", "format_tb"}
BANNED_WORDS = re.compile(r"please|oops|!", re.IGNORECASE)

KNOWN = {
    "api/routes_applications.py:1013": "POST /api/applications/check-url, 'Unsafe URL' (JobNavigator leftover)",
    "api/routes_companies.py:670": "the companies test-scrape 500 (JobNavigator leftover)",
    "api/routes_cover_letters.py:317": "cover letters' PDF 500 (JobNavigator leftover)",
    "api/routes_jobs.py:82": "POST /api/jobs/linkedin-import, already running; the route answers 410 first",
    "api/routes_jobs.py:1199": "the posting fetch 502 (JobNavigator leftover)",
}
USER_WORDS = {
    # candidates/autofill.py `Refused`: "A change the save route refuses (400), with what to tell the user". Its
    # messages are BenchQ's fixed sentences naming the question or the limit, never a library's text.
    "api/routes_candidate_resumes.py:220": "autofill_answers.Refused, BenchQ's own sentence for the user",
    "api/routes_ai_presets.py:443": "ai.test_run.TestRunRefused, BenchQ's own sentence for the admin (\"Add target role.\")",
}


def _name(func) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _detail(call: ast.Call):
    for keyword in call.keywords:
        if keyword.arg == "detail":
            return keyword.value
    return call.args[1] if len(call.args) > 1 else None


def _constants(tree: ast.Module) -> dict[str, str]:
    """The module's top-level `NAME = "text"` assignments."""
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    found[target.id] = node.value.value
    return found


def _from_exception(detail, bound: set[str]) -> str | None:
    for node in ast.walk(detail):
        if isinstance(node, ast.Name) and node.id in bound:
            return f"the caught exception `{node.id}`"
        if isinstance(node, ast.Call) and _name(node.func) == "repr":
            return "repr(...)"
        if isinstance(node, ast.Call) and _name(node.func) in TRACEBACK_CALLS:
            return "a traceback"
        if isinstance(node, ast.Attribute) and node.attr == "args":
            return "an exception's .args"
    return None


def _words(detail, constants: dict[str, str]) -> str | None:
    for node in ast.walk(detail):
        text = None
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            text = node.value
        elif isinstance(node, ast.Name) and node.id in constants:
            text = constants[node.id]
        if text and (match := BANNED_WORDS.search(text)):
            return f"{match.group(0)!r} in {text!r}"
    return None


class _Finder(ast.NodeVisitor):
    """Walks a module keeping the names bound by the `except ... as` clauses around each node."""

    def __init__(self, relative: str, constants: dict[str, str]):
        self.relative, self.constants, self.bound, self.found = relative, constants, [], {}

    def visit_ExceptHandler(self, node: ast.ExceptHandler):
        self.bound.append(node.name)
        self.generic_visit(node)
        self.bound.pop()

    def visit_Call(self, node: ast.Call):
        if _name(node.func) in ERROR_CALLS and (detail := _detail(node)) is not None:
            why = _from_exception(detail, {name for name in self.bound if name}) or _words(detail, self.constants)
            if why:
                self.found[f"{self.relative}:{node.lineno}"] = why
        self.generic_visit(node)


def _flagged() -> dict[str, str]:
    found = {}
    for path in sorted(BACKEND.rglob("*.py")):
        relative = path.relative_to(BACKEND).as_posix()
        if relative.startswith(("tests/", "migrations/")):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=relative)
        finder = _Finder(relative, _constants(tree))
        finder.visit(tree)
        found.update(finder.found)
    return found


def test_no_error_detail_is_an_exception_or_breaks_the_writing_rules():
    new = {where: why for where, why in _flagged().items() if where not in KNOWN and where not in USER_WORDS}
    assert not new, (
        f"error details against docs/02 §12 (rule 2: no exception text; §12.3 rule 4: no 'please', 'Oops' or '!'): "
        f"{new}. Send fixed words written for the user, and log what went wrong (ids, the exception's class; no "
        f"values). A BenchQ exception whose message is the user's sentence by design goes in USER_WORDS, with why.")


def test_every_listed_exception_still_exists():
    stale = sorted((set(KNOWN) | set(USER_WORDS)) - set(_flagged()))
    assert not stale, f"these are gone or moved; update KNOWN / USER_WORDS: {stale}"


def test_the_check_catches_planted_details(tmp_path, monkeypatch):
    """Measured, not assumed: each kind is found in a planted file, and fixed words are not."""
    import backend.tests.test_error_detail_lint as lint
    (tmp_path / "planted.py").write_text(
        "import traceback\n"
        "from fastapi import HTTPException\n"
        "from backend.problem import Problem, problem_response\n"
        "LOUD = 'Something broke!'\n"
        "def f():\n"
        "    try:\n"
        "        pass\n"
        "    except ValueError as e:\n"
        "        raise HTTPException(status_code=400, detail=str(e))\n"                       # 9
        "    except KeyError as exc:\n"
        "        raise Problem(500, f'Failed: {exc}', 'INTERNAL')\n"                          # 11
        "    except OSError as err:\n"
        "        return problem_response(502, detail=err.args[0])\n"                          # 13
        "    except TypeError as error:\n"
        "        raise HTTPException(409, f'{error.job_type} is running')\n"                  # 15
        "    except Exception:\n"
        "        raise HTTPException(500, traceback.format_exc())\n"                          # 17
        "    except LookupError as e:\n"
        "        raise HTTPException(500, 'Fixed words.') from e\n"                           # 19: fine
        "def g(value, e):\n"
        "    raise HTTPException(400, repr(value))\n"                                         # 21
        "def h(e):\n"
        "    raise HTTPException(400, f'Not bound by an except: {e}')\n"                      # 23: fine
        "def i():\n"
        "    raise HTTPException(429, detail='Please wait.')\n"                               # 25
        "    raise Problem(500, 'Oops, that failed.', 'INTERNAL')\n"                          # 26
        "    raise HTTPException(400, LOUD)\n"                                                # 27
        "    raise HTTPException(400, \"That résumé isn't a base. Pick another.\")\n",         # 28: fine
        encoding="utf-8")
    monkeypatch.setattr(lint, "BACKEND", tmp_path)
    assert set(lint._flagged()) == {f"planted.py:{line}" for line in (9, 11, 13, 15, 17, 21, 25, 26, 27)}
