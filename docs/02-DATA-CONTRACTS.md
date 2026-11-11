# 02 — Data Contracts

**Project:** BenchQ · frontend only
**Version:** 1.1 · 2026-10-14

Zod schemas are the single source of truth. Types are **inferred**, never written twice.
Everything here lives under `src/lib/schemas/`.

---

## 1. Alignment with JobNavigator

You asked to follow the meta fields and structure of
[`vesaias/JobNavigator`](https://github.com/vesaias/JobNavigator) for AI-related features — its
field shapes, not its UI.

**What JobNavigator is:** a self-hosted, **single-user, candidate-side** job search automation
platform. Python/FastAPI + React, scraping across seven discovery tiers, LLM resume scoring with
prompt caching, tailored resume and cover letter generation with PDF export and tracer links, Gmail
response monitoring.

**What BenchQ is:** **multi-tenant, recruiter-side.** A firm, many BDEs, each managing many
candidates. So the alignment is: adopt its AI-feature field shapes, then wrap them in the
firm → BDE → candidate hierarchy that JobNavigator has no concept of.

### 1.1 What we adopt from it

| JobNavigator concept | How it lands in BenchQ | Why it's worth taking |
|---|---|---|
| **Scoring record** — provider, depth (`light` \| `full`), keyword analysis, requirement mapping, ATS tips | `ScoringRecord` attached to a `Match` | The light/full split is a genuinely good cost control. Light for bulk ranking, full only when the BDE opens a job. |
| **Dedup hash** — URL-based and content-based, tracking params stripped before hashing | `Job.dedupe.urlHash` + `contentHash` | Same requirement, same solution. Reposts across sources are constant. |
| **H-1B sponsorship indicator**, LCA data per company | `Company.h1b` block | **The single most valuable borrow.** Work authorisation is the central filter in bench sales; JobNavigator already models it. |
| **Persona** — profile grounding AI answers for autofill | `Candidate.preferredIndustries`, `dealBreakers`, the base résumé's summary, `qaBank` (the `persona` field was dropped in migration 0015) | Maps onto the screening-question prefill panel. |
| **Q&A Bank** — reusable question/answer pairs | `QaBankEntry[]` per candidate | This *is* the prefill panel. Reusing answers across applications is a real time saving. |
| **Tracer links** — unique per resume/letter combo, open/click tracking | `ResumeVersion.tracer` | Lets a BDE see whether a submission was opened. Free signal. |
| **Template selection + tailoring history per job** | `ResumeVersion.templateId` + `tailoring` | Same shape. |
| **Status transitions with history** | `ApplicationEvent[]` | Already in the BenchQ spec; this confirms the pattern. |

### 1.2 What we deliberately do not take

- **Its single-user model.** No `firmId`, no assignment, no roles. Everything in BenchQ carries
  tenancy.
- **Its UI.** Stated requirement, and correct — it's a candidate's personal dashboard, not a
  recruiter's production console.
- **Auto-apply / cloud submission.** BenchQ is deliberately assisted, not automated, for ToS
  reasons.
- **Gmail polling.** Deferred well past MVP.

> **Note on fidelity:** the repo does not publish its schema files, so the field names below are
> BenchQ's own, modelled on JobNavigator's documented *concepts* and metadata. Where you later get
> access to its actual models, reconcile the AI-feature blocks (`ScoringRecord`, `tailoring`,
> `persona`, `qaBank`) first — those are the ones meant to line up.

---

## 2. Enums

```ts
// src/lib/schemas/enums.ts
import { z } from 'zod';

export const FirmRole = z.enum(['OWNER', 'MANAGER', 'BDE', 'VIEWER']);

export const WorkAuth = z.enum([
  'H1B', 'H4_EAD', 'OPT', 'CPT', 'GC', 'GC_EAD', 'USC', 'TN',   // no 'OTHER' since 0015 (Abdul, 2026-11-06)
]);

export const EmploymentType = z.enum(['C2C', 'W2', 'TEEN99', 'FTE']);

export const CandidateStatus = z.enum([
  'ON_BENCH', 'INTERVIEWING', 'OFFER', 'PLACED', 'PAUSED', 'INACTIVE',
]);

// No ClaimState or FieldSource (dropped 2026-11-05): BenchQ has no claim states, no evidence record and no export gate.

export const JobSourceType = z.enum([
  'CONNECTOR', 'AGGREGATOR', 'USER_SUBMITTED', 'MANUAL',
]);

export const LegalBasis = z.enum([
  'PUBLIC_DOCUMENTED', 'LICENSED_API', 'USER_SESSION',
]);

export const RemoteMode = z.enum(['ONSITE', 'HYBRID', 'REMOTE']);

export const VerificationVerdict = z.enum([
  'VERIFIED', 'CAUTION', 'REJECTED', 'UNKNOWN',
]);

export const ClientType = z.enum([
  'DIRECT_CLIENT', 'PRIME_VENDOR', 'IMPLEMENTATION_PARTNER', 'STAFFING_AGENCY', 'UNKNOWN',
]);

// Target new-write vocabulary (D3, 2026-11-04): exact mapping awaits Abdul's sign-off.
// Read compatibility retains legacy values/history separately; see section 2.1.
export const ApplicationStatus = z.enum([
  'SAVED', 'APPLIED', 'SCREENING_CALL', 'SHORTLISTED',
  'INTERVIEW_SCHEDULE_REQUEST', 'INTERVIEW_SCHEDULED', 'ASSESSMENT',
  'OFFER', 'MOVE_ON', 'INCOMPLETE_APPLICATION',
]);

export const OutreachChannel = z.enum([
  'EMAIL', 'LINKEDIN_CONNECT', 'LINKEDIN_MESSAGE', 'PHONE', 'OTHER',
]);

export const OutreachResult = z.enum(['SENT', 'OPENED', 'REPLIED', 'BOUNCED', 'NO_RESPONSE']);

export const FollowUpKind = z.enum(['DAY_3_LINKEDIN', 'DAY_7_EMAIL', 'CUSTOM']);
export const FollowUpState = z.enum(['PENDING', 'DONE', 'SNOOZED', 'CANCELLED']);

/** JobNavigator-aligned: two scoring depths for cost control. */
export const ScoringDepth = z.enum(['LIGHT', 'FULL']);

export const RequirementKind = z.enum(['MANDATORY', 'PREFERRED', 'ADJACENT']);
export const RequirementMatch = z.enum(['HAVE', 'MISSING', 'ADJACENT']);
```

---

### 2.1 Application-status vocabulary and legacy mapping — D3

**Decision record: 2026-11-04.** Source: [Abdul’s issue #110 reply](https://github.com/AbdulMuqtadir916/BenchQ/issues/110#issuecomment-6624344616)
and the stage display order confirmed by Samad. The target vocabulary and no-loss mapping policy are recorded below.
**Abdul’s sign-off on this exact list/mapping is pending before PR 4 UI work.** This documentation does not change
runtime schemas, status writers or stored rows. PR 3 makes no application-status writes.

#### Target: ten selectable candidate application statuses

| Backend / new command value | Frontend target value | User-facing label | Display/meaning |
|---|---|---|---|
| `saved` | `SAVED` | Saved | Draft/favorite; not proof of submission; not an email category |
| `applied` | `APPLIED` | Applied | Submitted application |
| `screening_call` | `SCREENING_CALL` | Screening call | Initial screening stage |
| `shortlisted` | `SHORTLISTED` | Shortlisted | Explicit advancement |
| `interview_schedule_request` | `INTERVIEW_SCHEDULE_REQUEST` | Interview schedule request | Availability/request to schedule; not a confirmed booking |
| `interview_scheduled` | `INTERVIEW_SCHEDULED` | Interview scheduled | Explicit confirmed interview booking |
| `assessment` | `ASSESSMENT` | Assessment | Hiring assessment/task |
| `offer` | `OFFER` | Offer | Offer outcome; always BDE review before applying an email suggestion |
| `move_on` | `MOVE_ON` | Move On (rejected) | Rejection/closing outcome; always BDE review before applying an email suggestion |
| `incomplete_application` | `INCOMPLETE_APPLICATION` | Incomplete application | Conditional stage, visible only with explicit incomplete-application email evidence |

Forward display order: Saved -> Applied -> Screening call -> Shortlisted -> Interview schedule request ->
Interview scheduled -> Assessment -> Offer. Move On is a separate closing outcome, not a step after Offer.
Incomplete application is conditional; omit it when no explicit evidence exists. Display order is not a transition
allowlist, and it must not reinterpret legacy records or fabricate status changes.

There is **no new Response stage**. **BDE review is a queue/indicator, not an application status**; preserve the
last confirmed application status while review is pending. Repeated rounds, backwards/old/ambiguous decisions go
to review; email presence alone is not a status write.

#### Separate email taxonomy

Ten email categories: `applied`, `screening_call`, `shortlisted`, `interview_schedule_request`,
`interview_scheduled`, `assessment`, `offer`, `move_on`, `incomplete_application`, `other`.
`other` belongs only to the email taxonomy, never the selectable application-status set; `saved` belongs only to
application statuses. A classified email can remain unmatched or require review without inventing an application
stage. `other` never changes application status, even at high confidence.

Required backend correction: remove `other` from the new-write `STATUSES` set in
`backend/applications/tracking.py` and enforce the same rule through candidate-status, review, legacy candidate
PATCH and bulk paths. Preserve reads, immutable history and identical historical command replay separately;
retaining `other` in a new-write allowlist is not required for legacy compatibility. Do not rewrite old events.

#### Explicit frontend/backend/legacy mapping policy

The first table defines the exact bidirectional spelling for new candidate commands. The following table covers
all old D3 values and known legacy backend values. **Mapping is read/display compatibility unless stated; it is
not an instruction to backfill stored statuses or rewrite event history.**

| Stored / old frontend value | Read/display mapping | New-write / automation behavior |
|---|---|---|
| `saved` / `SAVED` | Saved -> `SAVED` | Exact target value; no automatic match to a never-submitted draft |
| `applied` / `APPLIED` | Applied -> `APPLIED` | Exact target value |
| `offer` / `OFFER` | Offer -> `OFFER` | Exact target value; email outcome always BDE review |
| `rejected` / `REJECTED` | Display as Move On (rejected), retaining original `rejected` in stored history | New candidate rejection commands use `move_on`; email outcome always BDE review. This alias needs the pending mapping sign-off |
| `response` / `RESPONSE` | Preserve as Recruiter reply (legacy) | No equivalent target stage; no automatic conversion to Applied/Shortlisted; an authorized human chooses the current stage |
| `screening` / `SCREENING` | Preserve as Screening (legacy) | Ambiguous between old shortlist/screening meanings; do not assume `screening_call` or `shortlisted` |
| `interview` / `INTERVIEW` | Preserve as Interview (legacy) | Does not prove request versus confirmed booking; no automatic conversion to `interview_scheduled` |
| `placed` / `PLACED` | Preserve as Placed (legacy), closed outcome | Placement is not merely an offer; never collapse it into Offer or rejection |
| `withdrawn` / `WITHDRAWN` | Preserve as Withdrawn (legacy), closed outcome | Withdrawal is not rejection; no automatic conversion to Move On |
| `expired` / `EXPIRED` | Preserve as Expired (legacy), closed outcome | Expiry is not rejection; no automatic conversion to Move On |
| `other` / `OTHER` already on an application | Preserve as Other (legacy), outside progress/normal target choices | Read-only legacy value; reject new candidate commands selecting it; Other email never overwrites it |
| `phone_screen` | Preserve as Phone screen (legacy) if encountered | Do not silently remap; known historical migration may already have rewritten it, so inspect actual provenance before any future remediation |
| `final_round` | Preserve as Final round (legacy) if encountered | Not proof of a scheduled booking or an offer; review/manual correction |
| `null`, blank or any unknown value | Preserve the raw value; show a safe Unknown/legacy label and require review | Never fall back to Applied, Other or a guessed target; no automatic transition |

All additional modern backend/frontend spellings (`screening_call`/`SCREENING_CALL`, `shortlisted`/`SHORTLISTED`,
`interview_schedule_request`/`INTERVIEW_SCHEDULE_REQUEST`, `interview_scheduled`/`INTERVIEW_SCHEDULED`,
`assessment`/`ASSESSMENT`, `move_on`/`MOVE_ON`, `incomplete_application`/`INCOMPLETE_APPLICATION`) use the exact
mapping in the target table; no ambiguity or legacy rewrite is implied by the spelling conversion.

The frontend read mapper must accept preserved legacy values/history separately from the new-selectable-status
schema. It must not crash on an old transition or silently turn an unsupported status into Applied. Exact target
spelling applies at the adapter/DTO boundary; the backend does not start accepting arbitrary uppercase commands.
Candidate commands may correct a legacy application explicitly under current scope/revision/audit rules; the
classifier must not guess a forward rank for a legacy value. Existing legacy non-candidate APIs retain their
separate compatibility policy until explicitly changed; this decision does not expand or retire them.

#### Classification, automation and retention are different policies

- PR 3 records classification/review evidence and performs **no application-status writes**.
- PR 4 initial automatic forward targets: `screening_call`, `shortlisted`, `interview_schedule_request`,
  `interview_scheduled`, `assessment`; **confidence >=0.8**, trustworthy Gmail sender-authentication evidence,
  unique submitted-application match and freshness are independent requirements.
- `offer` and `move_on` always go to BDE review. No automatic return from closed/legacy states is inferred. Other
  and Saved are never automatic targets. Special email-driven Applied/Incomplete transitions described during
  discussion are not added to the approved five-target allowlist by this mapping document.
- Pending/failed classification is readable in the existing candidate scope with a **Not classified** badge.
  Hiding matched Other is separate: keep hidden Other encrypted for **30 days**, then purge only when enabled
  after evaluation proves zero job-related would-remove decisions; retain minimal exclusion references afterward.
- New-write status validation is not classification gating or purge authorization. Never use a confidence/status
  mapping change to silently enable real-mail AI, status automation or content deletion.
- Existing `applications.resume_id`, Notes, submission facts, status revisions and immutable events remain intact.

This section supersedes D3’s old four-vs-ten recommendation and original enum, earlier candidate
foundation wording that allowed new `other` stage selections, and any older module guidance to default unknown
status to Applied or map generic Interview to a confirmed booking. No such code/data conversion occurs in this
change. UI vocabulary/read compatibility and any new DTO details await Abdul’s sign-off before PR 4.

---

## 3. Session & tenancy

```ts
// src/lib/schemas/session.ts
export const FirmSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().url().nullable(),
  primaryTimezone: z.string().default('Asia/Kolkata'),
  clientTimezone: z.string().default('America/New_York'),
  applicationExpiryDays: z.number().int().default(30),
});

export const UserSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: FirmRole,
  avatarUrl: z.string().url().nullable(),
  isActive: z.boolean(),
  lastActiveAt: z.string().datetime().nullable(),
});

export const SessionSchema = z.object({
  user: UserSchema,
  firm: FirmSchema,
  seatsUsed: z.number().int(),
  seatLimit: z.number().int(),
  activeCandidates: z.number().int(),
  candidateLimit: z.number().int(),
});

export type Session = z.infer<typeof SessionSchema>;
```

### 3.1 Tenancy contracts — APPROVED 2026-10-14 (schemas and fixtures implemented)

> **Status: signed off by the product owner on 2026-10-14** (changes requested, then approved with
> the answers in the decision table at the end of this section; recorded in `docs/07` §0 as Q16–Q21).
> **Implemented in Phase T PR 1 (T1–T3):** the Zod schemas (`src/lib/schemas/tenancy.ts`, `firmId` on
> the records below, `Firm` additions), the derived usage (`src/lib/derive/tenancy.ts`) and the fixtures
> (four firms, plans, invites, a platform admin). **Phase T PR 2 (T4–T5):** the firm session
> (`FirmSessionSchema`: principal + user + firm) in the client store, the dev principal switcher (removed in Phase L, Q25), the query
> key factory (`src/lib/query/keys.ts`, every firm key starts with `firmId`) and `firmId` on every adapter
> and mock. **Not yet:** platform sessions (Phase P) and firm URLs (`[firm]`, T6). Five rules the owner did not state
> but approved on 2026-10-16 are marked **(approved 2026-10-16)** and listed under *Implications*.
> **Numbering.** **A1–A17** are the owner's 17 answers (decision table at the end of this section).
> **`07 Qn`** is always a decision in `docs/07` §0. Both are recorded there as Q16–Q21.
> Shapes follow this file's conventions (Zod, ISO datetimes as `z.string().datetime()`).

#### Principal and SupportView — who is signed in (07 §3)

```ts
// src/lib/schemas/session.ts (replaces the user + role pair in the client session store)
export const SupportViewSchema = z.object({
  id: z.string(),                         // support-view id; also the `entityId` on its ledger entries
  firmId: z.string(),                     // the one firm being viewed (one view at a time, 07 §4)
  reason: z.string().min(10),              // required free text; the firm sees it exactly as written
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),        // always startedAt + 60 minutes. No extension (A12)
});

export const PrincipalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('firm'),
    userId: z.string(),                    // → User.id
    firmId: z.string(),                    // must equal the URL firm's id, else not-found (07 §3)
    role: FirmRole,                        // OWNER | MANAGER | BDE | VIEWER (unchanged)
  }),
  z.object({
    kind: z.literal('platform'),
    userId: z.string(),                    // → PlatformUser.id
    role: z.literal('PLATFORM_ADMIN'),     // code name (07 Q7); UI label "Super Admin"
    support: SupportViewSchema.nullable(), // null = not inside a firm; at most one view at a time
  }),
]);
```

To keep a support view going past 60 minutes the admin starts a **new** view: new reason, new
`SupportView`, new `ADMIN_ACCESS` ledger entry. The firm sees the **admin's name** and the **reason
as written**, never the admin's email (the ledger entry carries `actorName`, and the reason is in
its `summary`).

#### Firm — additions to the existing `FirmSchema` (07 §7)

```ts
// existing fields unchanged: id, name, slug, logoUrl, primaryTimezone, clientTimezone,
// applicationExpiryDays (truthGuardMode was dropped 2026-11-05, migration 0016)
status: z.enum(['ONBOARDING', 'ACTIVE', 'SUSPENDED']),
  // ONBOARDING → ACTIVE automatically when the OWNER accepts their invite (A5).
  // Only Super Admin suspends or reactivates (A5). No TRIAL state until billing exists.
  // SUSPENDED: firm users can still sign in and see "Workspace suspended" on every route (A8, 07 §2.5).
planId: z.string(),                       // → Plan.id. REQUIRED in every status, ONBOARDING included (A16)
seatLimit: z.number().int(),              // EFFECTIVE limit. Copied from Plan.seatLimit when the plan is assigned (A3)
candidateLimit: z.number().int(),         // EFFECTIVE limit. Copied from Plan.candidateLimit when assigned (A3)
contactPhone: z.string().nullable(),      // the only new profile field (A6). The OWNER is the primary
                                          // contact: derived, not stored. GST, billing email and address
                                          // wait for billing work
createdAt: z.string().datetime(),

// slug (A7). Pattern + length + reserved + unique, all four:
//   lowercase a-z, 0-9 and hyphens; 3 to 32 characters; starts with a letter;
//   no leading, trailing or double hyphens; not a reserved word (07 §2.4); unique across firms.
slug: z.string()
  .regex(/^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/)   // tested: 3-32 chars, letter first, no -- and no trailing -
  .refine((s) => !RESERVED_SLUGS.includes(s)),          // uniqueness is checked by the backend / mock store
// Super Admin may change a slug after creation, behind a confirm dialog that warns old links
// break. No alias or redirect table for now (A7).
```

**Derived, never stored** (computed from the records, per CLAUDE.md "every number is derived"):

| Value | Definition |
|---|---|
| `seatsUsed` | *(replaced by §3.4 / 07 Q44: active BDEs + pending BDE invites)* number of **active users** (OWNER, MANAGER, BDE and VIEWER all count) **+ pending invites** (A1). Per A9, an invite that is `PENDING` but past `expiresAt` is treated as `EXPIRED` and does not reserve a seat **(approved 2026-10-16)** |
| `activeCandidates` | *(replaced by §3.4 / 07 Q45: a BDE is assigned and the status is working)* candidates whose status is `ON_BENCH`, `INTERVIEWING` or `OFFER`. `PLACED`, `PAUSED` and `INACTIVE` do not count (A2) |
| `canAddSeat` / `canAddCandidate` | `seatsUsed < seatLimit` / `activeCandidates < candidateLimit`. **These drive the block** on new additions: at the limit you can't add one more |
| `isOverSeatLimit` / `isOverCandidateLimit` | `seatsUsed > seatLimit` / `activeCandidates > candidateLimit`. Over, not at: a firm exactly at its limit is not flagged |
| `isOverLimit` | either of the two above. Shown as a flag on the admin firms list (A4) |

`SessionSchema.seatsUsed`, `seatLimit`, `activeCandidates` and `candidateLimit` stop being stored in
the session: usage is derived, and the two limits live on `Firm` (07 T2).

**Over-limit rule (A4).** When `canAddSeat` / `canAddCandidate` is false (at or over a limit), **block new additions**: sending an invite,
creating a candidate, reactivating a user, reactivating a candidate. ("Reactivating" here means a
*user* or a *candidate*, never the firm: reactivating a suspended firm is not blocked by a limit.) The message names the limit
("Your plan allows 10 seats; 10 are in use."). **Never auto-remove or deactivate anything.** After
a downgrade, existing users and candidates keep working.

#### Plan — a template, no billing (07 §7)

```ts
export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),                        // e.g. "Starter"
  seatLimit: z.number().int(),             // copied onto Firm.seatLimit when the plan is assigned (A3)
  candidateLimit: z.number().int(),        // copied onto Firm.candidateLimit when assigned (A3)
  features: z.array(z.string()),           // display labels only; no feature flags until something gates on them (A15)
  isActive: z.boolean(),                   // false = hidden from new firms, kept for existing ones
});                                        // no price fields: no billing in the frontend (CLAUDE.md)
```

**Copy, don't override (A3).** A plan is a template. Editing a plan **never changes existing firms**;
only assigning (or re-assigning) a plan copies its limits onto the firm. `Firm.seatLimit` and
`candidateLimit` are the limits that apply.

#### Invite — how every user joins (07 Q11)

```ts
// The fields, without the cross-field rule, so .extend / .pick / .omit keep working
// (a refined Zod schema can't be extended). Validate a whole invite with InviteSchema.
export const InviteBaseSchema = z.object({
  id: z.string(),
  firmId: z.string().nullable(),           // null = invite to the BenchQ platform team
  email: z.string().email(),               // who is invited; the token is sent here
  inviteeName: z.string().nullable(),      // the name the inviter gave, prefilled on /invite/[token];
                                           // the person may change it when accepting (07 Q31). null = not given
  role: z.union([FirmRole, z.literal('PLATFORM_ADMIN')]),
  invitedByUserId: z.string(),             // a firm user or a PlatformUser id
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
  expiresAt: z.string().datetime(),        // createdAt + 7 days (A9)
  createdAt: z.string().datetime(),
});

// A11: firmId is null  ⇔  role is PLATFORM_ADMIN
export const InviteSchema = InviteBaseSchema.superRefine((invite, ctx) => {
  if ((invite.firmId === null) !== (invite.role === 'PLATFORM_ADMIN')) {
    ctx.addIssue({ code: 'custom', path: ['firmId'], message: 'firmId must be null exactly when role is PLATFORM_ADMIN' });
  }
});                                        // the `[token]` in /invite/[token] is an opaque secret the
                                           // backend owns: it is not a field here and never in a fixture
```

| Rule | Decision |
|---|---|
| Lifetime | 7 days (A9) |
| Resend | keeps the **same `Invite` row**, issues a **new token** (the old one stops working) and resets `expiresAt` to now + 7 days (A9) |
| Expiry in the UI | the frontend may treat `PENDING` with `expiresAt` in the past as `EXPIRED` (A9) |
| One OWNER | **exactly one OWNER per firm** (A10). Transferring ownership is a Super Admin action, out of scope for now |
| Who invites whom | an OWNER can invite `MANAGER`, `BDE` or `VIEWER`, **not** `OWNER` (A10). The firm's single OWNER is invited by a Super Admin when the firm is created **(approved 2026-10-16)**. No cap on VIEWERs beyond seats (A10) |
| Platform staff | any `PLATFORM_ADMIN` can invite platform staff; `PLATFORM_ADMIN` is the only platform role (A11) |
| Seats | a `PENDING`, unexpired firm invite reserves a seat (A1) |

*Who may send an invite* is a permission, decided in Phase C (`member.invite`: OWNER only for firm
roles; any `PLATFORM_ADMIN` for platform staff). The schema only constrains the shape above.

#### PlatformUser — BenchQ staff (07 §7)

```ts
export const PlatformUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.literal('PLATFORM_ADMIN'),       // the only platform role (A11)
  isActive: z.boolean(),
  lastActiveAt: z.string().datetime().nullable(),
});                                        // no firmId: platform users belong to no firm (07 Q9)
```

#### Notifications and password-reset approvals — Q54

```ts
export const NotificationSchema = z.object({
  id: z.string(),
  type: z.string(),                        // extensible event kind; first: PASSWORD_RESET
  entityId: z.string(),                    // id of the typed entity; never a secret or reset URL
  requestStatus: z.string().nullable(),    // present for PASSWORD_RESET notifications
  canReissue: z.boolean(),                 // true only for the approver who approved the request
  title: z.string(),
  detail: z.string(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
});

export const PasswordResetRequestSchema = z.object({
  id: z.string(),
  requesterUserId: z.string(),
  requesterRole: FirmRole,
  approverRole: z.enum(['OWNER', 'MANAGER', 'PLATFORM_ADMIN']),
  firmId: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'COMPLETED', 'CANCELLED']),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),         // approval request lifetime: 24 hours
  decidedAt: z.string().datetime().nullable(),
});
```

`notifications` is addressed to exactly one firm user or one platform user. Firm notifications carry their
`firmId`; platform notifications have no firm. `password_reset_requests` is firm-owned, points to the requesting
`User`, and records the designated approver (a same-firm `User` or the Super Admin tier). A BDE's approver is its
assigned active Manager, or its own firm Owner when no active same-firm Manager is assigned; a Manager's approver
is their own firm Owner; an Owner's approver is a Super Admin. A VIEWER follows the Owner path. The Super Admin
does not initiate this flow. A stale or inactive designated approver expires the request; a BDE Manager already
inactive at routing time goes to the same-firm Owner. No request crosses firms.

  If no eligible approver exists, no request is created and the account is not frozen; the requester can retry once
  an active same-firm Owner or Super Admin is available.

Creating a valid request immediately freezes the unchanged old password and revokes all sessions. Denial or request
expiry unlocks it; successful completion replaces it. The 24-hour request deadline is independent of the 30-minute
reset-link lifetime. The request row stores only a hash of the one-use link. On approval the raw URL is returned
once to the approver's UI for manual sharing; it is never emailed, logged, stored in a notification or included in
this DTO. A replacement link invalidates the previous link.

The public forgot-password response is generic for known/unknown, inactive, VIEWER and Super Admin emails. Only an
active eligible firm account with an approver creates a request. One pending request per account; per-IP and
per-keyed-email rate limits; repeated submissions do not extend expiry. Since the account is frozen before the
approver decides, someone who knows an email can temporarily lock that account; this trade-off is mitigated, not
eliminated, by rate limits, deduplication, notifications and expiry.

Approval permissions are `notification.approve` (OWNER/MANAGER; request recipient is checked too) and
`platform.notification.approve` (Super Admin only). A platform support view has no approval permission.

#### `firmId` on records (07 §7, 07 Q13, A17)

| Record | Change | Note |
|---|---|---|
| Candidate, User | none | already have `firmId` |
| Job, Application, Resume, Record (candidate record), Document, Inbox (`CandidateInbox`, `InboxMessage`, `MailboxConnection`), Followup (`FollowUpTask`) | add `firmId: z.string()` | required; every fixture gets one in Phase T (T3) |
| **Agent and tailoring runs** | add `firmId: z.string()` | **required** (A17): `/admin/system` needs AI spend by firm, and deriving it through joins is fragile |
| LedgerEntry | add `firmId: z.string().nullable()` | rule below |
| Company (and `CompanyVerification`) | none | global reference data (07 Q13) |

**Ledger `firmId` rule (A13).** Any event *about a firm* carries that firm's `firmId`; `null` only for
platform-only events.

| `firmId` set (appears in that firm's `/[firm]/ledger`) | `firmId` null (only in `/admin/audit`) |
|---|---|
| `FIRM_CREATED`, `FIRM_SUSPENDED`, `FIRM_REACTIVATED`, `PLAN_CHANGED`, firm invites (`INVITE_SENT` / `INVITE_ACCEPTED` / `INVITE_REVOKED` with a firm), `ADMIN_ACCESS`, `ADMIN_ACCESS_END` | admin sign-ins, platform-team invites, plan **catalogue** edits |

`/admin/audit` shows everything, null and non-null.

#### Ledger actions and actors (07 §4)

```ts
// LedgerEntrySchema.action — existing values kept, these added:
'ADMIN_ACCESS_END',    // a support view ended (exit, expiry or sign-out)
'FIRM_CREATED', 'FIRM_SUSPENDED', 'FIRM_REACTIVATED',
'PLAN_CHANGED',        // a firm's plan or limits changed. `summary` states before and after
                       // (A14), e.g. "Starter → Growth, seats 5 → 10"
'INVITE_SENT', 'INVITE_ACCEPTED', 'INVITE_REVOKED',
'ASSIGN',              // a candidate's manager or BDE set or changed (§3.4, 07 Q43)
// `actorType` already has 'PLATFORM_ADMIN'; `ADMIN_ACCESS` (support view started) and `LOGIN` already exist
```

**No `PlanChange` entity (A14).** A firm's plan history is *derived* from its `PLAN_CHANGED` ledger
entries.

**Ledger entity types for tenancy events (lowercase, like every `entityType` in the ledger fixtures;
07 Q30).** `entityType` stays `z.string()`; these are the values the platform tier writes:

| `entityType` | Written by | `firmId` |
|---|---|---|
| `firm` | `FIRM_CREATED`, `FIRM_SUSPENDED`, `FIRM_REACTIVATED`, `UPDATE` (edit, slug change), `PLAN_CHANGED` for a **plan change** | the firm |
| `firm_limits` | `PLAN_CHANGED` for **custom limits** ("Adjust limits"); the firm's "custom limits" mark is derived from it (07 Q30) | the firm |
| `invite` | `INVITE_SENT` (sent or resent), `INVITE_ACCEPTED`, `INVITE_REVOKED` | the firm, or null for a platform-team invite |
| `user` | `STATE_CHANGE` when a firm user is deactivated or reactivated (07 Q30) | the firm |
| `platform_user` | `STATE_CHANGE` when staff are deactivated; `LOGIN` | null |
| `plan` | `CREATE` / `UPDATE` on the plan catalogue (implication 3) | null |
| `support_view` | `ADMIN_ACCESS`, `ADMIN_ACCESS_END` (07 P4); `entityId` is the support view's id | the firm |
| `password_reset_request` | 07 Q54, existing actions only: `CREATE` (the request, actor `SYSTEM`: it comes from a signed-out page), `STATE_CHANGE` (approved or denied, under the approver's name, a Super Admin's included; expired, `SYSTEM`), `UPDATE` (a fresh link, under the approver's name); completed, `STATE_CHANGE`, `SYSTEM`. `entityId` is the request's id; no entry holds a link or token | the requester's firm |

#### Decisions — answers to the 17 open questions (2026-10-14)

| A# | Topic | Decision | Lands in |
|---|---|---|---|
| 1 | Seat | every active firm user counts; pending invites reserve a seat; `seatsUsed` = active users + pending invites, derived | *Derived* table |
| 2 | Active candidate | status `ON_BENCH`, `INTERVIEWING` or `OFFER`; derived | *Derived* table |
| 3 | Plan vs firm limits | copy, don't override; `Firm` holds the effective limits; editing a plan never changes existing firms | `Plan`, `Firm` |
| 4 | Over limit | block new additions with a message naming the limit; never auto-remove; downgrades leave existing users working; admin list shows a derived "over limit" flag | Over-limit rule |
| 5 | Trial / lifecycle | no TRIAL now (add with billing); ONBOARDING → ACTIVE when the owner accepts; only Super Admin suspends or reactivates | `Firm.status` |
| 6 | Firm profile | add `contactPhone: string \| null` only; owner = primary contact, derived; GST, billing email, address deferred | `Firm` |
| 7 | Slug | rules in `Firm`; Super Admin may change it behind a confirm dialog; no alias or redirect table | `Firm.slug` |
| 8 | Suspended firm | users can still sign in and see the suspended screen | `Firm.status`, 07 §2.5 |
| 9 | Invite lifetime | 7 days; resend keeps the row, new token, `expiresAt` + 7 days; UI may treat past-due PENDING as EXPIRED | `Invite` |
| 10 | Owner and roles | exactly one OWNER per firm; an OWNER invites MANAGER, BDE or VIEWER, not OWNER; ownership transfer is Super Admin, out of scope; no VIEWER cap beyond seats | `Invite` |
| 11 | Platform staff | any `PLATFORM_ADMIN` invites staff; only platform role; refinement `firmId` null ⇔ `PLATFORM_ADMIN` | `Invite` |
| 12 | Support view | fixed 60 minutes, no extension (start a new view); firm sees admin's name and the reason as written, not the email | `SupportView` |
| 13 | Ledger `firmId` | firm events carry the firm's id and show in `/[firm]/ledger`; null only for platform-only events; `/admin/audit` shows all | Ledger rule |
| 14 | Plan history | no `PlanChange` entity; derived from `PLAN_CHANGED` entries whose summary has before and after | Ledger actions |
| 15 | `Plan.features` | display labels only | `Plan` |
| 16 | `planId` | required in every status, ONBOARDING included | `Firm` |
| 17 | Agent / tailoring runs | firm-scoped: add `firmId` | `firmId` table |

#### Implications — approved 2026-10-16

These follow from the answers above but the owner did not state them. Each is drafted as the
obvious reading and marked **(approved 2026-10-16)** where it appears. Tell me if any is wrong.

1. **Expired invites free their seat.** A1 says pending invites reserve a seat and A9 says a past-due
   PENDING invite may be treated as EXPIRED, so an expired invite stops reserving one.
2. **The one OWNER is invited by a Super Admin** at firm creation (A10 says an OWNER cannot invite an
   OWNER, and A5 says the firm turns ACTIVE when the owner accepts). So `Invite.role = 'OWNER'` with a
   `PlatformUser` as `invitedByUserId` is valid, and the "not OWNER" rule applies to firm-user inviters.
3. **Plan catalogue edits** (create or edit a `Plan`, `firmId` null) use the existing `CREATE` /
   `UPDATE` actions with `entityType: 'plan'` (lowercase, see *Ledger entity types*); no new action was requested.
4. **An unexpired PENDING invite blocks the one-OWNER rule too:** a firm cannot hold both an active
   OWNER and a pending OWNER invite.
5. **Reactivating a firm** (SUSPENDED → ACTIVE) is not blocked by over-limit. In A4, "reactivating"
   means a **user or candidate**, never the firm; the block applies to new additions only.

---

### 3.2 System contracts — APPROVED, NOT BUILT (2026-10-19)

> **Status: approved, not built.** Every open question (S1–S12) was answered on 2026-10-19 (07 Q33, Q34)
> and the answers are applied below. **Nothing is built from it yet** — no schema, fixture, adapter or
> screen; `/admin/system` stays a placeholder and AI spend stays hidden on the overview until it is built
> (07 Q29, docs/04 §14.9).
>
> **Grounded in the backend** (JobNavigator, `backend/`), so the mapper has something to map:
> `GET /health` (status + version, no DB), `scrape_log` (one row per search/company scrape:
> `jobs_found`, `new_jobs`, `error`, `is_warning`, `source_breakdown`, `duration_seconds`, `ran_at`),
> `job_runs` (scheduled jobs: `job_type`, `trigger`, `status`, times, `error`) and `llm_call_log`
> (`purpose`, `provider`, `model`, input/output/cache tokens, `cost_usd` float, `duration_ms`,
> `success`, `job_id`). **None of them carries a firm** — the backend is single-tenant (D1/D2).

All three are **platform data**: read by `PLATFORM_ADMIN` on `/admin/system` only, never shown to a
firm. Every total on that page is **derived** from these rows (CLAUDE.md), never stored.

#### HealthCheck — is each part of the system working?

```ts
export const HealthComponent = z.enum([
  'API',            // the FastAPI process (GET /health today)
  'DATABASE',       // Postgres reachable
  'SCRAPER',        // the last scraper run (rule below)
  'LLM_PROVIDER',   // the AI provider reachable
]);                 // S1 (answered, 07 Q33): only what the backend can actually report — nothing invented

export const HealthStatus = z.enum(['OK', 'DEGRADED', 'DOWN', 'UNKNOWN']);
// UNKNOWN = no check result yet, or the check itself failed to run

export const HealthCheckSchema = z.object({
  component: HealthComponent,
  status: HealthStatus,
  checkedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative().nullable(),
  /** Short, human, no secrets or stack traces: "3 consecutive empty scrapes on LinkedIn". */
  detail: z.string().nullable(),
  /** Backend version for API; null elsewhere. */
  version: z.string().nullable(),
});
```

- **History (S2) and retention (S7):** checks are stored and kept **30 days**; `/admin/system` shows each
  component's current status and its uptime over 7 and 30 days, derived from the stored checks.
- **`SCRAPER` reports the last run** (S1: what the backend can report): `OK` when the latest ScraperRun
  succeeded, `DEGRADED` when it was a warning, `DOWN` when it failed, `UNKNOWN` before any run; `detail`
  names the run and its time.

#### ScraperRun — one scrape of one search or company

```ts
export const ScraperRunSchema = z.object({
  id: z.string(),
  /** S5 (answered, 07 Q33): the firm when the run was for a firm; null for a shared run. */
  firmId: z.string().nullable(),
  target: z.object({
    kind: z.enum(['SEARCH', 'COMPANY']),
    id: z.string().nullable(),       // null once the search/company is deleted (the backend keeps the row)
    label: z.string(),               // "Java developers · Dallas" / "Acme Corp careers"
  }),
  trigger: z.enum(['SCHEDULED', 'MANUAL']),
  status: z.enum(['SUCCEEDED', 'WARNING', 'FAILED']),   // WARNING = backend is_warning (one board empty)
  jobsFound: z.number().int().nonnegative(),
  newJobs: z.number().int().nonnegative(),
  /** Per board, for multi-board runs; empty for a single-source scrape. */
  sources: z.array(z.object({
    board: z.string(),                // "indeed", "linkedin", "zip_recruiter"
    seen: z.number().int().nonnegative().nullable(),
    new: z.number().int().nonnegative().nullable(),
    error: z.string().nullable(),
  })),
  error: z.string().nullable(),        // human summary, no stack trace
  startedAt: z.string().datetime(),
  durationSeconds: z.number().nonnegative().nullable(),
});
```

**Retention (S7, answered):** scraper runs are kept **90 days**.

#### AiUsage — one call to an AI model

```ts
export const AiPurpose = z.enum([
  'RESUME_TAILOR',      // the tailoring agent (AgentDraft.runId)
  'JOB_SCORE_FULL',     // backend purpose "score_full"
  'JOB_SCORE_LIGHT',    // "score_light"
  'EMAIL_CLASSIFY',     // "email"
  'RESUME_REWRITE',     // resume text rewrite: the studio's "Ask AI"
  'RESUME_PARSE',       // resume parsing on upload
  'JOB_PARSE',          // job description parsing on capture
  'OTHER',
]);                     // S8 (answered, 07 Q34): this list, OTHER allowed

export const AiUsageSchema = z.object({
  id: z.string(),
  /** A17 + S6 (answered, 07 Q33): every AI usage row carries its firm — required, never null. */
  firmId: z.string(),
  purpose: AiPurpose,
  provider: z.string(),                 // "anthropic"
  modelId: z.string(),                  // "claude-sonnet-5-5"
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  /**
   * Cost in **micro-US-dollars** (1 USD = 1,000,000), an integer, so sums never drift (S3, answered: USD,
   * whole micro-dollars; the backend stores a float `cost_usd`, the mapper converts). S4 (answered): the
   * backend prices each call at call time from the provider's price list; the frontend never prices.
   */
  costMicroUsd: z.number().int().nonnegative(),
  /** The run this call belongs to (AgentDraft.runId), if any. */
  runId: z.string().nullable(),
  jobId: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  success: z.boolean(),
  createdAt: z.string().datetime(),
});
```

**Retention (S7, answered):** AI usage rows are kept **13 months**.

**Derived, never stored** (all on `/admin/system` and, once approved, the overview's AI spend group):

| Value | Definition |
|---|---|
| Spend in a period | sum of `costMicroUsd` over the period's rows; failed calls count when the provider billed them (S12). Periods ("this month") are IST calendar periods (S11) |
| Spend by firm | the same, grouped by `firmId` (always set, S6) |
| Spend by model | grouped by `modelId` |
| Tokens by purpose | sums of the four token counts, grouped by `purpose` |
| Scraper health | the `SCRAPER` rule above (the last run) |

#### Questions for sign-off — all answered (07 Q33, Q34)

| # | Question | Draft default |
|---|---|---|
| S1 | Which health components exist? | **Answered (07 Q33):** only what the backend can report — `API`, `DATABASE`, `SCRAPER` (last run), `LLM_PROVIDER` (reachability). Nothing invented |
| S2 | Keep health history (for uptime over time), or current state only? | **Answered (07 Q34):** keep the 30 days S7 retains; show uptime over 7 and 30 days per component |
| S3 | Currency and unit for AI cost | **Answered (07 Q33):** USD, stored as whole micro-dollars |
| S4 | Who prices an AI call? | **Answered (07 Q34):** the backend, at call time, from the provider's price list; the frontend never prices |
| S5 | Are scrapes firm-scoped or platform-wide? | **Answered (07 Q33):** `firmId` when the run was for a firm; null for a shared run |
| S6 | Can an AI call have no firm? | **Answered (07 Q33):** no — every AI usage row carries `firmId` (required) |
| S7 | Retention | **Answered (07 Q33):** AI usage 13 months; scraper runs 90 days; health checks 30 days |
| S8 | The full list of AI purposes; is `OTHER` acceptable? | **Answered (07 Q34):** resume tailoring, full job scoring, light job scoring, email classification, resume text rewrite (studio "Ask AI"), resume parsing (upload), job description parsing (capture), and `OTHER` |
| S9 | Is AI spend ever shown to a firm? | **Answered (07 Q34):** no — Super Admin only |
| S10 | Budgets or alerts now? | **Answered (07 Q34):** not now |
| S11 | Time zone for period boundaries | **Answered (07 Q34):** IST, like the rest of the admin area |
| S12 | Do failed AI calls count in spend? | **Answered (07 Q34):** yes, when the provider billed them |

### 3.3 Firm working rhythm — DRAFT, awaiting sign-off (2026-10-19)

> **Status: draft for the product owner's sign-off.** Nothing is built from it. Until it is approved,
> `settings/firm` shows **"Not set"** for both values, never an invented one (Phase B audit W7).

Two additions to `FirmSchema` (§3.1). Both are set when a firm is created (to the defaults below) and
edited by the OWNER on `settings/firm`; a support view reads them.

```ts
// src/lib/schemas/tenancy.ts — FirmSchema additions (draft)
const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);   // "HH:MM", 24-hour

shiftWindow: z.object({
  start: ClockTime,                       // default "18:30"
  end: ClockTime,                         // default "00:30"; end earlier than start = crosses midnight
}),                                       // read in the firm's primaryTimezone (no timezone of its own)

followUpCadence: z.array(z.object({
  dayOffset: z.number().int().min(1).max(30),   // days after the application is submitted
  channel: OutreachChannel,                      // §2 enum
})).min(1).max(5),                               // ascending dayOffset, no duplicates
// default: [{ dayOffset: 3, channel: 'LINKEDIN_MESSAGE' }, { dayOffset: 7, channel: 'EMAIL' }]
```

| Value | Default | Rules |
|---|---|---|
| `shiftWindow` | 18:30 – 00:30 in `primaryTimezone` | Times only; the window may cross midnight; start ≠ end. Shown with the timezone's abbreviation (IST for the beachhead) |
| `followUpCadence` | day 3 LinkedIn message, day 7 email | 1–5 steps, ascending, offsets 1–30 days; one channel per step |

**Questions with this draft** (proposed answers in brackets):

1. **Existing follow-ups when the cadence changes.** *(Proposed: only follow-ups created after the change
   use the new cadence; existing ones keep their dates.)*
2. **`FollowUpKind` (`DAY_3_LINKEDIN`, `DAY_7_EMAIL`, `CUSTOM`).** *(Proposed: keep the enum; a step that
   matches a default kind uses it, any other step creates `CUSTOM`. No enum change.)*
3. **What the shift window drives.** *(Proposed: display only for now — the focus-mode timer and the
   "shift" range on dashboards read it; nothing is blocked outside the window.)*
4. **Ledger.** *(Proposed: editing either logs `UPDATE` with `entityType: "firm"`, as other firm edits do.)*

### 3.4 Firm hierarchy — APPROVED 2026-10-26 (07 Q40–Q51)

> **Status: approved by the product owner on 2026-10-26** (07 §0 Q40–Q50; Q51 on 2026-10-27). Plan and modules:
> `docs/candidate-onboarding/`. **Schemas in onboarding module 01; the derivations (seats, limit, load) change in
> module 02.** The Q50 fields (`workSettings`, `preferredLocations`, `contactNotes`) are final since migration 0015 (2026-11-04).

The firm's layers are fixed: **OWNER → MANAGER → BDE → candidate** (Q40).

```ts
// src/lib/schemas/session.ts — UserSchema (base) gains:
managerId: z.string().nullable(),      // the MANAGER this BDE reports to. null for every non-BDE. A BDE has one,
                                       // except a BDE from before the hierarchy, null until the OWNER sets one (Q51)

// src/lib/schemas/tenancy.ts — InviteBaseSchema gains:
managerId: z.string().nullable(),      // the BDE's manager-to-be (Q40). null for non-BDE invites. A new BDE invite
                                       // always names one (checked when sent); an older one may be null (Q51)

// src/lib/schemas/session.ts — FirmSchema gains:
bdeCapacity: z.number().int().positive().default(10),   // comfortable load per BDE: a warning, never a block (Q46)
```

`UserSchema` and `InviteSchema` are refined like `InviteSchema` already is (a base object plus `superRefine`):
only a BDE (user or invite) has a `managerId`. That a **new** BDE or BDE invite has one, and that it is an active
MANAGER of the same firm, is a store/backend check: users and invites from before the hierarchy may lack one (Q51).

**Derived, never stored** (replaces the seat and candidate rows of §3.1's table):

| Value | Definition |
|---|---|
| `seatsUsed` | active users **with role BDE** + pending, unexpired invites **with role BDE** (Q44). OWNER, MANAGER and VIEWER are free and unlimited; `seatLimit` means BDE seats |
| working statuses | `ON_BENCH`, `INTERVIEWING`, `OFFER` (Q45). One list in `src/lib/derive/tenancy.ts` |
| assigned candidates | candidates with a BDE (`bdeId` not null) **and** a working status. What `candidateLimit` counts (Q45). Creating a candidate is never blocked; assigning a BDE is, at the limit |
| BDE load | a BDE's candidates in a working status, against `Firm.bdeCapacity` (Q46) |

Ledger: `ASSIGN` (`entityType: "candidate"`) whenever a candidate's manager or BDE is set or changed, summary
"Assigned to {BDE} ({manager})" or "Handed to {manager}", with "(from {previous})" on a move; its `note` is the
handoff note. Changing a BDE's manager logs `UPDATE` on the `user`.

---

## 4. Candidate

```ts
// src/lib/schemas/candidate.ts

/** JobNavigator-aligned: reusable Q&A pairs — this is the prefill panel. */
export const QaBankEntrySchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  category: z.enum([
    'WORK_AUTH', 'COMPENSATION', 'AVAILABILITY', 'RELOCATION',
    'EXPERIENCE', 'BEHAVIOURAL', 'OTHER',
  ]),
  useCount: z.number().int(),
  lastUsedAt: z.string().datetime().nullable(),
});

export const CandidateSchema = z.object({
  id: z.string(),
  firmId: z.string(),

  fullName: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().url().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),   // from the active base résumé (07 Q57); null when it names none; never defaulted
  willingToRelocate: z.boolean(),

  workAuth: WorkAuth,
  workAuthExpiry: z.string().datetime().nullable(),
  needsSponsorship: z.boolean(),
  needsTransfer: z.boolean(),

  employmentTypes: z.array(EmploymentType),
  rateMin: z.number().nullable(),
  rateTarget: z.number().nullable(),

  status: CandidateStatus,
  benchStartDate: z.string().datetime().nullable(),
  availableFrom: z.string().datetime().nullable(),
  noticePeriodDays: z.number().int().nullable(),

  yearsExperience: z.number().nullable(),
  primaryRole: z.string().nullable(),
  targetRoles: z.array(z.string()),

  managerId: z.string(),                 // the candidate's MANAGER. Always set (07 Q41)
  bdeId: z.string().nullable(),          // the one BDE (Q42); null = "Needs a BDE". When set, that BDE's
                                         // managerId equals managerId

  workSettings: z.array(RemoteMode),     // remote / hybrid / on-site, several allowed (Q50, final)
  preferredLocations: z.array(z.string()), // "City, ST"
  contactNotes: z.string().nullable(),   // how to reach them, interview windows ("Notes for the BDE")
  preferredIndustries: z.array(z.string()), // step 4 (was inside `persona`, dropped in 0015)
  dealBreakers: z.array(z.string()),     // step 4 (same)

  qaBank: z.array(QaBankEntrySchema),     // always [] on the backend since 0019 (no `candidates.qa_bank`; each résumé
                                         // version's `autofill` instead, §8.1); kept for the Documents tab until it goes

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * DERIVED — never stored in a fixture.
 * Computed in src/lib/derive/candidate-stats.ts from applications + events.
 */
export const CandidateStatsSchema = z.object({
  candidateId: z.string(),
  status: CandidateStatus,
  applicationsSubmitted: z.number().int(),
  distinctCompanies: z.number().int(),
  distinctRoles: z.number().int(),
  responsesReceived: z.number().int(),
  interviewsScheduled: z.number().int(),
  offersReceived: z.number().int(),
  applicationsOpen: z.number().int(),
  responseRatePct: z.number(),
  daysOnBench: z.number().int(),
  firstApplicationAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime().nullable(),
  isAtRisk: z.boolean(),                  // no activity in 7 days
  workAuthExpiringSoon: z.boolean(),      // < 90 days
});
```

**Writing a candidate** (07 Q41–Q43, Q48–Q49). `CreateCandidateSchema` is what the new-candidate flow sends;
`ReassignCandidateSchema` moves a candidate; `ResumeDraftSchema` is the parser's answer after the DTO mapper (it fills
the form and is never saved).

```ts
export const CreateCandidateSchema = CandidateSchema.pick({
  phone: true, linkedinUrl: true, city: true, state: true, yearsExperience: true,
  workAuth: true, workAuthExpiry: true, needsSponsorship: true, needsTransfer: true,
  employmentTypes: true, rateTarget: true, rateMin: true, availableFrom: true, noticePeriodDays: true,
  targetRoles: true, willingToRelocate: true, workSettings: true, preferredLocations: true, contactNotes: true,
}).extend({
  fullName: z.string().trim().min(1),
  primaryRole: z.string().trim().min(1),            // "Marketed as"
  email: z.string().trim().email(),                 // required in the flow (Q48)
  summary: z.string().trim().nullable(),
  skills: z.array(z.object({ name: z.string().trim().min(1), family: z.string().nullable() })),
  preferredIndustries: z.array(z.string()),
  dealBreakers: z.array(z.string()),
  resumeParseId: z.string().nullable(),             // the parse to keep; null = no résumé
  managerId: z.string().min(1),
  bdeId: z.string().nullable(),
  handoffNote: z.string().trim().max(1000).nullable(),
});

export const ReassignCandidateSchema = z.object({
  managerId: z.string().min(1),
  bdeId: z.string().nullable(),
  note: z.string().trim().max(1000).nullable(),
});

// src/lib/schemas/resume-draft.ts — every field null when the résumé didn't have it
export const ResumeDraftSchema = z.object({
  parseId: z.string(), fileName: z.string(),
  fullName: z.string().nullable(), primaryRole: z.string().nullable(), email: z.string().nullable(),
  phone: z.string().nullable(), linkedinUrl: z.string().nullable(), city: z.string().nullable(),
  state: z.string().nullable(), yearsExperience: z.number().nullable(),
  workAuth: WorkAuth.nullable(), workAuthText: z.string().nullable(),
  summary: z.string().nullable(),
  skills: z.array(z.object({ name: z.string(), family: z.string().nullable() })),
});
```

**Candidates final schema — 2026-11-04 (Zuhair; Abdul reviews with the PR), migration 0015.** `persona` is removed
from the candidate: `preferredIndustries` and `dealBreakers` are flat lists, `will_relocate` and `notice_period_days`
inside it were stale copies of `willingToRelocate` and `noticePeriodDays`, `toneNotes` was never filled, and the summary
is the active base résumé's (`resumes.summary`). `candidates.skills` and `summary_state` are removed too (the skills are the
active base résumé's). **BenchQ has no claim states (2026-11-05):** the `claims` and `evidence` tables are dropped in the
same migration, and the frontend's claim, evidence and export-gate types went in PR 7. `needsSponsorship` and
`needsTransfer` are required booleans: the new-candidate flow works them out from `workAuth` (H-1B, H4 EAD, OPT, CPT,
TN need sponsorship; H-1B needs a transfer; GC, GC EAD and US citizen send `false`; there is no `OTHER`, so both are
always known) and sends them; the backend
works nothing out and only checks that they were sent (a missing one is a 422 naming the field). An edit that changes
`workAuth` must carry both. Required on create, in the form and in the backend alike: `fullName`, `primaryRole`, `email`,
`phone`, `yearsExperience`, `country` (any country; the flow's Country box starts empty, takes the parsed résumé's
country, else the person types one, so a TN candidate from Canada or Mexico is saved as such), `workAuth`, `needsSponsorship`, `needsTransfer`,
`employmentTypes` (at least one), `targetRoles` (at least one), `managerId`; a MANAGER also names the BDE. `resumeParseId` is required: no candidate without their résumé (07 Q58), whose file becomes their first base.

**No default country — 2026-11-07 (Zuhair; raised by Abdul in the PR 7 review, #5, and approved in his re-review).**
BenchQ never invents a country. `Candidate.country` is the active base résumé's (07 Q57) and is `null` when that résumé
names none; the API sends `null`, never `"US"`. On create the country is required: the form starts empty, takes the
parsed résumé's country, else the person types it ("USA", "United States" and the like are sent as `US`). The Job
schema's own `country` default (§6) is a separate contract and is unchanged.

`ResumeDraftSchema` gains `country` with the new parser (§8.1). The skills a new candidate is created with go into
the first base résumé's version 1 (`resumes.skills`); they carry no source or state.

---

## 5. The Record

```ts
// src/lib/schemas/record.ts

export const RecordBulletSchema = z.object({
  id: z.string(),
  text: z.string(),
});

export const RecordExperienceSchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable(),
  isCurrent: z.boolean(),
  bullets: z.array(RecordBulletSchema),
  technologies: z.array(z.string()),
  sortOrder: z.number().int(),
});

export const RecordSkillSchema = z.object({
  id: z.string(),
  name: z.string(),                        // as stated
  canonicalName: z.string(),               // after taxonomy collapse
  family: z.string().nullable(),
  yearsUsed: z.number().nullable(),
  lastUsedYear: z.number().int().nullable(),
  proficiency: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).nullable(),
});

export const RecordEducationSchema = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
});

export const RecordCertificateSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string().nullable(),
  issueDate: z.string().datetime().nullable(),
  expiryDate: z.string().datetime().nullable(),
  credentialId: z.string().nullable(),
  credentialUrl: z.string().url().nullable(),
});

export const RecordSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  experiences: z.array(RecordExperienceSchema),
  educations: z.array(RecordEducationSchema),
  skills: z.array(RecordSkillSchema),
  certificates: z.array(RecordCertificateSchema),
});

/** DERIVED — computed, never stored. */
export const RecordCompletenessSchema = z.object({
  percent: z.number().int().min(0).max(100),
  missing: z.array(z.object({
    field: z.string(),
    label: z.string(),                     // "no end date on Infosys"
    severity: z.enum(['BLOCKER', 'IMPORTANT', 'MINOR']),
  })),
});
```

---

## 6. Company & Job

```ts
// src/lib/schemas/company.ts

/** JobNavigator-aligned: LCA / H-1B sponsorship data. Central to bench sales. */
export const H1bDataSchema = z.object({
  sponsorsH1b: z.boolean().nullable(),
  lcaCount: z.number().int().nullable(),
  lcaYear: z.number().int().nullable(),
  medianLcaWage: z.number().nullable(),
  topLcaTitles: z.array(z.string()),
  dataSource: z.string().nullable(),       // e.g. 'MyVisaJobs'
  lastCheckedAt: z.string().datetime().nullable(),
});

export const VerificationRuleSchema = z.object({
  rule: z.string(),                        // 'WEBSITE_LIVE'
  label: z.string(),                       // 'Website responds'
  passed: z.boolean(),
  observed: z.string().nullable(),         // '200 OK'
});

export const CompanyVerificationSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  verdict: VerificationVerdict,
  rules: z.array(VerificationRuleSchema),
  firedRule: z.string().nullable(),        // the rule that produced a non-VERIFIED verdict
  isManual: z.boolean(),
  overrideReason: z.string().nullable(),
  checkedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  normalisedName: z.string(),
  domain: z.string().nullable(),
  websiteUrl: z.string().url().nullable(),
  linkedinUrl: z.string().url().nullable(),
  employeeBand: z.enum(['1-10','11-50','51-200','201-500','501-1000','1000+']).nullable(),
  hasUsPresence: z.boolean().nullable(),
  clientType: ClientType,
  atsProvider: z.string().nullable(),
  h1b: H1bDataSchema.nullable(),
  verification: CompanyVerificationSchema.nullable(),
});
```

```ts
// src/lib/schemas/job.ts

/** JobNavigator-aligned: dual-hash dedup, tracking params stripped before hashing. */
export const JobDedupeSchema = z.object({
  urlHash: z.string(),
  contentHash: z.string(),
  canonicalUrl: z.string().url().nullable(),   // after param stripping
  duplicateOfJobId: z.string().nullable(),
});

export const JobProvenanceSchema = z.object({
  sourceType: JobSourceType,
  sourceId: z.string(),                    // 'greenhouse' | 'jsearch' | 'extension' | 'manual'
  sourceUrl: z.string().url().nullable(),
  legalBasis: LegalBasis,
  capturedByUserId: z.string().nullable(),
  ingestedAt: z.string().datetime(),
});

export const JobRequirementSchema = z.object({
  id: z.string(),
  kind: RequirementKind,
  category: z.enum(['SKILL','CERTIFICATION','EXPERIENCE_YEARS','EDUCATION','CLEARANCE']),
  value: z.string(),
  canonicalValue: z.string().nullable(),
  isBlocker: z.boolean(),
});

export const JobSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  company: CompanySchema,                  // denormalised for the feed

  title: z.string(),
  normalisedTitle: z.string(),
  description: z.string(),

  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().default('US'),
  remoteMode: RemoteMode,

  employmentType: EmploymentType.nullable(),
  rateMin: z.number().nullable(),
  rateMax: z.number().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),

  allowedWorkAuth: z.array(WorkAuth),
  excludesC2C: z.boolean(),

  postedAt: z.string().datetime().nullable(),
  applicantCount: z.number().int().nullable(),
  applyUrl: z.string().url().nullable(),

  requirements: z.array(JobRequirementSchema),
  dedupe: JobDedupeSchema,
  provenance: JobProvenanceSchema,

  isActive: z.boolean(),
});
```

---

### 6.x JobMark — a person's saved and hidden jobs (approved 2026-10-20, Phase B fix PR 2)

> **Approved 2026-10-20** by the product owner ("per person"). The job explorer's Save and Hide, and Save on
> the job page, used to live in component state and vanish on reload (audit W3).

```ts
// src/lib/schemas/job.ts
export const JobMarkKind = z.enum(['SAVED', 'HIDDEN']);

export const JobMarkSchema = z.object({
  id: z.string(),
  firmId: z.string(),                      // firm-scoped like every firm record
  userId: z.string(),                      // → User.id: marks are personal
  jobId: z.string(),                       // → Job.id, a job of the same firm
  kind: JobMarkKind,
  createdAt: z.string().datetime(),
});
```

- **Personal.** Each user sees and changes only their own marks; a BDE's hides never hide a job from anyone
  else. One mark per `(userId, jobId, kind)`; a job may be both saved and hidden.
- **Who:** the acting roles, by the existing `job.apply` action (OWNER, MANAGER, BDE). A VIEWER and a support
  view see no Save / Hide and the backend refuses the writes (403). A support view reads no marks (they belong
  to people, not to the firm's work).
- **Not in the ledger:** personal triage, like reading an email.
- Separate from `Match.isShortlisted` / `isDismissed` (§7), which are about one candidate and job.
- Endpoints: `GET /api/job-marks` (the signed-in user's), `PUT /api/job-marks/:jobId/:kind`,
  `DELETE /api/job-marks/:jobId/:kind`.

### 6.y `job_postings` — the job-search module's own jobs table (decided 2026-11-09; migrations 0020, 0022, 0023; backend only, no frontend schema/screen yet)

> Zuhair's track. Deliberately **not** `jobs`: this is a separate, candidate+batch-scoped table
> (`backend/models/job_search.py`), not the existing shared-pool `jobs` table above (`backend/models/db.py`) or its
> `JobSchema`/`JobMarkSchema` frontend contracts. One row per job a search found for one candidate — `(candidate_id,
> job_id)` is unique, so the same posting content found again for the same candidate updates the existing row
> (`batch_id`, `last_seen_at`) instead of inserting a duplicate. So `batch_id` is **the last batch that found the
> job**, not its batch history; "which jobs did batch X find" leaves out jobs a later batch found again. A
> membership table is the answer if a screen ever needs that history.

- **Columns (revised 2026-11-10, from Abdul's review):** `id`, `firm_id`, `candidate_id`, `batch_id`, `source`,
  `first_source` (0023: how the job was first saved, never changed), `job_id`, `content`, `discovered_at`,
  `last_seen_at`, `created_at`, `updated_at`.
  - **No `status` column.** Whether a job was saved or applied to lives in `applications` (its `saved` status, and
    an application row), so a copy here can't drift from it. Hiding a job (dismissed) isn't built.
  - **Tenancy:** `(firm_id, candidate_id)` references `candidates (firm_id, id)` (on `scrape_jobs` too), so a row
    can't carry a firm other than its candidate's; `candidates` gets `UNIQUE (firm_id, id)` for it.
  - **`(firm_id, candidate_id, batch_id)` references the same three on `scrape_jobs`** (unique together there), so
    a posting can only name a batch run for its own candidate in its own firm, never another candidate's or another
    firm's (Abdul's review, 2026-11-10). On a successful batch the ingestion code writes the `scrape_jobs` row and
    the postings in one transaction, the batch row first, so a crash leaves neither.
  - **`job_id` is checked:** `CHECK (job_id ~ '^[0-9a-f]{64}$')`, lower-case SHA256 hex, so a raw board id or a
    truncated or upper-case hash is refused instead of silently breaking dedup.
  - **Indexes:** the unique `(candidate_id, job_id)` (dedup, and lookups by candidate) and
    `(firm_id, candidate_id, batch_id)` (one candidate's list in a firm, a firm's list, and the batch key, by its
    leading columns). Nothing looks up by the hash alone. On `scrape_jobs`, the unique `(firm_id, candidate_id,
    batch_id)` serves a candidate's batches the same way.
- **Identity (revised 2026-11-09):** `job_id` (SHA256 of normalized company + title + full job description; a
  content hash, not an id from the job board, and not the row's primary key `id`)
  is the only identity key. A content change is treated as a new posting by design, so the board's own job id adds
  nothing to dedup and isn't stored (`source_id` was dropped before anything shipped). `source` records which
  provider the row came from.
- **Content (revised 2026-11-09): one `content` JSONB column, not separate typed columns.** Everything about the
  job — title, description, location, salary, seniority, skills, apply link, whatever a source sends — lives
  inside it. The original design (migration 0020, first cut) had a normalized core of typed columns plus a `raw`
  fallback, modeled on JSearch's `job-details` response; that's been replaced before anything shipped, because the
  set of sources isn't fixed to JSearch/freehire.me, and typed columns built around one source's fields would need
  a migration every time another aggregator is added or a source changes its response shape. `content`'s internal
  shape is the provider's, not this table's — so filtering/ranking on its fields (location, salary, seniority,
  skills) is a JSON-path query, not a plain `WHERE` on a column, and no CHECK constraint can cover anything inside it.
  **Revised 2026-11-10 (job search PR 1): `content` is the provider's own job object, as it arrived** (control
  characters stripped). Each provider's `read(content)` (`backend/job_search/providers/`) gives the common fields
  (title, company, plain-text description, http(s) apply link, location, countries, posted date, employment type,
  skills, closed), picked by `source`; nothing else looks inside `content`, and the API never returns it.
- **Repointed (migration 0023, job search PR 2, decided 2026-11-10):** `resumes (firm_id, candidate_id, job_id)` →
  `job_postings (firm_id, candidate_id, id)` ON DELETE CASCADE (a tailored résumé names its own candidate's job, and
  goes with it); `cover_letters.job_id`, `job_runs.target_job_id`, `llm_call_log.job_id` → `job_postings.id` ON
  DELETE SET NULL. `job_postings` has `UNIQUE (firm_id, candidate_id, id)` as the target. Nothing was copied (no real
  firm yet): the upgrade stops while a tailored résumé or a cover letter names an old job; the two logs are only
  unlinked. **The column names are kept, so `resumes.job_id` is a posting's `id`, while `job_postings.job_id` is
  the content hash.** `applications.job_id` moves in Samad's own PR (docs/team/samad.md §2 item 5); until then an
  application's job and its tailored résumé's job are in different tables, so the prep page and the tracker can't
  pair them (nothing creates a tailored résumé today; those tests are strict xfails).
- **Not yet built:** repointing
  `applications.job_id` / `job_runs.target_job_id` off the old `jobs` table onto this one. The old `jobs` table and
  everything still pointing at it (`candidate_jobs`, `favorite_jobs`, `firm_jobs`, `applications`, `job_runs`) is
  unchanged for now; retiring it and reclaiming the `jobs` name is a later migration once those are repointed.
- **Frontend contract:** none yet — the routes exist (below), but there is no adapter, DTO mapper, or screen (PR 2). `JobSchema`/`CompanySchema`
  above describe the existing mock-backed job explorer, not this table; reconciling (or replacing) that contract
  is separate, later work once this module starts serving real screens.
- **Second source, freehire.me (decided 2026-11-09, still applies under the `content` design):** target markets
  are US, Canada and India, so a posting can legitimately list more than one country/city (e.g. a remote NA role
  open to `["us", "ca"]`). Rather than a multi-location child table (the old `job_locations` pattern, dropped),
  `content` keeps the provider's full array and the country the search targeted is the batch's
  (`scrape_jobs.metadata.request.country`; revised 2026-11-10, since `content` is now the provider's object as sent). Cross-market queries ("all jobs open to India OR Canada at once") are out of scope; a candidate's
  search is always scoped to one target market. freehire.me's own `source` response field names the underlying ATS
  (e.g. `"successfactors"`) and maps to a publisher field inside `content`, the same role JSearch's `job_publisher`
  plays — not to this table's own `source` column, which holds the literal provider name (`"freehire"`). A closed
  posting is filtered out before it reaches this table; a posting that closes *after* being stored has no
  automatic signal and stays visible until something else catches it — accepted for now, revisit with a staleness
  rule if it becomes a real problem.
- **`scrape_jobs` (migration 0020, with `job_postings`):** one row per batch — `firm_id`, `candidate_id`,
  `user_id` (migration 0022: who ran it, the candidate's BDE; FK `users.id`, NOT NULL), `kind` (migration 0023:
  `search` | `capture`), `batch_id` (unique),
  `state` (revised 2026-11-10: `success`, the source answered with at least one job | `empty`, it answered with
  none | `error`, it failed), `error` (text, the failure detail, set exactly when `state = 'error'`: a real failure
  and an empty result never look the same), `metadata` (JSONB, `{}` by
  default: everything in the source's response except the jobs themselves, such as request id, parameters and
  totals, stored once per batch rather than on every job row), `created_at` (when it started), `finished_at`
  (migration 0022). **Revised 2026-11-10 (Q18): the search runs in the background, so its row is written `running`
  when the BDE starts it** and finished in place (`success` / `empty` / `error`); `finished_at` is set exactly when
  it isn't running (`ck_scrape_jobs_finished_iff_done`). "Is a search running", the attempt count and the history
  read this table, not `job_runs`. A row still `running` after 15 minutes was lost (a restart): the BDE's next search
  marks it `error` (`internal`), and reads show it as that error without writing. The batch carries its `run_id`;
  the search's `job_runs` row (the background launcher's own record) names nothing of the firm's, no `meta` and the
  opaque `batch_id` as its scope, because Super Admin's monitor lists runs across firms without a support view
  (Abdul's review, P1). `metadata` also carries
  `request` (`query`, `country`, `provider`, `limit`), `counts` (`found`, `saved`, `refreshed`, `skipped_closed`,
  `skipped_unreadable`, `skipped_duplicate`, `skipped_over_cap`) and, on an error, `error_code`; `error` is
  `"<code>: <safe message>"`, never the source's body or URL. One row per batch, not per source: freehire.me is the
  only live source, so there's nothing to break down yet; a per-source breakdown becomes a real question again
  once a second source goes live alongside it.

- **The search pipeline (job search PR 1, decided 2026-11-10):**
  - **Who:** only the candidate's assigned BDE (`job.search`, BDE role, plus `bde_id` = the user: `can_search_jobs`);
    nobody while the candidate has no BDE. Reads: anyone who can see the candidate.
  - **Input:** `query` (1–100 characters, one role per search, no control characters: NUL, tab or a line break
    inside it is 422 with nothing written; Abdul's second review, P2). The country is the candidate's résumé country
    (`Candidate.country`: the active base, newest version) mapped to `us` / `ca` / `in`; empty or anything else is
    422, never a default.
  - **Provider:** a registry by name; the active one is the global setting `job_search_provider` (default
    `freehire`), a PLATFORM setting (`settings_scope.py`) that `PATCH /api/settings` takes only as a registered
    provider. Every search asks for 100 jobs. One call: 20 s limit, one retry after 2 s on a timeout, a dropped
    connection, 5xx or 429; 5 MB cap; no redirects. Error codes: `timeout`, `provider_unavailable`,
    `provider_rejected`, `bad_response`, `too_large`, `internal`.
  - **Background:** `POST` commits the batch `running`, then launches the search through
    `job_monitor.launch_background` (four at once per worker) and returns 202 `{batch_id, run_id}`; a launch that
    fails deletes the batch (503, not an attempt). The task asks the source only while its batch exists and is
    `running` (Abdul's second review, P2), and finishes it. The admission (its locks and checks) runs in a worker thread,
    never on the event loop, so waiting for a lock can't stall other requests (Abdul's comment on PR 2). One search per candidate at a
    time (409), checked from the `running` row with the candidate row locked, so it holds across workers. The BDE
    is locked too (a Postgres advisory lock on their id, after the candidate), so two of their searches for
    different candidates count the 20 attempts in turn (Abdul's review, P2).
  - **Caps (per day from 6:30 PM IST):** 100 **new** jobs per candidate (a job seen again only refreshes its row);
    20 attempts per BDE, any outcome. Over either is 429 up front, nothing written. A search that reaches the
    candidate's 100 keeps the provider's order and drops the rest (`skipped_over_cap`).
  - **Saving:** closed and unreadable jobs (no title, company or description) and repeats within the reply are
    dropped. One transaction with the candidate row locked: the `scrape_jobs` row, then each job — one the candidate
    has gets `batch_id`, `last_seen_at`, `content` and `source` replaced (`discovered_at` kept); a new one is inserted
    while there is room — then one ledger entry (`CREATE`, entity `job_search`, every outcome: success, empty,
    error, and a lost search when it is written as `internal`, with its `error_code`, credited to the BDE who started
    it). The firm's ledger shows the role and country; a platform admin's (the audit, a support view) shows
    "Searched jobs (content restricted)." (`ledger_entry_json`, Abdul's second review, P2).
  - **Routes** (`backend/api/routes_job_search.py`, under `/api/firms/{firm_id}/candidates/{candidate_id}`):
    `POST /job-searches`, `GET /job-searches` (`running`, `searches` newest first, `usage`: `jobs_saved_today`,
    `jobs_cap`, `attempts_today`, `attempts_cap`, `resets_at`), `GET /job-postings?page=&size=` (newest first,
    common fields, no description), `GET /job-postings/{posting_id}` (with the description).
  - **Captures (job search PR 2):** `POST /job-postings` `{source: manual | extension, title, company,
    description, url, location?}` (title and company 1–300 characters, description 1–100,000, an http(s) link; no
    control characters, the description keeping its tabs and line breaks): the candidate's BDE only, 20 per BDE per
    day. A capture is its own batch (`scrape_jobs.kind = 'capture'`, finished at once) with one posting and a ledger
    entry (entity `job_posting`, restricted for a platform admin like a search's); the same job again (same hash) returns the posting the candidate has
    (200), even at the cap: only a capture that would create a posting counts against the 20 (Abdul's comment on PR
    2). An `extension` description is read as HTML. Captures aren't search attempts and don't use the 100-new cap.
    A search that finds a captured job merges into that row (`source` and `content` become the provider's), and it
    still stays out of the 100: the cap counts `first_source`, which never changes (Abdul's comment on PR 2).
  - **A repeated search continues (job search PR 2):** a provider returns `next_cursor`; the same role (case and
    spacing ignored), country and provider searched again since 6:30 PM IST asks from there (freehire.me: `offset`).
    A failed search doesn't move it. When the source has no more, the next search of that role ends `empty` without
    asking (`metadata.request.exhausted`). The next day starts from the top.
  - **The old pool (job search PR 2):** its scheduled scrape is no longer scheduled, and its write routes answer 410
    (`backend/job_search/retired.py`): manual / extension / LinkedIn job saves, PATCH a job, analyze, the scrape and
    backfill triggers, a search's run and test, a company's test scrape, cover letter create and generate. Its read
    routes still answer. The clean-up PR deletes it.
  - **Known limit:** the search runs in the API process. A restart loses a search in flight (its batch shows as an
    `internal` error after 15 minutes and the BDE searches again); a real job queue is the deployment work's.

## 7. Matching & scoring

```ts
// src/lib/schemas/match.ts

export const MatchComponentsSchema = z.object({
  skillOverlap: z.number().min(0).max(1),
  titleSimilarity: z.number().min(0).max(1),
  seniorityFit: z.number().min(0).max(1),
  locationFit: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
});

/**
 * JobNavigator-aligned scoring record.
 * LIGHT runs on every match for ranking. FULL runs only when the BDE opens a job.
 */
export const ScoringRecordSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  depth: ScoringDepth,
  provider: z.string().nullable(),         // null for deterministic LIGHT
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),

  score: z.number().int().min(0).max(100),

  // FULL only — null on LIGHT
  keywordAnalysis: z.object({
    matched: z.array(z.string()),
    missing: z.array(z.string()),
    adjacent: z.array(z.string()),
    densityPct: z.number(),
  }).nullable(),

  requirementMapping: z.array(z.object({
    requirementId: z.string(),
    requirement: z.string(),
    kind: RequirementKind,
    match: RequirementMatch,
    evidenceId: z.string().nullable(),
    note: z.string().nullable(),
  })).nullable(),

  atsTips: z.array(z.object({
    severity: z.enum(['BLOCKER', 'IMPORTANT', 'MINOR']),
    message: z.string(),
    fix: z.string(),
  })).nullable(),

  computedAt: z.string().datetime(),
  latencyMs: z.number().int().nullable(),
});

export const MatchSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  job: JobSchema,                          // denormalised for the feed

  score: z.number().int().min(0).max(100),
  components: MatchComponentsSchema,
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  adjacentSkills: z.array(z.string()),

  scoring: ScoringRecordSchema.nullable(),

  isShortlisted: z.boolean(),
  isDismissed: z.boolean(),
  dismissReason: z.string().nullable(),
  hardFilterFailed: z.enum([
    'WORK_AUTH', 'COMPANY_REJECTED', 'ALREADY_APPLIED', 'DISMISSED',
  ]).nullable(),

  computedAt: z.string().datetime(),
});
```

---

## 8. Resume

```ts
// src/lib/schemas/resume.ts

/** JobNavigator-aligned: tracer link per resume/letter, with open + click tracking. */
export const TracerSchema = z.object({
  token: z.string(),
  url: z.string().url(),
  openCount: z.number().int(),
  clickCount: z.number().int(),
  firstOpenedAt: z.string().datetime().nullable(),
  lastOpenedAt: z.string().datetime().nullable(),
});

/** JobNavigator-aligned: tailoring history per job. */
export const TailoringSchema = z.object({
  targetJobId: z.string(),
  targetJobTitle: z.string(),
  targetCompanyName: z.string(),
  keywordsTargeted: z.array(z.string()),
  bulletsRewritten: z.number().int(),
  generatedBy: z.enum(['HUMAN', 'AGENT']),
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  generatedAt: z.string().datetime().nullable(),
});

/** One line of a version's text: the summary, or one bullet of a job or project. */
export const ResumeLineSchema = z.object({
  id: z.string(),
  resumeVersionId: z.string(),
  section: z.enum(['summary', 'experience', 'project']),
  entityId: z.string().nullable(),
  bulletIndex: z.number().int().nullable(),
  text: z.string(),
});

export const AtsIssueSchema = z.object({
  check: z.string(),                       // 'SEMANTIC_HTML'
  label: z.string(),                       // 'Uses semantic headings'
  passed: z.boolean(),
  severity: z.enum(['BLOCKER', 'IMPORTANT', 'MINOR']),
  message: z.string(),
  fix: z.string().nullable(),
});

export const ResumeVersionSchema = z.object({
  id: z.string(),
  resumeId: z.string(),
  versionNumber: z.number().int(),
  parentVersionId: z.string().nullable(),

  templateId: z.string(),
  includedSectionIds: z.array(z.string()),
  includedBulletIds: z.array(z.string()),
  bulletOverrides: z.record(z.string(), z.string()),

  atsScore: z.number().int().min(0).max(100).nullable(),
  atsGrade: z.enum(['A','B','C','D','F']).nullable(),
  atsIssues: z.array(AtsIssueSchema),

  keywordScore: z.number().int().min(0).max(100).nullable(),
  keywordsMatched: z.array(z.string()),
  keywordsMissing: z.array(z.string()),

  lines: z.array(ResumeLineSchema),
  tailoring: TailoringSchema.nullable(),
  tracer: TracerSchema.nullable(),

  pdfUrl: z.string().nullable(),
  docxUrl: z.string().nullable(),
  renderedAt: z.string().datetime().nullable(),

  changeSummary: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
});

export const ResumeSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  name: z.string(),
  isMaster: z.boolean(),
  targetJobId: z.string().nullable(),
  templateId: z.string(),
  versions: z.array(ResumeVersionSchema),
  latestVersionId: z.string(),
});
```

### 8.1 Résumé versioning — APPROVED 2026-10-31 (Abdul; `promotedFromResumeId`, `archivedAt` and `summaryId` 2026-11-02, versioning PR 5); `ResumeDraftSchema.country` BUILT (versioning PR 2); `BaseResume`, `baseResumeId`, `ResumeShelf`, `OpenedResume` BUILT (versioning PR 7); the studio's document in the parser's shape and `ResumeRemoval` BUILT (PR 7, for Abdul's sign-off); the version's `autofill` (`?autofill=true`) APPROVED 2026-11-08 (Abdul, issue 119), BUILT (PR 118)

Bases and versions (`docs/team/resume-versioning.md`). The backend keeps many bases per candidate, one active, and
every edit as a new row; the frontend keeps its `Resume.versions[]` model, filled by the DTO mapper.

**How a `Resume` maps to the backend:** one `Resume` is one `(base_resume_id, category, job_id)` group of `resumes`
rows. `isMaster` ← `category = 'BASE'`, `targetJobId` ← `job_id`, `templateId` ← `template`, `name` ← `name`,
`versions[]` / `versionNumber` ← the group's rows / `version`, `latestVersionId` ← the highest `version`, and
`ResumeVersion.parentVersionId` ← the previous version in the group (derived; there is no column).

**`autofill` (backend only, migration 0019; decided by Zuhair 2026-11-07, Abdul and Samad OK; this contract signed off
by Abdul 2026-11-08 in issue 119, the `key` added with his OK):** `GET …/resumes/{id}?autofill=true`, on the
candidate's route and on
`GET /firms/{firm}/resumes/{id}`, adds `autofill`: every question an application form can ask, each once. Two parts:

- **Fixed answers**, built from the version and the profile for that read (`backend/candidates/autofill.py` `build()`)
  and never stored as answers (an edit keeps a copy of the one it replaced, below): this version's header, summary,
  skills, every job with its dates and bullets, its education (the highest degree by the rules written in
  `autofill._level`, with that degree's school and year; a certificate listed under education isn't a degree),
  projects, awards, certifications and languages; and the profile's facts:
  work authorization (the profile's status, which every candidate has), its expiry, sponsorship, transfer,
  target rate, availability, notice, relocation, engagement types, work settings, preferred locations and industries,
  primary and target roles. Years of experience come from the version's own jobs, counted to today (the New candidate
  form's rule), else `years_experience`. A profile edit shows in every version at once; nothing is rewritten.
- **The user's entries**, stored in `resumes.autofill` (`{}` by default) as
  `{"edited": {key: {"answer": …, "over": …}}, "custom": {question: answer}}`. An edit to a fixed answer is kept by
  its question's key, so rewording a question never loses it, with `over`: a copy of the built answer it replaced (for
  a list such as the work history, the whole list). An edit applies while `over` is still the built answer, compared
  as JSON (85.0 is 85, but `true` isn't 1): once the version's own text or the profile changes that answer, the new
  built answer shows (so a yearly step in the years worked out ends an edit of the years too). So does a change to how
  the backend writes an answer (a label, a field of the jobs, the date format), unless that change also rewrites the
  stored `over` values. A question they added can't take a fixed question's wording; one whose words a fixed question
  takes later (a new question, or a reworded one) is kept and copied, and shows only while that fixed question has no
  answer. A save, a promote and tailoring (a tailored v1, 07 Q55) copy the entries, and on the new version an edit
  applies only where its built answer is still `over`; a new upload starts with none. Anything else stored (a value
  that isn't an object, or the first 0019's `{question: answer}` of built answers) reads as no entries.

Each entry is `{question, answer, kind, key?, built?}`:

| Field | What |
|---|---|
| `question` | As written once in `autofill.py`, or as the user typed it |
| `answer` | Its JSON type kept: text, a number, `true`/`false`, a list, a list of objects (jobs, education, projects, awards), a date as `"YYYY-MM-DD"` |
| `kind` | `FIXED` (built), `EDITED` (the user's entry for a fixed question), `CUSTOM` (a question the user added) |
| `key` | On `FIXED` and `EDITED`: what the question asks, a fixed name that doesn't change with the wording, so a reader (the extension) matches by it. A new question gets a new key |
| `built` | On `EDITED`: the built answer a reset gives back; `null` when the version and the profile don't answer it |

The keys, in order: `full-name`, `email`, `phone`, `linkedin-url`, `github-url`, `address-city`, `address-region`,
`address-country`, `professional-title`, `summary`, `work-auth-status`, `skills`, `current-company`, `current-title`,
`work-history`, `education-degree`, `education-school`, `graduation-year`, `education-history`, `projects`, `awards`,
`certifications`, `languages`, `work-auth-expiry`, `visa-sponsorship`, `visa-transfer`, `years-experience`,
`primary-role`, `target-roles`, `pay-rate`, `start-date`, `notice-period-days`, `relocation-willing`,
`employment-types`, `work-settings`, `preferred-locations`, `preferred-industries`. The fixed questions come first in
that order, then the user's. A missing fact leaves its question out. Never in it: ids, `rate_min`, `contact_notes`,
`deal_breakers`, `status`, `bench_start_date`. Not in the list, a save, or a read without `?autofill=true`. Writing the
user's entries (a route) is planned: it takes `over` from its own build, never from the request, and the request
carries the built answer the user was shown, so the route answers 409 when its own build differs (an edit is never
saved over an answer the user didn't see). Its contract goes here first. The frontend doesn't map `autofill` (no screen
shows it yet); the extension reads it (Arbaz).

```ts
// src/lib/schemas/resume.ts — new: the bases, for the base dropdown and the active-base marker
export const BaseResumeSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  candidateId: z.string(),
  source: z.enum(['UPLOAD', 'PROMOTED']),   // an upload or a version a person chose (no MANUAL since 07 Q58, 0018)
  isActive: z.boolean(),                    // exactly one per candidate
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  promotedFromResumeId: z.string().nullable(), // PROMOTED: the version it was copied from (left out of the dropdown)
  archivedAt: z.string().datetime().nullable(), // set while hidden (a used base the BDE deleted); null otherwise
});

// src/lib/schemas/resume.ts — what a résumé list reads (PR 7): the bases and their résumés
export const ResumeShelfSchema = z.object({ bases: z.array(BaseResumeSchema), resumes: z.array(ResumeSchema) });

// src/lib/schemas/resume-document.ts — one version opened in the studio (PR 7); the studio's URL names the version
export const OpenedResumeSchema = z.object({ resume: ResumeSchema, versionId: z.string(), document: ResumeDocumentSchema });

// ResumeSchema gains:
  baseResumeId: z.string().nullable(),      // the base a version belongs to (a tailored résumé's base); null only for old ones

// src/lib/schemas/resume-draft.ts — ResumeDraftSchema gains:
  country: z.string().nullable(),           // header.country as printed; null when not printed (never guessed)

// src/lib/schemas/resume-document.ts — the studio's document, field for field the parser's strict format (PR 7,
// Zuhair 2026-11-05: "every field of the strict response format except languages is shown"; needs Abdul's sign-off).
// Languages are never shown: a save carries them over from the version as the backend has it.
export const ResumeHeaderSchema = z.object({
  city: z.string(), state: z.string(), country: z.string(), email: z.string(), phone: z.string(),
  linkedin: z.string(), github: z.string(),
  workAuthorization: z.string(),           // shown read-only (the profile's fact); not printed; a save keeps the backend's
});
export const ExperienceEntrySchema = z.object({
  id: z.string(), company: z.string(), title: z.string(), location: z.string(),
  dates: z.string(),                       // as printed
  start: z.string(), end: z.string(), current: z.boolean(),   // for sorting and matching; not printed
  bullets: z.array(RichTextSchema),
});
export const EducationEntrySchema = z.object({ id: z.string(), school: z.string(), degree: z.string(), graduationDate: z.string(), grade: z.string() });
export const CredentialEntrySchema = z.object({ id: z.string(), name: z.string(), issuer: z.string(), date: z.string(), detail: z.string() });  // certifications and awards
export const ProjectEntrySchema = z.object({ id: z.string(), name: z.string(), link: z.string(), dates: z.string(), technologies: z.string(), bullets: z.array(RichTextSchema) });
// ResumeDocumentSchema: fullName, title, header, summary (RichText; its id is summary_id), experience, skills
// ({id, category, items}: one row per category, skills comma-separated), education, certifications, awards, projects.
// Removed (no backend column, so a save would lose them): contacts (now header), experience.description,
// education.location, education.years (now graduationDate), certification.year (now date), project.description (now bullets).
// ResumeSectionKey: + 'awards'.

// src/lib/schemas/resume.ts — what deleting a base or a version would do, or did (§4.7)
export const ResumeRemovalSchema = z.object({
  outcome: z.enum(['DELETE', 'HIDE', 'REFUSED']), message: z.string(),
  uses: z.record(z.string(), z.number().int()),
  rest: z.object({ versions: z.number().int().optional(), tailored: z.number().int().optional() }),
});
// src/lib/schemas/resume-document.ts — a save's answer: the new version opened, and the notice (§4.3)
export const ResumeSaveResultSchema = z.object({ opened: OpenedResumeSchema, notice: z.string().nullable() });

// No claim or evidence types (dropped 2026-11-05).
```

- `ResumeDraftSchema.city` and `.state` are read straight from the parser's `header.city` / `header.state`
  (the parser splits the location; `splitLocation` is no longer used for the draft).
- Change `src/lib/schemas/` to match this only in the PR that builds it (versioning PR 2 for `country`, PR 7 for
  the rest).

### 8.2 A résumé version's file — PROPOSED 2026-11-09 (07 Q49; Zuhair's area, for his sign-off), BUILT (PR 121)

`GET /api/firms/{firm}/candidates/{cid}/resumes/{rid}/file` answers the PDF or Word file an uploaded base was read
from, as uploaded (`resume_parses.content`, its `mime_type`, `Content-Disposition: attachment` with the uploaded file's
name, `Cache-Control: no-store`). Only an uploaded base's version 1 has one: that version is the file as read. Any later
version, a tailored one or a promoted base's answers 404 ("This version has no uploaded file."), as does a version out
of the principal's scope. The read follows the version's own access (§8.1). The extension attaches it to a form's
résumé upload (07 Q50–Q52); a file for every version (rendered by the backend) is asked of Zuhair (Q25).

---

## 9. Application, outreach, follow-up

### Applications backend foundation — PR 1 (2026-11-01)

This backend-only slice implements the user's agreed candidate status/history and BDE-review foundation.
Code-owner contract/schema approval is required before merge. The existing frontend schemas below remain
unchanged in this PR; their live DTO integration and display changes belong to later PRs.

- Historical PR 1 vocabulary included `saved`, `applied`, `screening_call`, `shortlisted`, `interview_schedule_request`,
  `interview_scheduled`, `assessment`, `offer`, `move_on`, `incomplete_application`, and `other`. The current
  target selectable vocabulary is the ten-status list in §2.1; Other is excluded from new writes.
  PR 3 correction approved in Abdul’s reply supplied by Samad: `other` remains an email category and legacy
  stored value, but new candidate status/review commands selecting it return 400. Identical historical command
  replays remain idempotent; reads and existing evidence are preserved. The rule also applies through the
  candidate legacy PATCH and bulk routes. Frontend selection removal is PR 4.
  Legacy applications retain their existing four-status API. Statuses remain text; migration 0009 does not
  rewrite existing status values or invent a status enum.
- Application responses add nullable `candidate_id` / `submitted_by_user_id`, integer `status_revision`, nullable
  `status_effective_at` / `last_manual_change_at`, and `pending_reviews` containing
  `{id, message_id, revision, reason}` for each pending persisted review.
- `GET /api/applications` accepts `candidate_id` and `tracked_only`. Candidate visibility applies to list, detail,
  edits, interviews and preparation; legacy rows are visible to firm-wide readers only.
- `PATCH /api/applications/{id}/candidate-status` accepts
  `{status, expected_revision, command_id?, note?, form_data?, resume_id?}`. A changed revision returns 409. A matching
  command replay creates no duplicate event. Reusing a command ID with different content or actor returns 409.
- `resume_id` on that move is the résumé version the form was sent with: the one the extension's answers came from.
  Only a move to `applied` may send it, and it must be one of the application's candidate's versions, not deleted;
  anything else returns 400 and changes nothing. It becomes the application's `resume_id`, the résumé the application
  shows as sent. A move back to Saved leaves it.
- `applications.form_data` (migration 0021, nullable JSONB) is what the employer's form held when the BDE marked the
  job applied from the extension: `{fields: [{label, value, required, source}]}`, `source` being `autofill` or `bde`.
  Only a move to `applied` may send it; at most 200 fields, labels up to 500 characters, values up to 4000; anything
  else returns 400. It stays null on a Saved job and on an applied job with no form to send, and a move back to Saved
  clears it. An empty form (`{fields: []}`) is valid: the page couldn't be read. It holds the candidate's answers, so
  no response returns it, the ledger and status events don't copy it, and logs never carry it. The extension leaves
  out passwords, government IDs, payment details, dates of birth, signatures and EEO answers, and an upload is its
  file name only.
- `PATCH /api/applications/{id}/review` also requires `review_id` and `expected_review_revision`. Only a pending
  persisted review for this application can be confirmed; another route cannot bypass it with a normal status move.
  Review resolution and status/event/ledger writes commit together. Model classification and review queue creation
  from imported mail are deferred; tests seed messages using the existing 0007 tables.
- `application_status_events` stores firm/candidate/application, from/to status, actor, source, timestamp, revision,
  optional command/review/note and original payload. SQL update/delete is blocked by an append-only trigger.
  `application_reviews` stores the source email, reason, application/review revision and resolution metadata.
- Never-submitted Saved drafts have no submission timestamp or submitter. Returning a submitted application to
  Saved preserves its original submission date and submitter; returning to Applied does not assign a new one.
  Status changes maintain candidate favorites. Removing an untouched draft can remove its application; retained history, notes or reviews preserve it. Protected legacy
  application deletion returns 409, including atomic validation of bulk deletion.
- Human changes use the existing permission policy and candidate ledger. Transition notes never replace the
  application's notes. Candidate application notes are edited with a standalone `{notes}` PATCH; combining
  `notes` with status/command/revision/transition-note fields returns 400 before any mutation. This keeps command
  replays from overwriting subsequent notes edits. List, detail, status, review and notes responses use the same
  candidate/job-scoped document lookup. A cover letter is attributed through its source résumé; letters without
  an attributable résumé are shown only for legacy applications. The legacy email monitor and auto-reject
  scheduler leave candidate applications untouched.


```ts
// src/lib/schemas/application.ts

export const ApplicationEventSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  fromStatus: ApplicationStatus.nullable(),
  toStatus: ApplicationStatus,
  note: z.string().nullable(),
  actorUserId: z.string().nullable(),
  isAutomated: z.boolean(),
  createdAt: z.string().datetime(),
});

export const ApplicationSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  resumeVersionId: z.string().nullable(),
  submittedByUserId: z.string(),

  status: ApplicationStatus,

  // denormalised at submit so history survives edits upstream
  companyNameAtApply: z.string(),
  jobTitleAtApply: z.string(),

  appliedAt: z.string().datetime().nullable(),
  firstResponseAt: z.string().datetime().nullable(),
  interviewAt: z.string().datetime().nullable(),
  offerAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),

  coverLetterText: z.string().nullable(),
  notes: z.string().nullable(),

  events: z.array(ApplicationEventSchema),
  createdAt: z.string().datetime(),
});

export const RecruiterContactSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().url().nullable(),
  enrichedFrom: z.enum(['MANUAL', 'APOLLO', 'SNOV']).nullable(),
});

export const OutreachTouchSchema = z.object({
  id: z.string(),
  applicationId: z.string().nullable(),
  contactId: z.string(),
  sentByUserId: z.string(),
  channel: OutreachChannel,
  templateId: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  result: OutreachResult,
  generatedBy: z.enum(['HUMAN', 'AGENT']),
  sentAt: z.string().datetime(),
  repliedAt: z.string().datetime().nullable(),
});

export const FollowUpTaskSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  assignedToUserId: z.string(),
  kind: FollowUpKind,
  dueAt: z.string().datetime(),
  state: FollowUpState,
  completedAt: z.string().datetime().nullable(),
  snoozedUntil: z.string().datetime().nullable(),
  note: z.string().nullable(),

  // denormalised for the queue view
  candidateName: z.string(),
  companyName: z.string(),
  jobTitle: z.string(),
});
```

---

### 9.x Candidate inbox (`src/lib/schemas/inbox.ts`)

The candidate's Google mailbox, connected by the BDE. Frontend-only today — the mock adapter
simulates the consent hand-off and sync (`POST /api/candidates/:id/inbox/connect`).

- `MailboxConnection` — `provider: "GOOGLE"`, `address`, `connectedAt`, `lastSyncedAt`.
- `InboxMessage` — sender, subject, body, `receivedAt`, the `applicationId` it matched (nullable),
  a `signal` (`SHORTLISTED | CALL_REQUEST | INTERVIEW_SCHEDULED | ASSESSMENT | OFFER | REJECTED |
  CONFIRMATION`), the `impliedStatus` that signal means for the pipeline, and `scheduledFor` for a
  proposed call or interview.
- `CandidateInbox` — `{ connection | null, messages[] }`.
- A **suggested status update is derived, never stored**: it exists while the application's stage
  is behind the email's `impliedStatus`.

Status changes go through `PATCH /api/applications/:id/status` (`{ status, note }`), which appends
an `ApplicationEvent` — the same write the kanban makes.

### 9.y Candidate documents (`src/lib/schemas/document.ts`)

> **Planned to be dropped (Abdul, relayed by Zuhair 2026-11-07):** the candidate's Documents section — uploading visa copies, ID, certificates and other files, and the Screening answers panel. It may come back in a later version, not now. Nothing is removed yet: its owners remove it, with this contract (`docs/team/abdul.md` §3). Don't build on it.

- `CandidateDocument` — `kind` (`WORK_AUTH | IDENTITY | RESUME | CERTIFICATION | EDUCATION |
  EMPLOYMENT | OTHER`), `title`, `fileName`, `mimeType`, `sizeKb`, `uploadedAt`, `uploadedByUserId`,
  `expiresAt` (nullable), `shareUrl`.
- Endpoints: `GET/POST /api/candidates/:id/documents` (POST takes metadata only in the mock),
  `DELETE /api/documents/:id`.

### 9.z Candidate submission facts

`UpdateCandidate` (`src/lib/schemas/candidate.ts`) — a partial of `workAuth`, `needsSponsorship`, `needsTransfer`,
`workAuthExpiry`, `rateTarget`, `rateMin`, `availableFrom`, `noticePeriodDays`, `willingToRelocate`,
`employmentTypes`, sent to `PATCH /api/firms/{firm}/candidates/{id}`. A changed `workAuth` is sent with
`needsSponsorship` and `needsTransfer` worked out by the same rule as the new-candidate flow (`workAuthChange` in
`src/lib/constants/work-auth.ts`); the backend refuses a new `work_auth` without both.

`CreateCandidate` (`src/lib/schemas/candidate.ts`, Phase B fix PR 1) — the New candidate form (docs/04 §4.2),
sent to `POST /api/candidates`: `fullName`, `primaryRole`, `email`, `phone`, `workAuth`, `needsSponsorship`,
`needsTransfer`, and `assignedUserId` (an active BDE of the firm, or null). Only `candidate.assign` (OWNER,
MANAGER) may name one; a BDE's new candidate is assigned to themself. The candidate starts `ON_BENCH`, so at
the firm's candidate limit the call is refused (A4). An input shape over existing `Candidate` fields: no new
field. Logged as `CREATE` on `candidate`.

`CaptureJob` (`src/lib/schemas/job.ts`, Phase B fix PR 1) — the Capture job form (docs/04 §5.2), sent to
`POST /api/jobs`. The server builds the `Job`: provenance `USER_SUBMITTED` / `USER_SESSION` with the user as
`capturedByUserId`; the company reused by normalised name, else added with nothing known (`clientType`
`UNKNOWN`, no H-1B data, no verification); an hourly range fills `rateMin/Max`, a yearly one
`salaryMin/Max`; "visa sponsorship available" allows every work authorization, otherwise
`USC` and `GC`; skills and required experience become `MANDATORY` requirements (not blockers). The same
canonical URL (no query or fragment, lowercase host, no trailing slash) twice in a firm is refused with
409 `DUPLICATE_JOB` naming the existing job. Logged as `CREATE` on `job`.

## 10. Analytics & ledger

```ts
// src/lib/schemas/analytics.ts

export const FunnelStageSchema = z.object({
  status: ApplicationStatus,
  label: z.string(),
  count: z.number().int(),
  conversionFromPreviousPct: z.number().nullable(),
});

export const BdePerformanceSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  candidatesAssigned: z.number().int(),
  applicationsSubmitted: z.number().int(),
  responses: z.number().int(),
  responseRatePct: z.number(),
  interviews: z.number().int(),
  placements: z.number().int(),
});

export const SourceRoiSchema = z.object({
  sourceId: z.string(),
  sourceLabel: z.string(),
  jobsIngested: z.number().int(),
  applications: z.number().int(),
  responses: z.number().int(),
  responseRatePct: z.number(),
});

export const FirmDashboardSchema = z.object({
  period: z.enum(['7d', '30d', '90d']),
  funnel: z.array(FunnelStageSchema),
  byBde: z.array(BdePerformanceSchema),
  pipelineByStatus: z.array(z.object({
    status: CandidateStatus,
    count: z.number().int(),
  })),
  medianTimeToFirstResponseDays: z.number().nullable(),
  sourceRoi: z.array(SourceRoiSchema),
  activeBdeCount: z.number().int(),
  totalApplicationsInPeriod: z.number().int(),
});

export const BdeDashboardSchema = z.object({
  queueCount: z.number().int(),
  followUpsDueToday: z.number().int(),
  followUpsOverdue: z.number().int(),
  applicationsThisWeek: z.number().int(),
  responsesThisWeek: z.number().int(),
  interviewsScheduled: z.number().int(),
  candidatesAssigned: z.number().int(),
  atRiskCandidateIds: z.array(z.string()),
});

export const LedgerEntrySchema = z.object({
  id: z.string(),
  actorUserId: z.string().nullable(),
  actorType: z.enum(['USER', 'SYSTEM', 'AGENT', 'PLATFORM_ADMIN']),
  actorName: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  entityLabel: z.string(),
  action: z.enum([
    'CREATE','UPDATE','DELETE','STATE_CHANGE',
    'AI_GENERATE','AI_BLOCK','AI_OVERRIDE','EXPORT','LOGIN','ADMIN_ACCESS',
    // + the tenancy actions of §3.1 and 'ASSIGN' (§3.4)
  ]),
  summary: z.string(),
  note: z.string().nullable(),            // the handoff note on an ASSIGN entry; null on every other entry (§3.4)
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  // No evidenceIds or claimState: the ledger's columns are dropped in migration 0015 (Abdul, 2026-11-06).
  createdAt: z.string().datetime(),
});

/** Merged activity stream for a candidate. */
export const TimelineEventSchema = z.object({
  id: z.string(),
  kind: z.enum(['STATUS', 'APPLICATION', 'RESUME', 'OUTREACH', 'FOLLOWUP', 'NOTE', 'RECORD']),
  occurredAt: z.string().datetime(),
  actorName: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  linkTo: z.string().nullable(),
});
```

---

## 11. Rules for using these contracts

1. **Infer, never redeclare.** `export type Candidate = z.infer<typeof CandidateSchema>` — never a
   hand-written parallel interface.
2. **Validate at the boundary.** Every adapter response is parsed through its schema. A shape
   mismatch fails loudly in development rather than rendering `undefined` in production.
3. **Derived types are computed, not fetched.** `CandidateStats` and `RecordCompleteness`
   have schemas so they can be typed — but they're produced by pure functions in
   `src/lib/derive/`, which are unit-tested against fixtures.
4. **Denormalised fields are deliberate.** `Match.job`, `Application.companyNameAtApply`,
   `FollowUpTask.candidateName` — these exist so list views render without N+1 lookups, and so
   history survives upstream edits.
5. **No claim states (2026-11-05).** Nothing on a candidate, a résumé or an answer is Verified, Unverified or Contradicted.


### Candidate Gmail connection — PR 2 (Samad requested 2026-11-02; Abdul sign-off pending)

Candidate Inbox imports and displays read-only Google mail. Matching and classification belong to PR 3;
automatic application-status changes and Undo belong to PR 4 under the later approved split. A new import has `signal: null`, `impliedStatus: null` and `scheduledFor: null`;
render it as Unclassified, never guess a category. Existing mock signals keep their behavior.
`InboxMessage.sourceAddress?: string` identifies the verified source Google account for retained mail.
`MailboxConnection` adds `status` (CONNECTED / DISCONNECTED / ERROR; default CONNECTED for old fixtures),
`lastSyncError` (nullable, default null), and nullable `lastSyncedAt` (null before the first successful sync).
Disconnect retains messages and their source identity while deleting credentials; read marks are local to BenchQ.
Tokens and OAuth verifiers are encrypted at rest with an environment-owned Fernet key. OAuth state is hashed,
one-use and bound to the initiating user/firm/candidate. Callback checks current authorization before and after
Google exchange. The verified Google address is shown in the Inbox; an active account cannot be replaced without
an explicit disconnect. Account provenance and deduplication are part of PR 2, not deferred until PR 4.
Initial import uses the most recent 3 days; incremental Gmail history polling defaults to 5 minutes and can be
disabled with interval 0. Imported mail is deduplicated by mailbox, source address and provider message ID.
Every human action uses existing candidate.edit and candidate scope; viewers/support cannot write. Scheduled
imports use SYSTEM ledger attribution with candidate_id. Required code-owner contract/auth/schema review remains
pending before merge. No new role rules or live Google secrets are embedded in the UI.


### PR 104 review corrections — revised 2026-11-03

Samad confirmed the implementation decisions during the planning interview. Abdul's newer product replies,
supplied in the chat, approve the classification/UI sequence and gates below. Abdul’s written decision dated 2026-11-03, now accepted by Samad, makes Gmail uniqueness firm-local; the same address may connect across firms. This supersedes earlier global-uniqueness notes.
Abdul’s written 2026-11-03 decision removes read/manual-sync request business-ledger events; is_read remains message state. A separate access-log proposal is deferred. Exact remaining contracts still require code-owner approval. Support
health/counts-only visibility was explicitly approved in Abdul's 2026-11-03 GitHub review.
Nothing here records a GitHub approval. Candidate Gmail defaults off until matching/BDE review, privacy
acceptance and Google verification are ready. Classification disabled means imported mail stays readable,
Unclassified, in the Inbox. PR 104 makes no model requests and changes no application statuses.

OAuth stores a pending encrypted grant, requires the initiating user's current candidate.edit permission
and current candidate scope to confirm, and supports DELETE on the same confirmation URL to cancel.
Expired attempts offer Return to Inbox, which cancels/cleans the attempt; Connect starts a fresh OAuth flow. Cancel/conflict/expired cleanup revokes only if no active grant is
at risk; failures retain the encrypted pending token for scheduled retry. A separate five-minute cleanup job continues even when Inbox polling is disabled; expired unused PKCE verifiers are cleared. Provider identity failures also
retain issued grants for safe cleanup. Google revocation affects an account's whole project grant, so
known-account activation/cleanup uses normalized-account advisory locks across firms. Unknown-identity code
exchanges run concurrently, as do revocations for different known accounts. A two-group advisory barrier
prevents exchange and revocation groups overlapping, so revocation cannot invalidate an unidentified new grant.
Its global entry lock is held only for group admission, never during provider I/O. Account locks precede group
admission, and exchanges leave their group before account cleanup. Group admission has a five-second total
lock-wait budget, then returns a retryable error;
provider calls hold no mailbox row locks. Disconnect invalidates pending confirmations for the revoked grant.

The approved rule is one active candidate per Gmail within a firm. CONNECTED and ERROR reserve that address
only in that firm until disconnect; other firms may connect the same Gmail simultaneously. In-firm conflicts say
“This email is already connected to another candidate.” No cross-firm conflict or existence notice is returned.
Provider grant safety probes/locks remain global internally, without changing tenant read permissions.
Profile/Google addresses may differ. Reassignment preserves the mailbox, jobs, application
statuses and mapped email history, transfers current-candidate access to the new BDE, and blocks subsequent
requests and pending confirmation by the former BDE. Ledger visibility retains Q52: BDEs see entries they
authored and ASSIGN entries for currently handled candidates, not all other actors’ candidate activity. No broad
candidate-ledger permission amendment ships here. Existing backend candidate_id supports scoped filtering; this PR adds no frontend ledger field or access rights.

Durable confirmation evidence is the existing ledger entry: actor_user_id, candidate_id, created_at,
verified Google address and consent notice v1 in its summary. It survives attempt cleanup/reconnection and
email erasure. It is not the temporary OAuth attempt. This retention exception is disclosed in deletion UI.
Platform audit/support responses redact email audit summary/note; Inbox support reads return health/counts
without message rows or mailbox address. Safe diagnostics must not disclose email content.

GET Inbox uses limit (default 200, max 500), optional opaque cursor, next_cursor (nullable) and optional total_count on first-page list reads.
Older-page and selected-body reads skip the count query.
The cursor encodes a timezone-aware received_at and UUID with matching descending-time/ascending-ID ordering.
Malformed cursors fail 400. message_id independently selects exactly one scoped undeleted message with body.
Frontend CandidateInbox adds nextCursor (default null for older fixtures) and optional totalCount.
Infinite-query pages survive ordinary refresh without HTTP requests for previously cached history. When first-page
counts indicate historical backfill or erasure rather than just new head mail, loaded history is refreshed once
and subsequent ordinary polls reuse it. Refresh fetches the
newest page and bridges newly arrived pages to the previous head if necessary, preserving the historical cursor
without skipping a burst of new mail. URL/Zod inbox_pages automatically restores at most three loaded pages;
further history loads explicitly. Selected older bodies remain independently addressable. Lists omit bodies.

DELETE inbox-content accepts optional message_id and disconnect (default false). The app's bulk dialog defaults
Disconnect and delete to true. Owner/Manager deletion erases message content on all served surfaces and fences
in-flight jobs. Stored-only deletion targets content present at server confirmation, permits genuinely new
arrivals afterward, and preserves tombstones/dedup IDs. Disconnect-and-delete stops import first, completes
local erasure even if Google revoke fails, retains encrypted cleanup for scheduled retry, and shows truthful pending/manual fallback instructions. Gmail originals and
application statuses stay unchanged. Minimal source/history IDs and restricted connection attestations remain.
BDEs, Viewers and platform staff cannot erase email. Quarantine and recoverable auto-purge are later PR scope.

Audit policy (Abdul’s written decision, 2026-11-03, accepted by Samad): no read or manual Sync request ledger
entries, including empty requests. is_read remains local message state. Import results, connections,
confirmations and deletion remain business-ledger events. Propose a separate privacy access log in a follow-up;
no access-log table is added here. Existing JobRun metadata stores committed batch counts and appends one
immutable SYSTEM terminal/recovery result per nonempty run; no-change polls produce no result.

Disconnect atomically removes usable mailbox credentials and stores any token in an expired, consumed OAuth
cleanup attempt in the existing encrypted table. Failed/busy revocations remain encrypted for scheduled retry;
they cannot be used to activate a connection or sync mail. Cleanup skips revocation for another CONNECTED/ERROR
mailbox or a newer pending grant, and clears the pending warning after successful cleanup. No new table/column.

Later product direction: PR 3 classification first, PR 4 UI second. External processing stays off for real mail
until retention/logging are verified in writing and consent updated. Automatic updates stay off until PR 4 merges
and Undo works. Other never changes an application; matched Other remains readable, only unmatched Other may
qualify for approved recoverable purging. Failed processing alone never erases mail. The detailed next plan must
include lawful test-data provenance, approved recovery duration, sender authentication/approval contract,
quarantine release and legacy-status mappings. No such table/status migration is introduced by PR 104.
A named Google verification/security-assessment owner and delegated-access policy confirmation remain launch gates.


### PR 3 classification evidence — implementation of issue #110 direction (2026-11-04)

Source: [Abdul’s written approval](https://github.com/AbdulMuqtadir916/BenchQ/issues/110#issuecomment-6624344616).
This records the lean schema/API implementation submitted for code-owner review, not approval of every field name
or activation of external processing/purge/automation. Exact legacy/UI status mapping sign-off remains separate.

- One additive revision 0014 after main revision 0013 (résumé versioning), to be rechecked before publication. No application
  status/history backfill. Reuse existing inbox_messages, application_reviews and job_runs; adapt the local
  email_classifications table to versioned evidence rather than introduce a parallel result table.
- email_classifications: scoped UUID email/application references, nullable application_revision, result_version,
  content_revision, category, finite confidence/probabilities, model/provider/prompt/category identity,
  normalized sender_auth_result, receive_time_verified, reason/outcome and created_at. Unique email/result version;
  database trigger rejects updates and permits deletion only after explicit content tombstoning. No raw prompts,
  bodies or authentication headers. Other is retained hidden/encrypted, not a new application status.
- inbox_messages: classification_state PENDING/PROCESSING/DONE/ERROR/EXCLUDED, attempts/result version,
  content_revision, lease owner/expiry, next retry and safe error; normalized sender verdict UNKNOWN/PASS/FAIL,
  receive-time provenance, hidden_at and other_purge_after. Hidden subject/sender values are encrypted too.
  Explicit deletion/purge clears content and derived results, fences workers and preserves minimal source/provider
  dedup references. Purge is independently gated and requires 30-day retention and evaluated selection.
- application_reviews: nullable application_id/application_revision together for unmatched work, classification_id
  with SET NULL on privacy erasure and a separate classification_version so historical uniqueness survives erasure; preserve legacy linked-review uniqueness/history and unique unmatched-email
  review. Reruns cannot silently overwrite pending/resolved human work. No placeholder applications.
- Reuse JobRun for durable minimal attempt usage and idempotent human command journal; no separate attempt table.
  Unknown provider usage/cost remains UNKNOWN, never zero. Background notifier is bounded, leases fence stale work;
  there are no automatic application-status writes in PR 3.
- ai_config("email_classification") uses candidate_email_llm_* and candidate_email_instructions platform AI settings,
  separate from the legacy global email monitor. No new firm-owned model/prompt controls or preset-admin UI.
- Existing Inbox/read APIs centrally exclude hidden/deleted rows, including selected IDs and read-mark responses.
  Pending/failed rows remain readable, label Not classified, safe error/retry-exhausted metadata. No raw model output
  is returned. Support sees counts/health, never private message content or classifications.
- GET /api/firms/{firm_id}/candidates/{candidate_id}/email-reviews returns scoped pending linked/unmatched review
  IDs, revisions and reasons, UUID after-cursor and bounded limit. Current candidate read access applies.
- PATCH /api/firms/{firm_id}/candidates/{candidate_id}/inbox-messages/{message_id}/review requires application.move
  and current candidate access. Body: review_id, command_id, expected_review_revision, expected_content_revision,
  optional application_id/expected_application_revision, action LINK_ONLY/KEEP_CURRENT/SET_STATUS/DISMISS_NON_APPLICATION,
  optional status/note. Only existing submitted same-candidate apps can be linked. Status writes are explicit human
  commands through the established command service. No AI result can directly execute them.
- POST at the same message prefix /classification/retry (candidate.edit) or /classification/reclassify
  (candidate.assign, scoped Owner/Manager): command_id, expected_content_revision and expected_result_version.
  Retry requires ERROR; reclassification requires visible DONE and an authorized current connected source. Hidden
  Other has no V1 inspection/release endpoint; switching flags OFF never releases hidden mail. Mutations reject
  unknown fields and stale revisions; replay returns without duplicate decisions/audit writes.
- Candidate scope is checked with the central helper; no inline role checks. Missing/out-of-scope records are 404,
  denied actions 403, stale/reused commands 409. Both scopes and synthetic failure/visibility paths are covered by
  the access/F7 inventory. Existing mailbox/deletion/status endpoints and submitted résumé links remain intact.
- All sensitive env switches default false: CANDIDATE_EMAIL_CLASSIFICATION_ENABLED,
  CANDIDATE_EMAIL_REAL_MAIL_APPROVED, CANDIDATE_EMAIL_PURGE_ENABLED, CANDIDATE_EMAIL_PURGE_EVALUATED.
  Purge additionally requires CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID to match the classified configuration fingerprint.
  Real-mail provider/consent verification, zero-job-related shadow removal and PR 4/Undo activation are independent
  gates. A passing synthetic integration test is not model accuracy or launch approval.

PR 3 routing clarification: below-0.8 Other remains readable in review, consistent with the below-threshold review rule. Confident Other is hidden/encrypted; no classification confidence alone enables purge.
