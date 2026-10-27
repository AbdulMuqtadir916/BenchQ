# 05 — Assign, done screen and reassigning

**Owner:** — · **Depends on:** 02, 03, 04 · **Branch:** `feat/onboarding-05-assign`

Finishes the flow: step 5, creating the candidate, the done screen, the "Needs a BDE" queue, reassigning, and the BDE's
"New assignments". Then it switches `/candidates/new` over to the wizard for good.

Read first: [README](./README.md) §2 (Q41–Q46, Q48, Q50), §7 (A4–A6), [03 §1](./03-scope-and-permissions.md) (`canAssignTo`),
[02 §1–§2](./02-hierarchy-and-seats.md) (load, limit, messages), `src/components/app/candidate-wizard/` (04).

## 1. Step 5 — Assign ([screen](./screens/5-assign.webp))

Built as `src/components/app/candidate-wizard/step-assign.tsx` (+ `bde-option.tsx` for a row).

**A MANAGER** sees the screen as designed, with the copy changes below:

- Heading "Assign a BDE"; text: "The BDE markets this candidate every night and answers for their pipeline. Load counts
  candidates on the bench, interviewing or at offer." (Generate "on the bench, interviewing or at offer" from
  `WORKING_STATUSES`, so it can't drift from the rule.)
- Section label **"BDE"** (the screen's "Owner" is wrong, Q48), right side "Capacity {bdeCapacity} per BDE".
- Search "Search BDEs by name or email" (filters the list; `↓` moves into it).
- One row per active BDE reporting to them: avatar, name, email, "works {n} similar profile(s)" (A4), and the load
  "{load} / {capacity}" — amber with a warning icon and "At capacity" at or over it (Q46: a warning, still selectable).
- A BDE is required.

**The OWNER** sees two parts (Q41):

1. **Manager** (required): one row per active MANAGER with their team size and queue size.
2. **BDE** (optional), listing only that manager's BDEs as above, plus a first row **"Let {manager} choose"** (the
   default). Choosing it puts the candidate in that manager's "Needs a BDE" queue.

**Both:**

- Handoff: **"Note to the BDE"** (or "Note to {manager}" when no BDE is chosen), optional, max 1000 characters, helper
  "Context that isn't on the résumé." The screen's **"Notify the BDE" toggle is removed** (Q50).
- **At the candidate limit** (`canAssignCandidate` false, 02): BDE rows are disabled and the reason (`assignBlockReason`)
  shows above them; the OWNER can still hand to a manager. A MANAGER can't create at the limit: **Create candidate** is
  visible, disabled, with the reason (docs/04 §0).
- No active MANAGER in the firm: the whole "New candidate" entry point is disabled with `noManagerReason` (02).
- The rows are a radio group (arrow keys, `Space`); `J`/`K` also move (docs/04 §1.3).
- **Create candidate** (`⌘/Ctrl+Enter`): checks `canAssignTo` (03), then `candidatesApi.create`.

## 2. Creating (mock now, backend in 06)

`src/mocks/candidates.ts` `create(firmId, body: CreateCandidate)`, all or nothing:

1. Refuse with the policy (`can` + `canAssignTo`) and the limit (when `bdeId` is set), with the exact messages.
2. The candidate: `status: ON_BENCH`, `benchStartDate: now` (A2), `managerId`, `bdeId`, the step fields; persona from
   summary, industries, deal breakers, relocation, notice period.
3. Its Record (`src/mocks/records.ts`): `headline` = "Marketed as", `summary` with `summaryState: UNVERIFIED`, one
   `RecordSkill` per skill with `state: UNVERIFIED` and its `source`; no evidence. **Never `VERIFIED`** (Q49).
4. With `resumeParseId`: a `CandidateDocument` of kind `RESUME` with the file name (mock: no file content).
5. **No ledger entries on mocks.** The ledger is served only by the backend since F6, so the mock can't write to it.
   `CREATE` and `ASSIGN` (with the handoff note) are written by the backend's create in 06 PR 4 and appear once 07
   switches candidates live. Until then the handoff note is kept on the mock candidate's create call only for the done
   screen.

Hook `useCreateCandidate` invalidates the firm's candidates, records, documents and dashboard keys.

## 3. Done screen ([screen](./screens/6-done.webp))

`src/components/app/candidate-wizard/step-done.tsx`. Check icon (with a text label for screen readers), then:

- With a BDE: **"{name} is on the bench"** / "Assigned to **{BDE}**. They'll see it under New assignments on their
  dashboard."
- Handed to a manager: **"{name} is on the bench"** / "Handed to **{manager}**, who will pick a BDE."
- Drop the screen's "notified when their shift starts" and "Matching jobs … starts tonight" (Q50; the backend promises
  no such job).
- Buttons: **Open profile** (primary, focused) → `candidates.detail`; **Find jobs** → `/[firm]/jobs?candidate={id}` via
  `hrefFor` (A6); **Add another** → a fresh wizard on step 1.

## 4. Switch the route over

- Remove the `NEXT_PUBLIC_CANDIDATE_WIZARD` flag and `src/components/app/candidate/new-candidate-form.tsx`.
- Delete the modal intercept `src/app/[firm]/(app)/@modal/(.)candidates/new/page.tsx` (Q48: full page, no modal).
- Move the page to `src/app/[firm]/(studio)/candidates/new/page.tsx` (no sidebar; same URL) and set the registry entry's
  `shell` to `"studio"`. Check `command-palette.tsx`, the candidates page button and `registry.test.ts` /
  `no-path-literals.test.ts` still pass; links keep using `hrefFor("candidates.new")`.
- `docs/04-SCREENS.md` §4.2 already points here (01).

## 5. "Needs a BDE" queue

- Candidates list (`/candidates`): an **assignment** filter in the URL, `?assignment=all|needs-bde` (Zod). The BDE
  column shows the BDE, or a "Needs a BDE" tag (icon + label). Hidden for a BDE, who has no queue.
- MANAGER dashboard (`features/dashboard/manager-dashboard.tsx`): a "Needs a BDE" card with the count (derived) and the
  list's first five, linking to the filter. Empty: "No candidates waiting for a BDE."
- OWNER dashboard: the same count across the firm, per manager.

## 6. Reassigning (Q43)

- `src/components/app/candidate/reassign-dialog.tsx`, opened from **"Reassign"** on the candidate page (and from a
  "Pick a BDE" button on a queue candidate). Rendered through `<Can action="candidate.assign">`; hidden in a support
  view.
- OWNER: manager, then BDE or "Let {manager} choose"; MANAGER: their BDEs only. Note optional. Current assignment shown
  as "Now: {BDE} ({manager})". Same load, capacity and limit rules as step 5 (moving between BDEs never changes the limit
  count; assigning a queue candidate is blocked at the limit).
- Adapter `candidatesApi.reassign(firmId, id, body: ReassignCandidate)`; mock refuses with `canAssignTo`; writes one
  `ASSIGN` entry "Assigned to {new} (from {old})" with the note. Applications, resumes and history are untouched.
- The candidate page shows the latest handoff note ("Note from {actor}, {date}") in its overview.
- Bulk reassign from the list is **not** in this module (the list has no multi-select today); note it in docs/04 §4.1
  as later.

## 7. "New assignments" on the BDE dashboard (Q50, A5) — needs the ledger's `ASSIGN` entries, so it lands with 07

Build the card and its derivation here against a fixture of ledger entries in the test; on screen it shows its empty
state until 07, because no `ASSIGN` entries exist before the backend writes them. The same holds for the reassign
dialog's ledger entry and the candidate page's "Note from …" (§6): the mock reassign changes the candidate only.

`features/dashboard/bde-dashboard.tsx`: a card listing candidates whose latest `ASSIGN` entry names this BDE and is
under 7 days old, newest first, each with the note and who assigned it. Derived in `src/lib/derive/dashboard.ts` from
the ledger and candidates. Empty: "No new candidates this week." Skeleton and error like the other cards (docs/04 §13).

## 8. Tests

- Step 5: MANAGER sees only their BDEs; OWNER sees managers, then that manager's BDEs; at capacity → warning, still
  selectable; at the limit → BDE rows disabled with the message, manager-only still works; create refused for a BDE
  outside the team.
- Create: candidate, Record (`UNVERIFIED` only), document, `CREATE` + `ASSIGN` entries; nothing `VERIFIED` (assert over
  the whole Record).
- Reassign: OWNER across managers → queue when no BDE; MANAGER across teams refused; one ledger entry per move;
  applications stay.
- "New assignments": a 6-day-old assignment shows, an 8-day-old one doesn't; a candidate reassigned away disappears.
- Route: `/candidates/new` renders the wizard full page; no modal on `n`; BDE → Forbidden.

## Done when

- [ ] Step 5 and the done screen match the screens with the changes above
- [ ] Old form, flag and modal gone; the route is full page
- [ ] Queue filter, dashboard cards, reassign dialog and "New assignments" built, with skeleton, empty and error states
- [ ] README §10 exit check walked on mocks, signed in as every seeded account
- [ ] Both themes; keyboard only; 1440 / 1024 / 390 px; `axe` clean
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean

**Do not:** change the policy table (03), the seat or limit rules (02), or `backend/` (06).
