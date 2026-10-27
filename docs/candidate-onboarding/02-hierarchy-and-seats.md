# 02 — Hierarchy and seats

**Owner:** — · **Depends on:** 01 (steps 5–6 also wait for 03's new actions) · **Branch:** `feat/onboarding-02-hierarchy-seats`

The team side of the hierarchy: who reports to whom, the BDE-only seat count, the new candidate-limit count and BDE
load. Runs on mocks; the backend's matching change is in 06 (land the two close together, see §7).

Read first: [README](./README.md) §2 (Q40, Q44–Q46), `src/lib/derive/tenancy.ts`, `src/lib/derive/platform.ts`,
`src/features/team/member-invites.tsx`, `src/app/[firm]/(app)/settings/team/page.tsx`, `src/mocks/membership.ts`,
`docs/07-ROUTES-AND-RBAC.md` Q17 and Q38 (the rules this replaces).

## 1. Derivations (`src/lib/derive/tenancy.ts`)

All numbers stay derived (CLAUDE.md "Every number is derived").

```ts
/** Q45: the statuses that count toward the candidate limit and a BDE's load. Change here only, with a decision entry. */
export const WORKING_STATUSES: readonly CandidateStatus[] = ["ON_BENCH", "INTERVIEWING", "OFFER"];
export const isWorkingCandidate = (c: Pick<Candidate, "status">) => WORKING_STATUSES.includes(c.status);

/** Q45: counts toward the limit = a BDE is assigned and the status is working. */
export const countsTowardLimit = (c: Pick<Candidate, "status" | "bdeId">) => c.bdeId !== null && isWorkingCandidate(c);
```

- Rename `ACTIVE_CANDIDATE_STATUSES` → `WORKING_STATUSES` and `isActiveCandidate` → `isWorkingCandidate`
  everywhere (`src/lib/derive/index.ts` re-exports).
- `FirmUsage`: `seatsUsed` = active users **with role BDE** + seat-reserving invites **with role BDE** (Q44).
  `activeCandidates` → rename to `assignedCandidates`, counted with `countsTowardLimit`. `canAddCandidate` →
  `canAssignCandidate` (assigned < limit). Keep the `isOver*` flags.
- `deriveFirmUsage` needs the users' roles: its `users` parameter becomes `Pick<User, "firmId" | "isActive" | "role">`;
  invites already carry `role`.
- New: `deriveBdeLoad(bdeId, candidates)` → `{ load, capacity, isAtCapacity }` with `load` = the BDE's candidates in a
  working status and `isAtCapacity = load >= firm.bdeCapacity` (Q46). Module 05 shows it.

## 2. Block messages (`src/lib/derive/platform.ts`)

Word for word; the backend (06) returns the same text.

- `seatBlockReason`: "Your plan allows {n} BDE seat(s); {used} {is/are} in use."
- `candidateBlockReason` → rename `assignBlockReason`: "Your plan allows {n} assigned candidate(s); {used} {is/are}
  assigned. Hand this candidate to a manager instead, or free a slot." (The OWNER can still hand to a manager, Q45.)
- New `noManagerReason`: "Invite a manager first. Every BDE reports to a manager." Used by the BDE invite and by
  "New candidate" when the firm has no active MANAGER.

## 3. Seat labels everywhere

Every "Seats" label becomes **"BDE seats"**; the numbers come from `deriveFirmUsage`, so firm and admin pages can't
disagree (`features/dashboard/seats-agree.test.ts` keeps proving it):

`features/dashboard/owner-dashboard.tsx` ("BDE seats used x / limit") · `features/admin/overview.tsx` ·
`features/admin/firms/firms-list.tsx` · `features/admin/firm/overview-tab.tsx` · `features/admin/firm/plan-tab.tsx` ·
`features/admin/plans-page.tsx` · `features/admin/firms/create-firm.tsx` (the plan picker's "seats").

## 4. Inviting a BDE requires a manager (`settings/team`, `features/team/member-invites.tsx`)

- Role = BDE shows a required **Manager** select (the firm's active MANAGERs). Other roles hide it.
- No active MANAGER: the BDE option stays visible but disabled with `noManagerReason` (docs/04 §0: visible, disabled,
  with the reason).
- The seat block applies to BDE invites only. Inviting MANAGER or VIEWER is never blocked by seats.
- The members list shows **"Reports to"** for each BDE; pending BDE invites show their manager too.
- Mock (`src/mocks/membership.ts`): `invite` validates `managerId` (an active MANAGER of the same firm) for BDE
  invites, rejects it for others, checks the seat only for BDE. Accepting a BDE invite copies `managerId` to the user.

## 5. Changing a BDE's manager (after 03 adds `member.changeManager`, OWNER only)

- On `settings/team`, each BDE row has **"Change manager"** (OWNER only, through `<Can action="member.changeManager">`).
  A small dialog: pick the new MANAGER, confirm "Vikram Desai's {n} candidates move with them."
- Mock: in one write, set the user's `managerId` and set `managerId` on **every candidate whose `bdeId` is that BDE**
  (Q43: candidates move with the BDE). One ledger entry: `UPDATE`, entityType `"user"`, summary
  "Vikram Desai now reports to Sneha Rao (was Priya Shah); 6 candidates moved". Queue candidates of the old manager stay.
- Adapter: `teamApi.changeManager(firmId, userId, managerId)` in `src/lib/api/team.ts`, a hook in
  `src/lib/hooks/use-team.ts` that invalidates team, candidates and ledger for that firm.

## 6. BDE capacity setting (after 03 adds `firmSettings.edit`, OWNER only)

- `settings/firm` gets one editable row, **"BDE capacity"** (number 1–50, default 10): "Candidates a BDE can work
  comfortably. A warning when assigning, never a block." Other rows stay read-only as today.
- Adapter: `updateFirmSettings(firmId, { bdeCapacity })` in `src/lib/api/session.ts` next to `firmBySlug` (mock now; the endpoint is 06); the hook invalidates the session so `useFirm()` reads the new value. Ledger: `UPDATE`,
  entityType `"firm"`, "BDE capacity 10 → 8".

## 7. Fixtures and the backend

- Re-tune the seat edge cases in `docs/03-MOCK-DATA.md`'s firm table under the BDE-only rule, so each still holds:
  one firm **at** its seat limit, one **over** (the `isOverLimit` fixture), one under. Same for the candidate limit
  (count assigned, working candidates only). Update the table.
- The backend counts seats in `backend/auth/invites.py` (`seats_used`); module 06 changes it to BDEs only. In live mode
  (`NEXT_PUBLIC_LIVE_MODULES=session`) the team page reads the backend, so merge 02 and 06's seat change in the same
  week, and note in the PR which is first.

## 8. Tests

- `derive/tenancy.test.ts`: seats count only BDEs (and BDE invites); a MANAGER or VIEWER changes nothing; a queue
  candidate (`bdeId: null`) and a `PAUSED` candidate don't count toward the limit; load and `isAtCapacity` at, under
  and over capacity.
- `seats-agree.test.ts`: still one fixture, both pages, same number.
- Mock membership: BDE invite without manager → 400; with a manager of another firm → 404; MANAGER invite at the BDE
  seat limit → allowed; BDE invite at the limit → blocked with the exact message.
- Change manager: the BDE's candidates follow; queue candidates don't; one ledger entry.

## Done when

- [ ] Derivations, messages and labels as §1–§3; no "Seats" label without "BDE"
- [ ] BDE invite needs a manager; "Reports to" shown; seat block only on BDE invites
- [ ] Change manager (OWNER) moves the candidates; capacity editable (OWNER)
- [ ] Fixture table re-tuned and true
- [ ] Both themes, keyboard only (the dialogs trap focus, `Esc` closes), 1440 / 1024 / 390 px, `axe` clean
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean

**Do not:** edit `src/lib/auth/policy.ts` or the registry (03), the wizard (04/05), or `backend/` (06).
