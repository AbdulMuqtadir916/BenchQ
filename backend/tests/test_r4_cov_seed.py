"""R4-T6 coverage · backend/seed.py — the seed/data-tidying helpers run_seeds() calls.

These pin CURRENT behaviour. (The schema migrations that used to sit beside them left with the legacy schema
path at F6; the schema changes only through Alembic now.)
"""
import json

import pytest

import backend.seed as seed
from backend.models.db import (
    Company, Persona, Resume, Search, Setting,
)
from backend.models.tenancy import DEFAULT_FIRM_ID

pytestmark = pytest.mark.usefixtures("jobs_in_default_firm")


@pytest.fixture(autouse=True)
def _restore_dedup_cache():
    """`migrate_dedup_tracking_params` can eagerly reload the dedup cache — undo it."""
    import backend.scraper._shared.dedup as dedup
    saved = dedup._tracking_params_cache
    yield
    dedup._tracking_params_cache = saved


# ══ _int_setting_keys ═══════════════════════════════════════════════════════


def test_a_non_string_default_is_skipped_by_the_int_key_scan(monkeypatch):
    """The int-guard derives its key set from DEFAULT_SETTINGS and ignores non-str defaults."""
    monkeypatch.setitem(seed.DEFAULT_SETTINGS, "cov_int_default", (17, "an int, not a string"))
    monkeypatch.setitem(seed.DEFAULT_SETTINGS, "cov_none_default", (None, "no default at all"))

    keys = seed._int_setting_keys()
    assert "cov_int_default" not in keys
    assert "cov_none_default" not in keys
    # …while a genuine numeric string default is still picked up automatically.
    assert "scrape_interval_minutes" in keys


# ══ seed_companies ══════════════════════════════════════════════════════════


def test_seed_companies_fills_an_empty_table_once(test_db):
    """Seed companies land inactive with playwright on; a second run is a no-op."""
    seed.seed_companies(test_db)
    names = {c.name for c in test_db.query(Company).all()}
    assert names == {c["name"] for c in seed.SEED_COMPANIES}

    cf = test_db.query(Company).filter(Company.name == "Cloudflare").one()
    assert cf.active is False and cf.playwright_enabled is True
    assert cf.scrape_urls == ["https://boards.greenhouse.io/cloudflare"]

    seed.seed_companies(test_db)
    assert test_db.query(Company).count() == len(seed.SEED_COMPANIES)


def test_seed_companies_bails_when_any_company_exists(test_db):
    """One user-added company is enough to suppress the whole seed list."""
    test_db.add(Company(name="MyOwnCo"))
    test_db.commit()
    seed.seed_companies(test_db)
    assert [c.name for c in test_db.query(Company).all()] == ["MyOwnCo"]


# ══ seed_h1b_slugs ══════════════════════════════════════════════════════════


def test_seed_h1b_slugs_is_a_no_op_with_no_overrides(test_db):
    """The shipped override map is empty, so the migration touches nothing."""
    assert seed.H1B_SLUG_OVERRIDES == {}
    test_db.add(Company(name="Acme"))
    test_db.commit()
    seed.seed_h1b_slugs(test_db)
    assert test_db.query(Company).filter(Company.name == "Acme").one().h1b_slug is None


def test_seed_h1b_slugs_fills_only_empty_slugs_of_known_companies(test_db, monkeypatch):
    """An override applies to a matching company with no slug; it never overwrites one."""
    monkeypatch.setattr(seed, "H1B_SLUG_OVERRIDES",
                        {"Acme": "acme-corporation", "Beta": "beta-inc", "Ghost": "ghost-co"})
    test_db.add(Company(name="Acme"))
    test_db.add(Company(name="Beta", h1b_slug="already-set"))
    test_db.commit()

    seed.seed_h1b_slugs(test_db)

    assert test_db.query(Company).filter(Company.name == "Acme").one().h1b_slug == "acme-corporation"
    assert test_db.query(Company).filter(Company.name == "Beta").one().h1b_slug == "already-set"
    assert test_db.query(Company).filter(Company.name == "Ghost").first() is None


# ══ cleanup_removed_settings ════════════════════════════════════════════════


def test_removed_settings_are_deleted_and_live_ones_kept(test_db):
    """Every retired key is dropped; anything still in DEFAULT_SETTINGS stays."""
    for key in ("followup_reminder_days", "h1b_exclusion_phrases", "language_exclude_phrases",
                "default_cv_id", "max_jobs_per_scrape", "company_domains", "ats_domains",
                "autofill_decline_self_id", "llm_base_url", "llm_fallback_base_url",
                "autofill_structured_enabled", "autofill_structured_trigger"):
        test_db.add(Setting(key=key, value="x"))
    test_db.add(Setting(key="fit_score_threshold", value="60"))
    test_db.commit()

    seed.cleanup_removed_settings(test_db)

    assert {s.key for s in test_db.query(Setting).all()} == {"fit_score_threshold"}
    # …and none of the deleted keys is one PATCH /api/settings would still accept.
    assert not seed.is_known_setting("llm_base_url")


def test_cleanup_removed_settings_on_a_clean_db_is_a_no_op(test_db):
    seed.cleanup_removed_settings(test_db)
    assert test_db.query(Setting).count() == 0


# ══ migrate_cv_terminology ══════════════════════════════════════════════════


def test_cv_wording_is_renamed_but_template_tokens_survive(test_db):
    """Word-boundary rename: "CV"/"CVs" become Resume/Resumes, CV_NAMES_HERE does not."""
    test_db.add(Setting(key="scoring_rubric",
                        value="Score each CV. Compare CVs. Emit CV_NAMES_HERE and CVX."))
    test_db.commit()

    seed.migrate_cv_terminology(test_db)

    assert test_db.query(Setting).one().value == \
        "Score each Resume. Compare Resumes. Emit CV_NAMES_HERE and CVX."


def test_cv_wording_migration_is_idempotent_and_tolerates_gaps(test_db):
    """A missing row, an empty value and an already-migrated value are all no-ops."""
    seed.migrate_cv_terminology(test_db)              # no row at all
    test_db.add(Setting(key="scoring_rubric", value=""))
    test_db.commit()
    seed.migrate_cv_terminology(test_db)              # empty value
    assert test_db.query(Setting).one().value == ""

    row = test_db.query(Setting).one()
    row.value = "Score each Resume."
    test_db.commit()
    seed.migrate_cv_terminology(test_db)
    assert test_db.query(Setting).one().value == "Score each Resume."


# ══ migrate_llm_settings — malformed JSON paths ═════════════════════════════


def test_an_unparseable_model_list_is_rebuilt_from_the_defaults(test_db):
    """Corrupt `llm_models_list` JSON is treated as empty, not fatal."""
    test_db.add(Setting(key="llm_models_list", value="{not json at all"))
    test_db.commit()

    seed.migrate_llm_settings(test_db)

    result = json.loads(test_db.query(Setting).filter(Setting.key == "llm_models_list").one().value)
    assert result == json.loads(seed.DEFAULT_SETTINGS["llm_models_list"][0])


def test_an_unparseable_seen_marker_is_treated_as_empty(test_db):
    """Corrupt `llm_seeded_models` JSON means "nothing offered yet" — defaults re-seed."""
    test_db.add(Setting(key="llm_models_list", value=json.dumps(
        [{"provider": "ollama", "model": "mine"}])))
    test_db.add(Setting(key="llm_seeded_models", value="<<<broken>>>"))
    test_db.commit()

    seed.migrate_llm_settings(test_db)

    models = json.loads(test_db.query(Setting).filter(Setting.key == "llm_models_list").one().value)
    assert {"provider": "ollama", "model": "mine"} in models
    assert {"provider": "claude_api", "model": "claude-sonnet-5"} in models
    seen = json.loads(test_db.query(Setting).filter(Setting.key == "llm_seeded_models").one().value)
    assert "claude_api|claude-sonnet-5" in seen
    assert seen == sorted(seen)


# ══ seed_searches ═══════════════════════════════════════════════════════════


def test_seed_searches_seeds_one_per_mode(test_db):
    """Every shipped search mode gets a row; a second call adds nothing."""
    seed.seed_searches(test_db)
    modes = [s.search_mode for s in test_db.query(Search).all()]
    assert sorted(modes) == sorted(s["search_mode"] for s in seed.SEED_SEARCHES)

    ext = test_db.query(Search).filter(Search.search_mode == "extension").one()
    assert ext.active is True and ext.auto_scoring_depth == "light"

    seed.seed_searches(test_db)
    assert test_db.query(Search).count() == len(seed.SEED_SEARCHES)


def test_seed_searches_renames_the_legacy_extension_search(test_db):
    """A pre-existing "LinkedIn Extension" row is renamed in place, not duplicated."""
    test_db.add(Search(firm_id=DEFAULT_FIRM_ID, name="LinkedIn Extension", search_mode="linkedin_extension"))
    test_db.commit()

    seed.seed_searches(test_db)

    rows = test_db.query(Search).filter(Search.search_mode == "linkedin_extension").all()
    assert len(rows) == 1
    assert rows[0].name == "Extension LI"


def test_a_user_renamed_search_of_a_seeded_mode_blocks_the_seed(test_db):
    """Mode — not name — is the identity, so an existing mode is never re-seeded."""
    test_db.add(Search(firm_id=DEFAULT_FIRM_ID, name="My Own Keywords", search_mode="keyword"))
    test_db.commit()
    seed.seed_searches(test_db)
    assert [s.name for s in test_db.query(Search).filter(Search.search_mode == "keyword").all()] \
        == ["My Own Keywords"]


# ══ seed_mock_resume ════════════════════════════════════════════════════════


def test_mock_resume_is_seeded_and_wired_up(test_db):
    """The sample base resume becomes default_resume_id and every company's selection."""
    test_db.add(Setting(key="default_resume_id", value=""))
    test_db.add(Company(name="Acme"))
    test_db.add(Company(name="Beta"))
    test_db.commit()

    seed.seed_mock_resume(test_db)

    resume = test_db.query(Resume).one()
    assert resume.name == "Sample PM" and resume.is_base is True
    assert resume.template == "garamond_alt" and resume.page_format == "letter"
    assert resume.json_data["header"]["name"] == "Alex Johnson"
    assert test_db.query(Setting).filter(Setting.key == "default_resume_id").one().value == str(resume.id)
    for c in test_db.query(Company).all():
        assert c.selected_resume_ids == [str(resume.id)]


def test_mock_resume_is_skipped_when_a_base_resume_exists(test_db):
    """A user with their own base résumé never gets the sample."""
    test_db.add(Resume(firm_id=DEFAULT_FIRM_ID, name="Mine", is_base=True, json_data={}))
    test_db.commit()
    seed.seed_mock_resume(test_db)
    assert [r.name for r in test_db.query(Resume).all()] == ["Mine"]


def test_mock_resume_seeds_even_without_a_default_resume_setting(test_db):
    """No `default_resume_id` row yet → the resume is still created, nothing crashes."""
    seed.seed_mock_resume(test_db)
    assert test_db.query(Resume).filter(Resume.name == "Sample PM").count() == 1
    assert test_db.query(Setting).filter(Setting.key == "default_resume_id").first() is None


def test_a_tailored_copy_does_not_count_as_a_base_resume(test_db):
    """`is_base = False` copies do not suppress the seed."""
    test_db.add(Resume(firm_id=DEFAULT_FIRM_ID, name="Tailored", is_base=False, json_data={}))
    test_db.commit()
    seed.seed_mock_resume(test_db)
    assert test_db.query(Resume).filter(Resume.name == "Sample PM").count() == 1


# ══ seed_persona ════════════════════════════════════════════════════════════


def test_persona_singleton_is_created_once(test_db):
    seed.seed_persona(test_db)
    p = test_db.query(Persona).one()
    assert p.id == 1 and p.contact == {} and p.qa_bank == []

    p.contact = {"name": "V"}
    test_db.commit()
    seed.seed_persona(test_db)                     # must not clobber the user's data
    assert test_db.query(Persona).one().contact == {"name": "V"}


# ══ migrate_autofill_dicts ══════════════════════════════════════════════════


def test_autofill_dicts_gain_missing_defaults_without_losing_edits(test_db):
    """Only absent top-level keys are added; the user's own values are preserved."""
    test_db.add(Setting(key="autofill_field_patterns",
                        value=json.dumps({"veteran_status": ["my own pattern"],
                                          "my_custom_field": ["mine"]})))
    test_db.add(Setting(key="autofill_option_synonyms", value=json.dumps({})))
    test_db.commit()

    seed.migrate_autofill_dicts(test_db)

    patterns = json.loads(test_db.query(Setting)
                          .filter(Setting.key == "autofill_field_patterns").one().value)
    assert patterns["veteran_status"] == ["my own pattern"]      # edit kept
    assert patterns["my_custom_field"] == ["mine"]               # custom key kept
    defaults = json.loads(seed.DEFAULT_SETTINGS["autofill_field_patterns"][0])
    assert set(defaults) <= set(patterns)                        # every default present

    syn = json.loads(test_db.query(Setting)
                     .filter(Setting.key == "autofill_option_synonyms").one().value)
    assert syn == json.loads(seed.DEFAULT_SETTINGS["autofill_option_synonyms"][0])


def test_autofill_dicts_migration_skips_missing_and_broken_rows(test_db):
    """No row → nothing to merge; unparseable JSON is left exactly as the user left it."""
    seed.migrate_autofill_dicts(test_db)                          # no rows at all
    assert test_db.query(Setting).count() == 0

    test_db.add(Setting(key="autofill_field_patterns", value="{ broken"))
    test_db.commit()
    seed.migrate_autofill_dicts(test_db)
    assert test_db.query(Setting).one().value == "{ broken"


def test_autofill_dicts_migration_is_idempotent(test_db):
    """A row already carrying every default is not rewritten."""
    default = seed.DEFAULT_SETTINGS["autofill_field_patterns"][0]
    test_db.add(Setting(key="autofill_field_patterns", value=default))
    test_db.commit()
    seed.migrate_autofill_dicts(test_db)
    assert test_db.query(Setting).one().value == default


# ══ migrate_dedup_tracking_params ═══════════════════════════════════════════


def test_a_non_list_dedup_setting_is_left_alone(test_db):
    """Valid JSON of the wrong shape is not rewritten."""
    test_db.add(Setting(key="dedup_tracking_params", value=json.dumps({"jk": True})))
    test_db.commit()
    seed.migrate_dedup_tracking_params(test_db)
    assert json.loads(test_db.query(Setting).one().value) == {"jk": True}


def test_a_failing_eager_reload_does_not_break_the_migration(test_db, monkeypatch):
    """The cache reloads lazily anyway, so a reload failure is swallowed after the write."""
    import backend.scraper._shared.dedup as dedup

    def _explode():
        raise RuntimeError("cache reload failed")
    monkeypatch.setattr(dedup, "reload_tracking_params", _explode)

    test_db.add(Setting(key="dedup_tracking_params", value=json.dumps(["jk", "utm_source"])))
    test_db.commit()

    seed.migrate_dedup_tracking_params(test_db)          # must not raise
    assert json.loads(test_db.query(Setting).one().value) == ["utm_source"]


# ══ run_seeds ═══════════════════════════════════════════════════════════════


def test_run_seeds_brings_an_empty_database_up(test_db):
    """The whole startup path in order: migrations, settings, companies, searches,
    the sample résumé, the persona and the cleanup/upgrade migrations."""
    seed.run_seeds()

    settings = {s.key: s.value for s in test_db.query(Setting).all()}
    for key in seed.DEFAULT_SETTINGS:
        assert key in settings, f"{key} was not seeded"
    # The one-shot secret is generated, not left at its seeded empty value.
    assert len(settings["telegram_webhook_secret"]) >= 32

    assert test_db.query(Company).count() == len(seed.SEED_COMPANIES)
    assert {s.search_mode for s in test_db.query(Search).all()} == \
        {s["search_mode"] for s in seed.SEED_SEARCHES}
    assert test_db.query(Resume).filter(Resume.name == "Sample PM").count() == 1
    assert test_db.query(Persona).filter(Persona.id == 1).count() == 1
    # migrate_llm_settings ran: the seen-marker exists and the list is real JSON.
    assert json.loads(settings["llm_seeded_models"])
    assert json.loads(settings["llm_models_list"])


def test_run_seeds_is_idempotent(test_db):
    """A second boot changes nothing that matters."""
    seed.run_seeds()
    secret = test_db.query(Setting).filter(
        Setting.key == "telegram_webhook_secret").one().value
    resume_id = test_db.query(Resume).filter(Resume.name == "Sample PM").one().id

    seed.run_seeds()

    assert test_db.query(Setting).filter(
        Setting.key == "telegram_webhook_secret").one().value == secret
    assert test_db.query(Resume).filter(Resume.name == "Sample PM").one().id == resume_id
    assert test_db.query(Company).count() == len(seed.SEED_COMPANIES)
    assert test_db.query(Search).count() == len(seed.SEED_SEARCHES)
    assert test_db.query(Persona).count() == 1
