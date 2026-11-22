"""The Super Admin's AI setup: one provider, one encrypted key, a model catalog and presets (08-ai-presets.md).

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-22 13:00:00.000000

An existing database keeps what it runs today: each use case's model and prompts become its active "Preset 1", version 1.
The starting key is the parser's (else another OpenRouter row), encrypted with `AI_SETTINGS_ENCRYPTION_KEY`, and every
readable key row is erased in the same transaction. With a key to move and no secret, the upgrade stops and nothing
changes. A downgrade restores the models and prompts but never the key: a Super Admin enters it again.
"""
import json
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '0032'
down_revision = '0031'
branch_labels = None
depends_on = None

_FEATURES = ("llm", "llm_fallback", "scoring", "email", "cover_letter", "autofill", "resume_parse", "resume_tailor",
             "candidate_email")
_LEGACY = ("llm_fallback", "scoring", "email", "cover_letter", "autofill")
_DEFAULT_LEGACY_MODEL = "anthropic/claude-sonnet-5"
_TAILOR_PROMPTS = {
    "system": "resume_tailor_system_prompt", "review_system": "resume_tailor_review_system_prompt",
    "writing_style": "resume_tailor_writing_style", "cv_rules": "resume_tailor_cv_rules",
    "analyse": "resume_tailor_analyse_prompt", "draft": "resume_tailor_draft_prompt",
    "review": "resume_tailor_review_prompt", "revise": "resume_tailor_revise_prompt",
    "verify": "resume_tailor_verify_prompt",
}
_PROMPT_ROWS = {
    "resume_parse": {"system": "resume_parse_system_prompt", "parse": "resume_parse_prompt"},
    "resume_tailor": _TAILOR_PROMPTS,
    "search_titles": {"prompt": "search_titles_prompt"},
    "email_classification": {"instructions": "candidate_email_instructions"},
}
_MODEL_ROWS = {"resume_parse": "resume_parse_llm_model", "resume_tailor": "resume_tailor_llm_model",
               "search_titles": "search_titles_llm_model", "email_classification": "candidate_email_llm_model"}
_PROVIDER_ROWS = {"resume_parse": "resume_parse_llm_provider", "resume_tailor": "resume_tailor_llm_provider",
                  "email_classification": "candidate_email_llm_provider"}
_FORMAT_ROWS = ("resume_parse_response_format", "search_titles_response_format", "resume_tailor_analyse_format",
                "resume_tailor_draft_format", "resume_tailor_review_format", "resume_tailor_verify_format")


def _starting_key(rows: dict) -> str:
    """The parser's key first, then another row that is really an OpenRouter key."""
    for feature in ("resume_parse", "resume_tailor", "candidate_email"):
        if value := (rows.get(f"{feature}_llm_api_key") or "").strip():
            return value
    for feature, key_row in (("llm", "llm_api_key"), ("llm_fallback", "llm_fallback_api_key"),
                             *((f, f"{f}_llm_api_key") for f in _LEGACY if f != "llm_fallback")):
        if (rows.get(f"{feature}_provider" if feature in ("llm", "llm_fallback") else f"{feature}_llm_provider")
                == "openrouter") and (value := (rows.get(key_row) or "").strip()):
            return value
    return ""


def _prompt(module, name: str, rows: dict) -> str:
    from backend.candidates.parse_defaults import DEFAULT_PROMPT, OLD_DEFAULT_PROMPT
    from backend.resume_tailor.settings import upgraded_prompt
    row = _PROMPT_ROWS[module.key][name]
    value = rows[row] if row in rows else module.prompts.get(name, "")
    if module.key == "resume_parse" and name == "parse" and (value or "").strip() == OLD_DEFAULT_PROMPT.strip():
        return DEFAULT_PROMPT
    return upgraded_prompt(name, value) if module.key == "resume_tailor" else value


def _copy_settings(conn) -> None:
    from backend.ai.modules import PRESET_MODULES
    from backend.ai.secrets import encrypt_key
    from backend.ai.store import label_for

    rows = {key: value for key, value in conn.execute(sa.text("SELECT key, value FROM settings"))}
    if not rows:
        return                  # a new database: seeding makes the defaults
    api_key = _starting_key(rows)
    encrypted = encrypt_key(api_key) if api_key else None     # raises, stopping the upgrade, when the secret is missing
    conn.execute(sa.text("INSERT INTO ai_provider (id, provider, api_key_encrypted, key_last4) "
                         "VALUES (1, 'openrouter', :key, :last4)"),
                 {"key": encrypted, "last4": api_key[-4:] if api_key else None})

    known: set[str] = set()
    for module in PRESET_MODULES.values():
        model = (rows.get(_MODEL_ROWS[module.key]) or "").strip() or module.default_model
        if model not in known:
            known.add(model)
            conn.execute(sa.text("INSERT INTO ai_models (id, model_id, label) VALUES (:id, :model, :label)"),
                         {"id": uuid.uuid4(), "model": model, "label": label_for(model)})
        preset_id = uuid.uuid4()
        conn.execute(sa.text("INSERT INTO ai_presets (id, module, name, notes, is_active) "
                             "VALUES (:id, :module, 'Preset 1', 'The setup BenchQ ran before presets.', true)"),
                     {"id": preset_id, "module": module.key})
        prompts = {name: _prompt(module, name, rows) for name in _PROMPT_ROWS[module.key]}
        conn.execute(sa.text("INSERT INTO ai_preset_versions (id, preset_id, version, model_id, effort, prompts) "
                             "VALUES (:id, :preset, 1, :model, '', CAST(:prompts AS jsonb))"),
                     {"id": uuid.uuid4(), "preset": preset_id, "model": model, "prompts": json.dumps(prompts)})

    # The older code outside the presets: OpenRouter, the shared key and one default model.
    if rows.get("llm_provider") != "openrouter":
        conn.execute(sa.text("UPDATE settings SET value = :model WHERE key = 'llm_model'"),
                     {"model": _DEFAULT_LEGACY_MODEL})
        conn.execute(sa.text("UPDATE settings SET value = 'openrouter' WHERE key = 'llm_provider'"))
    for feature in _LEGACY:
        names = [f"{feature}_provider", f"{feature}_model", f"{feature}_effort"] if feature == "llm_fallback" else \
            [f"{feature}_llm_provider", f"{feature}_llm_model", f"{feature}_llm_effort"]
        conn.execute(sa.text("UPDATE settings SET value = '' WHERE key = ANY(:keys)"), {"keys": names})

    gone = [("llm_api_key" if f == "llm" else "llm_fallback_api_key" if f == "llm_fallback" else f"{f}_llm_api_key")
            for f in _FEATURES]
    for module_key, prompt_rows in _PROMPT_ROWS.items():
        gone += list(prompt_rows.values()) + [_MODEL_ROWS[module_key]]
    gone += list(_PROVIDER_ROWS.values()) + list(_FORMAT_ROWS) + ["candidate_email_llm_effort"]
    conn.execute(sa.text("DELETE FROM settings WHERE key = ANY(:keys)"), {"keys": gone})


def upgrade():
    op.create_table(
        'ai_provider',
        sa.Column('id', sa.SmallInteger(), primary_key=True, autoincrement=False),
        sa.Column('provider', sa.String(), nullable=False, server_default='openrouter'),
        sa.Column('api_key_encrypted', sa.LargeBinary(), nullable=True),
        sa.Column('key_last4', sa.String(4), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_by_id', UUID(as_uuid=True), sa.ForeignKey('platform_users.id', ondelete='SET NULL'),
                  nullable=True),
        sa.CheckConstraint('id = 1', name='ck_ai_provider_one_row'),
        sa.CheckConstraint("provider IN ('openrouter')", name='ck_ai_provider_supported'),
    )
    op.create_table(
        'ai_models',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('model_id', sa.String(), nullable=False, unique=True),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('is_hidden', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_table(
        'ai_presets',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('module', sa.String(), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False, server_default=''),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('module', 'name', name='uq_ai_presets_module_name'),
        sa.CheckConstraint('NOT (is_active AND archived_at IS NOT NULL)', name='ck_ai_presets_active_not_archived'),
    )
    op.create_index('uq_ai_presets_one_active', 'ai_presets', ['module'], unique=True,
                    postgresql_where=sa.text('is_active'))
    op.create_table(
        'ai_preset_versions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('preset_id', UUID(as_uuid=True), sa.ForeignKey('ai_presets.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('model_id', sa.String(), nullable=False),
        sa.Column('effort', sa.String(), nullable=False, server_default=''),
        sa.Column('prompts', JSONB(), nullable=False),
        sa.Column('created_by_id', UUID(as_uuid=True), sa.ForeignKey('platform_users.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('preset_id', 'version', name='uq_ai_preset_versions_preset_version'),
    )
    op.add_column('llm_call_log', sa.Column('preset_id', UUID(as_uuid=True), nullable=True))
    op.add_column('llm_call_log', sa.Column('preset_version', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_llm_call_log_preset', 'llm_call_log', 'ai_presets', ['preset_id'], ['id'],
                          ondelete='SET NULL')
    _copy_settings(op.get_bind())


def downgrade():
    conn = op.get_bind()
    active = conn.execute(sa.text(
        "SELECT p.module, v.model_id, v.prompts FROM ai_presets p JOIN LATERAL (SELECT model_id, prompts "
        "FROM ai_preset_versions WHERE preset_id = p.id ORDER BY version DESC LIMIT 1) v ON true WHERE p.is_active"
    )).fetchall()
    for module, model, prompts in active:
        if module == "email_classification" and (prompts or {}).get("question"):      # edited on the panel since 0032
            prompts = {"instructions": next(iter(json.loads(prompts["question"]).values()))["instructions"]}
        values = {_MODEL_ROWS[module]: model}
        if module in _PROVIDER_ROWS:
            values[_PROVIDER_ROWS[module]] = "openrouter"
        values.update({row: (prompts or {}).get(name, "") for name, row in _PROMPT_ROWS[module].items()})
        for key, value in values.items():
            conn.execute(sa.text("INSERT INTO settings (key, value) VALUES (:key, :value) "
                                 "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"),
                         {"key": key, "value": value})
    op.drop_constraint('fk_llm_call_log_preset', 'llm_call_log', type_='foreignkey')
    op.drop_column('llm_call_log', 'preset_version')
    op.drop_column('llm_call_log', 'preset_id')
    op.drop_table('ai_preset_versions')
    op.drop_index('uq_ai_presets_one_active', table_name='ai_presets')
    op.drop_table('ai_presets')
    op.drop_table('ai_models')
    op.drop_table('ai_provider')
