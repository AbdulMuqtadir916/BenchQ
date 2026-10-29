# 00 — The candidate core tables (fixed before the team starts)

**Owner:** Abdul · **Migration:** `0007_candidate_core` · **Decision:** 07 Q53 (2026-10-29)

Everything a candidate has, as tables with their bare-minimum columns, built in one PR **before** Samad, Zuhair and
Uzair start. After it merges, these tables and columns are the contract: owners add to their own tables (team
README §3–§4); nobody renames or removes a column here without Abdul.

Conventions as `backend/models/tenancy.py` and `candidates.py` (Q38): UUID keys, `firm_id` on every row, timestamps
with time zone, CHECKs instead of enum types, foreign keys `ON DELETE RESTRICT` unless stated. Candidates are never
deleted, so nothing cascades from a candidate.

## 1. What already exists and what 0007 adds

| Sketch | Table | Today | 0007 |
|---|---|---|---|
| Candidate (set of info + its own status) | `candidates` | Built (onboarding 06): info, `status`, `manager_id`, `bde_id` | No change. Zuhair improves it later, with Abdul's OK |
| Job scraping | `searches`, `jobs`, `candidate_jobs` | Searches are firm-wide; jobs a shared pool | `searches.candidate_id`; new `candidate_jobs` |
| Favorite jobs | `favorite_jobs` | A single `jobs.saved` flag (shared by every firm) | New table |
| Résumés (base + tailored) | `resumes` | `is_base`, `parent_id`, `job_id`, no candidate | `candidate_id`, `resume_parse_id`, the base/tailored rule |
| Applications | `applications` | Job + status, no candidate | `candidate_id`, `resume_id`, `submitted_by_user_id` |
| Inbox | `candidate_mailboxes`, `inbox_messages` | Nothing | New tables |
| Record (Truth Guard) | `claims`, `evidence` | Nothing (skills sit UNVERIFIED in `candidates.skills`) | New tables |
| Activity | `ledger_entries` | Firm ledger; candidate only in `entity_id` | `candidate_id` |

## 2. The tables

### Job scraping — each candidate has their own searches (Q53b)

**`searches`** + `candidate_id` UUID → `candidates`, nullable. A search runs *for a candidate*: new searches from the
app always name one (the route requires it). `NULL` only on searches from before this migration and the platform's
own (e.g. the extension search), which stay firm-wide.

**`candidate_jobs`**: the jobs found for a candidate. The job row itself stays in the shared pool (`jobs`, deduped
across firms, 07 Q37); this table says which candidate it was found for.

| Column | Type | |
|---|---|---|
| `id`, `firm_id`, `candidate_id` | UUID | |
| `job_id` | UUID → `jobs` | |
| `search_id` | UUID → `searches`, nullable, `ON DELETE SET NULL` | The search that found it; null = added by hand |
| `match_score` | int 0–100, nullable | Filled by scoring |
| `found_at` | timestamptz | |

Unique (`candidate_id`, `job_id`).

### Favorite jobs (Q53c)

**`favorite_jobs`**: jobs a BDE marked for a candidate. Every candidate has their own; the extension applies from them.

| Column | Type | |
|---|---|---|
| `id`, `firm_id`, `candidate_id` | UUID | |
| `job_id` | UUID → `jobs` | |
| `marked_by_user_id` | UUID → `users` | The BDE (or manager) who marked it |
| `created_at` | timestamptz | |

Unique (`candidate_id`, `job_id`). Reassigning the candidate keeps their favorites.

### Résumés: one base, many tailored (Q53e)

**`resumes`** + `candidate_id` (UUID → `candidates`, nullable for rows from before 0007; the routes require it from
now on) + `resume_parse_id` (UUID → `resume_parses`, nullable).

- **Base résumé** (`is_base = true`, `parent_id` null): uploaded or generated when the profile is created; made from
  the kept résumé parse (`resume_parse_id`). **One per candidate** (a partial unique index).
- **Tailored résumé** (`is_base = false`): made from the base for one job: `parent_id` → the base, `job_id` → the job.
  A candidate has many. The routes enforce "a tailored résumé has a base and a job" (Zuhair), not a database CHECK:
  jobs and base résumés can be deleted, and their `ON DELETE SET NULL` would then break such a check.
- Applying picks a tailored résumé (`applications.resume_id`). Once an application points at it, its content is what
  was sent: the tailoring routes must not change it afterwards (Zuhair).

### Applications (Q53d)

**`applications`** + `candidate_id` (UUID → `candidates`, nullable for old rows; required from now on) + `resume_id`
(UUID → `resumes`, nullable, `ON DELETE SET NULL`: the tailored résumé sent) + `submitted_by_user_id` (UUID → `users`,
nullable). Unique (`candidate_id`, `job_id`): one application per candidate per job.

`status` stays as it is in 0007; the 10 statuses (D3: SAVED → … → EXPIRED) and status history are Samad's Track 03
migration.

### Inbox: each candidate's own mailbox, linked to their applications (Q53f)

**`candidate_mailboxes`**: the candidate's connected email account. One per candidate.

| Column | Type | |
|---|---|---|
| `id`, `firm_id` | UUID | |
| `candidate_id` | UUID, **unique** | |
| `provider` | `'GOOGLE'` | CHECK; more later |
| `address` | text | The candidate's email address |
| `status` | `CONNECTED` / `DISCONNECTED` / `ERROR` | |
| `connected_by_user_id` | UUID → `users` | |
| `connected_at`, `last_synced_at` (nullable), `created_at`, `updated_at` | timestamptz | |

Token storage (OAuth refresh token, encrypted) is Samad's design (D8): he adds its columns.

**`inbox_messages`**: every email in the candidate's mailbox. The application's emails are the ones pointing at it,
so one application can have many (acknowledgement, screening, interview…).

| Column | Type | |
|---|---|---|
| `id`, `firm_id`, `candidate_id` | UUID | |
| `mailbox_id` | UUID → `candidate_mailboxes` | |
| `application_id` | UUID → `applications`, nullable, `ON DELETE SET NULL` | Null until matched to an application |
| `provider_message_id`, `thread_id` (nullable) | text | Unique (`mailbox_id`, `provider_message_id`) |
| `from_name`, `from_email`, `subject`, `snippet` | text | |
| `body` | text, nullable | |
| `received_at`, `created_at` | timestamptz | |
| `is_read` | bool, default false | |

### Record: claims and evidence (Truth Guard, D4; Q53g)

**`evidence`**: what substantiates a claim.

| Column | Type | |
|---|---|---|
| `id`, `firm_id`, `candidate_id` | UUID | |
| `resume_parse_id` | UUID → `resume_parses`, nullable | The kept résumé it came from, if any |
| `document_url` | text, nullable | A document's link until documents are on the backend |
| `excerpt` | text, nullable | The quoted passage |
| `page_number` | int, nullable | |
| `source` | `MANUAL` / `RESUME_UPLOAD` / `LINKEDIN_EXPORT` / `INTAKE_CALL` / `AI_EXTRACTED` | The frontend's `FieldSource` |
| `confirmed_by_user_id` (nullable), `confirmed_at` (nullable), `created_at` | | |

**`claims`**: every statement about the candidate (a skill, a bullet, a certificate…).

| Column | Type | |
|---|---|---|
| `id`, `firm_id`, `candidate_id` | UUID | |
| `entity_type` | `summary` / `experience` / `skill` / `project` / `certificate` / `education` | |
| `entity_ref` | text, nullable | Which experience/project it belongs to (the Record item's id) |
| `text` | text | |
| `state` | `VERIFIED` / `UNVERIFIED` / `CONTRADICTED`, default `UNVERIFIED` | |
| `evidence_id` | UUID → `evidence`, nullable | |
| `source` | as `evidence.source` | |
| `created_at`, `updated_at` | timestamptz | |

**`CHECK (state <> 'VERIFIED' OR evidence_id IS NOT NULL)`**: the database refuses a VERIFIED claim without
evidence. Never relax it.

### Activity: the ledger, by candidate (Q53h)

**`ledger_entries`** + `candidate_id` (UUID, nullable, no foreign key: the ledger outlives what it describes) and an
index (`firm_id`, `candidate_id`, `created_at`). Backfilled from entries whose `entity_type` is `candidate`.
`ledger.record` sets it itself for an entry whose entity is a candidate; **every other write about a candidate passes
`candidate_id=`** (an application, a résumé, an email). `GET /ledger?candidate_id=` is the candidate's activity. The old `activity_log_v2`
is removed in Abdul's clean-up.

## 3. Not in 0007, on purpose

- New columns on `candidates` (Zuhair's improvements, with Abdul's OK), application statuses (Samad), mailbox tokens
  (Samad), billing (Abdul): each owner's own migration.
- Moving `candidates.skills` into `claims`: Zuhair's first task.
- Interviews, cover letters, tracer links keep their tables; they reach the candidate through their application or
  résumé.

## 4. The PR (Abdul)

- Migration `0007_candidate_core` (`alembic check` clean), the models, the backfill of `ledger_entries.candidate_id`.
- The scoping lint knows the new firm-owned tables; `isolation_support.build_firm` and `snapshot_of` get a row (with a
  canary) for each, so `test_isolation.py` proves they never cross firms.
- `ledger.record(..., candidate_id=)`, passed by the candidate routes; `GET /ledger?candidate_id=`.
- Migration tests: the constraints above (VERIFIED without evidence refused, one base per candidate, one application
  per candidate per job, one mailbox per candidate, unique favorites).
- No routes for the new tables: each owner builds theirs.

## 5. Done when

- [ ] The PR (#91) is merged and the local database is on 0007
- [ ] Every table in §2 exists with every column, and the constraints are tested
- [ ] Owners in the team README §3 agreed; this file is the contract
