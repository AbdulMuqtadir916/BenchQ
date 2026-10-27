# Candidate onboarding and the firm hierarchy — master plan

**Status:** decided 2026-10-26 (docs/07 §0 Q40–Q50), not built. Product owner: Abdul. Replaces the brief that was
`docs/08-CANDIDATE-ONBOARDING.md`.

This folder is everything an engineer needs to build the feature. Read this file once, then only the module file you
picked up. Each module file stands on its own: scope, files, contract, steps, tests and a done checklist.

---

## 1. What we are building

Two things that only work together:

1. **A firm hierarchy.** OWNER → MANAGER → BDE → candidate. Every BDE reports to one MANAGER; every candidate belongs
   to one MANAGER and, once assigned, to exactly one BDE. A MANAGER sees only their own team's work.
2. **A five-step "New candidate" flow** at `/[firm]/candidates/new`, replacing today's single form: resume → basic
   details → work and rate → preferences → assign, then a done screen. The resume is read by the backend's parser
   (Zuhair's format, §6) and fills the form; nothing is saved until the person presses **Create candidate**.

Why it matters (`product.md` §2): the OWNER and MANAGER must see who works which candidate at any moment
(transparency), and onboarding a candidate must take minutes, not a long form (time compression).

## 2. The decisions (docs/07 §0 Q40–Q51, 2026-10-26 and 27)

| # | Rule |
|---|---|
| Q40 | **Layers are fixed:** OWNER → MANAGER → BDE. Every BDE reports to exactly one MANAGER, chosen when the BDE is invited (required) and changeable by the OWNER in `settings/team`. A firm needs at least one MANAGER before it can invite BDEs or add candidates. |
| Q41 | **Who adds:** only OWNER and MANAGER (a BDE no longer can). **Assignment at creation:** the OWNER picks a MANAGER (required) and optionally one of that MANAGER's BDEs; a MANAGER picks one of their own BDEs (required) and is the candidate's manager automatically. No candidate is ever without a manager. |
| Q42 | **One BDE per candidate.** A candidate with a manager but no BDE is in that manager's **"Needs a BDE"** queue. |
| Q43 | **Reassigning:** the OWNER moves a candidate to any MANAGER and optionally a BDE of theirs (moving to another manager without a BDE clears the BDE and puts it in that queue); a MANAGER moves a candidate only between their own BDEs; a BDE never reassigns. One `ASSIGN` ledger entry per move ("from → to"), with an optional note. Applications, resumes and history stay with the candidate. When a BDE's manager changes, their candidates move with them. |
| Q44 | **Seats are BDEs.** `seatsUsed` = active BDEs + pending, unexpired BDE invites. OWNER, MANAGER and VIEWER are free and unlimited. A plan's `seatLimit` now means BDE seats; only BDE invites are blocked at the limit. Replaces the seat half of Q17. |
| Q45 | **The candidate limit counts assigned, working candidates:** a BDE is assigned **and** the status is in the **working statuses** list (`ON_BENCH`, `INTERVIEWING`, `OFFER`; `PAUSED` does not count). One list, one place, used for the limit and the BDE load. Creating a candidate is never blocked; **assigning a BDE** is blocked at the limit, with the reason. Replaces the candidate half of Q17. |
| Q46 | **BDE capacity is a warning, not a block:** one firm-wide number (`bdeCapacity`, default 10) the OWNER edits in `settings/firm`. Each BDE row shows its load, e.g. "8 / 10", amber at or over capacity. |
| Q47 | **A MANAGER's scope is their team on every firm page** (dashboard, candidates, applications, resumes, outreach, follow-ups, analytics, ledger, `settings/team`): their BDEs' work plus their queue. OWNER and VIEWER see the whole firm; a BDE sees their own (unchanged). |
| Q48 | **The flow:** replaces `/[firm]/candidates/new` at the same URL, full page; the intercepted modal and the old form are deleted. No drafts: closing with anything entered asks "Discard this candidate?". Required: full name, "Marketed as", email, and the assignment. The screens say **"Assigned BDE"** / **"BDE"**, never "Owner". |
| Q49 | **Resume parsing and Truth Guard:** the backend parses the file and returns a draft without saving anything ("Nothing is saved until you create the candidate"). Onboarding never produces a `VERIFIED` claim: profile fields are plain facts; skills, summary, experience and education land in the candidate's Record as `UNVERIFIED` with their `FieldSource`; fields filled from the resume show a "Drafted from resume" marker until edited or confirmed. docs/04 §4.2's "typed fields are VERIFIED" is withdrawn. |
| Q50 | **No notifications.** The "Notify the BDE" toggle is dropped. The handoff note is saved with the assignment and shown on the candidate page; the BDE sees **"New assignments"** on their dashboard (derived from `ASSIGN` entries of the last 7 days). The new candidate fields are **provisional**: the frontend uses them on mocks; **Zuhair** owns the production contract and the backend Candidates track. Deactivating a MANAGER or BDE is out of scope (rule for later in §8). |
| Q51 | **BDEs from before the hierarchy** keep no manager ("No manager") until the OWNER sets one in `settings/team`; they can't be given candidates until then. The database enforces only "a non-BDE has no manager" until every BDE has one (06 §2). |

## 3. Vocabulary (also in `product.md` §4)

| Term | Meaning |
|---|---|
| **Manager** (of a BDE) | The one MANAGER a BDE reports to. |
| **Manager** (of a candidate) | The MANAGER responsible for the candidate. Always set. |
| **BDE** (of a candidate), "Assigned BDE" | The one BDE who markets the candidate. Never called "owner". |
| **Needs a BDE** | A candidate with a manager but no BDE yet. Doesn't count toward the candidate limit. |
| **Working statuses** | The candidate statuses that count toward the limit and a BDE's load. Today `ON_BENCH`, `INTERVIEWING`, `OFFER`. |
| **Load** | A BDE's candidates in a working status. |
| **BDE capacity** | The firm's comfortable load per BDE (default 10). A warning, never a block. |
| **Seat** | One BDE, or one pending BDE invite. |
| **Handoff note** | The note written when a candidate is assigned to a BDE. |

## 4. The screens

The designs are in [`screens/`](./screens). The summary card on the right of steps 1–5 shows the candidate as they are
filled in; its "Owner" row becomes **"Assigned BDE"** (Q48).

| # | Screen | What happens | Module |
|---|---|---|---|
| 1 | [Resume](./screens/1-resume.webp) | Drop a PDF or Word file (≤ 10 MB) or "Skip, enter manually". The parser fills steps 2–4. Sample resumes show only on mocks (§7 A1). | 04 |
| 2 | [Basic details](./screens/2-basic-details.webp) | Identity (full name\*, "Marketed as"\*, years), contact (email\*, phone, LinkedIn, city, state), profile (skills, summary). | 04 |
| 3 | [Work and rate](./screens/3-work-and-rate.webp) | Work authorization (one of nine), valid until, engagement types (C2C / W2 / 1099 / Full-time), target rate, walk-away floor, available from, notice period. | 04 |
| 4 | [Preferences](./screens/4-preferences.webp) | Target roles, work setting, preferred locations, willing to relocate, industries, deal breakers, notes for the BDE. "Skip for now" allowed. | 04 |
| 5 | [Assign](./screens/5-assign.webp) | MANAGER: pick one of their BDEs. OWNER: pick a manager, then optionally a BDE. Load per BDE, capacity warning, handoff note. **Create candidate.** The "Notify the BDE" toggle is removed (Q50). | 05 |
| 6 | [Done](./screens/6-done.webp) | "{name} is on the bench." Open profile · Find jobs · Add another. Copy in module 05. | 05 |

## 5. Modules

| # | Module | Owner | Depends on | Can run alongside |
|---|---|---|---|---|
| 01 | [Contracts, schemas and mock data](./01-contracts.md) | — | — | 06 can start from its docs PR |
| 02 | [Hierarchy and seats](./02-hierarchy-and-seats.md) | — | 01 (its steps 5–6 wait for 03) | 03, 04, 06 |
| 03 | [Scope and permissions](./03-scope-and-permissions.md) | — | 01 | 02, 04, 06 |
| 04 | [Wizard, steps 1–4](./04-wizard-steps.md) | — | 01 | 02, 03, 06 |
| 05 | [Assign, done screen and reassigning](./05-assign-and-reassign.md) | — | 02, 03, 04 | 06 |
| 06 | [Backend: candidates, hierarchy, parser](./06-backend.md) | Zuhair | 01 (docs part); PRs 2 and 4 wait for 03 | 02–05 |
| 07 | [Go live: adapters and mappers](./07-go-live.md) | — | 05, 06 | — |

```
01 ──┬── 02 ──┐
     ├── 03 ──┼── 05 ──┐
     ├── 04 ──┘        ├── 07
     └── 06 ───────────┘
```

Frontend modules 01–05 run on mocks and can start now. 06 is the backend Candidates track (decision D1 option 1, the
`candidates` table); its foundation (F1–F7) is done. 07 switches the frontend to it.

**File ownership** (two modules never edit the same file at once): 02 owns `src/lib/derive/tenancy.ts`,
`src/lib/derive/platform.ts`, the team/invite UI and `src/mocks/{team,membership,tenancy,usage}.ts`; 03 owns
`src/lib/auth/policy.ts`, `src/lib/routes/{registry,scope}.ts` and every page's scope call; 04 owns
`src/components/app/candidate-wizard/` steps 1–4 and the parse adapter; 05 owns the assign step, the done screen, the
reassign dialog and the BDE dashboard's "New assignments" card. Where a module must touch another's file, its plan says
so and it waits for that module to merge.

## 6. Zuhair's parser format

The backend's parser returns the shape below (snake_case; the full table is in [06-backend.md](./06-backend.md#parser-response)).
The frontend maps it in `src/lib/api/dto/resume-parse.ts` (module 04 on mocks, 07 live) — nothing snake_case leaves
`src/lib/api/dto/`. The mapping, field by field, with its gaps, is in [04-wizard-steps.md §5](./04-wizard-steps.md#5-parser-to-form-mapping).

`header{name,title,location,email,phone,work_authorization,github,linkedin}` · `professional_summary` ·
`technical_skills[]{category,skills}` · `work_experience[]{job_title,company,location,dates,start,end,current,bullets[]}` ·
`projects[]{name,url,dates,technologies,bullets[]}` · `education[]{degree,institution,graduation_date,grade}` ·
`certifications[]`.

The **tailor** format in the same document belongs to Track 04 (resumes and tailoring), not here. One thing from it
matters for Truth Guard later: each tailored bullet's `from_bullets` names the parsed bullets it was written from, so a
tailored claim can point back to the original résumé text as evidence.

## 7. Assumptions taken (change them here if wrong)

| # | Assumption |
|---|---|
| A1 | The "Try a sample" résumés on step 1 appear only when the module runs on mocks (demo). |
| A2 | A new candidate starts `ON_BENCH`, `benchStartDate` = creation time. |
| A3 | `needsSponsorship` and `needsTransfer` are derived from the work authorization card (H-1B → transfer; H-1B, H4 EAD, OPT, CPT, TN → sponsorship). The screen has no separate checkboxes. Provisional (Q50). |
| A4 | "Works N similar profiles" on step 5 = the BDE's candidates in a working status whose "Marketed as" matches, ignoring case. |
| A5 | "New assignments" on the BDE dashboard = candidates whose latest `ASSIGN` entry names this BDE and is under 7 days old. |
| A6 | The done screen's "Find jobs" opens `/[firm]/jobs` filtered to the new candidate (an existing URL filter). |

## 8. Later, not in this plan

- **Deactivating users** (Phase M "later"). Rule for whoever builds it: a deactivated BDE's candidates go back to their
  manager's "Needs a BDE" queue; a MANAGER can't be deactivated while BDEs still report to them.
- **Notifications** of any kind, and the firm's shift window (docs/02 §3.3, draft).
- **Changing a user's role** (e.g. BDE → MANAGER).
- The production candidate contract (Zuhair, Q50).

## 9. How to pick up a module

1. Read `CLAUDE.md`, this file, then your module file end to end. Check **Depends on** has merged.
2. Branch from `main`: `git checkout -b feat/onboarding-<NN>-<slug>`.
3. Follow the module's steps. Keep to its files; if you need another module's file, stop and ask.
4. Before the PR: `pnpm typecheck && pnpm lint && pnpm test`; both themes; 1440 / 1024 / 390 px; keyboard only; `axe`.
5. Fill your module's done checklist in the PR description, then update the table in §5 (owner, status).

**Briefing a Claude session:**

> Read `CLAUDE.md`, then `docs/candidate-onboarding/README.md`, then `docs/candidate-onboarding/<NN>-….md`. Build only
> that module. If the module file and the code disagree, or something needs a product decision, stop and ask.

## 10. Exit check (the whole feature)

Sign in as each seeded account and walk it:

- [ ] OWNER adds a candidate with a manager only → it sits in that manager's "Needs a BDE" queue, doesn't count toward the limit.
- [ ] That MANAGER assigns one of their BDEs → the BDE sees it under "New assignments"; the limit count goes up by one.
- [ ] OWNER adds a candidate with a manager and BDE in one go.
- [ ] MANAGER adds a candidate → only their BDEs are offered.
- [ ] BDE: no "New candidate" anywhere (button, ⌘K, `n`); `/candidates/new` shows Forbidden.
- [ ] MANAGER A can't see MANAGER B's candidates, applications, ledger entries or BDEs on any page (not-found for a direct URL).
- [ ] OWNER moves a candidate from manager A's BDE to manager B without a BDE → B's queue; one ledger entry.
- [ ] At the candidate limit, assigning a BDE is disabled with the reason; adding to a queue still works.
- [ ] At the BDE seat limit, inviting a BDE is blocked; inviting a MANAGER or VIEWER isn't.
- [ ] Nothing on the candidate is `VERIFIED` after onboarding.
- [ ] Support view: read-only on every page above, no "New candidate", no "Reassign".
