# Stop reading `personas`: use `candidates` and `resumes`

For everyone on the team. Decided 2026-11-05 (Abdul).

## 1. The facts

- **The `personas` table is going to be dropped.** It isn't dropped yet: it goes once nothing reads it (§8), in
  one migration that also drops `cover_letters.from_persona`.
- **Don't add anything new that reads or writes `personas`**, including `/api/persona` and the `Persona` model. What
  reads it today moves to `candidates` and `resumes` (§3).
- **Why:** `personas` is one row (`id = 1`) with no `firm_id`. Every firm's autofill, cover letters and scoring
  read the same profile, and any firm user's `PATCH /api/persona` changes it for all of them, which is a
  firm-isolation gap. BenchQ keeps one profile per candidate, and it is already in `candidates` and the candidate's
  résumés. On the dev database the `personas` row is empty.

## 2. What the tables hold

**`candidates`** (`backend/models/candidates.py`; Abdul approves every change). Facts about the candidate:

| Kind | Columns |
|---|---|
| Who and where | `willing_to_relocate`. Name, email, phone, LinkedIn, city, state and country are the résumé's since 0017 (07 Q57): read from the active base's newest version (`backend/candidates/profile.py`, or `candidate.full_name` and the others in Python) |
| Work authorization | `work_auth` (`H1B`, `H4_EAD`, `OPT`, `CPT`, `GC`, `GC_EAD`, `USC`, `TN`; no `OTHER` since 0015), `work_auth_expiry`, `needs_sponsorship`, `needs_transfer` |
| Work and pay | `employment_types` (C2C, W2, 1099, FTE), `rate_min`, `rate_target` |
| Availability | `status`, `bench_start_date`, `available_from`, `notice_period_days` |
| Role | `primary_role` ("Marketed as"), `target_roles`, `years_experience` |
| Preferences | `work_settings` (onsite, hybrid, remote), `preferred_locations`, `preferred_industries`, `deal_breakers`, `contact_notes` |
| Saved answers | `qa_bank`: a list of `{id, question, answer, category, …}` |
| Ownership | `firm_id`, `manager_id`, `bde_id` (read through `scoped()`, 07 Q47) |

**`resumes`** (`backend/models/db.py`; Zuhair's table). What the candidate did. Each row is one version of one
résumé, and a row's content is never updated: an edit inserts the next `version`
([resume-versioning.md](./resume-versioning.md)):

| Kind | Columns |
|---|---|
| Which résumé | `candidate_id`, `base_resume_id`, `category` (`BASE` or `TAILORED`), `job_id` (a tailored résumé's job), `version`, `deleted_at` |
| Header | `full_name`, `title` (the headline), `city`, `state`, `country`, `email`, `phone`, `work_authorization`, `github`, `linkedin` |
| Content | `summary`, `skills`, `experiences` (with `company`, `title`, `start`, `end`, `current`, `bullets`), `projects`, `educations`, `certifications`, `awards`, `languages` |
| As text | `resume_text(version)` in `backend/candidates/resume_text.py`: the version as plain text with `## Section` headings, for a prompt |

**`base_resumes`** (Zuhair's table): a candidate's bases. `is_active` marks the one in use. `deleted_at` and
`archived_at` mark one that is gone or hidden.

**Contact details and location are only in the résumé** (07 Q57). Work authorization is in both: `candidates.work_auth`
(the code) is the truth, and the studio shows it read-only.

## 3. Suggested mapping

**Everything from here on is a suggestion.** It is how each part that reads `personas` today could read the
candidate instead. The owner of each part decides:

| Reads `personas` today | Owner | Suggestion |
|---|---|---|
| Autofill (`backend/api/routes_autofill.py`, `backend/autofill_schema.py`): the extension | Samad | §4, §5 |
| Cover letters (`backend/api/routes_cover_letters.py`, `backend/analyzer/cover_letter_generator.py`) | Zuhair | §6 |
| Job scoring (`backend/analyzer/cv_scorer.py`) | Zuhair | §7 |
| Old tailoring, kept unwired (`backend/analyzer/legacy_tailoring.py`, `persona_tailor_prompt`) | Zuhair | §7 |
| `/api/persona` (GET, PATCH, `POST /qa-bank`), the seed's singleton (`backend/seed.py`) | Abdul (clean-up) | §8 |

## 4. Autofill: fixed answers (`GET /api/autofill/config` → `project_answers`)

`ANSWER_SCHEMA` keeps its keys, so the extension's field patterns and synonyms don't change. Only where each value is
read from changes. "No source" means no answer: the field is left for the BDE, or filled from the QA bank (§5) when a
saved answer matches.

**Contact** (was `persona.contact`):

| Answer key | New source |
|---|---|
| `first_name`, `last_name` | the résumé version's `full_name`, split at the first space (first word / the rest) |
| `email`, `phone`, `city`, `state`, `country`, `linkedin` | the résumé version's `email`, `phone`, `city`, `state`, `country`, `linkedin` (07 Q57: not on `candidates` since 0017) |
| `github` | the résumé version's `github` (`candidates` has none) |
| `current_company` | the résumé version's `experiences`: the first entry with `current: true` |
| `portfolio` | no source |

**Work authorization** (was `persona.work_auth`):

| Answer key | New source |
|---|---|
| `work_auth_type` | `candidates.work_auth`: `USC` → `citizen`; `GC` → `permanent_resident`; `H1B`, `H4_EAD`, `OPT`, `CPT`, `TN` → `visa`; `GC_EAD` → `other` |
| `authorized_us` | `true` for every `work_auth` (each one is a US work authorization) |
| `requires_sponsorship_now`, `requires_sponsorship_future` | `candidates.needs_sponsorship` (it follows `work_auth` unless the BDE entered it). **Open for Samad:** whether `needs_transfer` (an H1B transfer) also answers "yes" here |
| `over_18` | no source |

**Preferences and pay** (was `persona.preferences`, `persona.compensation`):

| Answer key | New source |
|---|---|
| `willing_to_relocate` | `candidates.willing_to_relocate` |
| `willing_remote` | `"REMOTE"` in `candidates.work_settings` |
| `notice_period` | `candidates.notice_period_days`, as "N days" |
| `earliest_start` | `candidates.available_from` (a date) |
| `desired_salary` | `candidates.rate_target` for a contract form (an hourly rate, `employment_types` C2C/W2/1099); an annual salary (FTE) has no source |
| `referral_source`, `how_did_you_hear` | no source |

**Self-ID** (was `persona.demographics`: `gender`, `race_ethnicity`, `veteran_status`, `hispanic_latino`,
`disability_status`, `age_range`, `transgender`, `sexual_orientation`, `decline_demographics`): **no source.**
`candidates` holds no demographics, by design. `decline_self_id` in the config answer is `false`. **Open for Samad
and the product owner:** whether the extension declines these by default or leaves them for the BDE.

## 5. Autofill: drafted answers (`POST /api/autofill/answer`, `/answer/stream`)

The `autofill_prompt` setting keeps its placeholders. They are filled from the candidate:

| Placeholder | Was | Now |
|---|---|---|
| `{qa_bank}` | `persona.qa_bank` | **The résumé version's `autofill`** (migration 0019: `candidates.qa_bank` is gone): one version's `{question, answer, kind, key}` entries from `GET …/resumes/{id}?autofill=true` ([docs/02](../02-DATA-CONTRACTS.md) §8.1). `_qa_pair` already reads the `{question, answer, …}` shape |
| `{persona}` (the profile) | `persona.contact`, `work_auth`, `preferences`, `resume_content` as JSON | **From `candidates`:** the §4 facts, plus `primary_role`, `target_roles`, `years_experience`, `employment_types`, `preferred_locations`, `preferred_industries`, `deal_breakers`. **From the résumé:** `resume_text(version)` (`backend/candidates/resume_text.py`), see below |

**Which résumé version:**
1. The application's résumé (`applications.resume_id`), when the application exists.
2. Otherwise, the candidate's tailored résumé for the job (newest version, not deleted).
3. Otherwise, the active base's newest version.

**What the extension must add.** It has to say which candidate it is filling for (a `candidate_id` on `config` and
`answer`), and the routes check that candidate is in the user's scope (`_visible`, 07 Q47: a BDE's own candidates).
That belongs in Samad's extension proposal ([samad.md](./samad.md) §3).

**Saving an answer.** "Save this answer to the bank" was `POST /api/persona/qa-bank`. `candidates.qa_bank` is gone
(0019). A hand-saved answer becomes one of the résumé version's own entries (`resumes.autofill`, docs/02 §8.1), which
wins over the built answer and goes with the résumé to its next version. The route that writes them is planned; its
contract goes in docs/02 first.

## 6. Cover letters (Zuhair)

| Was | Now |
|---|---|
| `persona.preferences` in the prompt ("why this role / company"), read for **every** letter, even one written from a résumé | The candidate's `target_roles`, `preferred_industries`, `work_settings`, `preferred_locations`, `deal_breakers` |
| Source `resume_id = "persona"`: the letter written from `persona.resume_content` | Removed: a letter is written from a résumé version's columns (already the case for every other source) |
| `cover_letters.from_persona`, `source_name` "Persona" | Always `false` for new letters; the column goes with the table (§8) |

## 7. Job scoring and old tailoring (Zuhair)

- **Job scoring** (`cv_scorer.py`): the virtual "Persona" résumé (`_get_persona_text`, the reserved `"persona"` id in
  `companies.selected_resume_ids` and in explicit cv ids) is removed. Scoring reads the candidates' active base
  versions only, as it already does for real résumés.
- **Old tailoring** (`legacy_tailoring.py`, unwired): "persona as base" and `persona_tailor_prompt` are not ported.
  Tailoring (zuhair.md §3) starts from the candidate's active base version. The persona's "rich pool" idea becomes
  that version's own columns.

## 8. The drop, later (Abdul)

When §4 to §7 are built and nothing reads `personas`, one migration:
- drops the `personas` table and `cover_letters.from_persona`;
- deletes the `persona_tailor_prompt` setting.

The same PR removes `backend/api/routes_persona.py` and its three routes (`access.py`, `isolation_cases.py`), the
`Persona` model, the seed's singleton, and their tests. Until then, nothing new reads `personas`.
