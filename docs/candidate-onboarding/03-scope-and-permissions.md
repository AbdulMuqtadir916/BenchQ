# 03 — Scope and permissions

**Owner:** — · **Depends on:** 01 · **Branch:** `feat/onboarding-03-scope-permissions`

> **Built 2026-10-27.** As specified, with three notes:
> - **The team is worked out as** the MANAGER, the BDEs whose `managerId` is theirs, **and the BDE of any candidate
>   they manage** (`teamMemberIds`). The live team list has no `managerId` until 06 PR 1, so without that last part a
>   MANAGER's follow-ups, ledger and team page would be empty in live mode.
> - **Résumés** are scoped through their candidate (`scopeByCandidate`), which also narrows a BDE's library to their
>   own candidates (it showed the whole firm's before).
> - **Not narrowed yet:** a MANAGER's *invites* list on `settings/team`, because invites carry no manager until the
>   backend sends `manager_id`. The candidates mock refuses creates with `canAssignTo`, after resolving a named BDE's
>   manager from its own data.

Who may add and assign candidates, and what a MANAGER sees: their team on every firm page (Q47). This module is the
only one that edits the permission policy and the route registry. Client checks are UX; the backend enforces the same
rules in 06 (CLAUDE.md: "Client-side guards are UX, not security").

Read first: [README](./README.md) §2 (Q41, Q43, Q47), `src/lib/auth/policy.ts`, `src/lib/auth/policy-shared.test.ts`,
`src/lib/routes/registry.ts`, `src/lib/routes/scope.ts`, `docs/07-ROUTES-AND-RBAC.md` §2.2 and Phase C.

## 1. Policy table (`src/lib/auth/policy.ts`)

| Action | Before | After |
|---|---|---|
| `candidate.create` | OWNER, MANAGER, BDE | **OWNER, MANAGER** (Q41) |
| `candidate.assign` | OWNER, MANAGER | unchanged; now also covers reassigning (Q43) |
| `member.changeManager` | — | **new**, OWNER (02 §5) |
| `firmSettings.edit` | — | **new**, OWNER (02 §6) |

Then mirror it on the backend in the same PR (that is how the table works): run
`UPDATE_POLICY_TABLE=1 pnpm test src/lib/auth/policy-shared.test.ts`, change `backend/auth/policy.py` to match, and
run `backend/tests/test_policy.py`. Tell Zuhair (06) the PR is up; it touches `backend/auth/`.

### Who may be assigned (pure helper, same file)

```ts
/** Q41/Q43: may this principal give `candidate` this manager and BDE? `team` = the firm's users. */
export function canAssignTo(
  principal: Principal,
  candidate: { managerId: string } | null,          // null = a new candidate
  target: { managerId: string; bdeId: string | null },
  team: readonly Pick<User, "id" | "role" | "managerId" | "isActive">[],
): boolean
```

- Everyone: `target.managerId` is an active MANAGER; `target.bdeId`, if set, is an active BDE whose `managerId` is
  `target.managerId`.
- OWNER: any such target.
- MANAGER: `target.managerId` is themself, and (when reassigning) `candidate.managerId` is themself. So a MANAGER can
  never move a candidate to another team, and must pick a BDE (`bdeId` not null) when creating (Q41).
- BDE, VIEWER, support view: never.

The mock backend calls the same helper before every create and reassign (as it does `can()` today,
`src/mocks/write-authorization.test.ts`).

## 2. Scope (`policy.ts` and `src/lib/routes/scope.ts`)

Replace the BDE-only `isOwnScope` with one function every page uses:

```ts
export type Scope = { kind: "firm" } | { kind: "team"; managerId: string } | { kind: "own"; userId: string };
export function scopeOf(principal: Principal): Scope   // OWNER, VIEWER, support view → firm; MANAGER → team; BDE → own
```

| Helper | `team` (MANAGER) | `own` (BDE, unchanged) |
|---|---|---|
| `scopeCandidates` | `candidate.managerId === managerId` (their BDEs' candidates and their queue) | `bdeId === userId` |
| `scopeApplications` | the application's candidate is in their candidates (history follows the candidate, Q43) | `submittedByUserId === userId` |
| `scopeLedger` | actor is them or one of their BDEs, **or** the entry is about one of their candidates | actor is them |
| `scopeFollowupsUserId` → `scopeFollowups` | assigned to them or one of their BDEs | assigned to them |
| new `scopeTeam` (users) | themself and the BDEs reporting to them | — |

Helpers that need the team or the candidate list take it as a parameter; they stay pure. `hasOwnScope` stays for the
"Your assigned bench" wording; add `hasTeamScope` for "Your team's bench".

Apply them on every firm page (Q47). From `grep -rlE 'scopeCandidates|scopeApplications|scopeLedger|scopeFollowupsUserId|hasOwnScope' src`:
dashboard (`features/dashboard/manager-dashboard.tsx` gets the team scope), candidates list and detail, applications,
jobs (its candidate picker), resumes and the studio pickers (`resume-studio/new-resume.tsx`, `open-resume.tsx`),
outreach, follow-ups, focus, analytics (`derive/bde-performance.ts`: only their BDEs), ledger, `settings/team`
(MANAGER sees their BDEs only, read-only, plus the assign controls 05 adds).

## 3. Registry (`src/lib/routes/registry.ts`)

- `Access` gains `"team"`: openable, records limited to the MANAGER's team; a record outside it renders **not-found**
  (never Forbidden: don't confirm it exists, CLAUDE.md).
- MANAGER column becomes `"team"` for: `candidates`, `candidates.detail`, `applications`, `applications.detail`,
  `resumes`, `resumes.studio`, `outreach`, `followups`, `ledger`, `analytics`. Dashboard stays `full` (its data is
  scoped by §2).
- `candidates.new`: BDE `full` → **`none`** (Forbidden screen in place).
- `isInScope("team", …)`: `ScopedRecord` gains `managerId?: string | null`; true when it equals the user's id.
- "New candidate" everywhere it appears (candidates page button, ⌘K, the `n` shortcut, the empty state's "Add your
  first candidate") renders through `can(principal, "candidate.create")`, so a BDE and VIEWER don't see it.
- Update the registry table test for every changed cell.

## 4. Docs

- `docs/07-ROUTES-AND-RBAC.md` §2.2: the table (MANAGER `team`, BDE `—` on `candidates/new`), the legend (`team`), the
  data-scope paragraph, and the Phase C principal × action table. The decisions themselves are already Q40–Q50 in §0.
- `product.md` §5: the MANAGER paragraph says "their team".

## 5. Tests

- `policy-table.test.ts`: the full principal × action table with the four changed rows.
- `canAssignTo`: OWNER to any manager / manager+BDE; OWNER with a BDE from another manager → false; MANAGER within
  their team → true; MANAGER creating without a BDE → false; MANAGER moving a candidate of another team → false;
  inactive targets → false; BDE / VIEWER / support → false.
- Scope helpers with the two-team fixture from 01: MANAGER A never sees B's candidates, applications, ledger entries,
  follow-ups or BDEs; a candidate moved from A to B takes its applications with it.
- Registry: a MANAGER opening B's candidate, application or resume by URL → not-found; a BDE opening
  `/candidates/new` → Forbidden; support view unchanged.
- Mock write authorization: a BDE `create` → refused; MANAGER reassign across teams → refused.

## Done when

- [ ] Policy table and `canAssignTo` as §1; backend policy mirrored and its test green
- [ ] `scopeOf` used by every firm page; no `role ===` added (CLAUDE.md: no inline role checks)
- [ ] Registry as §3; table test covers it
- [ ] Signed in as OWNER, both MANAGERs, a BDE, VIEWER, the second firm and a support view: each sees exactly §2
- [ ] Both themes, keyboard, 1440 / 1024 / 390 px, `axe` clean (the subtitles and empty states changed)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean; docs/07 updated

**Do not:** change seat or limit numbers (02), build the assign UI (05), or scope the backend's endpoints (06).
