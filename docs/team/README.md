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
                                  ├─ Record: claims + evidence        (Truth Guard: nothing VERIFIED without evidence)
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
| `claims`, `evidence` | Zuhair | Truth Guard is enforced in the database; never relax it |
| `applications`, `interviews` | Samad | |
| `candidate_mailboxes`, `inbox_messages` | Samad | |
| `ledger_entries` | Abdul | Everyone *writes* through `backend/auth/ledger.py`; nobody changes the table |
| billing tables (new) | Abdul | |
| `users`, `firms`, `plans`, `invites`, `sessions`, `support_views` | Abdul | Tenancy |
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

## 5. Where the detail lives

| Area | Doc |
|---|---|
| The user flow and the architecture (diagrams, who builds each step) | [FLOWS.md](./FLOWS.md) |
| The fixed tables | [00-candidate-core.md](./00-candidate-core.md) |
| Inbox design (D8) | `docs/integration/06-open-decisions.md` D8, Samad's plan |
| Applications (D3, 10 statuses) | `docs/integration/03-applications.md` |
| Jobs, scraping | `docs/integration/02-jobs.md` |
| Résumés, tailoring, claims (D4) | `docs/integration/04-resumes-and-tailoring.md` |
| Connecting a module to the frontend | `docs/integration/README.md` "The workflow for one module" |
| Decisions | `docs/07-ROUTES-AND-RBAC.md` §0 (Q53 is this plan) |

## 6. Migration numbers

| # | Owner | What | Status |
|---|---|---|---|
| 0007 | Abdul | Candidate core tables | PR #91 |
| 0008+ | — | Claim the next number here in your PR | — |
