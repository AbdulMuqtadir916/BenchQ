"""Server secrets come only from the environment (docs/team/uzair.md, step 6): no literal secret in the code.

Over every file in backend/, the tests included on purpose (a real key pasted into a test is as public as one in the
app). A name is secret-ish when it contains PASSWORD, SECRET, KEY, TOKEN or DATABASE_URL. Refused:
- `os.getenv(NAME, "literal")` (or `default="literal"`), `os.environ.get(NAME, "literal")`,
  `os.environ.setdefault(NAME, "literal")`, `os.getenv(NAME) or "literal"` and `os.environ[NAME] = "literal"`: a
  fallback that works when the variable is forgotten;
- `os.environ.update({NAME: "literal"})`, `os.environ.update(NAME="literal")`, `os.environ |= {NAME: "literal"}` and
  `os.putenv(NAME, "literal")`: the same, set;
- `NAME = "literal"`: an upper-case constant holding one. The constant rule reads KEY as a secret only with API, ENCRYPTION,
  SECRET, PRIVATE, FERNET, ACCESS or SIGNING before it (`LAYOUT_KEY` is a dictionary key), and skips names ending in
  NAME, URL or TYPE (they name or locate a secret; they don't hold one);
- any string literal that is a URL with a password in it (`scheme://user:password@host...`), whatever holds it: the
  `_URL` skip above doesn't cover it. Found as `file:<the URL>`; a failure message shows it with the password masked.
An empty literal is fine: it means "unset". What stays is NOT_SECRET, by name (for a URL, the exact URL) with the
reason.
"""
import ast
import pathlib
import re

BACKEND = pathlib.Path(__file__).resolve().parents[1]
SECRET_ENV = re.compile(r"PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL", re.IGNORECASE)
SECRET_CONSTANT = re.compile(r"^KEY$|(^|_)(PASSWORD|PASSWD|SECRET|TOKEN|DATABASE_URL|"
                             r"(API|ENCRYPTION|SECRET|PRIVATE|FERNET|ACCESS|SIGNING)_KEY)(_|$)")
DESCRIBES = re.compile(r"_(NAME|URL|TYPE)$")
# A URL whose authority holds `user:password@` (a non-empty password). Matched against the whole literal.
CREDENTIAL_URL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s/?#@:]*:(?P<password>[^\s/?#@]+)@\S*", re.IGNORECASE)

# "file:NAME" -> why the literal is not a secret. Delete an entry when its literal goes; the stale check fails until.
NOT_SECRET = {
    "scripts/seed_demo.py:DEMO_PASSWORD":
        "the published demo password (docs/03 §3.2), seeded in development only; in production no account on a "
        "testing domain signs in (backend/auth/invites.py)",
    "startup_checks.py:_DEFAULT_DB_PASSWORD": "the known-bad local default the check refuses in production",
    "scraper/sources/linkedin_personal.py:_LOGIN_PASSWORD": "a CSS selector for LinkedIn's password field",
    "match/work_auth.py:_SLASH_TOKEN": "a regular expression for a work-authorization word",
    "tests/conftest.py:TEST_DATABASE_URL":
        "the disposable test database (docker-compose db-test); conftest refuses a name not ending in _test",
    "tests/conftest.py:AI_SETTINGS_ENCRYPTION_KEY": "a fixed test-only Fernet key, never a real one",
    "tests/conftest.py:CANDIDATE_GMAIL_ENCRYPTION_KEY": "a synthetic test-only Fernet key, never a real one",
    "tests/auth_support.py:TEST_PASSWORD": "the test accounts' password, in the disposable test database",
    "tests/test_logging_canary.py:PASSWORD": "a planted canary value the log must never show",
    "tests/test_activity_sign_in_events.py:PASSWORD": "a test Super Admin's password, in the disposable test database",
    "tests/test_logging_canary.py:TOKEN": "a planted canary value the log must never show",
    "tests/test_production_config.py:DB_SECRET": "a planted value the start-up check's message must never show",
    # URLs with a password, by the exact URL.
    "tests/conftest.py:postgresql://jobnavigator:password@localhost:5433/jobnavigator_test":
        "the disposable test database's fallback (docker-compose db-test, its published port); conftest refuses a "
        "database name not ending in _test",
    "tests/test_production_config.py:postgresql://jobnavigator:password@db:5432/jobnavigator":
        "docker-compose's local development database: the DEV environment the check must pass",
    "tests/test_production_config.py:postgresql://benchq:password@db.planted-host:5432/benchq":
        "the local default password, planted so the production check refuses it",
}


def _literal(node) -> bool:
    return isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes)) and bool(node.value)


def _name_arg(node) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def _is_environ(node) -> bool:
    return (isinstance(node, ast.Attribute) and node.attr == "environ") or \
        (isinstance(node, ast.Name) and node.id == "environ")


def _call_arg(call: ast.Call, position: int, keyword: str):
    """The argument at `position`, or passed as `keyword=`; None when neither."""
    if len(call.args) > position:
        return call.args[position]
    return next((k.value for k in call.keywords if k.arg == keyword), None)


def _env_name(node) -> str | None:
    """The variable a `getenv(NAME)` / `environ.get(NAME)` / `environ[NAME]` read names, or None."""
    if isinstance(node, ast.Call) and _reads_env_with_default(node):
        name = _call_arg(node, 0, "key")
        return _name_arg(name) if name is not None else None
    if isinstance(node, ast.Subscript) and _is_environ(node.value):
        return _name_arg(node.slice)
    return None


def _dict_pairs(node: ast.Dict) -> list:
    return [(_name_arg(k), v) for k, v in zip(node.keys, node.values) if k is not None]


def _env_sets(node) -> list:
    """(name, value) for each variable `environ.update({...})`, `environ.update(NAME=...)`, `environ |= {...}` or
    `putenv(NAME, value)` sets."""
    pairs = []
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr == "update" and _is_environ(func.value):
            for arg in node.args:
                if isinstance(arg, ast.Dict):
                    pairs += _dict_pairs(arg)
            pairs += [(k.arg, k.value) for k in node.keywords if k.arg is not None]
        elif (isinstance(func, ast.Name) and func.id == "putenv") or \
                (isinstance(func, ast.Attribute) and func.attr == "putenv"):
            if len(node.args) >= 2:
                pairs.append((_name_arg(node.args[0]), node.args[1]))
    if isinstance(node, ast.AugAssign) and isinstance(node.op, ast.BitOr) and _is_environ(node.target) \
            and isinstance(node.value, ast.Dict):
        pairs += _dict_pairs(node.value)
    return pairs


def _reads_env_with_default(call: ast.Call) -> bool:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id == "getenv"
    if isinstance(func, ast.Attribute):
        if func.attr == "getenv":
            return True
        return func.attr in ("get", "setdefault") and _is_environ(func.value)
    return False


def findings(source: str, relative: str) -> set[str]:
    """`file:NAME` for every literal secret in `source`."""
    found = set()
    for node in ast.walk(ast.parse(source, filename=relative)):
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
            # `os.getenv(NAME) or "literal"`: the literal is the fallback.
            for i, value in enumerate(node.values[:-1]):
                name = _env_name(value)
                if name and SECRET_ENV.search(name) and any(_literal(v) for v in node.values[i + 1:]):
                    found.add(f"{relative}:{name}")
        if isinstance(node, ast.Call) and _reads_env_with_default(node):
            name, default = _env_name(node), _call_arg(node, 1, "default")
            if name and SECRET_ENV.search(name) and default is not None and _literal(default):
                found.add(f"{relative}:{name}")
        for name, value in _env_sets(node):
            if name and SECRET_ENV.search(name) and _literal(value):
                found.add(f"{relative}:{name}")
        if isinstance(node, ast.Constant) and isinstance(node.value, str) \
                and CREDENTIAL_URL.fullmatch(node.value.strip()):
            found.add(f"{relative}:{node.value.strip()}")
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None and _literal(node.value):
            for target in (node.targets if isinstance(node, ast.Assign) else [node.target]):
                if isinstance(target, ast.Subscript) and _is_environ(target.value):
                    name = _name_arg(target.slice)
                    if name and SECRET_ENV.search(name):
                        found.add(f"{relative}:{name}")
                elif isinstance(target, ast.Name) and target.id == target.id.upper() \
                        and SECRET_CONSTANT.search(target.id) and not DESCRIBES.search(target.id):
                    found.add(f"{relative}:{target.id}")
    return found


def _all_findings() -> set[str]:
    found = set()
    for path in sorted(BACKEND.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        relative = path.relative_to(BACKEND).as_posix()
        found |= findings(path.read_text(encoding="utf-8"), relative)
    return found


def _masked(finding: str) -> str:
    """A finding as a failure message shows it: a URL's password replaced, so a real one isn't printed again."""
    match = CREDENTIAL_URL.search(finding)
    if not match:
        return finding
    return finding[:match.start("password")] + "***" + finding[match.end("password"):]


def test_no_literal_secret_in_the_backend():
    unexpected = [_masked(f) for f in sorted(_all_findings() - set(NOT_SECRET))]
    assert not unexpected, (
        f"a literal secret: {unexpected}. Read it from the environment with no fallback (os.getenv(NAME, '')), and "
        "let backend/startup_checks.py refuse to start without it; or, if it is not a secret, add it to NOT_SECRET "
        "with why")


def test_the_allowlist_is_not_stale():
    stale = [_masked(f) for f in sorted(set(NOT_SECRET) - _all_findings())]
    assert not stale, f"these are no longer found; remove them from NOT_SECRET: {stale}"


def test_the_check_catches_planted_secrets():
    planted = '''
import os
from os import getenv, environ
A = os.getenv("STRIPE_SECRET", "sk_live_planted")
B = getenv("SERVICE_TOKEN", "tok-planted")
C = os.environ.get("DATABASE_URL", "postgresql://u:p@h/d")
os.environ.setdefault("OPENAI_API_KEY", "sk-planted")
E = os.getenv("SESSION_SECRET") or "planted-fallback"
os.environ["SIGNING_KEY"] = "planted"
environ["WEBHOOK_SECRET"] = "planted"
ADMIN_PASSWORD = "hunter2"
FERNET_KEY = b"planted"
API_TOKEN: str = "planted"
'''
    assert findings(planted, "x.py") == {f"x.py:{n}" for n in (
        "STRIPE_SECRET", "SERVICE_TOKEN", "DATABASE_URL", "OPENAI_API_KEY", "SESSION_SECRET", "SIGNING_KEY",
        "WEBHOOK_SECRET",
        "ADMIN_PASSWORD", "FERNET_KEY", "API_TOKEN",
        "postgresql://u:" + "p@h/d")}     # in two parts, so this file's own expectation isn't a credential URL


def test_the_check_catches_a_keyword_default():
    planted = '''
import os
from os import getenv
A = os.getenv("STRIPE_SECRET", default="sk_live_planted")
B = getenv(key="SERVICE_TOKEN", default="tok-planted")
C = os.environ.get("WEBHOOK_SECRET", default="planted")
D = os.environ.setdefault("OPENAI_API_KEY", default="sk-planted")
E = os.getenv("LOG_LEVEL", default="INFO")
F = os.getenv("SESSION_SECRET", default="")
'''
    assert findings(planted, "x.py") == {f"x.py:{n}" for n in (
        "STRIPE_SECRET", "SERVICE_TOKEN", "WEBHOOK_SECRET", "OPENAI_API_KEY")}


def test_the_check_catches_a_secret_set_in_bulk():
    planted = '''
import os
from os import environ, putenv
os.environ.update({"STRIPE_SECRET": "sk_live_planted", "LOG_LEVEL": "INFO", "SERVICE_TOKEN": ""})
os.environ.update(OPENAI_API_KEY="sk-planted", LOG_FORMAT="json")
environ.update({"WEBHOOK_SECRET": "planted"}, SIGNING_KEY="planted")
os.environ |= {"SESSION_SECRET": "planted"}
os.putenv("ADMIN_PASSWORD", "hunter2")
putenv("DB_TOKEN", "planted")
settings.update({"API_TOKEN": "not the environment"})
'''
    assert findings(planted, "x.py") == {f"x.py:{n}" for n in (
        "STRIPE_SECRET", "OPENAI_API_KEY", "WEBHOOK_SECRET", "SIGNING_KEY", "SESSION_SECRET", "ADMIN_PASSWORD",
        "DB_TOKEN")}


def test_the_check_catches_a_url_with_a_password_whatever_holds_it():
    planted = '''
DATABASE_URL = "postgresql://benchq:s3cr3t@db.internal:5432/benchq"
REDIS_URL = "redis://:hunter2@cache:6379/0"
mirror = {"url": "https://deploy:ghp_planted@github.example/acme/app.git"}
connect("  postgresql+psycopg://u:p%40ss@h/d  ")
'''
    assert findings(planted, "x.py") == {
        "x.py:postgresql://benchq:s3cr3t@db.internal:5432/benchq", "x.py:redis://:hunter2@cache:6379/0",
        "x.py:https://deploy:ghp_planted@github.example/acme/app.git", "x.py:postgresql+psycopg://u:p%40ss@h/d"}


def test_a_url_finding_is_shown_with_its_password_masked():
    assert _masked("x.py:postgresql://benchq:s3cr3t@db:5432/benchq") == "x.py:postgresql://benchq:***@db:5432/benchq"
    assert _masked("x.py:ADMIN_PASSWORD") == "x.py:ADMIN_PASSWORD"


def test_the_check_lets_the_safe_shapes_pass():
    safe = '''
import os
A = os.getenv("TELEGRAM_BOT_TOKEN", "")
B = os.getenv("SERVICE_TOKEN")
C = os.getenv("LOG_LEVEL", "INFO")
D = os.environ["DATABASE_URL"]
E = os.getenv("SESSION_SECRET") or ""
G = os.getenv("LOG_FORMAT") or "text"
SECRET_NAME = "AI_SETTINGS_ENCRYPTION_KEY"
TOKEN_URL = "https://oauth2.example/token"
LAYOUT_KEY = "layout"
EMPTY_PASSWORD = ""
token = "a local variable, not a constant"
H = os.getenv("SESSION_SECRET", default=None)
NO_PASSWORD_URL = "postgresql://benchq@db.internal/benchq"
EMPTY_PASSWORD_URL = "postgresql://benchq:@db.internal/benchq"
PORT_URL = "https://app.benchq.example:8443/path"
PATH_COLON = "https://app.benchq.example/a:b@c"
EMAIL = "mailto:someone@acme.example"
os.environ.update({"LOG_LEVEL": "INFO", "SERVICE_TOKEN": ""})
'''
    assert findings(safe, "x.py") == set()
