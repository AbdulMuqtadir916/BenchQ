"""The Super Admin's AI setup (docs/integration/08-ai-presets.md, /admin/ai-presets): one provider and encrypted key, the
approved models, each use case's presets, the parse and tailoring limits, and test runs. PLATFORM in backend/auth/access.py;
each write is gated by `ai.manage` and logged in the ledger with no firm. The key is never returned or logged."""
import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from backend.ai import connection, store
from backend.ai.config import AiConfig
from backend.ai.modules import PRESET_MODULES, PresetModule, editable_prompts, prompt_problems
from backend.ai.secrets import AiSecretError
from backend.ai.test_run import TestRunRefused, run_test
from backend.analyzer.llm_client import REASONING_EFFORTS
from backend.auth import ledger
from backend.auth.policy import require
from backend.auth.sessions import Principal
from backend.job_monitor import reset_limiter
from backend.models.ai_presets import AiModel, AiPreset, AiPresetVersion, AiProvider
from backend.models.db import Setting, get_db, utcnow
from backend.problem import NOT_CONFIGURED, Problem
from backend.models.tenancy import PlatformUser

logger = logging.getLogger("benchq.ai")
router = APIRouter(prefix="/admin/ai", tags=["admin"])

PROVIDERS = {"openrouter": "OpenRouter"}
EFFORTS = ("", *REASONING_EFFORTS["openrouter"])
LIMITS = {"resume_tailor": ("resume_tailor_max_concurrent", 40), "resume_parse": ("resume_parse_max_concurrent", 10)}
MOST_LIMIT = 200
_DECIDER_PREFIX = "perplexity/pplx-decider"


class ProviderBody(BaseModel):
    provider: str = Field(default="openrouter", max_length=40)
    api_key: str | None = Field(default=None, max_length=500)
    force: bool = False


class ModelBody(BaseModel):
    model_id: str = Field(min_length=1, max_length=200)
    label: str | None = Field(default=None, max_length=200)


class PresetBody(BaseModel):
    module: str = Field(max_length=40)
    name: str = Field(min_length=1, max_length=120)
    notes: str = Field(default="", max_length=2000)
    model_id: str = Field(min_length=1, max_length=200)
    effort: str = Field(default="", max_length=20)
    prompts: dict[str, str]


class PresetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)
    model_id: str | None = Field(default=None, min_length=1, max_length=200)
    effort: str | None = Field(default=None, max_length=20)
    prompts: dict[str, str] | None = None
    force: bool = False


class ForceBody(BaseModel):
    force: bool = False


class LimitsBody(BaseModel):
    resume_tailor: int = Field(ge=1, le=MOST_LIMIT)
    resume_parse: int = Field(ge=1, le=MOST_LIMIT)


class SampleBody(BaseModel):
    resume: str | None = Field(default=None, max_length=40000)
    posting: str | None = Field(default=None, max_length=40000)
    target_role: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=1000)
    body: str | None = Field(default=None, max_length=24000)


def _module(key: str) -> PresetModule:
    module = PRESET_MODULES.get(key)
    if module is None:
        raise HTTPException(status_code=422, detail="Unknown AI use case.")
    return module


def fits(module: PresetModule, model_id: str) -> bool:
    """Email classification takes only Decider models, on OpenRouter's Decisions endpoint; the rest never do."""
    return model_id.startswith(_DECIDER_PREFIX) == (module.request == "decision")


def _limit(db: DbSession, name: str) -> int:
    key, fallback = LIMITS[name]
    row = db.get(Setting, key)
    try:
        return max(1, int(row.value)) if row is not None and row.value else fallback
    except ValueError:
        return fallback


def _version_json(module: PresetModule, version: AiPresetVersion) -> dict:
    return {"version": version.version, "model_id": version.model_id, "effort": version.effort or "",
            "prompts": editable_prompts(module, version.prompts or {}), "created_at": version.created_at.isoformat()}


def _preset_json(db: DbSession, preset: AiPreset) -> dict:
    version = store.latest_version(db, preset.id)
    return {"id": str(preset.id), "module": preset.module, "name": preset.name, "notes": preset.notes or "",
            "is_active": preset.is_active, "archived_at": preset.archived_at.isoformat() if preset.archived_at else None,
            "current": _version_json(PRESET_MODULES[preset.module], version)}


def _overview(db: DbSession) -> dict:
    row = store.provider_row(db)
    models = db.query(AiModel).order_by(AiModel.label).all()
    in_use = {version.model_id for version in (store.latest_version(db, preset.id) for preset in
                                               db.query(AiPreset).filter(AiPreset.is_active.is_(True))) if version}
    presets = db.query(AiPreset).order_by(AiPreset.created_at, AiPreset.name).all()
    return {
        "provider": {"provider": row.provider if row else "openrouter", "key_set": bool(row and row.api_key_encrypted),
                     "key_last4": row.key_last4 if row else None,
                     "updated_at": row.updated_at.isoformat() if row and row.updated_at else None},
        "providers": [{"id": key, "label": label} for key, label in PROVIDERS.items()],
        "models": [{"id": str(model.id), "model_id": model.model_id, "label": model.label,
                    "is_hidden": model.is_hidden, "in_use": model.model_id in in_use} for model in models],
        "limits": {name: _limit(db, name) for name in LIMITS},
        "efforts": list(EFFORTS),
        "modules": [{"key": module.key, "label": module.label, "takes_effort": module.takes_effort,
                     "prompts": [{"name": name, "label": label, "placeholders": list(module.placeholders.get(name, ())),
                                  "optional": name in module.optional_prompts}
                                 for name, label in module.prompt_labels.items()],
                     "model_ids": [model.model_id for model in models if not model.is_hidden
                                   and fits(module, model.model_id)],
                     "presets": [_preset_json(db, preset) for preset in presets if preset.module == module.key]}
                    for module in PRESET_MODULES.values()],
    }


async def _check_all(key: str, targets: list[tuple[PresetModule, str, str, dict]], force: bool) -> None:
    """A rejected key or model stops the save. If OpenRouter is only unreachable, `force` lets it through (08, decided
    2026-11-22): a leaked key must be replaceable during an outage."""
    answers = [await connection.check_key(key)]
    if answers[0].ok or not answers[0].rejected:
        answers += await asyncio.gather(*(connection.check_model(key, module, model, effort, prompts)
                                          for module, model, effort, prompts in targets))
    rejected = [answer.message for answer in answers if answer.rejected]
    if rejected:
        raise HTTPException(status_code=422, detail=" ".join(dict.fromkeys(rejected)))
    if not all(answer.ok for answer in answers) and not force:
        raise HTTPException(status_code=409, detail="OpenRouter couldn't be reached. Save anyway?")


def _active_targets(db: DbSession) -> list[tuple[PresetModule, str, str, dict]]:
    targets = []
    for key, module in PRESET_MODULES.items():
        if (found := store.active_preset(db, key)) is not None:
            targets.append((module, found[1].model_id, found[1].effort or "", dict(found[1].prompts or {})))
    return targets


def _is_approved(db: DbSession, module: PresetModule, model_id: str) -> bool:
    model = db.query(AiModel).filter(AiModel.model_id == model_id, AiModel.is_hidden.is_(False)).first()
    return model is not None and fits(module, model_id)


def _refuse_removed_model(db: DbSession, module: PresetModule, model_id: str) -> None:
    if not _is_approved(db, module, model_id):
        raise HTTPException(status_code=409, detail="This preset's model is no longer approved. Edit it to pick another.")


def _log(db: DbSession, principal: Principal, action: str, entity_type: str, entity_id, label: str, summary: str) -> None:
    admin = db.get(PlatformUser, principal.user_id)
    ledger.record(db, actor=admin, action=action, entity_type=entity_type, entity_id=entity_id, entity_label=label,
                  summary=summary, firm_id=None)


def _preset(db: DbSession, preset_id: uuid.UUID) -> AiPreset:
    preset = db.get(AiPreset, preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    return preset


def _locked_preset(db: DbSession, preset_id: uuid.UUID) -> AiPreset:
    """The preset, its row locked until commit: activation and an edit's save take it in turn (Abdul's review on #150)."""
    preset = (db.query(AiPreset).filter(AiPreset.id == preset_id).with_for_update().populate_existing().first())
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    return preset


def _check_version(db: DbSession, module: PresetModule, model_id: str, effort: str, prompts: dict,
                   before_model: str | None = None) -> None:
    if effort not in EFFORTS or (effort and not module.takes_effort):
        raise HTTPException(status_code=422, detail="This reasoning effort isn't available for this use case.")
    if problems := prompt_problems(module, prompts):
        raise HTTPException(status_code=422, detail=" ".join(problems))
    if model_id == before_model:
        return                      # a preset keeps a model that was hidden after it was chosen
    if not _is_approved(db, module, model_id):
        raise HTTPException(status_code=422, detail="Pick a model from the approved list that fits this use case.")


def _key_or_refuse(db: DbSession) -> str:
    key = store.shared_key(db)
    if not key:
        raise HTTPException(status_code=422, detail="Add the API key first.")
    return key


# ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────

@router.get("", summary="The AI setup: provider, models, limits and each use case's presets")
def get_setup(db: DbSession = Depends(get_db)):
    return _overview(db)


@router.get("/available-models", summary="OpenRouter's live model list, to approve from")
async def available_models():
    try:
        return await connection.live_models()
    except Exception:
        raise HTTPException(status_code=502, detail="OpenRouter's model list couldn't be read. Try again.") from None


# ── Provider and key ─────────────────────────────────────────────────────────────────────────────────────────────────

@router.put("/provider", summary="Set the provider and key, after testing them")
async def save_provider(body: ProviderBody, principal: Principal = Depends(require("ai.manage")),
                        db: DbSession = Depends(get_db)):
    if body.provider not in PROVIDERS:
        raise HTTPException(status_code=422, detail="This provider isn't supported yet.")
    new_key = (body.api_key or "").strip()
    key = new_key or await asyncio.to_thread(store.shared_key, db)
    if not key:
        raise HTTPException(status_code=422, detail="Add the API key.")
    targets = await asyncio.to_thread(_active_targets, db)
    await asyncio.to_thread(db.commit)      # no connection held while OpenRouter answers
    await _check_all(key, targets, body.force)

    def write() -> dict:
        row = db.get(AiProvider, 1) or AiProvider(id=1)
        db.add(row)
        row.provider, row.updated_at, row.updated_by_id = body.provider, utcnow(), principal.user_id
        if new_key:
            try:
                store.store_key(row, new_key)
            except AiSecretError:
                db.rollback()
                # NOT_CONFIGURED: a setup the admin must fix, never the bare 503's "busy, try again" (Abdul, #150).
                raise Problem(503, "The server's AI encryption secret isn't set.", NOT_CONFIGURED) from None
        _log(db, principal, "UPDATE", "ai_provider", "1", PROVIDERS[body.provider],
             "AI API key changed" if new_key else "AI provider checked and saved")
        db.commit()
        return _overview(db)
    return await asyncio.to_thread(write)


# ── Approved models ──────────────────────────────────────────────────────────────────────────────────────────────────

@router.post("/models", status_code=201, summary="Approve a model from OpenRouter's list")
async def add_model(body: ModelBody, principal: Principal = Depends(require("ai.manage")),
                    db: DbSession = Depends(get_db)):
    model_id = body.model_id.strip()
    existing = await asyncio.to_thread(lambda: db.query(AiModel).filter(AiModel.model_id == model_id).first())
    if existing is None:
        try:
            live = await connection.live_models()
        except Exception:
            raise HTTPException(status_code=502, detail="OpenRouter's model list couldn't be read. Try again.") from None
        match = next((row for row in live if row["id"] == model_id), None)
        if match is None:
            raise HTTPException(status_code=422, detail="That model isn't in OpenRouter's list.")
        label = (body.label or match["name"]).strip()[:200]
    else:
        label = existing.label

    def write() -> dict:
        row = existing or AiModel(model_id=model_id, label=label)
        row.is_hidden = False
        db.add(row)
        db.flush()
        _log(db, principal, "CREATE", "ai_model", row.id, label, f"Approved AI model {model_id}")
        db.commit()
        return _overview(db)
    return await asyncio.to_thread(write)


@router.delete("/models/{model_uuid}", summary="Hide an approved model")
def hide_model(model_uuid: uuid.UUID, principal: Principal = Depends(require("ai.manage")),
               db: DbSession = Depends(get_db)):
    row = db.get(AiModel, model_uuid)
    if row is None:
        raise HTTPException(status_code=404, detail="Model not found")
    if any(target[1] == row.model_id for target in _active_targets(db)):
        raise HTTPException(status_code=409, detail="An active preset uses this model. Switch it first.")
    row.is_hidden = True
    _log(db, principal, "DELETE", "ai_model", row.id, row.label, f"Removed AI model {row.model_id} from the list")
    db.commit()
    return _overview(db)


# ── Presets ──────────────────────────────────────────────────────────────────────────────────────────────────────────

@router.post("/presets", status_code=201, summary="Create a preset")
def create_preset(body: PresetBody, principal: Principal = Depends(require("ai.manage")),
                  db: DbSession = Depends(get_db)):
    module = _module(body.module)
    name = body.name.strip()
    _check_version(db, module, body.model_id, body.effort, body.prompts)
    preset = AiPreset(module=module.key, name=name, notes=body.notes.strip())
    db.add(preset)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This use case already has a preset with that name.") from None
    db.add(AiPresetVersion(preset_id=preset.id, version=1, model_id=body.model_id, effort=body.effort,
                           prompts=body.prompts, created_by_id=principal.user_id))
    _log(db, principal, "CREATE", "ai_preset", preset.id, name, f"Created {module.label} preset “{name}”")
    db.commit()
    return _overview(db)


@router.patch("/presets/{preset_id}", summary="Edit a preset: a change to its setup is a new version")
async def edit_preset(preset_id: uuid.UUID, body: PresetPatch, principal: Principal = Depends(require("ai.manage")),
                      db: DbSession = Depends(get_db)):
    def prepare():
        preset = _preset(db, preset_id)
        if preset.archived_at is not None:
            raise HTTPException(status_code=409, detail="This preset is archived.")
        module = _module(preset.module)
        current = store.latest_version(db, preset.id)
        model = body.model_id if body.model_id is not None else current.model_id
        effort = body.effort if body.effort is not None else (current.effort or "")
        stored = editable_prompts(module, current.prompts or {})
        prompts = body.prompts if body.prompts is not None else dict(stored)
        _check_version(db, module, model, effort, prompts, current.model_id)
        changed = (model, effort, prompts) != (current.model_id, current.effort or "", stored)
        needs_check = preset.is_active and ((model, effort) != (current.model_id, current.effort or "")
                                            or (module.request == "decision" and prompts != stored))
        key = _key_or_refuse(db) if needs_check else ""
        version_number = current.version
        was_active = preset.is_active
        db.commit()
        return module, model, effort, prompts, changed, needs_check, key, version_number, was_active

    module, model, effort, prompts, changed, needs_check, key, version_number, was_active = \
        await asyncio.to_thread(prepare)
    if needs_check:
        await _check_all(key, [(module, model, effort, prompts)], body.force)

    def write() -> dict:
        preset = _locked_preset(db, preset_id)
        if preset.is_active != was_active:     # made active meanwhile: this change wasn't checked as a live one
            raise HTTPException(status_code=409, detail="This preset was just made active. Reload and try again.")
        if body.name is not None:
            preset.name = body.name.strip()
        if body.notes is not None:
            preset.notes = body.notes.strip()
        if changed:
            db.add(AiPresetVersion(preset_id=preset.id, version=version_number + 1, model_id=model, effort=effort,
                                   prompts=prompts, created_by_id=principal.user_id))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="This preset just changed, or that name is taken. "
                                                        "Reload and try again.") from None
        _log(db, principal, "UPDATE", "ai_preset", preset.id, preset.name,
             f"Edited {module.label} preset “{preset.name}”" + (f" (v{version_number + 1})" if changed else ""))
        db.commit()
        return _overview(db)
    return await asyncio.to_thread(write)


@router.post("/presets/{preset_id}/activate", summary="Make a preset active for its use case, after testing it")
async def activate_preset(preset_id: uuid.UUID, body: ForceBody, principal: Principal = Depends(require("ai.manage")),
                          db: DbSession = Depends(get_db)):
    def prepare():
        preset = _preset(db, preset_id)
        if preset.archived_at is not None:
            raise HTTPException(status_code=409, detail="Restore this preset before making it active.")
        version = store.latest_version(db, preset.id)
        module = _module(preset.module)
        _refuse_removed_model(db, module, version.model_id)
        key = _key_or_refuse(db)
        target = (module, version.model_id, version.effort or "", dict(version.prompts or {}))
        db.commit()
        return module, key, target, version.version

    module, key, target, tested = await asyncio.to_thread(prepare)
    await _check_all(key, [target], body.force)

    def write() -> dict:
        preset = _locked_preset(db, preset_id)
        if preset.archived_at is not None:
            raise HTTPException(status_code=409, detail="This preset was archived meanwhile.")
        # Only the version that was tested goes live: an edit saved while OpenRouter answered is refused here.
        if store.latest_version(db, preset.id).version != tested:
            raise HTTPException(status_code=409, detail="This preset was edited while it was being tested. "
                                                        "Test it again to make it active.")
        _refuse_removed_model(db, module, target[1])     # it may have been removed while OpenRouter answered
        db.query(AiPreset).filter(AiPreset.module == preset.module, AiPreset.id != preset.id,
                                  AiPreset.is_active.is_(True)).update({"is_active": False})
        db.flush()
        preset.is_active = True
        _log(db, principal, "UPDATE", "ai_preset", preset.id, preset.name,
             f"Made “{preset.name}” the active {module.label} preset")
        db.commit()
        return _overview(db)
    return await asyncio.to_thread(write)


@router.post("/presets/{preset_id}/archive", summary="Archive a preset that isn't active")
def archive_preset(preset_id: uuid.UUID, principal: Principal = Depends(require("ai.manage")),
                   db: DbSession = Depends(get_db)):
    preset = _preset(db, preset_id)
    if preset.is_active:
        raise HTTPException(status_code=409, detail="Make another preset active first.")
    if preset.archived_at is None:
        preset.archived_at = utcnow()
        _log(db, principal, "UPDATE", "ai_preset", preset.id, preset.name, f"Archived preset “{preset.name}”")
        db.commit()
    return _overview(db)


@router.post("/presets/{preset_id}/restore", summary="Bring an archived preset back, not active")
def restore_preset(preset_id: uuid.UUID, principal: Principal = Depends(require("ai.manage")),
                   db: DbSession = Depends(get_db)):
    preset = _preset(db, preset_id)
    if preset.archived_at is not None:
        preset.archived_at = None
        _log(db, principal, "UPDATE", "ai_preset", preset.id, preset.name, f"Restored preset “{preset.name}”")
        db.commit()
    return _overview(db)


@router.post("/presets/{preset_id}/test-run", summary="Run a preset on a pasted sample; nothing is saved")
async def test_preset(preset_id: uuid.UUID, body: SampleBody, principal: Principal = Depends(require("ai.manage")),
                      db: DbSession = Depends(get_db)):
    def prepare() -> AiConfig:
        preset = _preset(db, preset_id)
        version = store.latest_version(db, preset.id)
        row = store.provider_row(db)
        key = _key_or_refuse(db)
        cfg = AiConfig(module=preset.module, provider=row.provider, model=version.model_id, api_key=key,
                       effort=version.effort or "", prompts=dict(version.prompts or {}), preset_id=preset.id,
                       preset_version=version.version)
        db.commit()
        return cfg

    cfg = await asyncio.to_thread(prepare)
    try:
        return {"output": await run_test(cfg, body.model_dump())}
    except TestRunRefused as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except HTTPException:
        raise
    except Exception as error:      # the provider's message can hold the sample, so only its type is logged
        logger.warning("AI preset test run failed module=%s %s", cfg.module, type(error).__name__)
        raise HTTPException(status_code=502, detail="The test run failed. Check the model and try again.") from None


# ── Limits ───────────────────────────────────────────────────────────────────────────────────────────────────────────

@router.patch("/limits", summary="How many tailorings and parses run at once per backend process")
def save_limits(body: LimitsBody, principal: Principal = Depends(require("ai.manage")),
                db: DbSession = Depends(get_db)):
    for name, value in (("resume_tailor", body.resume_tailor), ("resume_parse", body.resume_parse)):
        key = LIMITS[name][0]
        row = db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=str(value)))
        else:
            row.value = str(value)
    _log(db, principal, "UPDATE", "ai_limits", "limits", "AI limits",
         f"AI limits: tailoring {body.resume_tailor}, parser {body.resume_parse} per backend process")
    db.commit()
    reset_limiter("resume_tailor")
    reset_limiter("resume_parse")
    return _overview(db)
