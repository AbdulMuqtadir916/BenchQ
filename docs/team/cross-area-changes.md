# Changes made in a teammate's area

When a PR has to change something in another person's area (`docs/team/README.md` §2–§3), it is agreed first and
listed here: what changed, in whose area, and why. Newest PR first.

## Résumé versioning PR 2 — the base-résumé parser (`feat/parser-format-v2`, Zuhair)

Design: [resume-versioning.md](./resume-versioning.md) §2–§2.2.

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Timeouts (Uzair; AI timeouts handed to Zuhair for now) | `next.config.ts` | `experimental.proxyTimeout: 360_000`: the `/api` rewrite waits up to 6 minutes for the backend instead of Next's default 30 s. Applies to every `/api` request. | The parse may take 80 s an attempt and 4 attempts (about 5.5 minutes at worst). At 30 s, a slow parse failed in the browser while the backend kept running and paying for it. Uzair can tighten it per route in the production layer. |
| AI call timeouts and retries (Uzair; handed to Zuhair for now) | `backend/analyzer/llm_client.py` | `call_llm` has five new optional arguments: a strict response format (with `provider.require_parameters`), reasoning off, no backup model, a cut-off reply retried, and a deadline per attempt (`LLMDeadlineError`). | The parser needs them (§2.1). They are off by default, and a call that doesn't pass them is dispatched exactly as before; the existing client tests pass unchanged. |
| The new-candidate parse route (built by Abdul, onboarding 06 PR 3) | `backend/api/routes_candidates.py` `parse_resume` | Text extraction runs in a worker thread (`asyncio.to_thread`). | Reading a PDF is CPU work; on the event loop it held up every other firm's requests while it ran. The route's path, permission and checks are unchanged. |
| The same | `backend/candidates/parse.py` `read_resume` | The read transaction ends (`db.commit()`) before the model call. | The parse held a database connection for the whole AI call, up to minutes. The pool has 30 connections, so about 30 parses at once would have made the whole app answer 503 (`backend/models/db.py`: nothing may hold a connection across an LLM call). |
| AI spend per firm (Abdul, tenancy: docs/integration/07-auth-and-tenancy.md Q33) | `backend/analyzer/llm_logger.py` | `track_llm_call` and `log_llm_call` take an optional `firm_id` and store it in `llm_call_log.firm_id`; the parse passes its firm. | Q33: "every LLM entry point must carry the firm down", and the column was never filled. Optional, so every other AI call logs exactly as before until its owner passes its firm (tailoring, cover letters, email, autofill, scoring). |
| Onboarding docs (Abdul) | `docs/candidate-onboarding/06-backend.md` §4 and §6 | The parser lines now describe the new parser: its own model instead of the primary, the format with `city`/`state`/`country`, `certifications` and `awards` as entries, `languages`; gap G8 (location as one string) marked done. | The doc described the format this PR replaces; anyone reading it (or their Claude) would build against the old one. Facts only; no decision in it changed. |
| Résumé format approved by Abdul (resume-versioning.md §1) | `resume-versioning.md` §2 and §3.3 | `certifications` is `[{name, issuer, date, detail}]` (was `[string]`), like awards; the planned `resumes.certifications` column follows. | In the live test, one string per certification made the model glue its description to the name. With the entry shape, 28 of 28 test parses kept the name clean and the description in `detail`. |

Not changed, left to the owner:

- **A limit on parses at once (Uzair, production layer step 1: per-firm limits for the AI routes).** Scoring and
  tailoring have one (`scoring_max_concurrent`, `tailoring_max_concurrent`); the parser has none, so many uploads at
  once would hit OpenRouter's rate limits (429).
