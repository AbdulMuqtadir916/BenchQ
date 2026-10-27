# 06 — Backend: candidates, hierarchy, parser

**Owner:** Zuhair · **Depends on:** 01's docs (the contracts in docs/02); foundation F1–F7 (done) ·
**Branch:** one per PR below, e.g. `feat/candidates-1-tables`

This is the backend **Candidates track** (`docs/integration/README.md` board; decision D1 option 1: a `candidates`
table) plus the hierarchy and seat rules this feature needs. Zuhair owns the production candidate contract (Q50): the
provisional fields from module 01 are a starting point, not a requirement. Change them by updating docs/02 and telling
the frontend owner of module 07.

Read first: [README](./README.md) §2 and §6, `docs/integration/README.md` (the workflow and conventions),
`docs/integration/07-auth-and-tenancy.md` (Q38 table conventions), `backend/models/tenancy.py`, `backend/auth/`
(`policy.py`, `scoping.py`, `invites.py`, `ledger.py`), `backend/ai/config.py`, `backend/tests/test_isolation.py`.

## 1. PRs, in order

| PR | What | Section |
|---|---|---|
| 1 | Tables and migration `0006`: `users.manager_id`, `firms.bde_capacity`, `ledger_entries.note` + `ASSIGN`, `candidates` | §2 |
| 2 | BDE invites need a manager; change a BDE's manager; firm settings. (*Seats count BDEs only* is already built, in frontend module 01) | §3 |
| 3 | Résumé parse endpoint (your parser), no save | §4 |
| 4 | Candidates: create, list, read, update, assign — with team scope | §5 |
| 5 | Demo seed and isolation tests | §7 |

Frontend module 02's team screens (invite with a manager, change manager, capacity) call PR 2's endpoints, since the
team, invites and ledger have no mock since F6. PRs 2 and 4 use
the new policy actions, so they wait for frontend module 03's PR (it changes `backend/auth/policy.py` and the shared
table).

## 2. Tables (Q38 conventions: plural snake_case, UUID keys, timestamps with time zone, CHECKs not enums, `ON DELETE RESTRICT`)

- `users.manager_id UUID NULL REFERENCES users(id)`, with `CHECK (role = 'BDE' OR manager_id IS NULL)` only (Q51).
  "A BDE has a manager" is enforced in code: accepting a BDE invite, changing a manager, and never clearing it. Existing
  BDEs stay `NULL` until the OWNER sets one. **Not `NOT VALID` on the full rule:** Postgres checks a `NOT VALID`
  constraint on every update of a row, so a manager-less BDE's sign-in (`last_active_at`) would fail. A later migration
  adds `CHECK ((role = 'BDE') = (manager_id IS NOT NULL))` once no BDE is `NULL`. The manager being an active MANAGER of
  the same firm is checked in code (a CHECK can't read another row).
- `invites.manager_id UUID NULL REFERENCES users(id)`, same CHECK on the invite's role.
- `firms.bde_capacity INTEGER NOT NULL DEFAULT 10 CHECK (bde_capacity BETWEEN 1 AND 50)`.
- `ledger_entries.note TEXT NULL`; add `ASSIGN` to the action CHECK.
- `candidates`: `id`, `firm_id` (indexed), `manager_id` (NOT NULL), `bde_id` (NULL), the profile fields of
  `CandidateSchema` (docs/02 §4) as columns, persona fields, `status` (CHECK on `CandidateStatus`), `created_at`,
  `updated_at`. Index `(firm_id, manager_id)` and `(firm_id, bde_id)`.
- Where the Record (skills, summary, experience, education, certificates) and documents live is **Track 04 / D4**
  (`evidence` + `claims`). If those tables don't exist yet, store the parse result as JSON on a `candidate_resumes`
  row (`candidate_id`, `file_name`, storage key, `parse` JSONB) and let Track 04 build the Record from it. Decide this
  in PR 1 and write it into docs/integration (§8).
- **Backfill** (Q51): nothing to backfill. Existing BDEs keep `manager_id NULL`; the OWNER sets each one's manager
  through `PATCH …/members/{user_id}/manager` (§3). Such a BDE can't be given candidates until then.

## 3. Hierarchy, seats, settings (PR 2)

- ~~`seats_used` counts BDEs only~~ **Done in frontend module 01 (2026-10-27):** `backend/auth/invites.py` counts active
  BDEs + pending, unexpired BDE invites; `check_seat(db, firm, role, now)` only blocks BDE invites; the message is "Your
  plan allows {n} BDE seat(s); {used} {is/are} in use."; tests in `test_member_invites.py` and `test_admin_firms.py`.
- `POST /api/firms/{firm_id}/team/invites`: `manager_id` required when `role` is `BDE` (400 otherwise), refused for other
  roles; it must be an active MANAGER of this firm (404 if not). No active MANAGER → 409 "Invite a manager first. Every
  BDE reports to a manager." Accepting copies `manager_id` onto the user.
- `PATCH /api/firms/{firm_id}/team/members/{user_id}/manager` `{ manager_id }` — `require("member.changeManager")`
  (OWNER). One transaction: the user's `manager_id`, and `manager_id` on every candidate whose `bde_id` is that user
  (Q43). Ledger `UPDATE` on the user: "{name} now reports to {new} (was {old}); {n} candidates moved".
- `PATCH /api/firms/{firm_id}/settings` `{ bde_capacity }` — `require("firmSettings.edit")` (OWNER). Ledger `UPDATE` on
  the firm: "BDE capacity 10 → 8".
- The member and session serializers add `manager_id`; the firm serializer adds `bde_capacity`.
- `backend/auth/policy.py` gets its new actions from frontend module 03's PR (the shared table); don't edit it here.

## 4. Résumé parse (PR 3)

`POST /api/firms/{firm_id}/candidates/parse-resume`, multipart `file` — `require("candidate.create")`.

- PDF, DOC, DOCX up to 10 MB (415 / 413 with the frontend's wording: "PDF or Word only", "Up to 10 MB").
- Runs your parser through `ai_config(...)` (AI purpose `RESUME_PARSE`, docs/02 §3.2), and logs usage the way the AI
  presets doc says.
- **Saves nothing to the candidate tables** (Q49). Keep the file and its parse in temporary storage for 60 minutes under
  a random `parse_id`, tied to the firm and the user; expired or another firm's id → 404.
- Response: `{ "parse_id": "...", "file_name": "...", "parse": <the parser response> }`.

### Parser response

As shared by Zuhair (`Copy of Response Formats For Parser And Tailoring Resume`). The frontend maps it in
`src/lib/api/dto/resume-parse.ts` ([04 §5](./04-wizard-steps.md#5-parser-to-form-mapping)).

| Field | Type |
|---|---|
| `header` `{ name, title, location, email, phone, work_authorization, github, linkedin }` | strings |
| `professional_summary` | string |
| `technical_skills[]` `{ category, skills }` | `skills` is one comma-separated string |
| `work_experience[]` `{ job_title, company, location, dates, start, end, current, bullets[] }` | `start`/`end` "YYYY-MM" or "YYYY"; empty when not printed or ongoing |
| `projects[]` `{ name, url, dates, technologies, bullets[] }` | |
| `education[]` `{ degree, institution, graduation_date, grade }` | `graduation_date` as printed |
| `certifications[]` | strings |

## 5. Candidates (PR 4)

| Endpoint | Rule |
|---|---|
| `GET /api/firms/{firm_id}/candidates` | scoped (below) |
| `GET /api/firms/{firm_id}/candidates/{id}` | scoped; outside the scope → 404 |
| `POST /api/firms/{firm_id}/candidates` | `require("candidate.create")` + `can_assign_to` (below) + the limit; body = docs/02 `CreateCandidate` in snake_case |
| `PATCH /api/firms/{firm_id}/candidates/{id}` | `require("candidate.edit")`, scoped; body = `UpdateCandidate` |
| `POST /api/firms/{firm_id}/candidates/{id}/assign` | `require("candidate.assign")` + `can_assign_to`; body = `ReassignCandidate` |

- **Scope** (Q47), in `backend/auth/scoping.py` next to `own_scope()`: a new `team_scope(principal)` → the MANAGER's id
  or None. Candidates: OWNER, VIEWER, support view → the whole firm; MANAGER → `manager_id = me`; BDE → `bde_id = me`.
  Applications, resumes and other tables get the team scope when their tracks add `candidate_id` (D1); write that
  into those module files.
- **`can_assign_to`**: a Python mirror of `canAssignTo` in `src/lib/auth/policy.ts` (module 03 §1), with tests built
  from the same cases.
- **Create** is one transaction:
  1. Lock the firm row, as seat checks do.
  2. Refuse with 409 and `assignBlockReason`'s wording when a BDE is set and assigned + working ≥ `candidate_limit`
     (Q45; working statuses `ON_BENCH`, `INTERVIEWING`, `OFFER` — one constant, with a comment pointing at the
     frontend's `WORKING_STATUSES`).
  3. Insert the candidate (`ON_BENCH`).
  4. Consume the `parse_id`: keep the file and parse with the candidate (§2), and mark skills and summary `UNVERIFIED`
     with their source. **Never `VERIFIED`** (Q49).
  5. Write ledger `CREATE` and `ASSIGN` (with `note`).
- **Assign** writes one `ASSIGN` entry "Assigned to {new} (from {old})" with the note; moving between BDEs doesn't
  re-check the limit; a queue candidate getting a BDE does.

## 6. Parser gaps to settle (Zuhair)

Found while mapping the format to the form (04 §5). None blocks onboarding; each affects what the Record can hold.

| # | Gap | Suggestion |
|---|---|---|
| G1 | `header.github` has no field on the candidate | add `githubUrl` with the production contract, or drop it |
| G2 | `projects[]` has nowhere to go: the Record has experiences, education, skills, certificates, no projects | add projects to the Record (Track 04), since tailoring keeps projects |
| G3 | `education[].grade` has no field | add it, or drop it |
| G4 | `work_experience[].start` empty when only one date is printed; `RecordExperience.startDate` is required | make `startDate` nullable, or treat the one date as the start |
| G5 | `header.work_authorization` is free text | return one of the nine statuses (or null) plus the printed text, so matching isn't redone in the frontend |
| G6 | Total years of experience are inside `professional_summary` text | return `years_experience` as a number |
| G7 | `technical_skills[].skills` is one comma-separated string | return an array |
| G8 | `header.location` is one string | return `city` and `state` |

## 7. Seed and tests (PR 5)

- Demo seed (`backend/seed.py`, F5): the mocks' managers, `manager_id` on BDEs and invites, `bde_capacity`, candidates
  with `manager_id` / `bde_id` and two queue candidates per firm (match `src/mocks/data/` after module 01).
- `backend/tests/test_isolation.py`: every new route across firms (404). New `test_team_scope.py`: MANAGER A can't read
  or assign B's candidates (404), BDE can't create (403), assign within the team works.
- Seats: MANAGER and VIEWER invites never blocked; BDE blocked at the limit with the exact message.
- Parse: no candidate row after a parse; an expired `parse_id` → 404; another firm's → 404.
- Create: nothing `VERIFIED` after create; ledger entries; the limit lock under two concurrent creates.

## 8. Before PR 1

- ~~Q1: backfilling BDEs without a manager~~ **Decided (Q51, 2026-10-27):** no backfill; the half CHECK in §2; the
  OWNER sets managers in `settings/team`; the full CHECK in a later migration.
- Where the parse and the Record live (§2), written into `docs/integration/04-resumes-and-tailoring.md`.

## Done when

- [ ] PRs 1–5 merged; `pytest` green; the isolation test covers every new route
- [ ] Seat message and block reasons word for word the frontend's
- [ ] `docs/integration/README.md` board updated (Candidates: in progress / done)
- [ ] The candidate response documented (snake_case) for module 07, with one real response saved as a sample
