# Team plan — who builds what, in which order, without stepping on each other

**Set by Abdul Muqtadir, 2026-10-29.** Read this file, then [FLOWS.md](./FLOWS.md) (the user flow and the
architecture, as diagrams), then [00-candidate-core.md](./00-candidate-core.md), then your own file. Anything this plan doesn't settle: ask Abdul before you build it.

## 1. The shape of the product

```
Firm ─ Owner ─ Manager ─ BDE ─ Candidate
                                  │  (a set of info + its own status: ON_BENCH, INTERVIEWING, …)
                                  ├─ Searches + jobs found for them   (job scraping)
                                  ├─ Favorite jobs                    (marked by the BDE, used by the extension)
                                  ├─ Résumés: bases (one active), tailored, every edit a version
                                  ├─ Applications                     (job + tailored résumé + status)
                                  ├─ Mailbox + emails                 (the candidate's own inbox, linked to applications)
                                  └─ Activity                         (the ledger, by candidate)
```

Every one of these belongs to a candidate (`candidate_id`) and a firm (`firm_id`). **These tables and their columns
are fixed before anyone starts** ([00-candidate-core.md](./00-candidate-core.md)), so four people can work at once
without changing each other's tables.

## 2. Who does what, in order

| Person | 1st | 2nd | 3rd | 4th | Plan |
|---|---|---|---|---|---|
| **Samad** | Inbox (Gmail per candidate) | Applications | Extension | — | [samad.md](./samad.md) |
| **Zuhair** | Candidate table improvement (profile from the résumé, the Record) | Job scraping per candidate | Résumé tailoring (+ ATS score) | — | [zuhair.md](./zuhair.md) |
| **Uzair** | Production layer (rate limits, req/s handling, timeouts, logging, errors) | Production testing (load, security, failure) | — | — | [uzair.md](./uzair.md) — detailed when he starts |
| **Abdul** | Candidate core tables (before everyone) | Billing layer | Deployment | Cleaning the project dump | [abdul.md](./abdul.md) |
| **Mohammed Abdul Ahad Umamah** | Password recovery approval workflow | Extensible Notifications inbox | — | — | [umamah.md](./umamah.md) |

Nobody starts their 1st task until the candidate core PR is merged (`00-candidate-core.md` §5).

## 3. Who owns which table

The **owner** is the only person who changes a table (adds columns, indexes, constraints) or the routes that write
it. Everyone else reads it.

| Table | Owner | Notes |
|---|---|---|
| `candidates` | **Abdul approves**, Zuhair changes | Every change to `candidates` is confirmed with Abdul first, whoever makes it |
| `resume_parses` | Zuhair | |
| `searches` (candidate columns), `candidate_jobs`, `jobs`, `companies`, `job_locations`, `firm_jobs` | Zuhair | `jobs` is the shared pool (07 Q37) |
| `favorite_jobs` | Samad | Written by the BDE in the app and read by the extension |
| `resumes`, `cover_letters`, `tracer_links`, `tracer_click_events` | Zuhair | |
| `base_resumes` (new, 0008) | Zuhair | A candidate's bases, one active ([resume-versioning.md](./resume-versioning.md)) |
| `applications`, `interviews` | Samad | |
| `candidate_mailboxes`, `inbox_messages`, `candidate_google_oauth_attempts` (0010) | Samad | Candidate connection, imported mail and one-use OAuth handoff state |
| `ledger_entries` | Abdul | Everyone *writes* through `backend/auth/ledger.py`; nobody changes the table |
| billing tables (new) | Abdul | |
| `users`, `firms`, `plans`, `invites`, `sessions`, `support_views` | Abdul | Tenancy |
| `notifications`, `password_reset_requests` | Mohammed Abdul Ahad Umamah | Extensible inbox; password recovery approvals |
| everything production-layer (middleware, limits, logging config) | Uzair | Not tables: `backend/main.py` middleware and config |

## 4. Rules that keep the work conflict-free

1. **One branch per task, from `main`, one PR to `main`.** Never stack PRs (a PR based on another branch merges
   into that branch, not `main`). Small PRs, one concern each (CONTRIBUTING.md).
2. **Only change tables you own** (§3). Need a column on someone else's table? Ask them; they add it.
3. **Changing `candidates`: confirm with Abdul first**, with the column, its type and why. Same for renaming or
   removing a column anywhere: not without Abdul.
4. **Migrations are numbered one at a time.** Before writing one, claim the next number in §6 in your PR (or tell
   Abdul). If two PRs collide, the second one renumbers and fixes its `down_revision` before merging. `alembic
   check` must stay clean.
5. **Additive changes only on fixed tables:** add nullable columns, or columns with a default. A destructive change
   (drop, rename, type change) needs Abdul and a migration that keeps old rows readable.
6. **Every firm-owned row has `firm_id`; every candidate-owned row has `candidate_id`.** Read through `scoped()`;
   every new route goes in `backend/auth/access.py` and `backend/tests/isolation_cases.py` (F7).
7. **The frontend never changes for the backend:** map in `src/lib/api/dto/`, and change `src/lib/schemas/` only
   with a contract change in `docs/02-DATA-CONTRACTS.md` that Abdul signed off.
8. **The checks must pass:** `pnpm typecheck && pnpm lint && pnpm test`, and the backend suite (`docs/integration/
   README.md` "Commands").
9. **Logs carry ids, counts, statuses and timings, never a person's data** (a name, email, phone, résumé or email
   text, an AI or Google reply, a request body, a file name). Two backend checks fail the PR otherwise:
   `test_log_lint.py` (reads the code) and `test_log_every_route.py` (runs every route with planted data). A new route
   or job needs nothing listed; when a check fails, fix the log call, and follow the failure message for the rest. A
   new table that holds people goes in `PEOPLE_MODELS`; a new outside service that returns people's data goes in
   `PERSONAL_HOSTS`. Detail: [uzair.md](./uzair.md) §1, step 4a.

## 5. Where the detail lives

| Area | Doc |
|---|---|
| The user flow and the architecture (diagrams, who builds each step) | [FLOWS.md](./FLOWS.md) |
| The fixed tables | [00-candidate-core.md](./00-candidate-core.md) |
| Inbox design (D8) | `docs/integration/06-open-decisions.md` D8, Samad's plan |
| Applications (D3, 10 statuses) | `docs/integration/03-applications.md` |
| Jobs, scraping | `docs/integration/02-jobs.md` |
| Résumés, tailoring | `docs/integration/04-resumes-and-tailoring.md` |
| `personas` is to be dropped: what `candidates` and `resumes` hold instead, and a suggested mapping | [persona-to-candidates.md](./persona-to-candidates.md) |
| Connecting a module to the frontend | `docs/integration/README.md` "The workflow for one module" |
| Password recovery approvals and Notifications inbox | [umamah.md](./umamah.md) |
| Logging, and the checks that keep it safe | [uzair.md](./uzair.md) §1, step 4a |
| Decisions | `docs/07-ROUTES-AND-RBAC.md` §0 (Q53 is this plan) |

## 6. Migration numbers

| # | Owner | What | Status |
|---|---|---|---|
| 0007 | Abdul | Candidate core tables | PR #91 |
| 0008 | Zuhair | Résumé versioning: `base_resumes`, the new `resumes` columns, `award` claims (additive) | `feat/base-resumes-schema` |
| 0009 | Samad | Applications foundation | Merged #100 |
| 0010 | Mohammed Abdul Ahad Umamah | Notifications and password-reset approvals | Merged #105 |
| 0011 | Zuhair | Résumé versioning and upload fingerprints | Merged #106 |
| 0012 | Samad | Candidate Gmail OAuth/sync and provenance | Merged #104 |
| 0013 | Zuhair | Résumé versioning PR 6: old résumé rows converted or deleted, the approved `resumes` / `resume_parses` drops, `base_resume_id` and `candidate_id` required. Follows 0012 (Samad's) | `feat/drop-legacy-resume-columns` |
| 0014 | Samad | Candidate email classification | Merged #111 |
| 0015 | Zuhair | Candidates final schema: `persona`, `skills`, `summary_state` removed (`preferred_industries`, `deal_breakers` flat; `claims` and `evidence` dropped (no claim states), the ledger's `claim_state` and `evidence_ids` dropped, no `OTHER` work authorization, `base_resumes.source` `MANUAL`. Follows 0014 | `feat/candidates-final-schema` |
| 0016 | Zuhair | `firms.truth_guard_mode` and its CHECK dropped (claim-era setting; no claim states) | `integrate/resumes` |
| 0017 | Zuhair | The résumé's fields leave `candidates` (`full_name`, `email`, `phone`, `linkedin_url`, `city`, `state`, `country`; 07 Q57): a MANUAL base for every candidate without one, empty header fields filled, then the drop | `integrate/resumes` |
| 0018 | Zuhair | No MANUAL bases (07 Q58): each becomes an UPLOAD base with a generated résumé file; a placeholder next to a real upload is removed; the checks allow UPLOAD and PROMOTED only | `integrate/resumes` |
| 0019 | Zuhair | Résumé autofill: `resumes.autofill`, the entries the user typed (`{}` on every version; the built answers aren't stored), `candidates.qa_bank` dropped | `feat/resume-autofill` |
| 0020+ | — | Claim the next number here in your PR | — |
