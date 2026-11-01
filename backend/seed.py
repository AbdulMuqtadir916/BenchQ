"""Seed settings and companies tables with defaults on first run."""
import logging
import json
import secrets
from backend.models.db import SessionLocal, Setting, Company, Search, Resume
from backend.models.tenancy import DEFAULT_FIRM_ID
from backend.analyzer.llm_client import REASONING_EFFORTS
from backend.candidates import parse as resume_parse
from backend.candidates.parse_defaults import (DEFAULT_PROMPT as RESUME_PARSE_PROMPT,
                                               DEFAULT_RESPONSE_FORMAT as RESUME_PARSE_RESPONSE_FORMAT,
                                               DEFAULT_SYSTEM_PROMPT as RESUME_PARSE_SYSTEM_PROMPT,
                                               OLD_DEFAULT_PROMPT as OLD_RESUME_PARSE_PROMPT)

logger = logging.getLogger("jobnavigator.seed")


DEFAULT_SETTINGS = {
    # The new-candidate résumé parser (docs/team/resume-versioning.md §2.2), as an AI preset. Its own model, all three
    # rows required: it never borrows the shared llm_* rows. The key is seeded empty and set on the settings page.
    "resume_parse_system_prompt": (RESUME_PARSE_SYSTEM_PROMPT, "Résumé parser system prompt (new-candidate flow)."),
    "resume_parse_prompt": (RESUME_PARSE_PROMPT, "Editable résumé parser prompt for the new-candidate flow. "
                            "{input_note} (how the text was extracted) and {resume} (the fenced résumé) are filled in; "
                            "{resume} is required."),
    "resume_parse_response_format": (RESUME_PARSE_RESPONSE_FORMAT,
                                     "The parser's strict response format (json_schema, strict: true), sent on every "
                                     "parse. Its schema must require every section the parser stores."),
    "resume_parse_llm_provider": ("openrouter", "Résumé parser provider (required; openrouter only)"),
    "resume_parse_llm_model": ("openai/gpt-6-luna", "Résumé parser model (required)"),
    "resume_parse_llm_api_key": ("", "OpenRouter API key for the résumé parser (required; until set, every parse "
                                 "fails naming this row)"),
    "fit_score_threshold": ("60", "Minimum fit score to trigger Telegram alert"),
    "scrape_interval_minutes": ("60", "How often the job checker runs"),
    "email_check_interval_minutes": ("30", "How often Gmail is polled"),
    "telegram_enabled": ("false", "Toggle all Telegram notifications on/off"),
    "digest_cron": ("0 8 * * *", "Daily digest cron (min hour day month dow). Empty = disabled"),
    "telegram_chat_id": ("", "Your Telegram chat ID"),
    "telegram_webhook_secret": ("", "Auto-generated secret token validated on every /api/telegram/webhook call. Rotate from the Telegram settings tab."),
    "body_exclusion_phrases": (json.dumps([]), "JD phrases that flag exclusion (H-1B, language, etc.). Add phrases to auto-skip jobs containing them."),
    # weekday NAME, not a digit: APScheduler numbers 0 = Monday (vixie cron 0 = Sunday), so "0" fired Monday
    "h1b_cron": ("0 2 * * sun", "H-1B refresh cron (min hour day month dow). Empty = disabled"),
    "cleanup_cron": ("0 4 * * *", "Job cleanup cron (min hour day month dow). Empty = disabled"),
    "job_archive_after_days": ("90", "Delete skipped jobs older than N days (used by cleanup job)"),
    "auto_reject_after_days": ("0", "Reject applications older than N days, 0 = disabled (used by reject job)"),
    "proxy_url": ("", "Optional rotating proxy for scraping"),
    "default_resume_id": ("", "Default base Resume ID used for scoring when no company-level Resumes are configured"),
    "company_exclude_global": (json.dumps([]), "Global company ignore list — applies to all searches"),
    "title_exclude_global": (json.dumps([]), "Global title exclude keywords — applies to all searches and companies"),
    "linkedin_email": ("", "LinkedIn account email for personal scrape mode"),
    "linkedin_password": ("", "LinkedIn account password for personal scrape mode"),
    "linkedin_mock_email": ("", "LinkedIn mock account email for Extension Voyager API"),
    "linkedin_mock_password": ("", "LinkedIn mock account password for Extension Voyager API"),
    "linkedin_use_mock_account": ("false", "Sign the extension session in with the mock account. false = use the personal account (linkedin_email/linkedin_password)"),
    "jobright_email": ("", "Jobright.ai account email"),
    "jobright_password": ("", "Jobright.ai account password"),
    "jobright_session_id": ("", "Jobright.ai session cookie (auto-managed, 60-day expiry)"),
    # The cookie itself is write-only to the UI (redacted on GET), so the
    # Accounts tab needs a plain timestamp to say how long it is still good for.
    "jobright_session_obtained_at": ("", "UTC ISO timestamp of the last successful Jobright login. Read-only; set by the scraper."),
    "reject_cron": ("0 4 * * *", "Auto-reject cron (min hour day month dow). Empty = disabled"),
    "backup_cron": ("0 3 * * *", "Backup cron schedule (min hour day month dow). Empty = disabled"),
    "scoring_rubric": ("Score each resume using these criteria (each 0-20, sum to 0-100):\n1. SKILLS MATCH (weight: 20): How many required technical skills/tools does the candidate have?\n2. EXPERIENCE LEVEL (weight: 20): Does seniority/years match? (entry-level resume for senior role = low)\n3. DOMAIN FIT (weight: 20): Has the candidate worked in the same industry/domain?\n4. ROLE ALIGNMENT (weight: 20): Does the candidate's career trajectory match this role type?\n5. REQUIREMENTS MET (weight: 20): Does the candidate meet stated requirements (education, certs, clearance)?\n\nUse the FULL 0-100 range. 90+ = perfect match. 50-70 = decent with gaps. Below 30 = poor match.\nAvoid clustering scores — differentiate meaningfully between resumes and jobs.", "Editable resume scoring rubric"),
    "scoring_output_light": ('Return ONLY this JSON:\n{\n  "scores": {CV_NAMES_HERE: 0-100},\n  "best_cv": "CV_NAME"\n}', "Light scoring output schema"),
    "scoring_output_full": ('Return ONLY this JSON:\n{\n  "scores": {CV_NAMES_HERE: 0-100},\n  "best_cv": "CV_NAME",\n  "breakdown": {"skills": 0-20, "experience": 0-20, "domain": 0-20, "role": 0-20, "requirements": 0-20},\n  "summary": "2-3 sentence assessment of candidate-job fit",\n  "requirement_mapping": [\n    {"requirement": "JD requirement text", "cv_match": "matching CV line or null", "matched": true/false, "severity": "required or preferred"}\n  ],\n  "keyword_coverage_pct": 0-100,\n  "matched_keywords": ["keyword1", "keyword2"],\n  "missing_keywords": ["keyword3", "keyword4"],\n  "hard_blockers": ["blocker if any"],\n  "ats_tip": "one actionable ATS optimization suggestion"\n}', "Full scoring output schema with keyword analysis"),
    "llm_provider": ("claude_api", "LLM provider: claude_api, claude_code, codex_cli, antigravity_cli, openai, ollama, lmstudio, openrouter"),
    "llm_model": ("claude-sonnet-5", "LLM model name"),
    "llm_api_key": ("", "API key for API-backed providers (not needed for subscription CLIs or Ollama)"),
    "llm_effort": ("", "Reasoning effort for the Primary model (empty = the model's default; values depend on the provider)"),
    "llm_fallback_provider": ("", "Fallback LLM provider (empty = no fallback)"),
    "llm_fallback_model": ("", "Fallback model name"),
    "llm_fallback_api_key": ("", "API key for fallback provider (OpenAI)"),
    "llm_fallback_effort": ("", "Reasoning effort for the fallback model (empty = the model's default; values depend on the provider)"),
    "scoring_llm_provider": ("", "Resume scoring provider override (empty = use Primary)"),
    "scoring_llm_model": ("", "Resume scoring model override (empty = use Primary)"),
    "scoring_llm_api_key": ("", "API key for the scoring provider override"),
    "scoring_llm_effort": ("", "Reasoning effort for the scoring override (empty = the Primary's on the same provider, else the model's default)"),
    "llm_models_list": (json.dumps([
        {"provider": "claude_api", "model": "claude-sonnet-5"},
        {"provider": "claude_api", "model": "claude-sonnet-4-6"},
        {"provider": "claude_api", "model": "claude-opus-5-5"},
        {"provider": "claude_api", "model": "claude-opus-5"},
        {"provider": "claude_api", "model": "claude-opus-4-8"},
        {"provider": "claude_api", "model": "claude-opus-4-7"},
        {"provider": "claude_api", "model": "claude-opus-4-6"},
        {"provider": "claude_api", "model": "claude-haiku-4-5"},
        {"provider": "claude_api", "model": "claude-fable-5-1"},
        {"provider": "claude_api", "model": "claude-fable-5"},
        {"provider": "claude_code", "model": "claude-sonnet-5"},
        {"provider": "claude_code", "model": "claude-sonnet-4-6"},
        {"provider": "claude_code", "model": "claude-opus-5-5"},
        {"provider": "claude_code", "model": "claude-opus-5"},
        {"provider": "claude_code", "model": "claude-opus-4-8"},
        {"provider": "claude_code", "model": "claude-opus-4-7"},
        {"provider": "claude_code", "model": "claude-opus-4-6"},
        {"provider": "claude_code", "model": "claude-haiku-4-5"},
        {"provider": "claude_code", "model": "claude-fable-5-1"},
        {"provider": "claude_code", "model": "claude-fable-5"},
        {"provider": "codex_cli", "model": "gpt-6-astra"},
        {"provider": "codex_cli", "model": "gpt-6-sol"},
        {"provider": "codex_cli", "model": "gpt-6-luna"},
        {"provider": "codex_cli", "model": "gpt-5.6-sol"},
        {"provider": "codex_cli", "model": "gpt-5.6-terra"},
        {"provider": "codex_cli", "model": "gpt-5.6-luna"},
        {"provider": "codex_cli", "model": "gpt-5.5"},
        # Antigravity CLI — Google subscription. Slugs carry the reasoning effort;
        # `agy models` is the live catalog and it also serves non-Google models.
        {"provider": "antigravity_cli", "model": "gemini-3.8-flash-high"},
        {"provider": "antigravity_cli", "model": "gemini-3.8-flash-medium"},
        {"provider": "antigravity_cli", "model": "gemini-3.8-flash-low"},
        {"provider": "antigravity_cli", "model": "gemini-3.7-flash-medium"},
        {"provider": "antigravity_cli", "model": "gemini-3.6-flash-medium"},
        {"provider": "antigravity_cli", "model": "gemini-3.1-pro-high"},
        {"provider": "antigravity_cli", "model": "gemini-3.1-pro-low"},
        {"provider": "antigravity_cli", "model": "claude-sonnet-4-6"},
        {"provider": "antigravity_cli", "model": "claude-opus-4-6-thinking"},
        {"provider": "antigravity_cli", "model": "gpt-oss-120b-medium"},
        {"provider": "openai", "model": "gpt-6-astra"},
        {"provider": "openai", "model": "gpt-6-sol"},
        {"provider": "openai", "model": "gpt-6-luna"},
        {"provider": "openai", "model": "gpt-5.6-sol"},
        {"provider": "openai", "model": "gpt-5.6-terra"},
        {"provider": "openai", "model": "gpt-5.6-luna"},
        {"provider": "openai", "model": "gpt-5.5"},
        {"provider": "openai", "model": "gpt-5.4"},
        {"provider": "openai", "model": "gpt-5.4-mini"},
        {"provider": "openai", "model": "gpt-5.4-nano"},
        {"provider": "openai", "model": "gpt-5.2"},
        {"provider": "openai", "model": "gpt-4o"},
        {"provider": "openai", "model": "gpt-4o-mini"},
        {"provider": "openai", "model": "o3"},
        {"provider": "ollama", "model": "llama3.3:70b"},
        {"provider": "ollama", "model": "llama3.1:8b"},
        {"provider": "ollama", "model": "qwen2.5:32b"},
        {"provider": "ollama", "model": "qwen2.5-coder:7b"},
        {"provider": "ollama", "model": "deepseek-r1:14b"},
        {"provider": "ollama", "model": "mistral:7b"},
        {"provider": "ollama", "model": "gemma2:9b"},
        {"provider": "ollama", "model": "phi3:14b"},
        # OpenRouter — one key reaches every vendor; slugs are vendor-prefixed.
        # A popular starter set; the full ~420 are fetchable in Settings via the API.
        {"provider": "openrouter", "model": "anthropic/claude-fable-5.1"},
        {"provider": "openrouter", "model": "anthropic/claude-opus-5.5"},
        {"provider": "openrouter", "model": "anthropic/claude-opus-5"},
        {"provider": "openrouter", "model": "anthropic/claude-sonnet-5"},
        {"provider": "openrouter", "model": "openai/gpt-6-sol"},
        {"provider": "openrouter", "model": "openai/gpt-6-luna"},
        {"provider": "openrouter", "model": "openai/gpt-5.6-luna"},
        {"provider": "openrouter", "model": "openai/o3-pro"},
        {"provider": "openrouter", "model": "google/gemini-3.8-flash"},
        {"provider": "openrouter", "model": "google/gemini-3.1-pro-preview"},
        {"provider": "openrouter", "model": "deepseek/deepseek-v4-pro"},
        {"provider": "openrouter", "model": "deepseek/deepseek-v3.2"},
        {"provider": "openrouter", "model": "meta-llama/llama-4-maverick"},
        {"provider": "openrouter", "model": "x-ai/grok-4.6"},
        {"provider": "openrouter", "model": "mistralai/mistral-large-2512"},
    ]), "Known LLM models per provider (JSON array, user can add custom entries)"),
    "scoring_max_concurrent": ("5", "Max parallel scoring jobs (others queue until a slot opens)"),
    "tailoring_max_concurrent": ("2", "Max concurrent resume-tailoring LLM calls"),
    "tailor_auto_quick_score": ("light", "After tailoring finishes, auto-launch a score chain. Values: 'off' | 'light' | 'full'. Default 'light'. Legacy 'true'='light', 'false'='off'."),
    "prompt_caching_enabled": ("true", "Use Anthropic prompt caching on resume scoring (claude_api only; ~50% cheaper input tokens on same-batch calls). Set false to disable as a rollback lever."),
    "scoring_default_depth": ("light", "Default scoring depth: light or full"),
    # Dashboard-only switch: the Jobs pane reads it, nothing on the backend does.
    # The zoom LEVEL itself is per-browser (localStorage), never a setting.
    "feed_zoom_floater": ("true", "Show the + / - zoom control on postings in the Jobs pane"),
    "on_save_action": ("off", "Action when job is saved: off, light, or full"),
    "email_llm_enabled": ("false", "Enable LLM second pass for ambiguous email classification"),
    "email_llm_provider": ("", "LLM provider for email classification (empty = use primary llm_provider)"),
    "email_llm_model": ("", "LLM model for email classification (empty = use primary llm_model)"),
    "email_llm_api_key": ("", "API key for email LLM provider"),
    "email_llm_effort": ("", "Reasoning effort for email classification (empty = the Primary's on the same provider, else the model's default)"),
    "email_llm_confidence_threshold": ("70", "Min confidence (0-100) to auto-act on LLM email classification"),
    "email_llm_prompt": ("Classify this email and match it to one active application if possible.\n\nRules:\n- match_index: pick from the numbered applications below (1-based), or null if no match\n- status: one of: interview, offer, rejected, no_change\n- confidence: 0-100 how sure you are about classification AND match combined\n- summary: one sentence describing what the email is about\n\nActive applications:\n{applications}\n\nEmail:\nFrom: {from}\nSubject: {subject}\nBody:\n{body}\n\nReturn ONLY this JSON:\n{\"match_index\": null, \"status\": \"no_change\", \"confidence\": 0, \"summary\": \"\"}", "Editable email classification LLM prompt template"),
    "email_gmail_query_subjects": (json.dumps([
        "application", "thank you for applying", "thanks for applying",
        "application received", "application submitted", "your application",
        "interview", "assessment", "coding challenge", "take-home",
        "availability", "offer", "offer letter", "referral", "recruiter",
        "hiring team", "regret to inform", "not moving forward", "not selected",
        "application unsuccessful", "moving forward with other candidates",
        "unable to proceed", "position has been filled", "hiring freeze",
        "position on hold", "withdrawn"
    ]), "Subject keywords for Gmail search query"),
    "email_gmail_query_senders": (json.dumps([
        "careers@", "jobs@", "recruiting@", "talent@",
        "no-reply@greenhouse.io", "no-reply@us.greenhouse-mail.io",
        "no-reply@ashbyhq.com", "notification@smartrecruiters.com",
        "@smartrecruiters.com", "@workablemail.com", "@hire.lever.co",
        "@myworkday.com", "@workdaymail.com", "@greenhouse.io", "@ashbyhq.com"
    ]), "Sender patterns for Gmail search query"),
    "email_gmail_query_exclusions": (json.dumps([
        "newsletter", "webinar", "course", "discount",
        "event invitation", "job search council", "matched new opportunities"
    ]), "Subject terms to exclude from Gmail search query"),
    "cv_tailor_llm_provider": ("", "LLM provider for resume tailoring (empty = use primary llm_provider)"),
    "cv_tailor_llm_model": ("", "LLM model for resume tailoring (empty = use primary llm_model)"),
    "cv_tailor_llm_api_key": ("", "API key for resume tailoring LLM provider"),
    "cv_tailor_llm_effort": ("", "Reasoning effort for resume tailoring (empty = the Primary's on the same provider, else the model's default)"),
    "cv_tailor_prompt": ("Tailor this resume for the job description below.\n\nRules for MAIN bullets[]:\n- Rewrite the summary to target this specific role\n- For each experience bullet: if it benefits from JD keyword alignment, reformulate it. If it's already well-suited, leave it UNCHANGED\n- Keep the same number of bullets per experience entry - do not add or remove\n- Reorder skills to prioritize JD-relevant ones first\n- Do NOT invent new experience, skills, or facts in the main bullets. If something is missing, map to the closest truthful concept\n- NEVER add skills the candidate does not have\n- Preserve all company names, titles, dates, locations, education exactly\n- Do NOT use em-dashes or unicode special characters. Use regular hyphens (-) and ASCII only\n- Preserve **bold** formatting (double asterisks) from the original bullets. For reformulated bullets, wrap the strongest metric or achievement in **bold** (e.g. **40,000+ new clients**, **reduced error rates by 30%**). Each bullet should have at most one bold highlight\n- VERIFICATION: every reformulated bullet must trace to the original resume. If you cannot trace it, leave the original unchanged.\n\nRules for suggested_bullets[] (gap-fillers - DIFFERENT from main bullets):\n- For each experience entry, generate 1-2 PLAUSIBLE STAR-format bullets that cover JD keywords/skills no existing bullet in this role covers\n- These MAY invent realistic, believable facts/metrics that someone in this role/title at this company at this seniority would credibly have done\n- Specifically target keywords from the JD that no existing bullet mentions\n- Use STAR format: strong action verb, context, concrete (possibly invented) metric or outcome\n- The user reviews these in a diff modal and accepts/rejects each - they know suggestions are speculative gap-fillers\n- Wrap the strongest metric in **bold** (one per bullet)\n- Skip a role entirely if no JD keyword gap exists for it\n\nResume:\n{resume_json}\n\nJob Description:\n{job_description}\n\nReturn ONLY this JSON:\n{\"summary\": \"rewritten summary\", \"experience\": [{\"company\": \"unchanged\", \"title\": \"unchanged\", \"location\": \"unchanged\", \"date\": \"unchanged\", \"description\": \"unchanged or null\", \"bullets\": [\"reformulated or unchanged bullet from existing content\"], \"suggested_bullets\": [\"plausible gap-filler covering missing JD keyword\"]}], \"skills\": {\"reordered label\": \"reordered value\"}}", "Editable resume tailoring LLM prompt template"),
    "persona_tailor_prompt": ("Tailor a FOCUSED resume from this rich candidate profile, targeted at the job description below.\n\nThe candidate profile is a deep pool - most roles have many bullets. SELECT only the strongest aligned with the JD; drop the rest.\n\nRules for MAIN bullets[]:\n- Rewrite the summary to target this specific role (2-4 sentences, lead with the most relevant strength)\n- For each experience entry: SELECT only 3-5 bullets (max 6 for the most senior/recent role) that best match JD keywords and required skills\n- Reformulate each selected bullet to use the JD's exact vocabulary where possible\n- Reorder skills to prioritize JD-relevant ones first; cap at 6 categories\n- Do NOT invent new experience, skills, or facts in the main bullets. Only reframe existing content from the candidate profile\n- NEVER add skills the candidate does not have\n- Preserve all company names, titles, dates, locations, education exactly\n- Do NOT use em-dashes or unicode special characters. Use regular hyphens (-) and ASCII only\n- Preserve **bold** formatting. For reformulated bullets, wrap the strongest metric in **bold** (one per bullet)\n- VERIFICATION: every selected/reformulated bullet must be traceable to the candidate profile\n\nRules for suggested_bullets[] (gap-fillers - DIFFERENT from main bullets):\n- For each experience entry, generate 1-2 PLAUSIBLE STAR-format bullets that cover JD keywords/skills no main bullet (selected from the pool) covers\n- These MAY invent realistic, believable facts/metrics that someone in this role at this company at this seniority would credibly have done\n- Specifically target JD keywords that no main bullet mentions\n- STAR format: strong action verb, context, concrete (possibly invented) metric or outcome\n- The user reviews these in a diff modal and accepts/rejects each\n- Wrap the strongest metric in **bold** (one per bullet)\n- Skip a role if no JD keyword gap exists\n\nCandidate Profile:\n{resume_json}\n\nJob Description:\n{job_description}\n\nReturn ONLY this JSON:\n{\"summary\": \"rewritten summary\", \"experience\": [{\"company\": \"unchanged\", \"title\": \"unchanged\", \"location\": \"unchanged\", \"date\": \"unchanged\", \"description\": \"unchanged or null\", \"bullets\": [\"selected + reformulated bullet from candidate profile\"], \"suggested_bullets\": [\"plausible gap-filler covering missing JD keyword\"]}], \"skills\": {\"reordered label\": \"reordered value\"}}", "Editable Persona tailoring LLM prompt template - used when base_resume_id='persona' to constrain bullet selection from the rich pool"),
    "cover_letter_llm_provider": ("", "LLM provider for cover-letter generation (empty = use primary llm_provider)"),
    "cover_letter_llm_model": ("", "LLM model for cover-letter generation (empty = use primary llm_model)"),
    "cover_letter_llm_api_key": ("", "API key for cover-letter LLM provider"),
    "cover_letter_llm_effort": ("", "Reasoning effort for cover-letter generation (empty = the Primary's on the same provider, else the model's default)"),
    "cover_letter_prompt": ("Write a cover letter for the candidate, targeting the job described below.\n\nGround everything in the candidate's resume (provided above) and the persona preferences. Do NOT invent experience, employers, titles, metrics, or skills the resume does not contain. Pull concrete achievements from the resume; reframe them toward what the job needs.\n\nStructure:\n- A short greeting line (use the recipient/company if known, else a neutral 'Dear Hiring Team,').\n- 3 body paragraphs: (1) a hook that connects the candidate to this specific role/company, (2) the strongest 2-3 proof points from the resume mapped to the job's needs, (3) a brief close on motivation/fit and a call to talk.\n- A closing line ('Sincerely,') and the candidate's name as signature.\n\nStyle:\n- {voice_instruction}\n- Length: {length_instruction}\n- First person. No corporate cliches, no 'I am writing to apply'. No em-dashes or unicode; ASCII only. Do NOT fabricate.\n\nJob:\n{job_description}\n\nReturn ONLY this JSON:\n{\"greeting\": \"Dear ...,\", \"body_paragraphs\": [\"...\", \"...\", \"...\"], \"closing\": \"Sincerely,\", \"signature\": \"Candidate Name\"}", "Editable cover-letter generation LLM prompt. Placeholders: {voice_instruction}, {length_instruction}, {job_description}."),
    "cover_letter_voice_presets": (json.dumps([
        {"id": "professional", "label": "Professional & direct", "instruction": "Concise, concrete, results-first. No corporate filler or cliches."},
        {"id": "warm", "label": "Warm & personable", "instruction": "First-person, genuine enthusiasm, conversational but polished."},
        {"id": "formal", "label": "Formal & traditional", "instruction": "Classic business-letter register, measured and respectful."},
        {"id": "confident", "label": "Confident & bold", "instruction": "Lead with strong claims and leadership framing; assertive but not arrogant."},
        {"id": "storytelling", "label": "Storytelling", "instruction": "Open with a brief hook or narrative, then connect it to the role."},
    ]), "Editable cover-letter voice presets: list of {id, label, instruction}. The selected preset's instruction is injected into the generation prompt."),
    "cover_letter_default_voice": ("professional", "Default voice preset id for new cover letters (must match an id in cover_letter_voice_presets)"),
    "autofill_field_patterns": (json.dumps({
        "gender": ["gender", "what is your gender", "gender identity"],
        "race_ethnicity": ["race", "ethnicity", "race/ethnicity", "racial background", "ethnicities"],
        "veteran_status": ["veteran", "protected veteran", "vevraa"],
        "hispanic_latino": ["hispanic or latino", "hispanic/latino", "are you hispanic", "hispanic latino"],
        "disability_status": ["disability", "disabled", "section 503"],
        "age_range": ["current age", "your age", "age range", "how old", "what is your age"],
        "transgender": ["transgender", "identify as transgender", "trans"],
        "sexual_orientation": ["sexual orientation", "your sexual orientation", "how do you identify your sexual"],
        "authorized_us": ["authorized to work", "legally authorized", "work authorization"],
        "requires_sponsorship_now": ["require sponsorship", "need sponsorship", "visa sponsorship", "require immigration", "immigration sponsorship"],
        "requires_sponsorship_future": ["future sponsorship", "sponsorship in the future"],
        "over_18": ["over 18", "at least 18", "18 years of age"],
        "first_name": ["first name", "given name"],
        "last_name": ["last name", "surname", "family name"],
        "full_name": ["full name", "your name", "legal name"],
        "email": ["email"],
        "phone": ["phone", "mobile", "telephone"],
        "city": ["city", "current location", "location"],
        "state": ["state", "province"],
        "country": ["country"],
        "linkedin": ["linkedin"],
        "github": ["github"],
        "portfolio": ["portfolio", "personal website", "website"],
        "current_company": ["current company", "current employer"],
        "willing_to_relocate": ["relocate", "willing to relocate"],
        "willing_remote": ["work remotely", "remote work"],
        "desired_salary": ["desired salary", "salary expectation", "expected salary", "compensation expectation"],
        "notice_period": ["notice period"],
        "earliest_start": ["start date", "available to start", "earliest start"],
        "referral_source": ["referral source", "referred by"],
        "how_did_you_hear": ["how did you hear"],
    }), "Editable dictionary: canonical autofill key -> list of label synonyms used to match a form field to an answer"),
    "autofill_option_synonyms": (json.dumps({
        "veteran_status": {
            "protected_veteran": ["i am a protected veteran", "identify as one or more", "yes"],
            "not_protected_veteran": ["not a protected veteran", "not a veteran", "no"],
            "decline": ["decline", "don't wish to answer", "do not wish to answer", "prefer not"],
        },
        "hispanic_latino": {
            "yes": ["hispanic or latino", "yes, i am", "yes"],
            "no": ["not hispanic or latino", "no, i am not", "no"],
            "decline": ["decline", "don't wish to answer", "prefer not"],
        },
        "disability_status": {
            "yes": ["yes, i have a disability", "yes", "i have a disability"],
            "no": ["no, i don't have a disability", "no", "do not have a disability"],
            "decline": ["decline", "do not want to answer", "prefer not"],
        },
        "gender": {
            "male": ["male", "man"],
            "female": ["female", "woman"],
            "nonbinary": ["non-binary", "nonbinary", "other"],
            "decline": ["decline", "prefer not", "don't wish"],
        },
        "race_ethnicity": {
            "hispanic_latino": ["hispanic", "latino", "latinx"],
            "white": ["white"],
            "black": ["black", "african american"],
            "asian": ["asian"],
            "native_american": ["native american", "alaska native", "american indian"],
            "pacific_islander": ["pacific islander", "native hawaiian"],
            "two_or_more": ["two or more"],
            "decline": ["decline", "prefer not", "don't wish"],
        },
        "work_auth_type": {
            "citizen": ["u.s. citizen", "us citizen", "citizen"],
            "permanent_resident": ["permanent resident", "green card"],
            "visa": ["visa", "work visa"],
            "other": ["other"],
        },
        "age_range": {
            "under_30": ["under 30", "under 30 years", "less than 30"],
            "30_39": ["30-39", "30 - 39", "30 to 39"],
            "40_49": ["40-49", "40 - 49", "40 to 49"],
            "50_59": ["50-59", "50 - 59", "50 to 59"],
            "60_plus": ["60 or older", "60+", "60 and over", "over 60"],
            "decline": ["prefer not to answer", "decline", "don't wish", "do not wish"],
        },
        "transgender": {
            "yes": ["yes"],
            "no": ["no"],
            "decline": ["prefer not to answer", "decline", "don't wish", "do not wish"],
        },
        "sexual_orientation": {
            "heterosexual": ["heterosexual", "straight"],
            "gay": ["gay"],
            "lesbian": ["lesbian"],
            "bisexual": ["bisexual"],
            "queer": ["queer"],
            "other": ["other"],
            "decline": ["prefer not to answer", "decline", "don't wish", "do not wish"],
        },
        "_bool": {
            "true": ["yes", "true"],
            "false": ["no", "false"],
        },
    }), "Editable dictionary: enum key -> {enum value -> list of option-text synonyms}; '_bool' maps yes/no. Used to pick the right option on a form."),
    "tracer_links_enabled": ("false", "Enable URL rewriting in PDF generation with tracking links"),
    "tracer_links_base_url": ("", "Public base URL for tracer links (e.g., https://yourdomain.com)"),
    "tracer_links_url_style": ("path", "URL format: path or param. Token: random or job_id. Combinations: path, param, path_jobid, param_jobid"),
    "dedup_tracking_params": (json.dumps([
        "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "mode",
        "src", "source", "ref", "refid", "refsrc", "refsource",
        "origin", "from", "channel", "medium",
        "gns", "gnk", "gni",
        "trk", "trackingid", "tracking_id", "currentjobid",
        "ebp", "recommendedflavor",
        "gh_src", "lever_source", "lever_origin",
        "lever-source", "lever-origin", "lever-source[]", "lever-source%5b%5d",
        "visitid", "impid",
        "jz",
        "iis", "iisn",
        "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid",
        "_ga", "_gl", "dclid", "zanpid",
        "igshid", "yclid", "twclid",
        "_hsenc", "_hsmi", "mkt_tok",
        "jclickid", "publisher",
        "p_sid", "p_uid", "ss",
        "__jvsd", "__jvst", "jobpipeline", "cmpid", "codes", "feedid",
        "partnerid", "siteid", "bid", "customredirect",
        "chnlid", "v", "ccd", "frd", "r", "a",
        # "jk" deliberately absent — it is Indeed's job identity, and stripping
        # it collapsed every Indeed posting onto one external_id.
        # Search-context noise (career page filters that leak into job hrefs):
        "categories", "cities", "locations", "departments", "teams", "regions", "country", "category",
    ]), "URL query params stripped before dedup hashing — tracking/referral noise"),
    "autofill_llm_provider": ("", "LLM provider for application autofill (empty = use primary llm_provider)"),
    "autofill_llm_model": ("", "LLM model for application autofill (empty = use primary llm_model)"),
    "autofill_llm_api_key": ("", "API key for the autofill LLM (empty = use the primary llm_api_key)"),
    "autofill_llm_effort": ("", "Reasoning effort for application autofill (empty = the Primary's on the same provider, else the model's default)"),
    "autofill_default_length": ("250", "Default target character length for autofill answers when a field has no maxlength"),
    "autofill_prompt": (
        "You are the candidate, writing a short first-person answer to a job-application question.\n\n"
        "Use ONLY facts from the candidate profile and the reusable Q&A bank below. Never invent employers, "
        "titles, metrics, or skills. If the Q&A bank already answers this (or a close variant), adapt that answer "
        "to this company and role instead of writing from scratch.\n\n"
        "Write like a real person: specific, direct, plain. No corporate filler or buzzwords (no 'leverage', "
        "'passionate', 'excited to', 'thrilled', 'synergy', 'mission-driven'), no generic mission-statement lines, "
        "no restating the question. ASCII only, no em-dashes. Keep it at or under {max_chars} characters.\n\n"
        "Put the finished answer (first person, no preamble, no meta-commentary) inside the JSON below, and put "
        "NOTHING outside it — no reasoning, no notes about the profile, no 'I'll write...' lines.\n\n"
        "CANDIDATE PROFILE:\n{persona}\n\n"
        "Q&A BANK (reusable prior answers):\n{qa_bank}\n\n"
        "TARGET: {company} - {position}\n"
        "QUESTION: {question}\n\n"
        "Return ONLY this JSON:\n{\"answer\": \"...\"}",
        "Editable application-autofill LLM prompt. Placeholders: {persona}, {qa_bank}, {company}, {position}, {question}, {max_chars}."
    ),
    "prep_include": ("resume,posting,notes",
        "Sections the interview prep handover includes by default (comma-separated: resume, posting, notes)"),
    "prep_ask": (
        "Prepare me for this interview. Ground every answer in my resume above — use my real projects, "
        "employers and numbers, and invent nothing.\n\n"
        "1. The 10 questions this panel is most likely to ask, ordered by likelihood, with a short answer for each.\n"
        "2. Every requirement in the posting I do not clearly meet, the honest framing to use, and the closest "
        "adjacent experience I can point to.\n"
        "3. Two or three stories from my background worth rehearsing, in STAR form.\n"
        "4. The questions I should ask them that show I read this posting closely.\n"
        "5. Anything in my resume that is a liability for this role, and how to handle it if raised.",
        "The closing 'What I need from you' section of the interview prep handover (Applications → Generate prep handover for AI)."
    ),
}

# Settings the app writes at runtime but never seeds. PATCH /api/settings rejects
# keys outside DEFAULT_SETTINGS, so these have to be listed explicitly.
RUNTIME_SETTING_KEYS = {
    "gmail_processed_ids",   # email_monitor/gmail_client.py — processed-message dedup
    "gmail_refresh_token",   # Gmail OAuth setup (gmail_oauth_setup.py)
    "llm_seeded_models",     # migrate_llm_settings() — one-time "defaults offered" marker
}


def is_known_setting(key: str) -> bool:
    """True if PATCH /api/settings may write this key."""
    return key in DEFAULT_SETTINGS or key in RUNTIME_SETTING_KEYS


def unknown_setting_keys(keys) -> list:
    """The subset of `keys` no reader in the codebase would ever look at."""
    return [k for k in keys if not is_known_setting(k)]


# ── Value validation ─────────────────────────────────────────────────────────
# The value shapes the app actually parses (int, cron, enum) are validated here,
# so an unparseable value can't reach configure_scheduler() and crash the backend.

def _int_setting_keys() -> set:
    """Every seeded key whose default is a plain integer, derived (not listed) so a new numeric default automatically picks up the guard."""
    keys = set()
    for key, (value, _desc) in DEFAULT_SETTINGS.items():
        if not isinstance(value, str):
            continue
        try:
            int(value)
        except (TypeError, ValueError):
            continue
        keys.add(key)
    return keys


INT_SETTING_KEYS = _int_setting_keys()

# Providers the LLM dispatcher knows how to call. "" means "inherit the primary
# llm_provider", which every per-feature prefix does.
_LLM_PROVIDERS = {"", "claude_api", "claude_code", "codex_cli", "antigravity_cli", "openai", "ollama", "lmstudio", "openrouter"}

# Depth words. `tailor_auto_quick_score` also honours legacy boolean spellings
# (see routes_resumes._resolve_chain_score_depth).
_DEPTHS = {"light", "full"}

# Every effort any provider takes; llm_client drops a value the chosen provider lacks.
_EFFORTS = {""} | {e for values in REASONING_EFFORTS.values() for e in values}

ENUM_SETTING_VALUES = {
    "llm_provider": _LLM_PROVIDERS,
    "llm_fallback_provider": _LLM_PROVIDERS,
    "scoring_llm_provider": _LLM_PROVIDERS,
    "email_llm_provider": _LLM_PROVIDERS,
    "cv_tailor_llm_provider": _LLM_PROVIDERS,
    "cover_letter_llm_provider": _LLM_PROVIDERS,
    "autofill_llm_provider": _LLM_PROVIDERS,
    # The parser sends a strict format and reasoning-off, which only its openrouter call carries.
    "resume_parse_llm_provider": {"openrouter"},
    "llm_effort": _EFFORTS,
    "llm_fallback_effort": _EFFORTS,
    "scoring_llm_effort": _EFFORTS,
    "email_llm_effort": _EFFORTS,
    "cv_tailor_llm_effort": _EFFORTS,
    "cover_letter_llm_effort": _EFFORTS,
    "autofill_llm_effort": _EFFORTS,
    "scoring_default_depth": _DEPTHS,
    "on_save_action": {"off"} | _DEPTHS,
    "tailor_auto_quick_score": {"off", "false", "no", "0", "true", "yes", "1", ""} | _DEPTHS,
    "tracer_links_url_style": {"path", "param", "path_jobid", "param_jobid"},
}


def _cron_error(value: str) -> str | None:
    """None if `value` is a usable 5-field cron expression (empty = disabled)."""
    expr = (value or "").strip()
    if not expr:
        return None                      # empty disables the job — always allowed
    if len(expr.split()) != 5:
        return "needs exactly 5 whitespace-separated fields (min hour day month dow)"
    try:
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:                  # pragma: no cover - apscheduler always present in the app
        return None
    try:
        CronTrigger.from_crontab(expr)
    except (ValueError, KeyError) as e:
        return f"not a valid cron expression ({e})"
    return None


def invalid_setting_values(updates: dict) -> list:
    """Human-readable complaints for every value the app could not parse back, one entry per offending key so PATCH can reject the whole request at once."""
    problems = []
    for key, value in sorted(updates.items()):
        if key in INT_SETTING_KEYS:
            ok = False
            if isinstance(value, bool):
                ok = False               # True/False are ints in Python; not here
            elif isinstance(value, int):
                ok = True
            elif isinstance(value, str):
                try:
                    int(value.strip())
                    ok = True
                except (TypeError, ValueError):
                    ok = False
            if not ok:
                problems.append(f"{key}: must be a whole number (got {value!r})")
            elif int(str(value).strip()) < 0:
                problems.append(f"{key}: must not be negative (got {value!r})")
            continue
        if key.endswith("_cron"):
            if not isinstance(value, str):
                problems.append(f"{key}: must be a cron string (got {value!r})")
                continue
            err = _cron_error(value)
            if err:
                problems.append(f"{key}: {err}")
            continue
        allowed = ENUM_SETTING_VALUES.get(key)
        if allowed is not None:
            if not isinstance(value, str) or value.strip().lower() not in allowed:
                shown = ", ".join(sorted(v for v in allowed if v)) or "(empty)"
                problems.append(f"{key}: must be one of {shown} (got {value!r})")
    # The parser's response format and prompt: a broken one would fail every parse (candidates/parse.py).
    return problems + resume_parse.setting_problems(updates)


SEED_COMPANIES = [
    # Example companies — one per ATS type. All inactive by default.
    # Greenhouse
    {"name": "Cloudflare", "tier": 2, "scrape_urls": ["https://boards.greenhouse.io/cloudflare"]},
    # Greenhouse
    {"name": "Anthropic", "tier": 1, "scrape_urls": ["https://job-boards.greenhouse.io/anthropic"]},
    # Ashby
    {"name": "OpenAI", "tier": 1, "scrape_urls": ["https://jobs.ashbyhq.com/openai/"]},
    # Workday
    {"name": "Salesforce", "tier": 1, "scrape_urls": ["https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site?CF_-_REC_-_LRV_-_Job_Posting_Anchor_-_Country_from_Job_Posting_Location_Extended=bc33aa3152ec42d4995f4791a106ed09"]},
    # Lever
    {"name": "Plaid", "tier": 2, "scrape_urls": ["https://jobs.lever.co/plaid"]},
    # Rippling
    {"name": "Rippling", "tier": 3, "scrape_urls": ["http://ats.rippling.com/rippling/jobs?workLocation=United+States"]},
    # Meta Careers (Playwright DOM)
    {"name": "Meta", "tier": 2, "scrape_urls": ["https://www.metacareers.com/jobsearch?offices[0]=Menlo%20Park%2C%20CA&teams[0]=Technical%20Program%20Management&teams[1]=Product%20Management&sort_by_new=true"]},
    # Google Careers (Playwright DOM)
    {"name": "Google", "tier": 2, "scrape_urls": ["https://www.google.com/about/careers/applications/jobs/results?location=United%20States"]},
    # Apple (API)
    {"name": "Apple", "tier": 2, "scrape_urls": ["https://jobs.apple.com/en-us/search?sort=relevance&location=united-states-USA"]},
    # Oracle HCM
    {"name": "Oracle", "tier": 3, "scrape_urls": ["https://careers.oracle.com/en/sites/jobsearch/jobs?lastSelectedFacet=LOCATIONS&selectedLocationsFacet=300000000149325"]},
    # Phenom People
    {"name": "Cisco", "tier": 3, "scrape_urls": ["POST|https://careers.cisco.com/widgets|{\"sortBy\":\"\",\"subsearch\":\"\",\"jobs\":true,\"counts\":true,\"all_fields\":[\"category\",\"raasJobRequisitionType\",\"country\",\"state\",\"city\",\"type\",\"RemoteType\"],\"pageName\":\"search-results\",\"clearAll\":false,\"jdsource\":\"facets\",\"isSliderEnable\":false,\"pageId\":\"page4\",\"siteType\":\"external\",\"keywords\":\"\",\"global\":true,\"selected_fields\":{\"raasJobRequisitionType\":[\"Professional\"],\"country\":[\"United States of America\"]},\"lang\":\"en_global\",\"deviceType\":\"desktop\",\"country\":\"global\",\"refNum\":\"CISCISGLOBAL\"}"]},
    # TalentBrew
    {"name": "Intuit", "tier": 2, "scrape_urls": ["https://jobs.intuit.com/search-jobs/results?ActiveFacetID=6252001-5332921&CurrentPage=1&RecordsPerPage=15&TotalContentResults=&Distance=50&RadiusUnitType=0&Keywords=&Location=United+States&ShowRadius=False&IsPagination=False&CustomFacetName=&FacetTerm=&FacetType=0&FacetFilters%5B0%5D.ID=6252001-5332921&FacetFilters%5B0%5D.FacetType=3&FacetFilters%5B0%5D.Count=435&FacetFilters%5B0%5D.Display=California%2C+United+States&FacetFilters%5B0%5D.IsApplied=true&FacetFilters%5B0%5D.FieldName=&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=1&OrganizationIds=27595&PostalCode=&ResultsType=0&fc=&fl=&fcf=&afc=&afl=&afcf=&TotalContentPages=NaN"]},
]


def seed_settings(db):
    """Insert default settings if they don't exist."""
    existing = {s.key for s in db.query(Setting).all()}
    for key, (value, desc) in DEFAULT_SETTINGS.items():
        if key not in existing:
            db.add(Setting(key=key, value=value, description=desc))
    db.commit()
    upgrade_resume_parse_prompt(db)
    # One-shot: a DB that already holds a mock account keeps signing in with it;
    # every other DB starts on the personal account.
    if "linkedin_use_mock_account" not in existing:
        mock = db.query(Setting).filter(Setting.key == "linkedin_mock_email").first()
        if mock is not None and (mock.value or "").strip():
            db.query(Setting).filter(Setting.key == "linkedin_use_mock_account").update({"value": "true"})
            db.commit()
    # One-shot: seeded empty above so the row is visible in /api/settings; the
    # real cryptographically random value is generated here on first run.
    row = db.query(Setting).filter(Setting.key == "telegram_webhook_secret").first()
    if row is not None and not (row.value or "").strip():
        row.value = secrets.token_urlsafe(32)
        db.commit()


def upgrade_resume_parse_prompt(db):
    """Seeding never replaces a row, so a database seeded with the onboarding parser's prompt would keep it. Replace
    it with the base-résumé parser's only while it is still that old default; an edited prompt is left alone (the
    save check and the parse's own check name it if it lacks {resume}). Idempotent, so every worker may run it."""
    row = db.query(Setting).filter(Setting.key == "resume_parse_prompt").first()
    if row is not None and (row.value or "").strip() == OLD_RESUME_PARSE_PROMPT.strip():
        row.value = RESUME_PARSE_PROMPT
        row.description = DEFAULT_SETTINGS["resume_parse_prompt"][1]
        db.commit()
        logger.info("resume_parse_prompt upgraded to the base-résumé parser's default")


def seed_companies(db):
    """Insert seed companies if table is empty."""
    if db.query(Company).count() > 0:
        return
    for c in SEED_COMPANIES:
        db.add(Company(
            name=c["name"],
            tier=c.get("tier"),
            scrape_urls=c["scrape_urls"],
            active=False,
            playwright_enabled=True,
        ))
    db.commit()


H1B_SLUG_OVERRIDES = {
    # Add H-1B slug overrides for MyVisaJobs.com lookups. Example:
    # "Acme Corp": "acme-corporation",
}


def seed_h1b_slugs(db):
    """Migrate hardcoded H-1B slug overrides into Company records."""
    for name, slug in H1B_SLUG_OVERRIDES.items():
        company = db.query(Company).filter(Company.name == name).first()
        if company and not company.h1b_slug:
            company.h1b_slug = slug
    db.commit()


def cleanup_removed_settings(db):
    """Remove settings that have been removed from DEFAULT_SETTINGS."""
    removed_keys = [
        "followup_reminder_days",
        "h1b_exclusion_phrases",
        "language_exclude_phrases",
        "default_cv_id",
        # Seeded but read by no code: max_jobs_per_scrape promised a per-run cap
        # nothing enforced; company_domains/ats_domains were a retired Gmail-detection design.
        "max_jobs_per_scrape",
        "company_domains",
        "ats_domains",
        # Duplicated the Persona's own decline_demographics checkbox.
        "autofill_decline_self_id",
        # openai_compat provider removed — these were only for it.
        "llm_base_url",
        "llm_fallback_base_url",
        # structured-autofill on/off + trigger live in the extension popup, not
        # server settings — they're per-browser preferences.
        "autofill_structured_enabled",
        "autofill_structured_trigger",
    ]
    for key in removed_keys:
        row = db.query(Setting).filter(Setting.key == key).first()
        if row:
            db.delete(row)
    db.commit()


def migrate_cv_terminology(db):
    """Rename 'CV'/'CVs' -> 'Resume'/'Resumes' in editable prompt-text settings; word-boundary matching leaves template tokens like CV_NAMES_HERE intact."""
    import re
    for key in ("scoring_rubric",):
        row = db.query(Setting).filter(Setting.key == key).first()
        if not row or not row.value:
            continue
        new = re.sub(r"\bCVs\b", "Resumes", row.value)
        new = re.sub(r"\bCV\b", "Resume", new)
        if new != row.value:
            row.value = new
    db.commit()


def migrate_llm_settings(db):
    """Refresh llm_models_list to current defaults, re-point openai_compat settings to openai, and rename the dated haiku model alias."""
    # Additive seed: default models are offered ONCE (tracked in llm_seeded_models);
    # after that the user's list is authoritative, but genuinely-new defaults still propagate.
    row = db.query(Setting).filter(Setting.key == "llm_models_list").first()
    seen_row = db.query(Setting).filter(Setting.key == "llm_seeded_models").first()
    if seen_row is None:
        seen_row = Setting(key="llm_seeded_models", value="[]",
                           description="Internal: default model keys already offered, so user deletions persist across restarts")
        db.add(seen_row)
    if row and row.value:
        try:
            current = json.loads(row.value)
        except (ValueError, TypeError):
            current = []
        current = [m for m in current if m.get("provider") != "openai_compat"]
        default_list = json.loads(DEFAULT_SETTINGS["llm_models_list"][0])
        try:
            seen = set(json.loads(seen_row.value or "[]"))
        except (ValueError, TypeError):
            seen = set()
        mkey = lambda m: f'{m.get("provider")}|{m.get("model")}'
        have = {mkey(m) for m in current}
        for d in default_list:
            dk = mkey(d)
            if dk not in seen and dk not in have:  # new default the user never removed
                current.append(d)
                have.add(dk)
            seen.add(dk)
        seen_row.value = json.dumps(sorted(seen))
        row.value = json.dumps(current)

    provider_keys = ["llm_provider", "llm_fallback_provider", "email_llm_provider",
                     "cv_tailor_llm_provider", "cover_letter_llm_provider", "autofill_llm_provider",
                     "scoring_llm_provider"]
    for key in provider_keys:
        r = db.query(Setting).filter(Setting.key == key).first()
        if r and r.value == "openai_compat":
            r.value = "openai"

    model_keys = ["llm_model", "llm_fallback_model", "email_llm_model",
                  "cv_tailor_llm_model", "cover_letter_llm_model", "autofill_llm_model",
                  "scoring_llm_model"]
    for key in model_keys:
        r = db.query(Setting).filter(Setting.key == key).first()
        if r and r.value == "claude-haiku-4-5-20251001":
            r.value = "claude-haiku-4-5"

    db.commit()


SEED_SEARCHES = [
    {
        "name": "Extension LI",
        "active": True,
        "search_mode": "linkedin_extension",
        "sources": [],
        "title_include_keywords": [],
        "title_exclude_keywords": [],
        "company_exclude": [],
        "auto_scoring_depth": "off",
    },
    {
        "name": "Extension",
        "active": True,
        "search_mode": "extension",
        "sources": [],
        "title_include_keywords": [],
        "title_exclude_keywords": [],
        "company_exclude": [],
        "auto_scoring_depth": "light",
    },
    {
        "name": "Keyword Search",
        "active": False,
        "search_mode": "keyword",
        "sources": ["linkedin", "indeed", "zip_recruiter", "google"],
        "title_include_keywords": ["product manager", "program manager"],
        "title_exclude_keywords": [],
        "company_exclude": [],
        "auto_scoring_depth": "off",
    },
    {
        "name": "Levels.fyi",
        "active": False,
        "search_mode": "levels_fyi",
        "sources": [],
        "title_include_keywords": [],
        "title_exclude_keywords": [],
        "company_exclude": [],
        "auto_scoring_depth": "off",
    },
    {
        "name": "LinkedIn Personal",
        "active": False,
        "search_mode": "linkedin_personal",
        "sources": ["recommended", "top_applicant"],
        "title_include_keywords": [],
        "title_exclude_keywords": [],
        "company_exclude": [],
        "auto_scoring_depth": "off",
    },
    {
        "name": "Jobright.ai",
        "active": False,
        "search_mode": "jobright",
        "sources": [],
        "title_include_keywords": [],
        "title_exclude_keywords": [],
        "company_exclude": [],
        "auto_scoring_depth": "off",
    },
]


MOCK_RESUME_JSON = {
    "header": {
        "name": "Alex Johnson",
        "contact_items": [
            {"text": "San Francisco, CA", "url": ""},
            {"text": "alex@example.com", "url": "mailto:alex@example.com"},
            {"text": "linkedin.com/in/alexjohnson", "url": "https://linkedin.com/in/alexjohnson"},
        ],
    },
    "summary": "Product manager with 8 years of experience building B2B SaaS products. Led cross-functional teams of 5-15 across 3 product lines, driving $12M ARR growth. Strong background in data-driven decision making, user research, and agile delivery.",
    "experience": [
        {
            "company": "TechCorp",
            "title": "Senior Product Manager",
            "location": "San Francisco, CA",
            "date": "2021 - Present",
            "bullets": [
                "Led product strategy for enterprise platform serving **2,000+ customers**, increasing NPS from 32 to 58",
                "Shipped AI-powered search feature that reduced time-to-resolution by **40%** across support workflows",
                "Managed $3M annual budget and prioritized roadmap across 3 engineering squads",
                "Drove adoption of experimentation framework, running **50+ A/B tests** per quarter",
            ],
        },
        {
            "company": "StartupXYZ",
            "title": "Product Manager",
            "location": "New York, NY",
            "date": "2018 - 2021",
            "bullets": [
                "Launched MVP marketplace product from 0 to **$2M ARR** in 18 months",
                "Defined and executed migration from monolith to microservices architecture",
                "Conducted **100+ user interviews** to inform product-market fit pivots",
                "Collaborated with design team to reduce onboarding drop-off by **35%**",
            ],
        },
        {
            "company": "BigFinance Inc.",
            "title": "Business Analyst",
            "location": "Chicago, IL",
            "date": "2016 - 2018",
            "bullets": [
                "Built dashboards and reporting tools for trading desk, saving **20 hours/week** of manual work",
                "Translated business requirements into technical specs for engineering team",
                "Led UAT for $5M regulatory compliance project delivered on schedule",
            ],
        },
    ],
    "skills": {
        "Product": "Roadmapping, A/B Testing, User Research, PRDs, OKRs, Agile/Scrum",
        "Technical": "SQL, Python, Jira, Amplitude, Mixpanel, Figma, REST APIs",
        "Domain": "B2B SaaS, Fintech, Marketplace, Enterprise, AI/ML Products",
    },
    "education": [
        {
            "school": "University of California, Berkeley",
            "location": "Berkeley, CA",
            "degree": "B.S. Computer Science, Minor in Business Administration",
        },
    ],
}

def seed_searches(db):
    """Seed default searches if none exist (except LinkedIn Extension which is always ensured)."""
    existing_modes = {s.search_mode for s in db.query(Search).all()}
    for s in SEED_SEARCHES:
        if s["search_mode"] not in existing_modes:
            db.add(Search(firm_id=DEFAULT_FIRM_ID, **s))   # platform searches live in the Default firm (F2b)
    # Idempotent rename: self-heal any linkedin_extension search still named
    # "LinkedIn Extension" so fresh DB clones end up labeled "Extension LI".
    legacy = db.query(Search).filter(
        Search.search_mode == "linkedin_extension",
        Search.name == "LinkedIn Extension",
    ).first()
    if legacy:
        legacy.name = "Extension LI"
    db.commit()


def seed_mock_resume(db):
    """Seed a mock base Resume for demonstration and set it as default for all companies; bails if any base Resume already exists."""
    if db.query(Resume).filter(Resume.is_base == True).count() > 0:
        return  # User already has a base resume

    resume = db.query(Resume).filter(Resume.name == "Sample PM", Resume.is_base == True).first()
    if resume is None:
        resume = Resume(
            firm_id=DEFAULT_FIRM_ID,
            name="Sample PM",
            is_base=True,
            template="garamond_alt",
            page_format="letter",
            json_data=MOCK_RESUME_JSON,
        )
        db.add(resume)
        db.commit()
        db.refresh(resume)

    default_row = db.query(Setting).filter(Setting.key == "default_resume_id").first()
    if default_row:
        default_row.value = str(resume.id)
    db.commit()

    for company in db.query(Company).all():
        company.selected_resume_ids = [str(resume.id)]
    db.commit()

    logger.info("Seeded mock resume 'Sample PM'")


def seed_persona(db):
    """Ensure the singleton Persona (id=1) exists with empty nodes."""
    from backend.models.db import Persona
    existing = db.query(Persona).filter(Persona.id == 1).first()
    if existing:
        return
    p = Persona(
        id=1,
        contact={},
        work_auth={},
        demographics={},
        compensation={},
        preferences={},
        resume_content={},
        qa_bank=[],
    )
    db.add(p)
    db.commit()
    logger.info("Persona singleton (id=1) seeded with empty nodes")


def migrate_autofill_dicts(db):
    """Merge newly-added canonical keys into autofill_field_patterns/autofill_option_synonyms without clobbering the user's edits (only missing top-level keys are added)."""
    for setting_key in ("autofill_field_patterns", "autofill_option_synonyms"):
        row = db.query(Setting).filter(Setting.key == setting_key).first()
        if not row:
            continue
        default_json = DEFAULT_SETTINGS.get(setting_key, ("{}", ""))[0]
        try:
            defaults = json.loads(default_json)
            stored = json.loads(row.value or "{}")
        except (ValueError, TypeError):
            continue
        changed = False
        for k, v in defaults.items():
            if k not in stored:
                stored[k] = v
                changed = True
        if changed:
            row.value = json.dumps(stored)
    db.commit()


def migrate_dedup_tracking_params(db):
    """Take "jk" out of an already-stored `dedup_tracking_params`, since settings are seeded once and DEFAULT_SETTINGS alone won't fix an existing install."""
    row = db.query(Setting).filter(Setting.key == "dedup_tracking_params").first()
    if not row or not row.value:
        return
    try:
        stored = json.loads(row.value)
    except (ValueError, TypeError):
        return
    if not isinstance(stored, list):
        return
    kept = [p for p in stored if str(p).strip().lower() != "jk"]
    if len(kept) == len(stored):
        return
    row.value = json.dumps(kept)
    db.commit()
    try:
        from backend.scraper._shared.dedup import reload_tracking_params
        reload_tracking_params()
    except Exception:
        pass   # the cache loads lazily anyway; a failed eager reload is not fatal


def run_seeds():
    db = SessionLocal()
    try:
        # Schema changes are Alembic revisions now (backend/db_schema.py); this only seeds and
        # tidies data.
        seed_settings(db)
        migrate_dedup_tracking_params(db)
        migrate_autofill_dicts(db)
        seed_companies(db)
        seed_h1b_slugs(db)
        seed_searches(db)
        seed_mock_resume(db)
        seed_persona(db)
        cleanup_removed_settings(db)
        migrate_llm_settings(db)
        migrate_cv_terminology(db)
    finally:
        db.close()
