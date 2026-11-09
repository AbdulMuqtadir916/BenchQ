# Résumé versioning — `resume_parses`, `base_resumes`, `resumes` (Zuhair)

Design agreed 2026-10-31 by Zuhair, with the approvals in §1 from Abdul. **Built so far: the parser (§2–§2.2, PR 2), the tables
(§3, PR 3, migration 0008), the first base on candidate create (§4.2, PR 4) and versions and bases through the API
(§4.3, §4.6, §4.7, §6, PR 5, migration 0011) and the clean-up of the old columns and JobNavigator's résumé code
(§3.3, §4.8, §8, PR 6, migration 0013).** The screens (PR 7) are not built yet. This file is
the single reference for building it: the tables (§3), the workflow (§4), the frontend contract (§5), permissions
(§6) and the PR plan (§7). Owner of all three tables: Zuhair (`docs/team/README.md` §3).

---

## 1. Approvals (Abdul, 2026-10-31)

| Approved | Scope |
|---|---|
| Drop columns and an index | `resume_parses.updated_at`; `resumes.is_base`, `resumes.parent_id`, `resumes.json_data`, `resumes.resume_parse_id`, `resumes.updated_at`; the index `uq_resumes_one_base_per_candidate` |
| Rewrite the résumé section of `docs/team/00-candidate-core.md` ("Résumés: one base, many tailored (Q53e)") | Many bases per candidate, one active; `category` instead of `is_base`; no `parent_id`; `resume_parse_id` on `base_resumes` |
| The `docs/02-DATA-CONTRACTS.md` addition | A `BaseResume` entity; `baseResumeId` on `Resume`; the new parser fields (§2) in `ResumeDraftSchema` and the studio content |
| Migration numbers | `0008` (additive, PR 3), `0011` (additive, PR 5) and the next free number for the drops (PR 6; `0009` went to Applications), each claimed in `docs/team/README.md` §6 in the PR that adds it |
| Awards | awards are a section of the résumé like the others (`resumes.awards`); the `claims` table they were once added to is gone (0015, 2026-11-05) |

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
   uploads                             the shelf of bases          every version of every résumé
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
| `content_sha256` | varchar | NOT NULL | The file's fingerprint (hex SHA-256 of `content`); **new in 0011 (PR 5)** |
| `created_at` | timestamptz | NOT NULL, `now()` | When it was uploaded |

- **Rule (exists):** `(candidate_id IS NULL) = (expires_at IS NOT NULL)`. Expired drafts are deleted on the next upload.
- **Rule (0011):** `UNIQUE (candidate_id, content_sha256) WHERE candidate_id IS NOT NULL`: one candidate never keeps
  the same file twice (§4.6). Drafts (no candidate) are not checked. The model computes the fingerprint from
  `content` whenever a row is written, so the onboarding parse route is unchanged; 0011 fills it in for existing rows.
- **Dropped:** `updated_at` (it only marked when the draft was kept, which is the candidate's `created_at`).
- Holds uploads only. A BDE-made base never goes here: a base points at this table as
  "the document the candidate supplied".
- `parse` is kept after create: the record of what the AI extracted (as opposed to what a person corrected) and the
  baseline for parser-quality work (1.2).

### 3.2 `base_resumes` — the shelf of bases (new; holds no content)

| Column | Type | Constraint | Meaning |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | The base's id ("base 1, 2…") |
| `firm_id` | uuid | FK → firms, NOT NULL | The firm that owns it |
| `candidate_id` | uuid | FK → candidates, NOT NULL | The candidate it belongs to |
| `source` | varchar | NOT NULL, `UPLOAD` / `PROMOTED` | Made from an upload, or promoted by a person from a `resumes` version. (`MANUAL`, a base from the form alone, existed from 0015 to **0018**: 07 Q58, no candidate without a résumé) |
| `resume_parse_id` | uuid | FK → resume_parses, nullable | The upload it came from; required for `UPLOAD`, empty for `PROMOTED` |
| `is_active` | boolean | NOT NULL, default false | The base the workflow uses (tailoring, job search) |
| `created_by_user_id` | uuid | FK → users, NOT NULL | Who made it |
| `created_at` | timestamptz | NOT NULL, `now()` | When it was made |
| `promoted_from_resume_id` | uuid | FK → resumes, nullable, `ON DELETE SET NULL` | For `PROMOTED`: the version it was copied from. **New in 0011 (PR 5)** |
| `deleted_at` | timestamptz | nullable | Soft delete (§4.7): set when an unused base is deleted; NULL again when the same file restores it. **New in 0013 (PR 6)** |
| `archived_at` | timestamptz | nullable | Set when a used base is deleted (hidden, §4.7); NULL again on "Show again". **New in 0011 (PR 5)** |

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

```sql
-- 0011 (PR 5)
ALTER TABLE base_resumes ADD COLUMN promoted_from_resume_id uuid REFERENCES resumes(id) ON DELETE SET NULL;
ALTER TABLE base_resumes ADD COLUMN archived_at timestamptz;
CREATE UNIQUE INDEX uq_base_resumes_one_per_parse   ON base_resumes (resume_parse_id)         WHERE resume_parse_id IS NOT NULL;
CREATE UNIQUE INDEX uq_base_resumes_one_per_version ON base_resumes (promoted_from_resume_id) WHERE promoted_from_resume_id IS NOT NULL;
```

- No `json_data`, on purpose: content lives only in `resumes`.
- `UNIQUE (id, candidate_id)` exists for the composite foreign key from `resumes` (§3.3).
- **`promoted_from_resume_id`** (decided 2026-11-02, Zuhair; replaces "no `promoted_from_resume_id`" of 2026-10-31):
  once B2 v3 has become B3 v1, the dropdown leaves B2 v3 out, since B3 v1 is the same résumé; history still shows it
  ("became Base 3"). One version gives at most one base, so picking it again (or a double-click on Yes) switches to
  the existing base instead of copying it twice.
- **One upload gives at most one base** (`uq_base_resumes_one_per_parse`).

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
| `summary_id` | varchar | nullable | The summary's id, like an item's (§3.4); NULL without a summary | **new in 0011 (PR 5)** |
| `deleted_at` | timestamptz | nullable | Soft delete (§4.7): set when the version (or its base) is deleted; the row stays, out of sight, its number never reused | **new in 0013 (PR 6)** |
| `skills` | jsonb | | `[{id, category, name}]` | **new** |
| `experiences` | jsonb | | `[{id, job_title, company, location, dates, start, end, current, bullets: [{id, text}]}]` | **new** |
| `projects` | jsonb | | `[{id, name, url, dates, technologies, bullets: [{id, text}]}]` | **new** |
| `educations` | jsonb | | `[{id, degree, institution, graduation_date, grade}]` | **new** |
| `certifications` | jsonb | | `[{id, name, issuer, date, detail}]` | **new** |
| `awards` | jsonb | | `[{id, name, issuer, date, detail}]` | **new** |
| `languages` | jsonb | | `[{id, name}]` | **new** |
| `autofill` | jsonb | `'{}'` | The autofill entries the user typed for this version, `{"edited": {key: {"answer", "over"}}, "custom": {question: answer}}`: an edit to a built answer, by its key, with `over`, a copy of the built answer it replaced (for the work history, the whole list; the edit applies while that's still the built answer), or a question they added ([docs/02](../02-DATA-CONTRACTS.md) §8.1). The built answers aren't otherwise stored: `backend/candidates/autofill.py` builds them from the version and the profile each time one version is read with `?autofill=true`. A save, a promote and tailoring copy the entries to the new version. Not content: a save never compares it | **new in 0019** |
| `created_by_user_id` | uuid | FK → users | Who saved this version | **new** |
| `created_at` | timestamptz | `now()` | When this version was saved | exists |

**Dropped (approved; done in PR 6, migration 0013):** `is_base` (→ `category`), `parent_id` (not tracking which base
version a tailored résumé came from; add a `base_version` integer later if that's ever needed), `json_data` (→ the
content columns), `resume_parse_id` (→ `base_resumes`), `updated_at` (rows never change), and the index
`uq_resumes_one_base_per_candidate` (a candidate now has many base versions).

**Required from 0013 (PR 6, decided 2026-11-02):** every row belongs to a base and a candidate. `base_resume_id` and
`candidate_id` are `NOT NULL`, and the "rows with a base only" exceptions below are gone: `ck_resumes_category_job`
holds for every row, `uq_resumes_version` has no `WHERE`, and `ck_resumes_base_has_candidate` is dropped (the
`NOT NULL` does its job).

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
- **Deleting a job deletes the résumés tailored for it** (Abdul, 2026-11-01): `resumes.job_id` is
  `ON DELETE CASCADE`, so `ck_resumes_category_job` always holds. An application still blocks deleting a job it
  names (`applications.job_id`), so a résumé that was sent is never lost. The `Job` → `resumes` relationship has
  `passive_deletes`, so the ORM leaves the cascade to the database. Before a BDE deletes a job, the app asks
  "Are you sure you want to delete this job?" and names the résumés tailored on it (built with the job module,
  `zuhair.md` §2; not in PR 5).
- **Rows from before 0008 are deleted, not converted** (decided 2026-11-04, Zuhair: BenchQ keeps no JobNavigator
  résumé data; supersedes the 2026-11-02 plan to convert a candidate's old rows). 0013 deletes every `resumes` row
  without a base (the seeded "Sample PM", firm-level résumés, old tailored copies). What pointed at one lets go:
  applications and cover letters lose the link (SET NULL); tracking links and their click history go with it
  (CASCADE). Before running 0013 on a database with real customer data, check what it would delete (the migration's
  header has the query).
- **`ck_resumes_base_has_candidate`** (`base_resume_id IS NULL OR candidate_id IS NOT NULL`): Postgres skips a
  composite foreign key while one of its columns is null, so a versioned row must name its candidate.
- **0007's `uq_resumes_one_base_per_candidate` covers old rows only** (`… AND base_resume_id IS NULL`): a versioned
  candidate has many bases and many base versions. PR 6 drops it, as approved.

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
- **An id stands for one exact text** (decided 2026-11-02, Zuhair; replaces "ids stay the same across versions"):
  an item copied or kept exactly as it was keeps its id; a changed item gets a **new** id, and so does a new one. A
  job's or project's text includes its bullets, so changing, adding or removing a bullet gives the job a new id
  (the changed bullet gets one too; untouched bullets keep theirs).
- **The summary is an item too** (`resumes.summary_id`, 0011): the same text keeps its id, a changed one gets a new
  id, no summary has none.
- These ids stand for one exact text: the same text keeps its id from version to version, so a save can tell what changed. Editing a version never touches another version's ids.
- Skills are stored one per item (`[{id, category, name}]`), split from the parser's comma-separated string at
  bracket depth 0 only ("AWS (ECS, Lambda, S3)" stays one item).

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
| name, title, email, phone, LinkedIn, city, state, country, work authorization, summary, skills | GitHub, work experience, projects, education, certifications, awards, languages |

No résumé uploaded (`resume_parse_id` null) → no base is created; one can be added later.

Built in PR 4 (`backend/candidates/first_base.py`):
- The first base's `name` is **"Base"**. (`is_base` was set while the column existed; PR 6 dropped it.)
- **Work authorization** is the form's code in the app's own label (`USC` → "US Citizen", `H1B` → "H-1B", as
  `work-auth-chip.tsx`). There is no `OTHER` since 0015.
- **`json_data`** was left empty on new rows until PR 6 dropped it; its readers now read the columns (§4.8).

### 4.3 Every action

| Action | `base_resumes` | `resumes` |
|---|---|---|
| Create a candidate with a résumé file | new `UPLOAD`, active | `BASE` v1 |
| Create a candidate with no file (**0015**) | new `MANUAL`, active, no parse | `BASE` v1 from the form alone (header, summary, skills; the lists start empty) |
| Edit a base version or a tailored résumé, then save | — | the next version of that résumé (content copied, then changed) |
| After the save, "Use this as the base?" → **Yes** | new `PROMOTED`, active (the previous one switched off) | the saved version copied as `BASE` v1 of the new base |
| … → **No** | — | — (the version is history only) |
| Base dropdown → pick a base's **v1** | `is_active` moves to that base; **no new row** | — |
| Base dropdown → pick a base's **v2 or later** | new `PROMOTED`, active (or the existing one, if that version was promoted before) | that version copied as `BASE` v1 of the new base |
| Upload a new résumé on the candidate's page (BDE, §4.6) | new `UPLOAD`, active | `BASE` v1 from the parse |
| Delete a version or a base (BDE, §4.7) | unused: soft deleted (`deleted_at`); used: hidden (`archived_at`) | unused version: deleted; used: refused |
| "Show again" on a hidden base (BDE) | `archived_at` cleared; **not** made active | — |
| Tailor for a job (the tailoring module, not PR 5) | — | `TAILORED` v1 from the active base's v1 (or the next version if this base + job already exists) |

- **A new base is always the active one**, in the same transaction that switches the previous one off (the partial
  unique index refuses two).
- **The base dropdown lists only bases** and their versions (it reads `base_resumes` and the `BASE` rows of
  `resumes`). Tailored résumés are not listed. Hidden bases and versions already promoted to a base are left out;
  history shows both. Bases are numbered in the order they were made ("Base 1, 2…"); deleting one renumbers the
  later ones, and a hidden one keeps its place. The screens name a base `<Candidate> · <Role> · Base 2` from its
  headline (`title`, which the listing carries for that reason; docs/04 §4.3).
- **Saving** (decided 2026-11-02):
  - The save names the version it was edited from. The new row is that résumé's next version, whatever was saved
    in between: two people saving from v2 at once get **v3 and v4**, both kept (Abdul). The second one is told:
    *"v3 was saved while you were editing; your v4 doesn't include those changes."* No lineage is stored (§3.3).
  - A save that changes nothing is refused: *"No changes to save."*
  - Ids follow §3.4: an item, bullet or summary kept as it was keeps its id; a changed or new one gets a new id.
    An id that isn't in the version edited is refused, so a save can't take over another item's id.
- **Saving from the studio (PR 7, Zuhair 2026-11-05):** Save reads the version again just before saving, lays the
  studio's edits over it and sends that: what the studio doesn't edit (languages; work authorization, shown read-only)
  is carried over untouched, so no save drops it. The studio shows every field of the parser's strict format but
  languages. The design (template) and the résumé's name aren't part of a save (the save copies them from the version).
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

### 4.5 No claim states (decided 2026-11-05)

BenchQ has no Verified, Unverified or Contradicted states, no `claims` and `evidence` tables and no export gate (migration 0015
drops the tables; the frontend removes the rest in PR 7). Any résumé that is not soft deleted can be exported. What stays:
- the truth rules in the parser's prompts and its strict response format (§2): the parser must not invent content;
- ids on every item (§3.4), which tell a save what changed;

### 4.6 A later résumé (decided 2026-11-02, Abdul and Zuhair)

When the candidate sends an updated résumé, the owner or manager messages the file to the candidate's BDE outside
the app, and **the BDE uploads it** on the candidate's page. This holds before assignment too: the owner and manager
assign the BDE first, then send the file. The onboarding upload (§4.2) stays the owner's and manager's.

1. The file is read and fingerprinted. **The same file the candidate already has** (whoever uploaded it, the
   onboarding file included) is refused before the AI call: *"This résumé is already Base 3."* If that base is
   hidden: *"This résumé is Base 3 (hidden). Show it again?"*.
2. The parser reads it (`read_resume`, §2.1; no database connection held during the call).
3. **One transaction:** `resume_parses` (candidate set, `expires_at` NULL), `base_resumes` (`UPLOAD`, **active**, the
   previous one switched off), `resumes` `BASE` v1 from the parse (`first_base()` without the form). If the parse
   fails, nothing is saved.
4. The candidate's profile is not changed by an upload.

### 4.7 Deleting, hiding and showing again (decided 2026-11-02, Abdul and Zuhair; deleting made soft 2026-11-04, Zuhair)

Only the assigned BDE deletes. A warning always comes first and names what uses it (*"Used by 2 live applications, 1
tailored résumé sent in a live application."*).

**Deleting is a soft delete** (Zuhair, 2026-11-04; D10 in `docs/integration/06-open-decisions.md`): the row stays and
gets `deleted_at` (`resumes` and `base_resumes`, migration 0013). It is out of every list, the base dropdown, the
workflow and scoring, and opening it is "not found"; its text stays stored, so the ledger and history can still show
what each BDE worked on, and its **version number is never reused**. A base can't be removed from the table anyway
while version rows point at it, so deleting a base marks it and its versions. The base's upload (`resume_parses`)
stays: it holds the file and its fingerprint.

**Used** (changed 2026-11-04, Zuhair) means something real points at it:
- a **live application** (`applications.resume_id`): every status except `move_on` (the application tracker's word for a rejection) and the
  old API's `rejected`, which are closed. A closed application doesn't keep anything in use;
- a **tailored résumé of the base sent in a live application** (a tailoring nobody sent doesn't count).

Cover letters and tracking links are **not** counted: they aren't planned for BenchQ yet.

**"Keep what is in use and delete the rest"** (`DELETE …/bases/{id}?keep_used=true`; the removal preview's `rest`
says what it would do). A base that is in use is only hidden; with `keep_used` it is also cleaned up, all soft
deleted: its versions after v1 that nothing uses and were made by a BDE, and its tailored résumés no live application
was sent with. A base nothing uses is deleted whole, with all its tailorings. The screen asks twice.

**An application keeps showing the résumé it was sent with** (`resume_id`) after it is deleted: read-only, with
`tailored_resume_deleted: true` (any résumé a BDE sent, base version or tailored; the field names still say "tailored"). Only an application with no `resume_id` falls back to the newest tailored résumé of its
candidate and job. Lists, dropdowns and scoring still skip deleted rows.

| | Made by a BDE (this one or an earlier one) | Made by an owner or manager |
|---|---|---|
| **A version, unused** | deleted (soft) | refused |
| **A version, used** | refused: *"Can't delete v2: it was sent to 2 jobs."* | refused |
| **A whole base, unused** | deleted (soft) with its versions; its upload stays | refused if any of its versions was made by an owner or manager |
| **A whole base, used** | **hidden** for everyone: `archived_at` set; out of the dropdown, kept in history and on the applications | refused |
| **The active base** | refused: *"Pick another base first."* | refused |

- **Made by** is read from `created_by_user_id` and that user's current role. Roles can't change today; whoever
  builds role change decides whether to record the role on each row instead.
- A version can't be hidden on its own: a hole in the history (v1, v3) would leave applications pointing at
  something invisible.
- **A base's v1 is never deleted on its own**: it is the base (what the workflow uses when the base is picked).
  Delete the whole base instead.
- **Version numbers are never reused** (soft delete): the next version is one more than the highest that ever
  existed, deleted ones included. Delete v3 and save again: the new version is v4, and the history reads v1, v2, v4.
  (This replaces the 2026-11-02 decision that the latest number could come back.)
- **Version numbers never shift:** deleting v2 of v1, v2, v3 leaves v1, v3. A version's number is what applications,
  the ledger and people refer to, so it never changes (only base numbers, "Base 1, 2…", shift; §4.3).
- **Uploading the same file again restores a deleted base** (Zuhair, 2026-11-04): the file's fingerprint
  (`resume_parses.content_sha256`, unique per candidate) finds the kept upload and its deleted base. No new read, no
  AI: the base comes back with **only its v1** (the file's own content; later edits stay deleted), becomes the base
  the workflow uses (as any upload does), and the answer says `restored: true`. Picking a version whose promoted base
  was deleted brings that base back the same way. Base numbers ("Base 1, 2…") count the bases that exist.
- **Show again** clears `archived_at`. The base comes back to the dropdown with all its versions, **not active**;
  the BDE picks it to use it. History lists hidden bases with "Show again"; re-uploading the file offers the same.

### 4.8 Reading a résumé as text (PR 6)

`backend/candidates/resume_text.py` `resume_text(version)` is a version's plain text with `## Section` headings, read
from the columns. Job scoring and interview prep use it; nothing converts the columns back to JobNavigator's shape.

- **Job scoring** (`backend/analyzer/cv_scorer.py`, until the job module scores per candidate): a job is scored
  against each of the firm's candidates' active base v1, labelled with the candidate's name. The platform-wide
  `default_resume_id` setting is no longer read; a company's `selected_resume_ids` still narrows the list to those
  versions. The "persona" option still reads the shared persona, until it moves ([persona-to-candidates.md](./persona-to-candidates.md) §7).
- **Interview prep** (`routes_applications.py`): the candidate's tailored résumé for the job, newest version.
- **Cover letters:** the letter is written from the version's columns.

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
- **PR 5 (approved by Abdul, 2026-11-02):** `BaseResume` gains `promotedFromResumeId` (nullable) and `archivedAt`
  (nullable), for leaving promoted versions and hidden bases out of the dropdown (§3.2). The studio's content gains
  `summaryId` (nullable), the summary's id (§3.4).

Change `src/lib/schemas/` only after the docs/02 text is merged (PR 1); PR 7 does it (`BaseResume`, `baseResumeId`, and the
shelf and opened-version shapes are built; the studio content's `awards`, `languages` and `summaryId` come with saving).

**PR 7's read routes** (`backend/api/routes_firm_resumes.py`): `GET /api/firms/{firm}/resumes` lists every base and
résumé of the candidates in the principal's scope (07 Q47) in two queries, with no content; `GET
/api/firms/{firm}/resumes/{id}` opens one version by its id alone (a link from an application or the studio's URL). A
version outside the scope, of another firm, or deleted is the same 404 as a missing one. Every base and version in a
listing names its `candidate_id`.

---

## 6. Permissions and isolation

**Who changes résumés (07 Q55, Abdul, 2026-11-02):** the owner and manager build the candidate; once a BDE is
assigned, only that BDE changes the candidate's résumés. The owner and manager then view them.

| Action | Before a BDE is assigned | After | The policy |
|---|---|---|---|
| Onboarding upload, create the candidate and its first base (§4.2) | OWNER, MANAGER | — | `candidate.create` |
| Edit and save, "Use as base?", pick a base | OWNER, MANAGER (in their scope) | the candidate's BDE | `can_change_resume(principal, candidate)` |
| Upload a later résumé (§4.6), delete or hide (§4.7), show again | — | the candidate's BDE | `can_manage_resume(principal, candidate)` |
| Tailor (the tailoring module) | — | the candidate's BDE | `can_manage_resume` |
| Read résumés and bases | anyone who can see the candidate | the same | BDE: their own candidates (`own_scope`); MANAGER: their team's (`team_scope`); OWNER, VIEWER: the firm |
| Support view (platform admin) | read only | read only | `access.py`: every non-GET is 403 in a view |

- **The two helpers** sit next to the role table, in `backend/auth/policy.py` and `src/lib/auth/policy.ts` (like
  `can_assign_to` / `canAssignTo`). They start from `resume.edit` (OWNER, MANAGER, BDE in the role table, unchanged)
  and narrow it by the candidate's `bde_id`. So the role table, the route registry and its access levels don't
  change: the résumé pages open as before, and the helpers decide which actions work.
- **The check happens when the request arrives**, with the candidate row locked: a manager's save that lands just
  after a BDE was assigned is refused (*"This candidate now has a BDE; you can view the résumé, not change it."*).
- **Reassignment:** résumés stay with the candidate; the new BDE sees and changes everything the earlier BDE made,
  and the earlier BDE loses access at once. The ledger is unchanged (07 Q52): each BDE reads their own entries.
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
| 3 | `feat/base-resumes-schema` (**built**, #99) | **Additive only**: `base_resumes`, the new `resumes` columns, CHECKs, indexes, composite FK; `award` in `ck_claims_entity_type`; SQLAlchemy models; constraint tests; claim **0008** in `docs/team/README.md` §6. No behaviour change. | **0008** |
| 4 | `feat/base-resume-from-parse` (**built**) | Candidate create (`routes_candidates.py` `create_candidate`) writes the base and `resumes` v1 in its transaction (§4.2), item ids (§3.4); tests incl. rollback on failure and isolation. | — |
| 5 | `feat/resume-versions` (**built**) | Routes under `/api/firms/{firm}/candidates/{candidate}/resumes`: list bases + versions, open a version, save the next version (§4.3), "use as base" and pick a base (v1 flips, v2+ promotes or reuses), the BDE's upload (§4.6), delete / hide / show again with the usage reads for the warning (§4.7). `can_change_resume` / `can_manage_resume` in both policies (§6), `access.py`, `isolation_cases.py`; races tested. Migration 0011: `promoted_from_resume_id`, `archived_at`, `content_sha256` and their unique rules (§3.1, §3.2), `summary_id` (§3.4). Saving gives changed text new ids instead of resetting claims (§4.5). Docs: 07 Q55, docs/02 §8.1. **Tailoring is not here**: the tailoring module creates tailored résumés; their edits use PR 5's save. | **0011** |
| 6 | `feat/drop-legacy-resume-columns` (**built**) | **The approved drops** (§3.1, §3.3) and the old JobNavigator résumé code (decided 2026-11-02). Migration 0013: deletes JobNavigator's old résumé rows (§3.3), drops the approved columns and index, makes `base_resume_id` and `candidate_id` required. Removes the old `/api/resumes` router (its shared rendering helpers move to `backend/api/render_shared.py` for cover letters), the 8 backend templates, the old parser (`parse_resume_pdf`), `POST /api/persona/import` and the "Sample PM" seed. The other readers read the columns (§4.8): job scoring, interview prep, the jobs checks, cover letters. | **0013** |
| 7 | `integrate/resumes` | **No claim states on the frontend** (chips, export gate, "Mark as reviewed", the claim types; `firms.truth_guard_mode` dropped, migration 0016). **Reading live:** two read-only routes (`GET /firms/{firm}/resumes`, the firm's list in the principal's scope; `GET /firms/{firm}/resumes/{id}`, a version by its id alone, `backend/api/routes_firm_resumes.py`); the résumé adapter's live path and DTO mapper (§5); `BaseResume`, `baseResumeId`; the studio opens the exact version from its own text; one résumé tree (base → versions, tailored by job) in the Resume Builder library and the candidate's Résumés tab. **Writing:** explicit Save with the notice, use as base and pick, upload, delete / hide / show again. Both themes, keyboard, skeleton/empty/error states. | **0016** |

If someone else's 0008 merges first, renumber and fix `down_revision` before merging.

**Decided:** `resumes.job_id` cascades (Abdul, §3.3); the content columns are `NOT NULL DEFAULT '[]'`; the first
base is named "Base" (§4.2).

**Decided for PR 5 (2026-11-02, Abdul and Zuhair):**
- Only the candidate's BDE changes résumés once assigned; before that the owner and manager may edit, save and
  choose the base (07 Q55, §6). Later résumés are uploaded by the BDE (§4.6).
- Two saves from the same version are both kept, as the next two versions, with a notice to the second (§4.3).
- A promoted version leaves the dropdown; one version gives at most one base (§3.2).
- Deleting: by creator and by use, hidden when used, "Show again" not active (§4.7).
- One candidate per person per firm: the email is required and unique within the firm, never checked across firms;
  one BDE per candidate, for all their target roles (Abdul's `candidates` table; not in PR 5).
- Later, in the tailoring module: one active base but several target roles; whether tailoring may choose the base
  per job is decided there.

**Still to decide (Abdul):**
- **The nightly clean-up** (`scheduler.py`, "skip" jobs older than `job_archive_after_days`) deletes shared jobs
  with no confirmation, and with them any firm's tailored résumés; and `candidate_jobs.job_id` is RESTRICT, so it
  errors on a job a candidate still has. Should it skip jobs that still have tailored résumés or candidates?
- **A BDE's delete** (proposed): act on their candidate only (dismiss that candidate's `candidate_jobs` row with a
  `dismissed_at`, and delete that candidate's tailored résumés for the job), never the shared job, which other
  candidates and firms may use. Belongs to the job module (`zuhair.md` §2), with the "résumés tailored on this job"
  dialog; not PR 5.

---

## 8. Known issues and out of scope

- **Résumé designs (decided 2026-11-02, Zuhair):** the studio's 6 designs (`src/components/app/resume-studio/
  templates.ts`, printed by the browser) are BenchQ's résumé designs. JobNavigator's 8 backend designs
  (`backend/resume_templates/`) are deleted in PR 6. A PDF the server makes itself (for the extension or email, with
  tracer links and the export gate enforced by the backend) comes later, built from the studio's designs, in the
  tailoring module or the extension.
- **The old `/api/resumes` routes are removed in PR 6** (they took the firm from the session and didn't check the
  candidate). PR 5's routes replace list, open, save and delete; tailoring and the ATS score (`score-check`) are
  rebuilt in the tailoring module. JobNavigator's tailoring pipeline and score-check are kept, unwired, in
  `backend/analyzer/legacy_tailoring.py` for it to port (they still read the dropped `json_data`).
- **Tailoring prompts** allow content not in the base; there is no claim state to hold it (§4.5), so the prompts
  are worth tightening in §3.
- **`personas`** (a singleton without `firm_id` on firm routes) is a firm-isolation gap, flagged to Abdul; not
  touched here. Kept for now (Abdul, 2026-11-05); its readers move to the candidate first
  ([persona-to-candidates.md](./persona-to-candidates.md)).
- **Word export**: none exists (PDF only). Not part of this design.
- **File storage** (S3, `docs/integration/06-open-decisions.md` D7): would replace `resume_parses.content` with a
  storage key; nothing else here changes.
- **Cover letters** (JobNavigator's `cover_letters`, `/api/cover-letters`) are not used by BenchQ. Kept for now
  (Zuhair, 2026-11-02, "maybe later"); PR 6 only makes them read the résumé from the columns.
