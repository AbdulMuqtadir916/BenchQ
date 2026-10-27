# 01 — Contracts, schemas and mock data

**Owner:** — · **Depends on:** nothing · **Branch:** `feat/onboarding-01-contracts` · **Size:** one PR, docs first

Every later module builds on the shapes defined here. This module changes contracts and keeps the app working
as today: no new screens. It is the only module that edits `src/lib/schemas/`.

> **Built 2026-10-27, with one change of scope (decided with the product owner):** the BDE-only seat rule (Q44) moved
> here from module 02 and 06 PR 2, frontend and backend, because the demo MANAGERs this module adds would otherwise
> push the seat fixtures over their limits. Done here: `deriveFirmUsage` and `seats_used` count BDEs and BDE invites,
> only BDE invites are blocked, the block message and every label say "BDE seats", and the seat fixtures were
> re-tuned (two demo BDEs each in STL and CBW). `workSettings` reuses the existing `RemoteMode` enum instead of a new
> `WorkSetting`. The live DTO mapper reads `manager_id`, `bde_capacity` and `note` as optional until 06 sends them.

Read first: [README](./README.md) §2–§3, `docs/02-DATA-CONTRACTS.md` §3.1 and §4, `src/lib/schemas/candidate.ts`,
`tenancy.ts`, `session.ts`, `analytics.ts`, `enums.ts`.

## 1. Contract changes (write them in docs/02 first, then the Zod schemas)

The product owner approved these on 2026-10-26 (Q40–Q50). The fields marked *provisional* are on mocks only until
Zuhair fixes the production contract (Q50); keep the "provisional" note next to them in docs/02.

### Candidate (`candidate.ts`, docs/02 §4)

| Change | Field | Rule |
|---|---|---|
| remove | `assignedUserIds`, `primaryUserId` | replaced by the two below |
| add | `managerId: string` | the candidate's manager (a MANAGER of the same firm). Always set (Q41). |
| add | `bdeId: string \| null` | the candidate's one BDE (Q42). When set, that BDE's `managerId` equals the candidate's `managerId`. null = "Needs a BDE". |
| add, provisional | `workSettings: RemoteMode[]` | step 4, several allowed |
| add, provisional | `preferredLocations: string[]` | step 4, "City, ST" strings |
| add, provisional | `contactNotes: string \| null` | step 4 "Notes for the BDE" (how to reach them, interview windows) |

`workSettings` uses the existing `RemoteMode` enum (`ONSITE`, `HYBRID`, `REMOTE`, docs/02 §2); no new enum.

`CreateCandidateSchema` becomes the wizard's payload (module 04/05 use it):

```ts
export const CreateCandidateSchema = CandidateSchema.pick({
  email: true, phone: true, linkedinUrl: true, city: true, state: true, yearsExperience: true,
  workAuth: true, workAuthExpiry: true, needsSponsorship: true, needsTransfer: true,
  employmentTypes: true, rateTarget: true, rateMin: true, availableFrom: true, noticePeriodDays: true,
  targetRoles: true, willingToRelocate: true, workSettings: true, preferredLocations: true, contactNotes: true,
}).extend({
  fullName: z.string().trim().min(1, "Enter the candidate's name."),
  primaryRole: z.string().trim().min(1, "Enter the title they're marketed as."),   // "Marketed as"
  email: z.string().trim().email("Enter a valid email."),                            // required in the flow (Q48)
  summary: z.string().trim().nullable(),
  skills: z.array(z.object({ name: z.string().trim().min(1), family: z.string().nullable(), source: FieldSource })),
  preferredIndustries: z.array(z.string()),
  dealBreakers: z.array(z.string()),
  /** The parse to keep (06: the backend holds the file until create). null = no résumé. */
  resumeParseId: z.string().nullable(),
  managerId: z.string().min(1),
  bdeId: z.string().nullable(),
  handoffNote: z.string().trim().max(1000).nullable(),
});
```

`ReassignCandidateSchema = z.object({ managerId: z.string().min(1), bdeId: z.string().nullable(), note: z.string().trim().max(1000).nullable() })`.

### Résumé draft (new file `src/lib/schemas/resume-draft.ts`, docs/02 §4)

What the parser's answer becomes on the frontend (the snake_case shape stays in `src/lib/api/dto/`, module 04). Every
field is nullable: null means the résumé didn't have it. Nothing here is saved; it only fills the form (Q49).

```ts
export const ResumeDraftSchema = z.object({
  /** The backend's handle on the uploaded file and its full parse; sent back as `resumeParseId` on create. */
  parseId: z.string(),
  fileName: z.string(),
  fullName: z.string().nullable(),
  primaryRole: z.string().nullable(),          // header.title
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  yearsExperience: z.number().nullable(),      // derived from work_experience dates (04 §5)
  workAuth: WorkAuth.nullable(),               // matched from header.work_authorization, else null
  workAuthText: z.string().nullable(),         // the printed text, shown when it didn't match
  summary: z.string().nullable(),
  skills: z.array(z.object({ name: z.string(), family: z.string().nullable() })),
});
```

### User and Invite (`session.ts`, `tenancy.ts`, docs/02 §3.1)

- `UserSchema` gains `managerId: string | null`. **A user who isn't a BDE has `null`** (refinement). A BDE has a
  manager, except a BDE from before the hierarchy, who may be `null` until the OWNER sets one (Q51); the UI shows
  "No manager". Add the refinement the same way `InviteSchema` does it (a base object plus `superRefine`), so
  `.pick`/`.extend` keep working.
- `InviteBaseSchema` gains `managerId: string | null`, with the same rule in `InviteSchema`'s refinement: only a BDE
  invite has one. A **new** BDE invite must name one (checked when sent, module 02 / 06); a BDE invite from before the
  hierarchy may be null, like its user (Q51).

### Firm (`session.ts`, docs/02 §3.1)

- `bdeCapacity: z.number().int().positive().default(10)` (Q46). Not copied from the plan; the OWNER edits it.
- `seatLimit` keeps its name; its doc comment now says "BDE seats (Q44)".

### Ledger (`analytics.ts`, docs/02 §10)

- `action` gains `"ASSIGN"`: entityType `"candidate"`, summary "Assigned to {BDE} ({manager})" or
  "Handed to {manager}", with "from {previous}" when it moves. One entry per assignment change (Q43).
- `LedgerEntrySchema` gains `note: z.string().nullable()` — the handoff note. null on every other entry.

## 2. Docs to update in this PR

- `docs/02-DATA-CONTRACTS.md`: §2 (`WorkSetting`), §3.1 (User, Invite, Firm), §4 (Candidate, CreateCandidate,
  ReassignCandidate), §10 (`ASSIGN`, `note`). Each change cites Q40–Q50.
- `docs/04-SCREENS.md` §4.2: replace the section with a short pointer to `docs/candidate-onboarding/` and Q48–Q49;
  delete "Fields the user types by hand are VERIFIED immediately". §4.1: the list's "assigned BDE" column and the
  "Needs a BDE" filter (built in 05).
- `docs/03-MOCK-DATA.md`: the new fields and the manager of each BDE.

## 3. Keep the app compiling (mechanical, no behaviour change)

Removing `assignedUserIds` breaks about 20 files. Change each read **mechanically**, keeping today's behaviour:

| Today | Becomes |
|---|---|
| `candidate.assignedUserIds.includes(userId)` | `candidate.bdeId === userId` |
| `candidate.primaryUserId` | `candidate.bdeId` |
| `ScopedRecord.assignedUserIds` (`src/lib/routes/scope.ts`) | `bdeId?: string \| null` |
| `scopeCandidates<T extends { assignedUserIds }>` | `<T extends { bdeId: string \| null }>` |

Files (from `grep -rlE 'assignedUserIds|primaryUserId' src`): the candidates, applications, ledger, follow-ups,
outreach, jobs and focus pages; `use-candidate-workspace.ts`; `resume-studio/new-resume.tsx`, `open-resume.tsx`;
`features/dashboard/bde-dashboard.tsx`; `derive/dashboard.ts`, `derive/bde-performance.ts`; `routes/scope.ts`;
`auth/policy.ts`; `mocks/applications.ts`, `mocks/candidates.ts`. MANAGER scoping is **not** this module (03).

The old form (`new-candidate-form.tsx`) still compiles until 04 deletes it: the mock's `create` accepts the new schema;
the old form fills `managerId` with the chosen BDE's manager, or the signed-in MANAGER, or the firm's first MANAGER.
Mark that branch `// removed in onboarding module 04`.

## 4. Mock data

- `src/mocks/data/candidates.json`: each candidate's `primaryUserId` (or first `assignedUserIds`) becomes `bdeId`;
  `managerId` = that BDE's manager. Leave **two candidates per firm** with `bdeId: null` (the "Needs a BDE" fixture).
  New fields: `workSettings`, `preferredLocations`, `contactNotes` on about half, empty on the rest.
- `src/mocks/data/firm.json`: every BDE gets `managerId`. **Every firm needs at least one MANAGER** (Q40): add one to
  each firm that has none, and a **second MANAGER** to the main demo firm, with BDEs split between them (03 and 05
  need two teams to test against). Other roles: `managerId: null`. Add `bdeCapacity` (10; one firm at 3, so a BDE is at
  capacity in the demo).
- `src/mocks/data/invites.json`: BDE invites get a `managerId`; others null.
- Seeded accounts: list the new MANAGER accounts wherever the demo accounts are documented (root `README.md` Quick
  start). Re-tuning the seat fixtures to the BDE-only rule is module 02, not here.
- `src/lib/api/dto/demo-ids.json`: add the new users' ids if the backend seed maps them (check `demo-ids.test.ts`).

## 5. Tests

- `tenancy.test.ts`: `InviteSchema` and `UserSchema` reject a non-BDE with a `managerId` and accept a BDE with one or
  with `null` (Q51).
- Candidate schema: `bdeId` null is valid; a fixture whose `bdeId`'s manager differs from `managerId` fails a new
  fixture test (`mocks/fixtures.test.ts`).
- Ledger: an `ASSIGN` entry parses; every existing entry has `note: null`.
- All existing tests pass unchanged in meaning (only the field names in them change).

## Done when

- [ ] docs/02, docs/04 §4.1–4.2, docs/03 updated, citing Q40–Q50; provisional fields marked
- [ ] Schemas changed as §1; no `assignedUserIds` / `primaryUserId` left (`grep -r` is empty, `backend/` aside)
- [ ] Mock data as §4; fixtures validate
- [ ] App behaves exactly as before for every seeded account (spot check: BDE list, MANAGER list, OWNER dashboard)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean

**Do not:** change who can see or do anything (03), the seat count (02), or any screen (04/05).
