"""The Super Admin's AI setup (docs/integration/08-ai-presets.md): one encrypted key, approved models, presets, limits,
test runs, the upload limit and the migration of an existing database. No network: the checks are stubbed."""
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import text

from backend.ai import connection, store
from backend.ai.config import ai_config
from backend.ai.connection import OK, UNREACHABLE, Check
from backend.ai.modules import DECIDER_MODEL, PRESET_MODULES
from backend.candidates import upload_limit
from backend.inbox.decider import config_identity
from backend.models.ai_presets import AiModel, AiProvider
from backend.models.candidates import ResumeParse
from backend.models.db import LlmCallLog, utcnow
from backend.models.tenancy import LedgerEntry
from backend.tests.ai_support import edit_active, set_up_ai
from backend.tests.auth_support import make_user
from backend.tests.test_migration_0002 import scratch_db  # noqa: F401  (the fixture)


@pytest.fixture
def ai(test_db, monkeypatch):
    """The seeded setup, every outside check passing unless a test says otherwise."""
    set_up_ai(test_db)
    state = {"key": OK, "model": OK, "models": []}

    async def check_key(key):
        return state["key"]

    async def check_model(key, module, model, effort=""):
        state["models"].append((module.key, model))
        return state["model"]

    async def live_models():
        return [{"id": "anthropic/claude-sonnet-5", "name": "Claude Sonnet 5"}]

    monkeypatch.setattr(connection, "check_key", check_key)
    monkeypatch.setattr(connection, "check_model", check_model)
    monkeypatch.setattr(connection, "live_models", live_models)
    return state


def _setup(client):
    r = client.get("/api/admin/ai")
    assert r.status_code == 200, r.text
    return r.json()


def _module(setup, key):
    return next(module for module in setup["modules"] if module["key"] == key)


def _body(setup, key="search_titles", name="Second", model=None):
    module = _module(setup, key)
    current = next(preset for preset in module["presets"] if preset["is_active"])["current"]
    return {"module": key, "name": name, "notes": "", "model_id": model or current["model_id"], "effort": "",
            "prompts": current["prompts"]}


def test_the_four_use_cases_start_active_with_their_models(api_client, ai):
    setup = _setup(api_client)
    assert [module["key"] for module in setup["modules"]] == list(PRESET_MODULES)
    active = {module["key"]: [p["current"]["model_id"] for p in module["presets"] if p["is_active"]]
              for module in setup["modules"]}
    assert active["email_classification"] == [DECIDER_MODEL] and active["resume_parse"] == ["openai/gpt-6-luna"]
    assert setup["limits"] == {"resume_tailor": 40, "resume_parse": 10}


def test_the_key_is_encrypted_and_never_comes_back(api_client, test_db, ai):
    r = api_client.put("/api/admin/ai/provider", json={"provider": "openrouter", "api_key": "sk-real-secret-9876"})
    assert r.status_code == 200, r.text
    assert "sk-real-secret" not in r.text and r.json()["provider"]["key_last4"] == "9876"
    test_db.expire_all()
    row = test_db.get(AiProvider, 1)
    assert b"sk-real-secret" not in bytes(row.api_key_encrypted) and store.shared_key(test_db) == "sk-real-secret-9876"
    assert len(ai["models"]) == 4
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_type == "ai_provider").one()
    assert entry.firm_id is None and "sk-real" not in entry.summary


def test_every_use_case_runs_on_the_one_key(test_db, ai):
    assert {ai_config(key, db=test_db).api_key for key in PRESET_MODULES} == {"test-key"}


def test_a_rejected_key_blocks_the_save_and_keeps_the_old_one(api_client, test_db, ai):
    ai["key"] = Check(False, True, "OpenRouter rejected this API key.")
    r = api_client.put("/api/admin/ai/provider", json={"api_key": "sk-bad-key", "force": True})
    assert r.status_code == 422 and "rejected" in r.json()["detail"]
    test_db.expire_all()
    assert store.shared_key(test_db) == "test-key"


def test_an_outage_asks_first_and_can_be_saved_anyway(api_client, test_db, ai):
    ai["key"] = UNREACHABLE
    assert api_client.put("/api/admin/ai/provider", json={"api_key": "sk-new-key"}).status_code == 409
    assert api_client.put("/api/admin/ai/provider", json={"api_key": "sk-new-key", "force": True}).status_code == 200
    test_db.expire_all()
    assert store.shared_key(test_db) == "sk-new-key"


def test_another_provider_is_refused(api_client, ai):
    assert api_client.put("/api/admin/ai/provider", json={"provider": "claude_api"}).status_code == 422


def test_a_model_comes_only_from_openrouters_list(api_client, ai):
    assert api_client.post("/api/admin/ai/models", json={"model_id": "made/up"}).status_code == 422
    r = api_client.post("/api/admin/ai/models", json={"model_id": "anthropic/claude-sonnet-5"})
    assert r.status_code == 201 and "anthropic/claude-sonnet-5" in _module(r.json(), "resume_parse")["model_ids"]
    assert "anthropic/claude-sonnet-5" not in _module(r.json(), "email_classification")["model_ids"]


def test_a_model_in_use_cant_be_removed_and_a_hidden_one_keeps_its_row(api_client, test_db, ai):
    used = test_db.query(AiModel).filter(AiModel.model_id == DECIDER_MODEL).one()
    assert api_client.delete(f"/api/admin/ai/models/{used.id}").status_code == 409
    api_client.post("/api/admin/ai/models", json={"model_id": "anthropic/claude-sonnet-5"})
    free = test_db.query(AiModel).filter(AiModel.model_id == "anthropic/claude-sonnet-5").one()
    r = api_client.delete(f"/api/admin/ai/models/{free.id}")
    assert r.status_code == 200 and "anthropic/claude-sonnet-5" not in _module(r.json(), "resume_parse")["model_ids"]
    test_db.expire_all()
    assert test_db.get(AiModel, free.id).is_hidden


def test_a_preset_needs_an_approved_fitting_model_and_its_placeholders(api_client, ai):
    setup = _setup(api_client)
    assert api_client.post("/api/admin/ai/presets", json=_body(setup, model="not/approved")).status_code == 422
    assert api_client.post("/api/admin/ai/presets", json=_body(setup, "email_classification", model="openai/gpt-6-luna")
                           ).status_code == 422
    body = _body(setup)
    assert api_client.post("/api/admin/ai/presets", json={**body, "prompts": {"prompt": "No role here"}}).status_code == 422
    assert api_client.post("/api/admin/ai/presets", json=body).status_code == 201
    assert api_client.post("/api/admin/ai/presets", json=body).status_code == 409


def test_an_edit_is_a_new_version_and_a_rename_is_not(api_client, ai):
    setup = api_client.post("/api/admin/ai/presets", json=_body(_setup(api_client))).json()
    preset = next(p for p in _module(setup, "search_titles")["presets"] if p["name"] == "Second")
    url = f"/api/admin/ai/presets/{preset['id']}"
    renamed = api_client.patch(url, json={"name": "Renamed"}).json()
    assert next(p for p in _module(renamed, "search_titles")["presets"] if p["id"] == preset["id"])["current"]["version"] == 1
    edited = api_client.patch(url, json={"prompts": {"prompt": "New wording for {target_role}"}}).json()
    assert next(p for p in _module(edited, "search_titles")["presets"] if p["id"] == preset["id"])["current"]["version"] == 2


def test_one_active_preset_and_a_switch_reaches_new_runs(api_client, test_db, ai):
    setup = api_client.post("/api/admin/ai/presets", json=_body(_setup(api_client))).json()
    second = next(p for p in _module(setup, "search_titles")["presets"] if p["name"] == "Second")
    first = next(p for p in _module(setup, "search_titles")["presets"] if p["is_active"])
    assert api_client.post(f"/api/admin/ai/presets/{first['id']}/archive").status_code == 409
    r = api_client.post(f"/api/admin/ai/presets/{second['id']}/activate", json={})
    assert r.status_code == 200
    assert [p["name"] for p in _module(r.json(), "search_titles")["presets"] if p["is_active"]] == ["Second"]
    test_db.expire_all()
    assert str(ai_config("search_titles", db=test_db).preset_id) == second["id"]
    assert api_client.post(f"/api/admin/ai/presets/{first['id']}/archive").status_code == 200
    assert api_client.post(f"/api/admin/ai/presets/{first['id']}/activate", json={}).status_code == 409


def test_a_rejected_model_cant_be_made_active(api_client, ai):
    setup = api_client.post("/api/admin/ai/presets", json=_body(_setup(api_client))).json()
    second = next(p for p in _module(setup, "search_titles")["presets"] if p["name"] == "Second")
    ai["model"] = Check(False, True, "That model isn't available for this use case.")
    assert api_client.post(f"/api/admin/ai/presets/{second['id']}/activate", json={"force": True}).status_code == 422


def test_the_limits_save_and_apply_without_a_restart(api_client, ai):
    from backend.job_monitor import get_limiter
    assert get_limiter("resume_parse").value == 10
    r = api_client.patch("/api/admin/ai/limits", json={"resume_tailor": 12, "resume_parse": 3})
    assert r.status_code == 200 and r.json()["limits"] == {"resume_tailor": 12, "resume_parse": 3}
    assert (get_limiter("resume_tailor").value, get_limiter("resume_parse").value) == (12, 3)
    assert api_client.patch("/api/admin/ai/limits", json={"resume_tailor": 0, "resume_parse": 3}).status_code == 422
    from backend.job_monitor import reset_limiter
    reset_limiter()


def test_a_test_run_saves_nothing_and_logs_platform_cost(api_client, test_db, ai, monkeypatch):
    calls = []

    async def fake_llm(prompt, system, max_tokens=1200, **kwargs):
        calls.append(prompt)
        return {"text": '{"titles": ["Backend Engineer", "API Engineer"]}', "usage": {"input_tokens": 1, "output_tokens": 1},
                "provider": "openrouter", "model": kwargs["model"]}

    monkeypatch.setattr("backend.ai.test_run.call_llm", fake_llm)
    preset = store.active_preset(test_db, "search_titles")[0]
    r = api_client.post(f"/api/admin/ai/presets/{preset.id}/test-run", json={"target_role": "Java Developer"})
    assert r.status_code == 200 and r.json()["output"]["titles"] == ["Backend Engineer", "API Engineer"]
    assert "Java Developer" in calls[0]
    row = test_db.query(LlmCallLog).filter(LlmCallLog.purpose == "preset_test:search_titles").one()
    assert row.firm_id is None and row.preset_id == preset.id and row.preset_version == 1
    assert api_client.post(f"/api/admin/ai/presets/{preset.id}/test-run", json={}).status_code == 422


def test_a_firm_user_cant_reach_the_ai_setup(anonymous_client, accounts):
    r = anonymous_client.get("/api/admin/ai", headers={"cookie": f"bq_session={accounts.firm_token}"})
    assert r.status_code == 403


def test_the_email_fingerprint_is_the_model_and_prompts_not_the_preset(test_db, ai):
    from dataclasses import replace
    cfg = ai_config("email_classification", db=test_db)
    assert config_identity(cfg) == config_identity(replace(cfg, preset_id=None, preset_version=None))
    edit_active(test_db, "email_classification", model="perplexity/pplx-decider-v2")
    test_db.expire_all()
    assert config_identity(ai_config("email_classification", db=test_db)) != config_identity(cfg)


# ── The upload limit ─────────────────────────────────────────────────────────

def _parse(db, accounts, candidate_id, user_id, at):
    db.add(ResumeParse(firm_id=accounts.firm_id, uploaded_by_user_id=user_id, candidate_id=candidate_id,
                       file_name="r.pdf", mime_type="application/pdf", size_bytes=4,
                       content=uuid.uuid4().bytes, parse={}, created_at=at))


def test_five_later_uploads_a_shift_and_the_first_resume_doesnt_count(test_db, accounts):
    from fastapi import HTTPException
    from backend.models.candidates import Candidate
    from backend.models.tenancy import Firm
    firm = test_db.get(Firm, accounts.firm_id)
    manager = make_user(test_db, firm, email="m@acme.test", role="MANAGER")
    candidate = Candidate(firm_id=firm.id, manager_id=manager.id, created_by_user_id=manager.id, work_auth="H1B")
    test_db.add(candidate)
    test_db.flush()
    now = utcnow()
    for minutes in range(6):
        _parse(test_db, accounts, candidate.id, manager.id, now - timedelta(minutes=30 - minutes))
    test_db.flush()
    assert upload_limit.uploads_today(test_db, candidate, now) == 5
    with pytest.raises(HTTPException) as refused:
        upload_limit.refuse_past_limit(test_db, candidate, now)
    assert refused.value.status_code == 429 and refused.value.detail.startswith("Upload limit reached. Next upload at ")
    assert upload_limit.uploads_today(test_db, candidate, now + timedelta(days=1, hours=1)) == 0


# ── The migration ────────────────────────────────────────────────────────────

def test_the_migration_keeps_todays_setup_and_erases_every_readable_key(scratch_db, monkeypatch):
    from backend.tests.test_migration_0002 import _alembic, _ok
    name, engine = scratch_db
    _ok(_alembic(name, "upgrade", "0031"))
    rows = {"resume_parse_llm_provider": "openrouter", "resume_parse_llm_model": "openai/parser-model",
            "resume_parse_llm_api_key": "sk-parser-key-1234", "resume_tailor_llm_provider": "openrouter",
            "resume_tailor_llm_model": "openai/tailor-model", "resume_tailor_llm_api_key": "sk-parser-key-1234",
            "search_titles_llm_model": "openai/titles-model", "search_titles_prompt": "Mine {target_role}",
            "candidate_email_llm_model": "perplexity/pplx-decider-v1.2", "candidate_email_llm_api_key": "sk-other",
            "llm_provider": "claude_api", "llm_model": "claude-sonnet-5", "llm_api_key": "sk-ant-key",
            "resume_parse_response_format": "{}"}
    with engine.begin() as conn:
        for key, value in rows.items():
            conn.execute(text("INSERT INTO settings (key, value) VALUES (:key, :value)"), {"key": key, "value": value})
    _ok(_alembic(name, "upgrade", "0032"))
    with engine.connect() as conn:
        settings = dict(conn.execute(text("SELECT key, value FROM settings")).all())
        provider = conn.execute(text("SELECT api_key_encrypted, key_last4 FROM ai_provider")).one()
        active = dict(conn.execute(text(
            "SELECT p.module, v.model_id FROM ai_presets p JOIN ai_preset_versions v ON v.preset_id = p.id "
            "WHERE p.is_active")).all())
        prompt = conn.execute(text(
            "SELECT v.prompts->>'prompt' FROM ai_presets p JOIN ai_preset_versions v ON v.preset_id = p.id "
            "WHERE p.module = 'search_titles'")).scalar_one()
    assert not [key for key in settings if key.endswith("api_key")]
    assert "sk-parser" not in str(settings) and "resume_parse_response_format" not in settings
    assert b"sk-parser" not in bytes(provider[0]) and provider[1] == "1234"
    from backend.ai.secrets import decrypt_key
    assert decrypt_key(provider[0]) == "sk-parser-key-1234"
    assert active == {"resume_parse": "openai/parser-model", "resume_tailor": "openai/tailor-model",
                      "search_titles": "openai/titles-model", "email_classification": "perplexity/pplx-decider-v1.2"}
    assert prompt == "Mine {target_role}"
    assert (settings["llm_provider"], settings["llm_model"]) == ("openrouter", "anthropic/claude-sonnet-5")
    _ok(_alembic(name, "downgrade", "0031"))
    with engine.connect() as conn:
        back = dict(conn.execute(text("SELECT key, value FROM settings")).all())
    assert back["resume_parse_llm_model"] == "openai/parser-model" and "resume_parse_llm_api_key" not in back


def test_the_migration_stops_without_the_secret_when_a_key_must_move(scratch_db, monkeypatch):
    from backend.tests.test_migration_0002 import _alembic
    name, engine = scratch_db
    assert _alembic(name, "upgrade", "0031").returncode == 0
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO settings (key, value) VALUES ('resume_parse_llm_api_key', 'sk-keep-me')"))
    monkeypatch.setenv("AI_SETTINGS_ENCRYPTION_KEY", "")
    assert _alembic(name, "upgrade", "0032").returncode != 0
    with engine.connect() as conn:
        assert conn.execute(text("SELECT value FROM settings WHERE key = 'resume_parse_llm_api_key'")).scalar() == "sk-keep-me"
        assert conn.execute(text("SELECT to_regclass('ai_provider')")).scalar() is None
