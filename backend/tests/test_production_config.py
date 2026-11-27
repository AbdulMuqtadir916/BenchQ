"""What production refuses to start with (backend/startup_checks.py; docs/team/uzair.md, step 6): one case per insecure
setting, each naming the variable and never its value; the development settings pass; the worker skips what only the
API uses; and every start calls the check."""
import pytest
from cryptography.fernet import Fernet

from backend import startup_checks
from backend.startup_checks import check_production_config

KEY = Fernet.generate_key().decode()
SITE = "https://app.benchq.example"
EXTENSION = "chrome-extension://" + "abcdefghijklmnopabcdefghijklmnop"
DB_SECRET = "s3cr3t-db-pass-91f2"

# A production environment that passes: what backend/.env.example's "Production: required" block asks for.
GOOD = {
    "DATABASE_URL": f"postgresql://benchq:{DB_SECRET}@db.internal:5432/benchq",
    "ALLOWED_ORIGINS": f"{SITE},{EXTENSION}",
    "PASSWORD_RESET_BASE_URL": SITE,
    "AI_SETTINGS_ENCRYPTION_KEY": KEY,
    "TRUSTED_PROXY_HOPS": "1",
}
GMAIL = {
    "CANDIDATE_GMAIL_ENABLED": "true",
    "CANDIDATE_GMAIL_CLIENT_ID": "client-id-7d1e.apps.example",
    "CANDIDATE_GMAIL_CLIENT_SECRET": "gmail-client-secret-4b2c",
    "CANDIDATE_GMAIL_REDIRECT_URI": f"{SITE}/api/oauth/google/callback",
    "CANDIDATE_GMAIL_ENCRYPTION_KEY": KEY,
}
DEV = {"BENCHQ_ENV": "development",
       "DATABASE_URL": "postgresql://jobnavigator:password@db:5432/jobnavigator"}   # what docker-compose sets


def _with(**changes):
    env = {**GOOD, **changes}
    return {k: v for k, v in env.items() if v is not None}


def test_a_good_production_environment_passes():
    assert check_production_config(GOOD, "api") == []
    assert check_production_config({**GOOD, **GMAIL}, "api") == []
    assert check_production_config({**GOOD, "BENCHQ_ENV": "production"}, "worker") == []


def test_the_development_settings_pass():
    assert check_production_config(DEV, "api") == []
    assert check_production_config(DEV, "worker") == []
    # Gmail on locally (http redirect, no client id) needs only a readable key, as before.
    assert check_production_config({**DEV, "CANDIDATE_GMAIL_ENABLED": "true",
                                    "CANDIDATE_GMAIL_ENCRYPTION_KEY": KEY}, "api") == []


# (the environment, the variable the problem names, the value that must not be in it)
INSECURE = [
    pytest.param(_with(DATABASE_URL=None), "DATABASE_URL", None, id="database url unset"),
    pytest.param(_with(DATABASE_URL="postgresql://benchq:password@db.planted-host:5432/benchq"), "DATABASE_URL",
                 "planted-host", id="database default password"),
    pytest.param(_with(ALLOWED_ORIGINS=None), "ALLOWED_ORIGINS", None, id="origins unset"),
    pytest.param(_with(ALLOWED_ORIGINS="*"), "ALLOWED_ORIGINS", None, id="origins wildcard"),
    pytest.param(_with(ALLOWED_ORIGINS=f"{SITE},null"), "ALLOWED_ORIGINS", SITE, id="origins null"),
    pytest.param(_with(ALLOWED_ORIGINS="http://app.benchq.example"), "ALLOWED_ORIGINS", "app.benchq.example",
                 id="origins http"),
    pytest.param(_with(ALLOWED_ORIGINS=f"{SITE}/"), "ALLOWED_ORIGINS", "app.benchq.example", id="origins slash"),
    pytest.param(_with(ALLOWED_ORIGINS=f"{SITE}/app"), "ALLOWED_ORIGINS", "app.benchq.example", id="origins path"),
    pytest.param(_with(ALLOWED_ORIGINS=f"{SITE}:443"), "ALLOWED_ORIGINS", "app.benchq.example", id="origins :443"),
    pytest.param(_with(ALLOWED_ORIGINS="chrome-extension://short"), "ALLOWED_ORIGINS", "short",
                 id="origins bad extension id"),
    pytest.param(_with(SESSION_COOKIE_SECURE="false"), "SESSION_COOKIE_SECURE", None, id="cookie not secure"),
    pytest.param(_with(TRUSTED_PROXY_HOPS="0"), "TRUSTED_PROXY_HOPS", None, id="no trusted proxy"),
    pytest.param(_with(TRUSTED_PROXY_HOPS="one"), "TRUSTED_PROXY_HOPS", "one", id="hops not a number"),
    pytest.param(_with(PASSWORD_RESET_BASE_URL=None), "PASSWORD_RESET_BASE_URL", None, id="reset url unset"),
    pytest.param(_with(PASSWORD_RESET_BASE_URL="http://app.benchq.example"), "PASSWORD_RESET_BASE_URL",
                 "app.benchq.example", id="reset url http"),
    pytest.param(_with(PASSWORD_RESET_BASE_URL="https://elsewhere.example"), "PASSWORD_RESET_BASE_URL",
                 "elsewhere.example", id="reset url other origin"),
    pytest.param(_with(AI_SETTINGS_ENCRYPTION_KEY=None), "AI_SETTINGS_ENCRYPTION_KEY", None, id="ai key unset"),
    pytest.param(_with(AI_SETTINGS_ENCRYPTION_KEY="not-a-fernet-key-5a9"), "AI_SETTINGS_ENCRYPTION_KEY",
                 "not-a-fernet-key-5a9", id="ai key invalid"),
    pytest.param(_with(BENCHQ_ENV="staging-7c"), "BENCHQ_ENV", "staging-7c", id="unknown environment"),
    pytest.param({**GOOD, **GMAIL, "CANDIDATE_GMAIL_CLIENT_ID": ""}, "CANDIDATE_GMAIL_CLIENT_ID", None,
                 id="gmail no client id"),
    pytest.param({**GOOD, **GMAIL, "CANDIDATE_GMAIL_CLIENT_SECRET": ""}, "CANDIDATE_GMAIL_CLIENT_SECRET", None,
                 id="gmail no client secret"),
    pytest.param({**GOOD, **GMAIL, "CANDIDATE_GMAIL_REDIRECT_URI": "http://app.benchq.example/cb"},
                 "CANDIDATE_GMAIL_REDIRECT_URI", "app.benchq.example", id="gmail redirect http"),
    pytest.param({**GOOD, **GMAIL, "CANDIDATE_GMAIL_REDIRECT_URI": "https://elsewhere.example/cb"},
                 "CANDIDATE_GMAIL_REDIRECT_URI", "elsewhere.example", id="gmail redirect other origin"),
    pytest.param({**GOOD, **GMAIL, "CANDIDATE_GMAIL_ENCRYPTION_KEY": "bad-gmail-key-77c1"},
                 "CANDIDATE_GMAIL_ENCRYPTION_KEY", "bad-gmail-key-77c1", id="gmail key invalid"),
]


@pytest.mark.parametrize("env, variable, value", INSECURE)
def test_each_insecure_setting_is_named_and_its_value_is_not(env, variable, value):
    problems = check_production_config(env, "api")
    assert problems, f"{variable} was accepted"
    assert any(p.startswith(variable) for p in problems), problems
    text = "\n".join(problems)
    for secret in filter(None, (value, DB_SECRET, KEY, GMAIL["CANDIDATE_GMAIL_CLIENT_SECRET"])):
        assert secret not in text, f"a value is in the message: {text}"


@pytest.mark.parametrize("url", ["postgresql://benchq@db.internal:5432/benchq",
                                 "postgresql://benchq:@db.internal/benchq"])
def test_production_refuses_no_database_password(url):
    """Password authentication only (Abdul, 2026-11-23): none, or an empty one, is refused, naming only the variable."""
    problems = check_production_config(_with(DATABASE_URL=url), "api")
    assert problems == ["DATABASE_URL has no database password"]
    assert "db.internal" not in " ".join(problems)


@pytest.mark.parametrize("encoded", ["%70assword", "pass%77ord", "%70%61%73%73%77%6F%72%64"])
def test_production_refuses_the_default_password_percent_encoded(encoded):
    """SQLAlchemy and libpq decode the URL's password, so `%70assword` is `password`: the check decodes it too."""
    problems = check_production_config(_with(DATABASE_URL=f"postgresql://benchq:{encoded}@db.internal/benchq"), "api")
    assert problems == ["DATABASE_URL uses the local default database password"]
    assert encoded not in " ".join(problems)


@pytest.mark.parametrize("query", ["?password=password", "?sslmode=require&password=%70assword"])
def test_production_refuses_the_default_password_as_a_query_parameter(query):
    url = f"postgresql://benchq@db.internal/benchq{query}"
    assert check_production_config(_with(DATABASE_URL=url), "api") == [
        "DATABASE_URL uses the local default database password"]


def test_a_percent_encoded_real_password_passes():
    real = DB_SECRET.replace("-", "%2D")
    assert check_production_config(_with(DATABASE_URL=f"postgresql://benchq:{real}@db.internal/benchq"), "api") == []
    assert check_production_config(_with(DATABASE_URL=f"postgresql://benchq@db.internal/b?password={real}"), "api") \
        == []


def test_development_keeps_the_compose_database_url():
    assert check_production_config(DEV, "worker") == []


def test_empty_values_count_as_unset():
    assert check_production_config(_with(BENCHQ_ENV="", SESSION_COOKIE_SECURE=""), "api") == []
    assert any(p.startswith("ALLOWED_ORIGINS") for p in check_production_config(_with(ALLOWED_ORIGINS=""), "api"))


@pytest.mark.parametrize("raw", [None, "", "   ", "\t", "true", " TRUE "])
def test_a_blank_session_cookie_secure_is_secure_in_production_in_config_and_the_check(raw):
    """Whitespace is unset in both readers: the cookie is Secure (backend/config.py) and the check passes."""
    from backend import config
    assert config.session_cookie_secure(raw, is_production=True) is True
    assert check_production_config(_with(SESSION_COOKIE_SECURE=raw), "api") == []


@pytest.mark.parametrize("raw, secure", [(None, False), ("   ", False), ("true", True), ("false", False)])
def test_session_cookie_secure_in_development(raw, secure):
    from backend import config
    assert config.session_cookie_secure(raw, is_production=False) is secure


@pytest.mark.parametrize("origin", [f"{SITE}:00081", f"{SITE}:081", f"{SITE}:0", f"{SITE}:00000", f"{SITE}:65536",
                                    f"{SITE}:99999", f"{SITE}:0443"])
def test_an_origin_port_a_browser_never_sends_is_refused(origin):
    """A browser sends `:81`, never `:00081`; port 0 and ports past 65535 don't exist."""
    assert not startup_checks.valid_origin(origin)
    problems = check_production_config(_with(ALLOWED_ORIGINS=origin), "api")
    assert any(p.startswith("ALLOWED_ORIGINS") for p in problems), problems


@pytest.mark.parametrize("port", ["1", "81", "8443", "65535"])
def test_an_origin_with_a_real_port_passes(port):
    assert startup_checks.valid_origin(f"{SITE}:{port}")


MALFORMED = "https://["


@pytest.mark.parametrize("changes, problem", [
    ({"PASSWORD_RESET_BASE_URL": MALFORMED}, "PASSWORD_RESET_BASE_URL is not a valid URL"),
    ({**GMAIL, "CANDIDATE_GMAIL_REDIRECT_URI": f"{MALFORMED}/cb"}, "CANDIDATE_GMAIL_REDIRECT_URI is not a valid URL"),
    ({"DATABASE_URL": f"postgresql://benchq:{DB_SECRET}@[db/benchq"}, "DATABASE_URL is not a valid URL"),
])
def test_a_url_that_does_not_parse_is_named_not_a_traceback(changes, problem):
    problems = check_production_config({**GOOD, **changes}, "api")
    assert problem in problems
    assert "[" not in " ".join(problems) and DB_SECRET not in " ".join(problems)


def test_the_cli_names_a_url_that_does_not_parse(monkeypatch, capsys):
    from backend.scripts import check_config
    for name, value in {**GOOD, "BENCHQ_ENV": "production", "CANDIDATE_GMAIL_ENABLED": "false",
                        "PASSWORD_RESET_BASE_URL": MALFORMED}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("SESSION_COOKIE_SECURE", raising=False)
    assert check_config.main(["--role", "api"]) == 1
    err = capsys.readouterr().err
    assert "PASSWORD_RESET_BASE_URL is not a valid URL" in err
    assert MALFORMED not in err and "Traceback" not in err


def test_the_worker_skips_what_only_the_api_uses():
    api_only = _with(ALLOWED_ORIGINS=None, SESSION_COOKIE_SECURE="false", TRUSTED_PROXY_HOPS="0",
                     PASSWORD_RESET_BASE_URL=None)
    assert check_production_config(api_only, "worker") == []
    assert len(check_production_config(api_only, "api")) == 4
    # What every process needs, the worker too.
    assert any(p.startswith("AI_SETTINGS_ENCRYPTION_KEY")
               for p in check_production_config(_with(AI_SETTINGS_ENCRYPTION_KEY=None), "worker"))
    assert any(p.startswith("CANDIDATE_GMAIL_CLIENT_ID")
               for p in check_production_config({**GOOD, **GMAIL, "CANDIDATE_GMAIL_CLIENT_ID": ""}, "worker"))


def test_development_still_refuses_what_nothing_can_run_with():
    assert any(p.startswith("DATABASE_URL") for p in check_production_config({"BENCHQ_ENV": "development"}, "api"))
    assert any(p.startswith("CANDIDATE_GMAIL_ENCRYPTION_KEY") for p in check_production_config(
        {**DEV, "CANDIDATE_GMAIL_ENABLED": "true", "CANDIDATE_GMAIL_ENCRYPTION_KEY": "bad"}, "worker"))


def test_the_check_is_pure():
    """No database, no module reload: the mapping it is given is all it reads, and it raises nothing for a problem."""
    env = dict(GOOD)
    check_production_config(env, "api")
    assert env == GOOD
    with pytest.raises(ValueError):
        check_production_config(GOOD, "browser")


def test_require_config_raises_one_error_listing_the_names():
    with pytest.raises(RuntimeError) as refused:
        startup_checks.require_config("api", env=_with(ALLOWED_ORIGINS=None, AI_SETTINGS_ENCRYPTION_KEY="xyz-bad-key"))
    message = str(refused.value)
    assert "ALLOWED_ORIGINS" in message and "AI_SETTINGS_ENCRYPTION_KEY" in message
    assert "xyz-bad-key" not in message and DB_SECRET not in message
    startup_checks.require_config("api", env=GOOD)


# ── Every start calls it ─────────────────────────────────────────────────────

@pytest.fixture
def refusing(monkeypatch):
    calls = []

    def check(env, role):
        calls.append(role)
        return ["ALLOWED_ORIGINS is not set"]

    monkeypatch.setattr(startup_checks, "check_production_config", check)
    return calls


@pytest.mark.asyncio
async def test_the_api_lifespan_calls_it_first(refusing, monkeypatch):
    import backend.main as main_mod
    reached = []
    monkeypatch.setattr(main_mod, "check_schema_at_head", lambda: reached.append("schema"))
    with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
        async with main_mod.lifespan(main_mod.app):
            pass
    assert refusing == ["api"] and reached == []


def test_the_worker_start_calls_it_first(refusing, monkeypatch):
    import backend.db_schema as db_schema
    from backend import worker
    reached = []
    monkeypatch.setattr(db_schema, "check_schema_at_head", lambda: reached.append("schema"))
    with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
        worker.start()
    assert refusing == ["worker"] and reached == []


def test_the_migration_calls_it_first(refusing, monkeypatch):
    from backend.scripts import db_upgrade
    reached = []
    monkeypatch.setattr(db_upgrade, "upgrade_database", lambda: reached.append("migrated"))
    with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
        db_upgrade.main()
    assert refusing == ["worker"] and reached == []


@pytest.mark.parametrize("role", ["api", "worker"])
def test_the_cli_exits_1_with_the_names(refusing, role, capsys):
    from backend.scripts import check_config
    assert check_config.main(["--role", role]) == 1
    assert "ALLOWED_ORIGINS" in capsys.readouterr().err
    assert refusing == [role]


def test_the_cli_passes_a_good_environment_and_never_opens_the_database(monkeypatch):
    import backend.models.db as db_mod
    from backend.scripts import check_config

    def no_database(*_args, **_kwargs):
        raise AssertionError("the CLI opened the database")

    monkeypatch.setattr(db_mod, "SessionLocal", no_database)
    monkeypatch.setattr(db_mod.engine, "connect", no_database)
    assert check_config.main(["--role", "api"]) == 0          # the test run's own (development) environment


def test_the_start_scripts_check_before_they_migrate():
    import pathlib
    scripts = pathlib.Path(startup_checks.__file__).resolve().parent / "scripts"
    for name, role in (("start.sh", "api"), ("start_worker.sh", "worker")):
        text = scripts.joinpath(name).read_text(encoding="utf-8")
        check = text.index(f"python -m backend.scripts.check_config --role {role}")
        assert check < text.index("python -m backend.scripts.db_upgrade"), name


# ── The scripts that write to the database check first too ───────────────────

SCRIPTS = [
    ("create_platform_admin", ["--email", "a@b.example", "--name", "A", "--password-stdin"]),
    ("reset_password", ["--email", "a@b.example", "--password-stdin"]),
    ("seed_demo", []),
    ("backfill_location", []),
    ("backfill_work_arrangement", []),
    ("move_local_jobs_to_postings", ["--dry-run"]),
    ("backfill_external_id", None),                    # reads sys.argv
]


@pytest.mark.parametrize("name, argv", SCRIPTS)
def test_each_database_script_checks_the_settings_first(refusing, name, argv, monkeypatch):
    import importlib
    import sys
    import backend.models.db as db_mod

    def no_database(*_args, **_kwargs):
        raise AssertionError(f"{name} opened the database before the check")

    monkeypatch.setattr(db_mod, "SessionLocal", no_database)
    module = importlib.import_module(f"backend.scripts.{name}")
    monkeypatch.setattr(module, "SessionLocal", no_database, raising=False)
    monkeypatch.setattr(module, "create_engine", no_database, raising=False)
    with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
        if argv is None:
            monkeypatch.setattr(sys, "argv", [name, "--dry-run"])
            module.main()
        else:
            module.main(argv)
    assert refusing == ["worker"]


@pytest.mark.parametrize("benchq_env", ["production", "prod", "staging"])
def test_the_demo_seed_runs_in_development_only(benchq_env, monkeypatch, capsys):
    """By name: a typo is not development. (require_config refuses an unknown BENCHQ_ENV anyway; this is the seed's
    own guard.)"""
    from backend.scripts import seed_demo
    monkeypatch.setattr(startup_checks, "require_config", lambda role: None)
    monkeypatch.setattr(seed_demo, "IS_PRODUCTION", benchq_env == "production")
    monkeypatch.setattr(seed_demo, "BENCHQ_ENV", benchq_env)
    assert seed_demo.main([]) == 1
    assert "isn't development" in capsys.readouterr().err
