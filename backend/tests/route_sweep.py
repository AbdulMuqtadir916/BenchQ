"""Sends a request to every route with planted values everywhere it can put them, for test_log_every_route.py.

Three parts, all generic, so a new route or table is covered without anyone listing it:

  seed       one row in every table (FastAPI's models, in dependency order), in the signed-in firm. In the tables
             that hold people (test_log_lint.PEOPLE_MODELS), every text column that isn't an id, a status or the like
             holds a planted value; elsewhere a neutral one, so a job's title or a company's name logged as such
             isn't mistaken for a leak
  request    built from the route's own OpenAPI description: path ids point at the seeded rows, every string in the
             body, the query and the form holds a planted value (a URL, a company or a job title a neutral one), and
             a file field gets a PDF of a planted résumé
  outside    the AI (every `call_*llm`) answers with planted values; an HTTP call to Google or an AI provider
             (test_log_lint.PERSONAL_HOSTS) gets a planted reply, any other host a neutral empty one; the browser
             is off. No request leaves the test.
"""
import json
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import text as sql

from backend.tests.test_log_lint import PEOPLE_MODELS, PERSONAL_HOSTS, _safe_attr
from backend.tests.test_logging_canary import EMAIL, NAME, PASSWORD, PHONE, RESUME, TOKEN

PLANTED = f"{NAME}, {RESUME}"
# Request fields that hold a job posting or a company, not a person: neutral, as a job board's reply is.
NEUTRAL_FIELDS = re.compile(r"(^|_)(url|urls|link|href|domain|company|companies|title|job|jobs|keywords?|"
                            r"search_term|location|locations|provider|model|source|sources|board|ats|slug|timezone|"
                            r"currency|lang|language|format|sort|order|kind|type|view|tab)($|_)")
# Rules across columns that the seed can't read from a CHECK constraint, by table: the values that meet them.
LATER = datetime(2099, 1, 1, tzinfo=timezone.utc)
SEED_BATCH = uuid.UUID("00000000-0000-4000-8000-000000000020")   # the seeded scrape_jobs batch, named by job_postings
SEED_OVERRIDES = {
    "invites": {"invited_by_platform_user_id": None, "token_hash": "0" * 64, "email": "zorvath.invite@canary-mail.test",
                "manager_id": None, "expires_at": LATER},
    "firm_jobs": {"origin": "CAPTURED"},
    # An email is classified only when it came through its mailbox: the same address on both.
    "candidate_mailboxes": {"address": "zorvath.quillane@canary-mail.test", "refresh_token_ciphertext": b"sealed"},
    "inbox_messages": {"source_address": "zorvath.quillane@canary-mail.test"},
    "notifications": {"platform_user_id": None},
    "password_reset_requests": {"is_platform_approval": False, "approver_role": "OWNER", "decided_by_user_id": None,
                                "decided_by_platform_user_id": None, "decided_at": None, "reset_token_hash": None,
                                "reset_token_expires_at": None, "expires_at": LATER},
    "resume_parses": {"expires_at": None},
    # 07 Q57: a candidate's name lives in its active base's newest version, so the seeded base is that one.
    "base_resumes": {"is_active": True, "deleted_at": None, "archived_at": None},
    "resumes": {"category": "BASE", "job_id": None, "deleted_at": None},
    "support_views": {"ended_at": None},
    # A billing period is 30 days (ck_firm_billing_periods_30_days); the seed's amount is 1 x 1. It ended long ago, so the
    # sweep's "start the next period" (which starts today) comes after it.
    "firm_billing_periods": {"starts_on": date.today() - timedelta(days=100), "ends_on": date.today() - timedelta(days=70),
                             "status": "UNPAID"},
    # error only on an error row, finished_at on every row but a running one; the seed's is 'success'
    "scrape_jobs": {"error": None, "batch_id": SEED_BATCH, "finished_at": datetime.now(timezone.utc)},
    # job_id is a SHA256 hex digest (ck_job_postings_job_id_sha256), and batch_id references scrape_jobs.batch_id,
    # not its id, so the seeded posting names the seeded batch.
    "job_postings": {"job_id": "0" * 64, "batch_id": SEED_BATCH},
}
# Path and body ids by name, when the name isn't `<table, singular>_id`.
ID_ALIASES = {"app": "applications", "cl": "cover_letters", "base": "base_resumes", "message": "inbox_messages",
              "attempt": "candidate_google_oauth_attempts", "interview": "interviews", "manager": "users",
              "bde": "users", "user": "users", "owner": "users", "firm": "firms", "plan": "plans",
              "resume": "resumes", "base_resume": "base_resumes", "notification": "notifications", "run": "job_runs",
              "review": "application_reviews", "posting": "job_postings", "period": "firm_billing_periods"}
JOB_URL = "https://jobs.example.test/posting/1"
# Values the routes check in code, not in their schema, by field name.
FIELD_VALUES = {"role": "MANAGER", "public_url": "https://benchq.example.test", "provider": "openrouter",
                "country": "United States", "tiers": ["1"], "slug": "zorvath-firm", "template": "traditional"}


# ── Seed ──────────────────────────────────────────────────────────────────

def _check_values(db) -> dict[tuple[str, str], list[str]]:
    """(table, column) -> the values a CHECK constraint allows (`status IN ('A', 'B')`)."""
    allowed = {}
    rows = db.execute(sql("SELECT conrelid::regclass::text, pg_get_constraintdef(oid) FROM pg_constraint "
                          "WHERE contype = 'c'")).all()
    for table, definition in rows:
        match = re.search(r"\(?\(?(\w+)\)?(?:::[\w ]+)?\s*=\s*ANY\s*\(\(?ARRAY\[(.*?)\]", definition) or \
            re.search(r"\(?(\w+)\)?\s+<@\s+ARRAY\[(.*?)\]", definition) or \
            re.fullmatch(r"CHECK \(\(\((\w+)\)::text = ('[^']*')::text\)\)", definition)
        if match:
            allowed[(table.strip('"'), match.group(1))] = re.findall(r"'([^']*)'", match.group(2))
    return allowed


def _people_tables() -> set[str]:
    from backend.models.db import Base
    return {m.class_.__tablename__ for m in Base.registry.mappers if m.class_.__name__ in PEOPLE_MODELS}


def _value(table, column, ids, allowed, people):
    """A value for one column, or `...` to leave it to its default."""
    from sqlalchemy import ARRAY, JSON, Boolean, Date, DateTime, Enum, Float, Integer, LargeBinary, Numeric, String
    from sqlalchemy.dialects.postgresql import JSONB, UUID
    from sqlalchemy.types import Uuid

    name, kind = column.name, column.type
    if column.foreign_keys:
        # The key to the row's own id (`candidates.id`), not one shared with another column (`(base_resume_id,
        # candidate_id) -> base_resumes`); a set has no order, so pick it, or the seed changes from run to run.
        key = min(column.foreign_keys, key=lambda f: (not f.column.primary_key, len(f.constraint.elements),
                                                       f.column.table.name))
        target = key.column.table.name
        return ids.get(target, None if column.nullable else ...)
    if column.primary_key and (column.default is not None or column.server_default is not None
                               or column.autoincrement is True):
        return ...
    if (table.name, name) in allowed:
        first = allowed[(table.name, name)][0]
        return [first] if isinstance(kind, ARRAY) else first
    if isinstance(kind, Enum):
        return kind.enums[0]
    personal = table.name in people and not _safe_attr(name)
    if isinstance(kind, String):
        if re.search(r"(^|_)(url|link)$", name):
            value = JOB_URL
        elif not personal:
            value = f"{table.name[:12]}-{name}"[:kind.length or 64]
        elif "email" in name:
            value = f"zorvath.quillane+{table.name}@canary-mail.test"
        elif "phone" in name:
            value = PHONE
        else:
            value = PLANTED
        return value[:kind.length] if kind.length else value
    if isinstance(kind, Boolean):
        return False
    if isinstance(kind, (Integer, Float, Numeric)):
        return ... if column.autoincrement is True else 1
    if isinstance(kind, (DateTime, Date)) and column.nullable:
        return None                                           # archived_at, revoked_at: set, they change the state
    if isinstance(kind, DateTime):
        return datetime.now(timezone.utc)
    if isinstance(kind, Date):
        return date.today()
    if isinstance(kind, (UUID, Uuid)):
        return uuid.uuid4()
    if isinstance(kind, (JSON, JSONB)):
        return None if column.nullable else {}                # structured (a résumé's content): its shape is the app's
    if isinstance(kind, ARRAY):
        return [PLANTED] if personal and isinstance(kind.item_type, String) else []
    if isinstance(kind, LargeBinary):
        return b""
    return ...


def seed_every_table(db, accounts) -> tuple[dict[str, uuid.UUID], dict[str, str]]:
    """One row per table, in the signed-in firm. Returns (table -> its row's id, table -> why it couldn't be seeded).
    Adds a MANAGER and a BDE (people too: planted names), since routes need them."""
    from backend.models.db import Base, Setting
    from backend.models.tenancy import Firm
    from backend.seed import DEFAULT_SETTINGS
    from backend.tests.auth_support import make_user

    firm = db.get(Firm, accounts.firm_id)
    manager = make_user(db, firm, email="zorvath.manager@canary-mail.test", role="MANAGER", name=NAME + " Manager")
    bde = make_user(db, firm, email="zorvath.bde@canary-mail.test", role="BDE", name=NAME + " Bde")
    bde.manager_id = manager.id
    # The app's settings as run_seeds() writes them (the api_client fixture skips it), with the keys filled in.
    for key, (value, *_rest) in DEFAULT_SETTINGS.items():
        db.add(Setting(key=key, value="test-key" if key.endswith("api_key") and not value else value))
    db.commit()
    ids = {"plans": accounts.plan_id, "firms": accounts.firm_id, "users": accounts.user_id,
           "platform_users": accounts.admin_id, "_manager": manager.id, "_bde": bde.id, "_slug": firm.slug}
    allowed, people, failed = _check_values(db), _people_tables(), {}
    for table in Base.metadata.sorted_tables:
        if table.name in ids or table.name in {"sessions", "alembic_version"}:
            continue
        values = {}
        for column in table.columns:
            if column.name == "firm_id" and not column.foreign_keys:
                values["firm_id"] = accounts.firm_id
                continue
            value = _value(table, column, ids, allowed, people)
            if value is ...:
                if not column.nullable and column.default is None and column.server_default is None \
                        and not column.primary_key:
                    failed[table.name] = f"no value for {column.name} ({column.type})"
                continue
            values[column.name] = value
        values.update(SEED_OVERRIDES.get(table.name, {}))
        if "started_at" in values and table.name == "support_views":   # it expires an hour after it starts
            values["expires_at"] = values["started_at"] + timedelta(hours=1)
        if table.name in failed:
            continue
        pk = list(table.primary_key.columns)
        try:
            with db.begin_nested():
                row = db.execute(table.insert().values(**values).returning(*pk)).first()
            if len(pk) == 1:
                ids[table.name] = row[0]
        except Exception as e:                                 # a constraint the generic row doesn't meet
            failed[table.name] = str(getattr(e, "orig", e)).splitlines()[0][:160]
    db.commit()
    return ids, failed


# ── Requests ──────────────────────────────────────────────────────────────

def _id_for(name: str, ids: dict) -> object:
    stem = name[:-3] if name.endswith("_id") else name[:-4] if name.endswith("_ids") else name
    if stem in {"manager", "bde"}:
        return ids["_" + stem]
    table = ID_ALIASES.get(stem)
    candidates = [table] if table else [stem + "s", stem + "es", stem[:-1] + "ies", stem]
    for t in candidates:
        if t in ids:
            return ids[t]
    for t in ids:                                             # `job_id` -> jobs, `company_id` -> companies
        if t.startswith(stem) or t.replace("_", "").startswith(stem.replace("_", "")):
            return ids[t]
    return uuid.uuid4()


def _resolve(schema: dict, spec: dict) -> dict:
    while "$ref" in schema:
        schema = spec["components"]["schemas"][schema["$ref"].rsplit("/", 1)[1]]
    return schema


def _string(name: str, schema: dict, ids: dict) -> object:
    fmt = schema.get("format", "")
    if fmt == "uuid" or name.endswith("_id"):
        return str(_id_for(name, ids))
    if fmt == "email" or "email" in name:
        return EMAIL
    if fmt in {"date-time", "date"}:
        return datetime.now(timezone.utc).isoformat() if fmt == "date-time" else date.today().isoformat()
    if fmt in {"uri", "url"}:
        return "https://jobs.example.test/posting/1"
    if "phone" in name:
        return PHONE
    if "password" in name:
        return PASSWORD
    if "token" in name:
        return TOKEN
    if NEUTRAL_FIELDS.search(name) or _safe_attr(name):
        value = "https://jobs.example.test/posting/1" if re.search(r"url|link|href", name) else f"{name} sample"
    else:
        value = PLANTED
    lo, hi = schema.get("minLength", 0), schema.get("maxLength")
    value = value.ljust(lo, "x")
    return value[:hi] if hi else value


def example(schema: dict, spec: dict, ids: dict, name: str = "", depth: int = 0, owner: str = "") -> object:
    """A value for a JSON schema, with planted values in its strings. `owner` is the model the field is on."""
    schema = _resolve(schema, spec)
    if depth > 6:
        return None
    if name in FIELD_VALUES:
        return FIELD_VALUES[name]
    if name == "name" and re.search(r"compan|job", owner, re.I):   # a company's or a posting's name, not a person's
        return "Acme Robotics"
    if isinstance(schema.get("default"), str) and schema["default"]:
        return schema["default"]                              # template="classic", status="saved": a code value
    pattern = re.fullmatch(r"\^\(([^)]*)\)\$", schema.get("pattern", ""))
    if pattern:
        return pattern.group(1).split("|")[0]                 # sort_by: ^(date|score|salary|company)$
    for key in ("anyOf", "oneOf"):
        if key in schema:
            options = [o for o in schema[key] if _resolve(o, spec).get("type") != "null"]
            return example(options[0], spec, ids, name, depth + 1) if options else None
    if "allOf" in schema:
        return example(schema["allOf"][0], spec, ids, name, depth + 1)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    kind = schema.get("type")
    if kind == "object" or "properties" in schema:
        props = schema.get("properties", {})
        out = {k: example(v, spec, ids, k, depth + 1, owner + schema.get("title", "")) for k, v in props.items()}
        if not props and schema.get("additionalProperties"):
            out = {"note": example(schema["additionalProperties"], spec, ids, "note", depth + 1)}
        return out
    if kind == "array":
        item = example(schema.get("items", {}), spec, ids, name.rstrip("s"), depth + 1)
        return [item] * max(1, schema.get("minItems", 1))
    if kind == "string":
        return _string(name, schema, ids)
    if kind == "integer" and name.endswith("_id"):
        return _id_for(name, ids)
    if kind == "integer":
        return max(1, schema.get("minimum", 1)) if schema.get("maximum", 2) >= 1 else schema.get("maximum")
    if kind == "number":
        return float(schema.get("minimum", 1))
    if kind == "boolean":
        return True
    return PLANTED


def _keys_read_by(app, method: str, path: str, ids: dict) -> dict:
    """A body for a route whose schema names no fields (`body: dict`, `await request.json()`): the keys its code reads
    (`body.get("name")`, `data["question"]`), each with a value by its name."""
    import ast
    import inspect
    import textwrap

    from fastapi.routing import APIRoute

    route = next((r for r in app.router.routes if isinstance(r, APIRoute) and r.path == path and method in r.methods),
                 None)
    if route is None:
        return {}
    try:
        tree = ast.parse(textwrap.dedent(inspect.getsource(route.endpoint)))
    except (OSError, TypeError):
        return {}
    module = sys.modules.get(route.endpoint.__module__)
    trees = [tree]
    for call in [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]:
        helper = getattr(module, call.func.id, None)         # a helper in the same file it hands the body to
        if inspect.isfunction(helper) and helper.__module__ == route.endpoint.__module__:
            try:
                trees.append(ast.parse(textwrap.dedent(inspect.getsource(helper))))
            except (OSError, TypeError):
                pass
    keys = []
    for node in (n for t in trees for n in ast.walk(t)):
        key = None
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in {"get", "pop"} \
                and node.args and isinstance(node.args[0], ast.Constant):
            key = node.args[0].value
        elif isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
            key = node.slice.value
        if isinstance(key, str) and key not in keys:
            keys.append(key)
    out = {}
    for key in keys:
        out[key] = example({"type": "integer" if _safe_attr(key) and not key.endswith(("_id", "status")) else "string"},
                           {}, ids, key, owner=path) if not key.endswith("ids") else [str(_id_for(
            key if key != "ids" else path.split("/")[2].rstrip("s") + "_id", ids))]   # ids: the route's own rows
    return out


def build_request(app, method: str, path: str, ids: dict) -> dict:
    """The keyword arguments for TestClient.request: url, json, data, files, params."""
    from backend.tests.test_resume_parse import _pdf

    spec = app.openapi()
    op = spec["paths"].get(path, {}).get(method.lower(), {})
    url = path
    params = {}
    for p in op.get("parameters", []):
        schema = _resolve(p.get("schema", {}), spec)
        if p["in"] == "path":
            value = ids["_slug"] if p["name"] == "slug" else example(schema, spec, ids, p["name"])
            url = url.replace("{" + p["name"] + "}", str(value))
        elif p["in"] == "query":
            params[p["name"]] = example(schema, spec, ids, p["name"])
    out = {"method": method, "url": url, "params": params}
    content = op.get("requestBody", {}).get("content", {})
    body = _resolve(content.get("application/json", {}).get("schema", {}), spec)
    if "application/json" in content and body.get("properties"):
        out["json"] = example(body, spec, ids, owner=body.get("title", "") + path)
    elif "multipart/form-data" not in content and method in {"POST", "PUT", "PATCH"}:
        out["json"] = _keys_read_by(app, method, path, ids)    # `body: dict`, or `await request.json()`
    elif "multipart/form-data" in content or "application/x-www-form-urlencoded" in content:
        form = _resolve((content.get("multipart/form-data") or content["application/x-www-form-urlencoded"])["schema"],
                        spec)
        files, data = {}, {}
        for k, v in form.get("properties", {}).items():
            v = _resolve(v, spec)
            v = next((_resolve(o, spec) for o in v.get("anyOf", []) if o.get("type") != "null"), v)  # Optional[File]
            items = _resolve(v.get("items", {}), spec) if v.get("type") == "array" else v
            if items.get("format") == "binary" or items.get("contentMediaType") == "application/octet-stream":
                files[k] = (f"{NAME}.pdf", _pdf(f"{NAME}\n{EMAIL} | {PHONE}\n{RESUME}"), "application/pdf")
            else:
                data[k] = example(v, spec, ids, k)
        out["files"], out["data"] = files or None, data or None
    return out


# ── Outside services ──────────────────────────────────────────────────────

AI_REPLY = json.dumps({"header": {"name": NAME, "email": EMAIL, "phone": PHONE}, "professional_summary": RESUME,
                       "name": NAME, "summary": RESUME, "answer": f"{NAME} {RESUME}", "text": RESUME,
                       "cover_letter": f"Dear team, I am {NAME}. {RESUME}", "status": "INTERVIEW", "confidence": 0.9,
                       "scores": {"base": 70}, "best_cv": NAME, "reason": f"{NAME} {RESUME}"})


def _ai_reply(*args, **kwargs):
    return {"text": AI_REPLY, "usage": {"input_tokens": 1, "output_tokens": 1},
            "provider": kwargs.get("provider") or "openrouter", "model": kwargs.get("model") or "stub"}


async def _ai(*args, **kwargs):
    return _ai_reply(*args, **kwargs)


async def _ai_stream(*args, **kwargs):
    for chunk in (NAME, " ", RESUME):
        yield chunk


def _http_reply(request: httpx.Request) -> httpx.Response:
    if any(host in str(request.url) for host in PERSONAL_HOSTS):
        body = {"name": NAME, "email": EMAIL, "error": f"invalid grant for {EMAIL}", "messages": [],
                "snippet": RESUME, "choices": [{"message": {"content": AI_REPLY}}],
                "content": [{"type": "text", "text": AI_REPLY}], "usage": {}}
        return httpx.Response(200, json=body, request=request)
    return httpx.Response(200, json={}, request=request)


def stub_outside(monkeypatch):
    """The AI, HTTP and the browser, replaced for the test (monkeypatch undoes it)."""
    from backend.analyzer import llm_client

    originals = {}
    for attr in dir(llm_client):
        if attr.startswith("call_") and "llm" in attr or attr == "_dispatch":
            originals[id(getattr(llm_client, attr))] = _ai_stream if attr.endswith("_stream") else _ai
    for module in [m for name, m in sys.modules.items() if name.startswith("backend.") and m is not None]:
        for attr, value in list(vars(module).items()):
            if callable(value) and id(value) in originals:   # `from llm_client import call_llm` bound it here
                monkeypatch.setattr(module, attr, originals[id(value)])

    async def async_send(self, request, *args, **kwargs):
        return _http_reply(request)

    def send(self, request, *args, **kwargs):
        if type(self).__name__ == "TestClient" or "testserver" in str(request.url):
            return original_send(self, request, *args, **kwargs)
        return _http_reply(request)

    original_send = httpx.Client.send
    monkeypatch.setattr(httpx.AsyncClient, "send", async_send)
    monkeypatch.setattr(httpx.Client, "send", send)

    import requests

    def requests_send(self, prepared, **kwargs):
        reply = _http_reply(httpx.Request(prepared.method, prepared.url))
        out = requests.Response()
        out.status_code, out._content, out.url = reply.status_code, reply.content, prepared.url
        out.headers["content-type"] = "application/json"
        return out

    monkeypatch.setattr(requests.Session, "send", requests_send)

    import socket
    real_getaddrinfo = socket.getaddrinfo

    def getaddrinfo(host, *args, **kwargs):                   # the SSRF guard resolves a URL's host first
        if isinstance(host, str) and host.endswith(".example.test"):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.215.14", 443))]
        return real_getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)

    def no_browser(*args, **kwargs):
        raise RuntimeError("the browser is off in this test")

    # Features that stay off until approved (candidate email classification) are on here, so their path is checked.
    from backend import config
    for flag in ("CANDIDATE_EMAIL_CLASSIFICATION_ENABLED", "CANDIDATE_EMAIL_REAL_MAIL_APPROVED"):
        monkeypatch.setattr(config, flag, True)

    import playwright.async_api
    monkeypatch.setattr(playwright.async_api, "async_playwright", no_browser)
    for name, module in list(sys.modules.items()):
        if name.startswith("backend.") and module is not None and hasattr(module, "async_playwright"):
            monkeypatch.setattr(module, "async_playwright", no_browser)
