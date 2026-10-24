# 08 — AI presets (planned)

**Owner:** Abdul · **Starts:** after Zuhair's tracks (Candidates, job scraping, résumé tailoring, résumé scoring) ·
**Status:** decided, not built. Only the `ai_config` seam exists (`backend/ai/config.py`).

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

## The rule for every AI track, starting now

- Read the module's model and prompts through `ai_config("<module>")`, never `settings` or `resolve_llm_config`
  directly, and never a hardcoded model name. A new AI module gets an entry in `AI_MODULES` first.
- Keep the output format (the JSON the code parses) in code, next to its parser.
- Write the prompt's placeholders down in the module's doc; Q18 enforces them later.

## Not decided yet (comes with the contract)

The exact tables and fields, the screen layout of `/admin/ai-presets`, and how a test run picks its sample job.
