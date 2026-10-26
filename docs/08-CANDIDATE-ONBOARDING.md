# 08 — Candidate onboarding and the firm hierarchy

**Status:** brief, not approved. Written 2026-10-26 from Abdul's description. Designs are with Abdul and arrive when the work starts.
Nothing here is built. Every change to a contract, role or seat rule below needs Abdul's sign-off before code (`CLAUDE.md`, "When you're unsure").

## Goal

A new flow for adding a candidate to a firm. Who adds the candidate decides who must assign them next, down a fixed
chain of command. Screens come from Abdul's designs; this doc fixes the rules the screens enforce.

## The hierarchy

```
OWNER (one per firm)
 └─ MANAGER (many)
     └─ BDE (many per manager)
         └─ Candidate (many per BDE)
```

- Seats are counted per BDE.
- Each person reports to exactly one person above them.

## Who adds, who assigns

| Added by | Must assign | Then |
|---|---|---|
| OWNER | a MANAGER | that MANAGER assigns a BDE |
| MANAGER | a BDE (own team) | done |

Until the last assignment is made the candidate is **unassigned** and visible to the people responsible for the next step.
(Interpretation of "owner assigns Manager, Manager then assigns a BDE": confirm in Q1.)

## What exists today (do not redo)

- Routes `/[firm]/candidates`, `/candidates/new` (single form plus resume-parse simulation), `/candidates/[id]`: `docs/04` §4, registry entries `candidates*`.
- `Candidate.assignedUserIds: string[]` (`src/lib/schemas/candidate.ts`): a flat list of assignees, no manager level.
- Roles `OWNER | MANAGER | BDE | VIEWER`; all permissions go through `src/lib/auth/policy.ts` and `backend/auth/policy.py`.
- Seats today (07 Q17): every active firm user, any role, plus pending invites. `seatsUsed` is derived by `deriveFirmUsage`.
- The backend has no candidates yet (Candidates track in `docs/integration/README.md`).

## Decisions needed before code

| # | Question | Why it matters |
|---|---|---|
| Q1 | Confirm the chain: OWNER adds → picks a MANAGER → that MANAGER picks a BDE. Can the OWNER also pick a BDE directly, skipping the MANAGER? | Defines the assignment states |
| Q2 | Seats counted per BDE contradicts Q17 (every active user holds a seat). Which wins? If BDE-only: do OWNER, MANAGER and VIEWER become free? | Changes `deriveFirmUsage`, plans, invite blocking at the limit, the admin seat numbers |
| Q3 | New field: which BDE reports to which MANAGER (e.g. `managerId` on the firm user). Stored on the user or a separate team table? | New field on a contract (`docs/02`), needs the backend schema |
| Q4 | Does a candidate have one BDE or several? Today `assignedUserIds` is a list. | Decides whether the list stays or becomes `bdeId` |
| Q5 | Scope: does a MANAGER see only their own BDEs' candidates, or the whole firm (as today)? Does a BDE still see only their own? | Changes the access matrix in `docs/07` and the policy |
| Q6 | Can a BDE add a candidate? Today `candidates.new` allows BDE. VIEWER is read-only. | Registry access for the new flow |
| Q7 | Reassignment: who can move a candidate to another BDE or MANAGER, and is it a ledger event? | Audit trail (Truth Guard principle) |
| Q8 | Is the new flow a replacement for `/candidates/new` or an addition (e.g. a wizard at `/candidates/onboard`)? | Registry, links, docs/04 |
| Q9 | Does a candidate count toward the plan's candidate limit while unassigned? | `activeCandidates` derivation |

## Out of scope

- Candidate self-service or any new kind of user (the candidate does not sign in).
- Billing, payments, per-firm model config.
- Backend candidates and evidence (that is the Candidates track). Screens run on mocks first; the DTO mapper comes with the track.

## How to work it

1. Settle the questions above with Abdul and record each answer in `docs/07` §0 (next free Q number).
2. Update the contracts in `docs/02` and the access matrix in `docs/07`, then the Zod schemas, then the policy.
3. Build the screens from the designs against mocks: skeleton, empty, error, both themes, keyboard path.
4. Exit check: sign in as each seeded role (OWNER, MANAGER, BDE, VIEWER) and walk both rows of the table above.

## Start here (new session)

Open Claude Code in the repo, then send the prompt:

> Read `CLAUDE.md`, then `docs/08-CANDIDATE-ONBOARDING.md`. We are building the candidate onboarding flow and the
> OWNER → MANAGER → BDE → candidate hierarchy. The designs are in `<path or link to the designs>`. Do not write code yet:
> first list which of the questions Q1–Q9 the designs already answer, then give me a plan with your recommendation on each
> open question, and wait for my "go".
