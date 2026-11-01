# Résumé versioning — `resume_parses`, `base_resumes`, `resumes` (Zuhair)

Design agreed 2026-10-31 by Zuhair, with the approvals in §1 from Abdul. **Built so far: the parser (§2–§2.2, PR 2).**
The tables, the workflow and the screens (PRs 3–7) are not built yet. This file is
the single reference for building it: the tables (§3), the workflow (§4), the frontend contract (§5), permissions
(§6) and the PR plan (§7). Owner of all three tables: Zuhair (`docs/team/README.md` §3).

---

## 1. Approvals (Abdul, 2026-10-31)

| Approved | Scope |
|---|---|
| Drop columns and an index | `resume_parses.updated_at`; `resumes.is_base`, `resumes.parent_id`, `resumes.json_data`, `resumes.resume_parse_id`, `resumes.updated_at`; the index `uq_resumes_one_base_per_candidate` |
| Rewrite the résumé section of `docs/team/00-candidate-core.md` ("Résumés: one base, many tailored (Q53e)") | Many bases per candidate, one active; `category` instead of `is_base`; no `parent_id`; `resume_parse_id` on `base_resumes` |
| The `docs/02-DATA-CONTRACTS.md` addition | A `BaseResume` entity; `baseResumeId` on `Resume`; the new parser fields (§2) in `ResumeDraftSchema` and the studio content |
| Migration numbers | `0008` (additive) and `0009` (drops), claimed in `docs/team/README.md` §6 in the PR that adds each |
| Awards are claims | `award` added to `claims.entity_type` (0007's `ck_claims_entity_type` widened in 0008), and to the frontend `entityType` enums in docs/02 |

Only what this table lists is approved. Any other rename, drop or `candidates` change still goes to Abdul first.

**Order (confirmed by Zuhair, 2026-10-31):** this is `zuhair.md` 1.2 (parser) and 1.4 (base résumé), done before 1.1
(fields proposal) and 1.3 (the Record).

---

## 2. The parser's response format (new)

The parser returns this shape (OpenAI-style `json_schema`, `strict: true`, every field required, no extra
properties). It replaces the current format in `src/lib/api/dto/resume-parse.ts`.

| Section | Shape | Change from today |
|---|---|---|
| `header` | `{name, title, city, state, country, email, phone, work_authorization, github, linkedin}` — all strings | `location` → `city`, `state`, `country` |
| `professional_summary` | string | — |
| `technical_skills` | `[{category, skills}]` — `skills` is comma-separated | — |
| `work_experience` | `[{job_title, company, location, dates, start, end, current, bullets[]}]` | — |
| `projects` | `[{name, url, dates, technologies, bullets[]}]` | — |
| `education` | `[{degree, institution, graduation_date, grade}]` | — |
| `certifications` | `[{name, issuer, date, detail}]` | **was `[string]`** (2026-11-01): with one string, the model glued a certification's description to its name |
| `awards` | `[{name, issuer, date, detail}]` | **new** |
| `languages` | `[string]` | **new** |

`resume_parses.parse` stores the reply in this shape after code cleans its values (`clean_reply`: same keys, every
key present, nothing added). Ids (§3.4) are added by BenchQ when it builds `resumes` rows, never by the AI.

### 2.1 The parse call (decided 2026-10-31)

The parser's request goes through `call_llm` (`backend/analyzer/llm_client.py`). Each item below is a new optional
argument; every other caller behaves exactly as before.

| Setting | Value | Why |
|---|---|---|
| Strict response format | `json_schema`, name `base_resume`, `strict: true`, with `provider.require_parameters = true` (approved by Abdul) | The schema is enforced, not a hint, and OpenRouter only routes to hosts that honour it |
| Reasoning | `reasoning: {enabled: false}`, replacing any effort setting | Structuring is transcription: thinking first costs time and tokens for no better result |
| Backup model | Never used for the parse (`llm_fallback_*` skipped) | A backup model wouldn't carry the strict format |
| Cut-off reply | `finish_reason == "length"` counts as a failed attempt and is retried | A reply cut off halfway is unusable |
| Deadline and retries | 80 s per attempt; 4 attempts, 2/4/8 s apart; a timeout ends the call | Someone is watching the upload spinner |

### 2.2 The parser's settings (decided 2026-11-01)

The parser gets its own rows in the `settings` table, each with its default in `backend/seed.py` and its entry in
`backend/settings_scope.py`. Seeding only inserts a missing key, so an admin's edits are never overwritten.

| Key | Value |
|---|---|
| `resume_parse_system_prompt` | The system prompt |
| `resume_parse_prompt` | The user prompt template (replaces today's default) |
| `resume_parse_response_format` | The strict JSON schema (§2), as JSON text |
| `resume_parse_llm_provider` | `openrouter` |
| `resume_parse_llm_model` | `openai/gpt-6-luna` |
| `resume_parse_llm_api_key` | Seeded **empty**; set on the settings page. Never in code, seed data or commits |

- **Save check:** `/api/settings` refuses a broken `resume_parse_response_format` (not valid JSON, not `json_schema`,
  not `strict: true`, no name, or missing a top-level key) and a `resume_parse_prompt` without `{resume}`, with a 400.
- **The parser never borrows the shared settings:** if any of its provider, model or key rows is empty, the parse
  stops with a 500 naming that row and makes no AI call.
- Until `resume_parse_llm_api_key` is set, every parse fails with that error. This is expected; tell the team before
  PR 2 merges.

---

## 3. The tables

```
resume_parses ──(resume_parse_id)──▶ base_resumes ◀──(base_resume_id)── resumes
   uploads (the evidence)              the shelf of bases          every version of every résumé
```

### 3.1 `resume_parses` — uploads (exists; one column dropped)

| Column | Type | Constraint | Meaning |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | The parse's id; sent to the frontend as `parse_id`, back on create as `resume_parse_id` |
| `firm_id` | uuid | FK → firms, NOT NULL | The firm that owns it |
| `uploaded_by_user_id` | uuid | FK → users, NOT NULL | Who uploaded it |
| `candidate_id` | uuid | FK → candidates, nullable | NULL while a draft; set at candidate create |
| `file_name` | varchar | NOT NULL | The original file name |
| `mime_type` | varchar | NOT NULL | PDF or DOCX |
| `size_bytes` | integer | NOT NULL, 1 byte to 10 MB | The file size |
| `content` | bytea | NOT NULL | The uploaded file |
| `parse` | jsonb | NOT NULL | The AI's output in the §2 shape, after `clean_reply` |
| `expires_at` | timestamptz | nullable | now + 60 min while a draft; NULL once kept |
| `created_at` | timestamptz | NOT NULL, `now()` | When it was uploaded |

- **Rule (exists):** `(candidate_id IS NULL) = (expires_at IS NOT NULL)`. Expired drafts are deleted on the next upload.
- **Dropped:** `updated_at` (it only marked when the draft was kept, which is the candidate's `created_at`).
- Holds uploads only. A BDE-made base never goes here: evidence (`evidence.resume_parse_id`) points at this table as
  "the document the candidate supplied".
- `parse` is kept after create: the record of what the AI extracted (as opposed to what a person corrected) and the
  baseline for parser-quality work (1.2).

### 3.2 `base_resumes` — the shelf of bases (new; holds no content)

| Column | Type | Constraint | Meaning |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | The base's id ("base 1, 2…") |
| `firm_id` | uuid | FK → firms, NOT NULL | The firm that owns it |
| `candidate_id` | uuid | FK → candidates, NOT NULL | The candidate it belongs to |
| `source` | varchar | NOT NULL, `UPLOAD` / `PROMOTED` | Made from an upload, or promoted by a person from a `resumes` version |
| `resume_parse_id` | uuid | FK → resume_parses, nullable | The upload it came from; required for `UPLOAD` |
| `is_active` | boolean | NOT NULL, default false | The base the workflow uses (tailoring, job search) |
| `created_by_user_id` | uuid | FK → users, NOT NULL | Who made it |
| `created_at` | timestamptz | NOT NULL, `now()` | When it was made |

```sql
CREATE TABLE base_resumes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES firms(id)         ON DELETE RESTRICT,
  candidate_id       uuid NOT NULL REFERENCES candidates(id)    ON DELETE RESTRICT,
  source             varchar NOT NULL,
  resume_parse_id    uuid     REFERENCES resume_parses(id)      ON DELETE RESTRICT,
  is_active          boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NOT NULL REFERENCES users(id)         ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_base_resumes_source_values CHECK (source IN ('UPLOAD', 'PROMOTED')),
  CONSTRAINT ck_base_resumes_source CHECK (source = 'PROMOTED' OR resume_parse_id IS NOT NULL),
  CONSTRAINT uq_base_resumes_id_candidate UNIQUE (id, candidate_id)
);
CREATE UNIQUE INDEX uq_base_resumes_one_active ON base_resumes (candidate_id) WHERE is_active;
CREATE INDEX ix_base_resumes_firm_candidate ON base_resumes (firm_id, candidate_id);
```

- No `json_data` and no `promoted_from_resume_id`, on purpose: content lives only in `resumes`.
- `UNIQUE (id, candidate_id)` exists for the composite foreign key from `resumes` (§3.3).

### 3.3 `resumes` — every version of every résumé (exists; columns added and dropped)

All reads, edits, tailoring, previews and downloads go through this table.

| Column | Type | Constraint | Meaning | Status |
|---|---|---|---|---|
| `id` | uuid | PK | This version's id | exists |
| `firm_id` | uuid | FK → firms, NOT NULL | The firm that owns it | exists |
| `candidate_id` | uuid | FK → candidates | The candidate (kept: team rule 6, and one-filter scope checks) | exists |
| `base_resume_id` | uuid | FK → base_resumes, nullable | The base it comes from (NULL only on rows from before 0008) | **new** |
| `category` | varchar | NOT NULL, default `'BASE'`, `BASE` / `TAILORED` | What it is | **new** |
| `job_id` | uuid | FK → jobs, nullable | NULL for a base; the job for a tailored résumé | exists |
| `version` | integer | NOT NULL, default 1 | 1, 2, 3… within its résumé | **new** |
| `name` | varchar | NOT NULL | The person's label: the studio title and the PDF file name (`{full_name}_{name}_Resume_{job short id}.pdf`) | exists |
| `template` | varchar | | The design (unused by BenchQ today; §8) | exists |
| `page_format` | varchar | | `letter` / `a4` (BenchQ prints Letter) | exists |
| `full_name` | varchar | | `header.name` | **new** |
| `title` | varchar | | `header.title` | **new** |
| `city` | varchar | | `header.city` | **new** |
| `state` | varchar | | `header.state` | **new** |
| `country` | varchar | | `header.country` | **new** |
| `email` | varchar | | `header.email` | **new** |
| `phone` | varchar | | `header.phone` | **new** |
| `work_authorization` | varchar | | `header.work_authorization` | **new** |
| `github` | varchar | | `header.github` | **new** |
| `linkedin` | varchar | | `header.linkedin` | **new** |
| `summary` | text | | `professional_summary` | **new** |
| `skills` | jsonb | | `[{id, category, name}]` | **new** |
| `experiences` | jsonb | | `[{id, job_title, company, location, dates, start, end, current, bullets: [{id, text}]}]` | **new** |
| `projects` | jsonb | | `[{id, name, url, dates, technologies, bullets: [{id, text}]}]` | **new** |
| `educations` | jsonb | | `[{id, degree, institution, graduation_date, grade}]` | **new** |
| `certifications` | jsonb | | `[{id, name, issuer, date, detail}]` | **new** |
| `awards` | jsonb | | `[{id, name, issuer, date, detail}]` | **new** |
| `languages` | jsonb | | `[{id, name}]` | **new** |
| `created_by_user_id` | uuid | FK → users | Who saved this version | **new** |
| `created_at` | timestamptz | `now()` | When this version was saved | exists |

**Dropped (approved):** `is_base` (→ `category`), `parent_id` (not tracking which base version a tailored résumé came
from; add a `base_version` integer later if that's ever needed), `json_data` (→ the content columns),
`resume_parse_id` (→ `base_resumes`), `updated_at` (rows never change), and the index
`uq_resumes_one_base_per_candidate` (a candidate now has many base versions).

**Rules**

```sql
ALTER TABLE resumes ADD CONSTRAINT ck_resumes_category_values CHECK (category IN ('BASE', 'TAILORED'));
ALTER TABLE resumes ADD CONSTRAINT ck_resumes_category_job
  CHECK ((category = 'BASE' AND job_id IS NULL) OR (category = 'TAILORED' AND job_id IS NOT NULL));
CREATE UNIQUE INDEX uq_resumes_version
  ON resumes (base_resume_id, category, job_id, version) NULLS NOT DISTINCT;
ALTER TABLE resumes ADD CONSTRAINT fk_resumes_base_candidate
  FOREIGN KEY (base_resume_id, candidate_id) REFERENCES base_resumes (id, candidate_id);
```

- `NULLS NOT DISTINCT` needs Postgres 15+; docker compose runs `postgres:16-alpine`, so it's available (production
  must be 15+ too).
- **Content is immutable.** An edit inserts the next version; a row's content columns are never updated.
- `name` and `template` are labels, not content: they may change in place.
- `ck_resumes_category_job`: `jobs` rows can be deleted with `ON DELETE SET NULL`, which would then break the check
  on a tailored row (00-candidate-core notes the same problem). Decide in PR 3: change `resumes.job_id` to
  `ON DELETE RESTRICT`, or enforce the rule in the routes instead of a CHECK.

**One résumé = one `(base_resume_id, category, job_id)`.** No `lineage_id` is needed, because tailoring takes only
two inputs, the job description and the base:

| `base_resume_id` | `category` | `job_id` | `version` | Which résumé |
|---|---|---|---|---|
| 1 | BASE | NULL | 1, 2, 3 | Base 1 and its edits |
| 1 | TAILORED | 7 | 1, 2 | Base 1 tailored for job 7, then edited |
| 1 | TAILORED | 8 | 1 | Base 1 tailored for job 8 |
| 2 | TAILORED | 7 | 1 | Base 2 tailored for job 7 (a different input, so a separate résumé) |

Re-tailoring the same base for the same job is the next version of that résumé, not a second one.

### 3.4 Ids inside the jsonb columns

- Every item (skill, job, bullet, project, education, certification, award, language) gets an `id` (uuid) when
  BenchQ first builds it.
- **Ids stay the same across versions**: copying a version copies the ids; a new item gets a new id.
- `claims.entity_ref` points at these ids, so a claim and its evidence follow an item from version to version.
- Skills are stored one per item (`[{id, category, name}]`), split from the parser's comma-separated string at
  bracket depth 0 only ("AWS (ECS, Lambda, S3)" stays one item), so each skill can carry its own claim.
- Claims cover summary, experience, project, skill, education, certification and award items. Languages are never
  printed, so they carry no claim.

---

## 4. The workflow

### 4.1 The one rule

> **The workflow (tailoring, job search) always uses version 1 of the active base.**

Every version a person selects becomes the first version of a new base, so the active base's v1 is always the
résumé in use. Versions 2, 3… of any base are saved edits nobody selected. The workflow résumé is:

```sql
SELECT r.* FROM resumes r
JOIN base_resumes b ON b.id = r.base_resume_id
WHERE b.candidate_id = :candidate AND b.is_active AND r.category = 'BASE' AND r.version = 1;
```

### 4.2 Creating a candidate (OWNER or MANAGER)

1. Upload a PDF or DOCX → the parser runs → a `resume_parses` row: `candidate_id` NULL, `expires_at` now + 60 min.
   The row is saved only if the parse succeeds.
2. The parse fills the new-candidate form (via `toResumeDraft`); the person can correct it.
3. **Create**, in **one transaction** (any failure saves nothing):
   1. the `candidates` row;
   2. `resume_parses`: `candidate_id` set, `expires_at` NULL;
   3. `base_resumes`: `source = 'UPLOAD'`, `resume_parse_id` set, `is_active = true`;
   4. `resumes`: `category = 'BASE'`, `version = 1`, `base_resume_id` = the new base.

**What goes into that first `resumes` row** (confirmed): the form's corrected values where the form has the field;
the parse for the rest. `resume_parses.parse` keeps the AI's original untouched.

| From the form (corrected) | From the parse |
|---|---|
| name, title, email, phone, LinkedIn, city, state, work authorization, summary, skills | country, GitHub, work experience, projects, education, certifications, awards, languages |

No résumé uploaded (`resume_parse_id` null) → no base is created; one can be added later.

### 4.3 Every action

| Action | `base_resumes` | `resumes` |
|---|---|---|
| Create a candidate | new `UPLOAD`, active | `BASE` v1 |
| Edit a base version or a tailored résumé, then save | — | the next version of that résumé (content copied, then changed) |
| After the save, "Use this as the base?" → **Yes** | new `PROMOTED`, active (the previous one switched off) | the saved version copied as `BASE` v1 of the new base |
| … → **No** | — | — (the version is history only) |
| Base dropdown → pick a base's **v1** | `is_active` moves to that base; **no new row** | — |
| Base dropdown → pick a base's **v2 or later** | new `PROMOTED`, active | that version copied as `BASE` v1 of the new base |
| Tailor for a job | — | `TAILORED` v1 from the active base's v1 (or the next version if this base + job already exists) |

- **A new base is always the active one**, in the same transaction that switches the previous one off (the partial
  unique index refuses two).
- **The base dropdown lists only bases** and their versions (it reads `base_resumes` and the `BASE` rows of
  `resumes`). Tailored résumés are not listed.
- **A tailored résumé becomes a base only through "Use this as the base?"**: its copy is `category = 'BASE'`,
  `job_id` NULL; the original stays `TAILORED`.
- **Editing the active base does not change the workflow**: it stays on v1 until the person says Yes.
- **Switching the active base leaves old tailored résumés alone**: they keep pointing at their base (right for
  applications already sent). New tailoring uses the new active base.
- **A sent résumé is frozen**: an application points at a `resumes` row, and rows never change (00-candidate-core).

### 4.4 Example

| Step | Rows |
|---|---|
| Create | Base 1 (UPLOAD, active) · resumes B1 v1 |
| Edit twice, "No" both times | resumes B1 v2, B1 v3 — workflow still B1 v1 |
| Tailor for job 7 | resumes B1 TAILORED job 7 v1 |
| Edit B1 v3 → v4, "Yes" | resumes B1 v4 · Base 2 (PROMOTED, active) · resumes B2 v1 = copy of B1 v4 |
| Dropdown → Base 1 · v1 | `is_active` back to Base 1, nothing copied |

### 4.5 Truth Guard

- Every claim on new content starts `UNVERIFIED`. A copied version keeps its items' ids, so claims follow them; a
  changed or new item's claim goes back to (or starts at) `UNVERIFIED`.
- A `PROMOTED` base never backs evidence: only `resume_parses` rows (uploads) do.
- Evidence excerpts quote the original file (`resume_parses.content`), never `parse`: the parser rewrites the
  résumé for ATS, so `parse` is the AI's wording, the draft the claims come from, not proof of them.
- Nothing here produces a `VERIFIED` claim. The export gate (unverified claims block export) is unchanged.

---

## 5. The frontend contract (`docs/02` §8)

**Versioning needs no new shape.** `src/lib/schemas/resume.ts` already has it:

| Frontend (`Resume`) | Backend |
|---|---|
| `Resume` | one `(base_resume_id, category, job_id)` group |
| `isMaster` | `category = 'BASE'` |
| `targetJobId` | `job_id` |
| `templateId` | `template` |
| `name` | `name` |
| `versions[]` / `versionNumber` | the group's rows / `version` |
| `latestVersionId` | the highest `version` in the group |
| `ResumeVersion.parentVersionId` | the previous version's id in the group, or null (derived; no column) |

The DTO mapper (`src/lib/api/dto/`) groups rows into `Resume` objects. No backend shape leaves `src/lib/api/dto/`.

**The docs/02 addition (approved; written in `docs/02-DATA-CONTRACTS.md` §8.1):**
- **`BaseResume`**: `id`, `candidateId`, `firmId`, `source` (`UPLOAD` / `PROMOTED`), `isActive`, `createdAt`,
  `createdByUserId` — for the base dropdown and showing which base is active.
- **`baseResumeId`** on `Resume`.
- **The new parser fields** in `ResumeDraftSchema` (`country`; city and state read directly, no `splitLocation`)
  and in the studio's content (`awards`, `languages`).
- **`RecordEvidenceSchema.entityType`** gains `education` and `award`, matching the backend's `claims.entity_type`.

Change `src/lib/schemas/` only after the docs/02 text is merged (PR 1).

---

## 6. Permissions and isolation

| Action | Who (the permission policy) | Notes |
|---|---|---|
| Upload a résumé, create the candidate (and its first base) | `candidate.create`: OWNER, MANAGER | Exists (`backend/auth/policy.py`, `src/lib/auth/policy.ts`) |
| Edit a version, "Use as base?", pick a base, tailor | `resume.edit`: OWNER, MANAGER, BDE | Exists in both policies; the résumé routes don't call it yet — every new or changed write route must use `Depends(require("resume.edit"))` |
| Read résumés and bases | Anyone who can see the candidate | BDE: their own candidates (`own_scope`); MANAGER: their team's (`team_scope`); OWNER: the firm |
| Support view (platform admin) | Read only | No write route, no PDF export (`access.py` already blocks `GET …/pdf` for a view) |

- No inline role checks: only the policy and the scope helpers.
- Every row carries `firm_id` and `candidate_id`; every read goes through `scoped()` (plus `own_scope` / `team_scope`
  where the route lists candidates' data).
- Every new route goes into `backend/auth/access.py` (`ROUTE_ACCESS`) and `backend/tests/isolation_cases.py` (F7):
  another firm's ids → 404, never confirm existence.
- A foreign key from a request (`job_id`, `base_resume_id`, a version id) is checked to be the firm's own
  (`firm_ref`) before anything is written.

---

## 7. Implementation plan

Each PR branches from `main`, never from another PR's branch, and opens after the previous one merges (work can
start earlier on a branch from `main`). One concern each, merge commits. Before each PR: `pnpm typecheck && pnpm
lint && pnpm test`, plus the backend suite when `backend/` changed. Abdul (CODEOWNERS) approves models, migrations
and contracts.

| # | Branch | What | Migration |
|---|---|---|---|
| 1 | `docs/resume-versioning` | This file; the docs/02 §8.1 addition (§5); the 00-candidate-core résumé rewrite; `zuhair.md` 1.3, 1.4, 3.2 and 3.3 updated; `base_resumes` in `docs/team/README.md` §3. No code. | — |
| 2 | `feat/parser-format-v2` (**built**) | The new parser (§2–§2.2, from the parser handoff): prompts, strict format, `clean_reply`, link addresses for PDF and DOCX, the `call_llm` options, the settings rows and save check. Frontend: `BackendResumeParseSchema`, `toResumeDraft`, `splitSkills` (bracket depth 0), `ResumeDraftSchema.country`, the mock fixture. The wizard and `applyDraft` are unchanged. Tests; the real-résumé tests run on the team's test résumés, which are shared separately and kept out of the repo. | — |
| 3 | `feat/base-resumes-schema` | **Additive only**: `base_resumes`, the new `resumes` columns, CHECKs, indexes, composite FK; `award` in `ck_claims_entity_type`; SQLAlchemy models; constraint tests; claim **0008** in `docs/team/README.md` §6. No behaviour change. | **0008** |
| 4 | `feat/base-resume-from-parse` | Candidate create (`routes_candidates.py` `create_candidate`) writes the base and `resumes` v1 in its transaction (§4.2), item ids (§3.4); tests incl. rollback on failure and isolation. | — |
| 5 | `feat/resume-versions` | Routes: save an edit as the next version; "use as base"; list bases + versions; pick a base (v1 flips, v2+ promotes); tailor from the active base's v1 (also sets `candidate_id`, which the tailor route doesn't today). `resume.edit`, `access.py`, `isolation_cases.py`. | — |
| 6 | `feat/drop-legacy-resume-columns` | **The approved drops** (§3.1, §3.3). First backfill old rows' content from `json_data` (the JobNavigator shape: `header.contact_items`, `experience`, `skills` dict, `education.school`…) into the new columns, so old rows stay readable (team rule 5). Port everything still reading the dropped columns: render/preview/PDF, copy, tailor, import-pdf, score-check, the seed. Claim **0009**. | **0009** |
| 7 | `integrate/resumes` | Frontend live: the résumé adapter's live path, the DTO mapper (§5), the `BaseResume` schema, the base dropdown, the "Use this as the base?" prompt, version history. Both themes, keyboard, skeleton/empty/error states. | — |

If someone else's 0008 merges first, renumber and fix `down_revision` before merging.

**Still to decide:**
- **PR 3:** `resumes.job_id` `ON DELETE RESTRICT` with the CHECK, or a route rule instead (§3.3; ask Abdul).
- **PR 3:** the jsonb content columns `NOT NULL DEFAULT '[]'` (proposed).
- **PR 4:** the first base's `name` (proposed: `"Base"`).

---

## 8. Known issues and out of scope

- **Two template systems**: the studio has 6 CSS designs (`src/components/app/resume-studio/templates.ts`, printed
  by the browser, `@page { size: letter }`); the backend has 8 HTML designs (`backend/resume_templates/`, PDF via
  Playwright). Names don't match and BenchQ never saves `template`. Pick one in §3 (tailoring) before
  `resumes.template` means anything.
- **The tailor route** writes `resumes` rows without `candidate_id` (fixed in PR 5).
- **Tailoring prompts** allow content not in the base; Truth Guard keeps it `UNVERIFIED` (§4.5), but the prompts
  are worth tightening in §3.
- **`personas`** (a singleton without `firm_id` on firm routes) is a firm-isolation gap, flagged to Abdul; not
  touched here.
- **Word export**: none exists (PDF only). Not part of this design.
- **File storage** (S3, `docs/integration/06-open-decisions.md` D7): would replace `resume_parses.content` with a
  storage key; nothing else here changes.
