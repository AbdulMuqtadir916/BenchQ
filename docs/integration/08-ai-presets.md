# 08 — AI presets

**Owner:** Abdul · **Built by:** Zuhair (`feat/job-search-indeed-and-candidate-details`, 2026-11-22, agreed with Abdul) ·
**Status:** built. Screen: `/admin/ai-presets`. Code: `backend/ai/`, `backend/api/routes_ai_presets.py`,
`backend/models/ai_presets.py`, migration `0032`. Contract: `docs/02-DATA-CONTRACTS.md` §3.5.

Agreed with the product owner on 2026-10-23/24 (grill rounds 1 and 2, Q1–Q21). The first PR when this starts is the
contract in `docs/02-DATA-CONTRACTS.md` (Preset, PresetVersion, AiModel) for product-owner sign-off.

## The idea

Each AI module (scoring, tailoring, résumé building, cover letters) can have several **presets**. A preset is one
way of running the module: a model and its prompts. A Super Admin creates presets, tries them, and switches the
module's active preset, without touching code. The goal is to find the setup that gives clients the best results,
and to change it in minutes.

Firms never see or choose a model, a prompt or a preset. There are no scraper logins and no Telegram in BenchQ
(F2c, `backend/settings_scope.py`).

## Decisions

| # | Decision |
|---|---|
| Q1 | Name: **AI presets** ("preset" in the UI). Not "systems", which would clash with `/admin/system` (health) |
| Q2 | A preset holds provider + model, reasoning effort, the module's prompt(s), an optional fallback model, a name and notes. The output format the code parses stays in code |
| Q3 | Modules first: scoring, tailoring, résumé building, cover letters. Email classification and autofill get presets when their tracks are live |
| Q4 | One **active preset per module, for the whole platform**. Switching applies to new runs at once. No per-firm presets, no A/B splits (maybe later) |
| Q5 | Editing a preset creates a **new version**. Every AI run records the preset and version it used (the ledger's `modelId` / `promptVersion`) |
| Q6 | Super Admin only (Zuhair gets a Super Admin account; no separate AI-developer role). Create, edit, switch and archive are logged in the platform ledger |
| Q7 | v1: a **test run** (pick a job and a résumé, run a preset, see the output, nothing saved). Next: two presets side by side. Later: automatic scoring of presets |
| Q8 | A **model catalog** in the database (provider, model id, label). Each provider's API key lives in the server's secrets, never in the database or the UI |
| Q9 / Q20 | Until presets exist, every LLM call of an AI module reads its setup through **`ai_config("<module>")`** (`backend/ai/config.py`). Today it reads the settings; later the active preset. Callers don't change |
| Q10 | The settings that move here are scope `AI_PRESET` in `backend/settings_scope.py` |
| Q11 | Contract first (Preset, PresetVersion, AiModel), signed off by the product owner |
| Q12 | The scoring output schemas (`scoring_output_light` / `full`) move into code: a preset changes what the model is told, never the shape the code parses |
| Q13 | A failing model: retry once on the preset's own fallback model, if it has one; else the run fails with a clear error. Never a silent switch to another preset |
| Q14 | A run keeps the preset version it started with; only new runs use a newly active preset |
| Q15 | A preset any run used can only be **archived**, never deleted. The active preset can't be archived until another is active |
| Q16 | Test runs count in AI spend, marked as tests, charged to the platform (no firm) |
| Q17 | Day one: each module's current settings become "Preset 1, v1" and stay active, so clients see no change until a Super Admin switches |
| Q18 | Each module lists its required prompt placeholders (`{resume}`, `{job}`…); saving a prompt that's missing one is refused |
| Q19 | Lives at `/admin/ai-presets` (platform area). The AI spend view (Phase S, docs/02 §3.2) shows spend and runs per preset |

## What was built (decided by Zuhair with Abdul, 2026-11-22)

These replace the decisions above where they differ.

- **One provider, one key (replaces Q8's "key in the server's secrets").** A Super Admin enters them on the panel.
  OpenRouter is the only provider at launch: email classification uses its Decisions endpoint, and the strict JSON the
  parser, tailor and search titles need is sent only on OpenRouter. The key is encrypted with the server secret
  `AI_SETTINGS_ENCRYPTION_KEY`, never returned (the panel shows "ending 1234"), and only its change is logged.
- **Saving tests first.** A provider or key save tests the key and every active model; making a preset active, or
  changing an active preset's model, effort or (for email) State or Question, tests that setup. A rejected key or model blocks the save. If OpenRouter
  is only unreachable, a Super Admin can "save anyway", so a leaked key can be replaced during an outage.
- **Four use cases have presets:** résumé parser, résumé tailoring, search titles, email classification. Cover letters,
  the old AI autofill route, old LLM job scoring and the old Gmail monitor have no panel row: they stay on the
  `llm_model` setting and the shared key until they're removed.
- **The model catalog** holds models approved from OpenRouter's live list; nobody types an id. A model an active preset
  uses can't be removed; another is hidden, so old presets and runs keep its name. Email classification takes only
  Decider models, and the other use cases never do.
- **Day one (Q17):** each use case's current model and prompts become its active "Preset 1, v1". Email defaults to
  `perplexity/pplx-decider-v1.2` unless that database has another model; its safety switches stay off.
- **No fallback model at launch** (narrows Q2, Q13): a failed run shows a clear error.
- **Test runs (Q7, Q16)** use pasted samples, never firm data, save nothing, and log their cost with no firm under
  `preset_test:<use case>`. Tailoring's test runs its first step only.
- **Output formats are in code (Q2, Q12):** the six `*_format` rows are gone.
- **The email fingerprint** is the model and prompts, not the preset's id or version, so moving an unchanged setup into
  a preset doesn't force re-evaluation. A real model or prompt change still does.
- **The classifier's State and Question are editable** in its preset, as JSON. A save is refused unless State uses
  `{subject}` and `{body}` and Question keeps its key, `choice` type and the 10 category names, which the code depends
  on. Instructions and category descriptions can change. Masking and the length limits stay in code. Activating a
  classifier preset, or changing the active one's State or Question, sends that exact setup to OpenRouter first.
- **A removed model can't go live:** a preset on it can't be made active until it's edited to an approved model.
- **Archiving can be undone:** Restore brings a preset back, not active. Its name stays reserved while archived.
- **Limits:** résumé tailoring 40 and the parser 10 at once **per backend process**, editable on the panel, applied
  without a restart; extra runs wait. Each existing candidate takes **5 saved résumé uploads per firm work day**; the
  next is refused with "Upload limit reached. Next upload at <the firm's next shift start>." The résumé a candidate was
  added with, duplicates, refused files and failed parses don't count.

**Deploying:** set `AI_SETTINGS_ENCRYPTION_KEY` (a Fernet key) before migration `0032`. If a database holds a key and the
secret is missing, the migration stops and changes nothing. It moves the parser's key into the encrypted row and erases
every readable key row. A downgrade restores models and prompts but not the key: a Super Admin enters it again.

## The rule for every AI track, starting now

- Read the module's model and prompts through `ai_config("<module>")`, never `settings` or `resolve_llm_config`
  directly, and never a hardcoded model name. A new AI module gets an entry in `AI_MODULES` first.
- Keep the output format (the JSON the code parses) in code, next to its parser.
- List the prompt's placeholders in `backend/ai/modules.py`: a save missing one is refused (Q18).
