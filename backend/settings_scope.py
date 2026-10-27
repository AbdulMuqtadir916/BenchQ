"""Who owns each key of the `settings` table (docs/integration/07-auth-and-tenancy.md F2c, §6.4).

`settings` is one platform-wide key-value store, read and written only by a Super Admin (`/api/settings` is
PLATFORM in backend/auth/access.py). Firms never configure models, prompts or scrapers (product owner,
2026-10-23). Every key the app knows is classified here, and backend/tests/test_settings_scope.py fails on a key
that isn't, so a new setting has to say whose it is.

- PLATFORM    stays here: schedules, limits, scraping filters, link formats.
- AI_PRESET   the models, keys and prompts of each AI module. They move to the Super Admin's AI presets
              (one active preset per module) when that module is built; until then they stay here.
- FIRM_LATER  really a firm's (or a candidate's) choice. It stays platform-wide until its track gives it a firm
              table; that track's owner moves it. Firm code must not treat its value as the firm's own data.
- UNUSED      not part of BenchQ (LinkedIn and Jobright logins, Telegram, JobNavigator's own UI). The owner's track
              deletes the key together with the code that reads it.
"""
from enum import Enum


class Scope(str, Enum):
    PLATFORM = "platform"
    AI_PRESET = "ai_preset"
    FIRM_LATER = "firm_later"
    UNUSED = "unused"


P, AI, FIRM, UNUSED = Scope.PLATFORM, Scope.AI_PRESET, Scope.FIRM_LATER, Scope.UNUSED

# key -> (scope, the track that moves or deletes it; "" for PLATFORM keys that stay)
SETTING_SCOPES: dict[str, tuple[Scope, str]] = {
    # ── Platform: schedules, limits, scraping filters ────────────────────────
    "scrape_interval_minutes": (P, ""),
    "h1b_cron": (P, ""),
    "cleanup_cron": (P, ""),
    "backup_cron": (P, ""),
    "reject_cron": (P, ""),
    "job_archive_after_days": (P, ""),
    # Per-firm application expiry is the Applications track's decision (D3); 0 = off until then.
    "auto_reject_after_days": (P, "03 Applications"),
    "proxy_url": (P, ""),
    "company_exclude_global": (P, ""),
    "title_exclude_global": (P, ""),
    "body_exclusion_phrases": (P, ""),
    "dedup_tracking_params": (P, ""),
    "scoring_max_concurrent": (P, ""),
    "tailoring_max_concurrent": (P, ""),
    "tracer_links_base_url": (P, ""),
    "tracer_links_url_style": (P, ""),

    # ── AI presets: models, keys, prompts (one active preset per module, Super Admin) ──
    "llm_provider": (AI, "AI presets"),
    "llm_model": (AI, "AI presets"),
    "llm_api_key": (AI, "AI presets"),
    "llm_effort": (AI, "AI presets"),
    "llm_fallback_provider": (AI, "AI presets"),
    "llm_fallback_model": (AI, "AI presets"),
    "llm_fallback_api_key": (AI, "AI presets"),
    "llm_fallback_effort": (AI, "AI presets"),
    "llm_models_list": (AI, "AI presets"),
    "llm_seeded_models": (AI, "AI presets"),
    "prompt_caching_enabled": (AI, "AI presets"),
    "scoring_llm_provider": (AI, "AI presets"),
    "scoring_llm_model": (AI, "AI presets"),
    "scoring_llm_api_key": (AI, "AI presets"),
    "scoring_llm_effort": (AI, "AI presets"),
    "scoring_rubric": (AI, "AI presets"),
    "scoring_output_light": (AI, "AI presets"),
    "scoring_output_full": (AI, "AI presets"),
    "scoring_default_depth": (AI, "AI presets"),
    "cv_tailor_llm_provider": (AI, "AI presets"),
    "cv_tailor_llm_model": (AI, "AI presets"),
    "cv_tailor_llm_api_key": (AI, "AI presets"),
    "cv_tailor_llm_effort": (AI, "AI presets"),
    "cv_tailor_prompt": (AI, "AI presets"),
    "persona_tailor_prompt": (AI, "AI presets"),
    "cover_letter_llm_provider": (AI, "AI presets"),
    "cover_letter_llm_model": (AI, "AI presets"),
    "cover_letter_llm_api_key": (AI, "AI presets"),
    "cover_letter_llm_effort": (AI, "AI presets"),
    "cover_letter_prompt": (AI, "AI presets"),
    "resume_parse_prompt": (AI, "AI presets"),
    "cover_letter_voice_presets": (AI, "AI presets"),
    "email_llm_enabled": (AI, "AI presets"),
    "email_llm_provider": (AI, "AI presets"),
    "email_llm_model": (AI, "AI presets"),
    "email_llm_api_key": (AI, "AI presets"),
    "email_llm_effort": (AI, "AI presets"),
    "email_llm_prompt": (AI, "AI presets"),
    "email_llm_confidence_threshold": (AI, "AI presets"),
    "autofill_llm_provider": (AI, "AI presets"),
    "autofill_llm_model": (AI, "AI presets"),
    "autofill_llm_api_key": (AI, "AI presets"),
    "autofill_llm_effort": (AI, "AI presets"),
    "autofill_prompt": (AI, "AI presets"),

    # ── A firm's or a candidate's choice, platform-wide until its track ──────
    # A résumé id is firm data: scoring must not use another firm's résumé (07 F2c, "default résumé").
    "default_resume_id": (FIRM, "04 Resumes + scoring"),
    "on_save_action": (FIRM, "02 Jobs"),
    "tailor_auto_quick_score": (FIRM, "04 Resumes + scoring"),
    "cover_letter_default_voice": (FIRM, "04 Resumes + scoring"),
    "tracer_links_enabled": (FIRM, "04 Resumes + scoring"),
    "prep_include": (FIRM, "03 Applications"),
    "prep_ask": (FIRM, "03 Applications"),
    "autofill_field_patterns": (FIRM, "Job extension"),
    "autofill_option_synonyms": (FIRM, "Job extension"),
    "autofill_default_length": (FIRM, "Job extension"),
    # Gmail becomes one inbox per candidate (D8).
    "email_check_interval_minutes": (FIRM, "Gmail inbox (D8)"),
    "email_gmail_query_subjects": (FIRM, "Gmail inbox (D8)"),
    "email_gmail_query_senders": (FIRM, "Gmail inbox (D8)"),
    "email_gmail_query_exclusions": (FIRM, "Gmail inbox (D8)"),
    "gmail_processed_ids": (FIRM, "Gmail inbox (D8)"),
    "gmail_refresh_token": (FIRM, "Gmail inbox (D8)"),

    # ── Not part of BenchQ: deleted with the code that reads them ───────────
    "linkedin_email": (UNUSED, "02 Jobs"),
    "linkedin_password": (UNUSED, "02 Jobs"),
    "linkedin_mock_email": (UNUSED, "02 Jobs"),
    "linkedin_mock_password": (UNUSED, "02 Jobs"),
    "linkedin_use_mock_account": (UNUSED, "02 Jobs"),
    "jobright_email": (UNUSED, "02 Jobs"),
    "jobright_password": (UNUSED, "02 Jobs"),
    "jobright_session_id": (UNUSED, "02 Jobs"),
    "jobright_session_obtained_at": (UNUSED, "02 Jobs"),
    "telegram_enabled": (UNUSED, "Production readiness"),
    "telegram_chat_id": (UNUSED, "Production readiness"),
    "telegram_webhook_secret": (UNUSED, "Production readiness"),
    "digest_cron": (UNUSED, "Production readiness"),           # the daily Telegram digest
    "fit_score_threshold": (UNUSED, "Production readiness"),   # the Telegram fit alert
    "feed_zoom_floater": (UNUSED, "02 Jobs"),                  # JobNavigator's own jobs pane
}


def scope_of(key: str) -> Scope:
    return SETTING_SCOPES[key][0]


def keys_in(scope: Scope) -> list[str]:
    return sorted(k for k, (s, _owner) in SETTING_SCOPES.items() if s is scope)
