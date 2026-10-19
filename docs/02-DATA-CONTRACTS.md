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
| **Persona** — profile grounding AI answers for autofill | `Candidate.persona` | Maps exactly onto the screening-question prefill panel. |
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
  'H1B', 'H4_EAD', 'OPT', 'CPT', 'GC', 'GC_EAD', 'USC', 'TN', 'OTHER',
]);

export const EmploymentType = z.enum(['C2C', 'W2', 'TEEN99', 'FTE']);

export const CandidateStatus = z.enum([
  'ON_BENCH', 'INTERVIEWING', 'OFFER', 'PLACED', 'PAUSED', 'INACTIVE',
]);

/** The three claim states. The product's core concept. */
export const ClaimState = z.enum(['VERIFIED', 'UNVERIFIED', 'CONTRADICTED']);

export const FieldSource = z.enum([
  'MANUAL', 'RESUME_UPLOAD', 'LINKEDIN_EXPORT', 'INTAKE_CALL', 'AI_EXTRACTED',
]);

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

export const ApplicationStatus = z.enum([
  'SAVED', 'APPLIED', 'RESPONSE', 'SCREENING', 'INTERVIEW',
  'OFFER', 'PLACED', 'REJECTED', 'WITHDRAWN', 'EXPIRED',
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
  truthGuardMode: z.enum(['STRICT', 'BALANCED', 'LENIENT']).default('BALANCED'),
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
> (`FirmSessionSchema`: principal + user + firm) in the client store, the dev principal switcher, the query
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
// truthGuardMode, applicationExpiryDays
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
| `seatsUsed` | number of **active users** (OWNER, MANAGER, BDE and VIEWER all count) **+ pending invites** (A1). Per A9, an invite that is `PENDING` but past `expiresAt` is treated as `EXPIRED` and does not reserve a seat **(approved 2026-10-16)** |
| `activeCandidates` | candidates whose status is `ON_BENCH`, `INTERVIEWING` or `OFFER`. `PLACED`, `PAUSED` and `INACTIVE` do not count (A2) |
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

### 3.2 System contracts — DRAFT for sign-off (2026-10-19)

> **Status: draft, not approved. Nothing is built from it** — no schema, fixture, adapter or screen.
> `/admin/system` stays a placeholder and AI spend stays hidden on the overview until these are
> signed off (07 Q29, docs/04 §14.9). Open points are **S1–S12** at the end of this section; the
> shapes below are the draft's defaults and change with the answers.
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
  'DATABASE',       // Postgres reachable, pool not drained
  'SCHEDULER',      // scheduled jobs running on time (job_runs)
  'SCRAPER',        // derived from recent ScraperRuns (rule below)
  'EMAIL_MONITOR',  // inbox polling (backend/email_monitor)
  'LLM_PROVIDER',   // the AI provider answering
]);                 // S1: which components exist, and which ones the backend can report

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

- **One row per component, current state only** by default (a live probe, no history). S2 decides
  whether history is kept (uptime over 7 / 30 days needs it).
- **`SCRAPER` is derived, not probed:** `DOWN` when any source's last 3 runs all failed or found nothing
  (the backend's own alert rule, `check_scrape_health`); `DEGRADED` when the latest run of any source is
  a warning; otherwise `OK`.

#### ScraperRun — one scrape of one search or company

```ts
export const ScraperRunSchema = z.object({
  id: z.string(),
  /** S5: firm-scoped (a firm's saved search) or platform-wide (shared job boards)? */
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

#### AiUsage — one call to an AI model

```ts
export const AiPurpose = z.enum([
  'RESUME_TAILOR',      // the tailoring agent (AgentDraft.runId)
  'JOB_SCORE_FULL',     // backend purpose "score_full"
  'JOB_SCORE_LIGHT',    // "score_light"
  'EMAIL_CLASSIFY',     // "email"
  'OTHER',
]);                     // S8: the full list, and whether OTHER is allowed

export const AiUsageSchema = z.object({
  id: z.string(),
  /** A17: agent and tailoring runs are firm-scoped. S6: null for platform/system calls (e.g. scoring a shared job)? */
  firmId: z.string().nullable(),
  purpose: AiPurpose,
  provider: z.string(),                 // "anthropic"
  modelId: z.string(),                  // "claude-sonnet-5-5"
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  /**
   * Cost in **micro-US-dollars** (1 USD = 1,000,000), an integer, so sums never drift (the backend
   * stores a float `cost_usd`; the mapper converts). S3 / S4: currency, unit, and who prices it.
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

**Derived, never stored** (all on `/admin/system` and, once approved, the overview's AI spend group):

| Value | Definition |
|---|---|
| Spend in a period | sum of `costMicroUsd` over the period's rows (failed calls included: they are billed) |
| Spend by firm | the same, grouped by `firmId` (null shown as "Platform") |
| Spend by model | grouped by `modelId` |
| Tokens by purpose | sums of the four token counts, grouped by `purpose` |
| Scraper health | the `SCRAPER` rule above, per source and overall |

#### Open questions for sign-off

| # | Question | Draft default |
|---|---|---|
| S1 | Which health components exist, and which can the backend report today? (Only `API` has an endpoint.) | the six above; `UNKNOWN` until the backend reports one |
| S2 | Keep health history (for uptime over time), or current state only? | current state only |
| S3 | Currency and unit for AI cost: USD only, or also INR for the firms? Exchange rate source and date if INR. | USD, integer micro-dollars |
| S4 | Who prices a call: the backend at call time (provider price list), or the frontend from a price table? | the backend, at call time; the frontend never prices |
| S5 | Are scrapes firm-scoped (each firm's saved searches) or platform-wide (shared boards, jobs copied per firm)? | firm-scoped once searches carry `firmId` |
| S6 | Can an AI call have no firm (platform/system work)? If not, `firmId` becomes required. | nullable, shown as "Platform" |
| S7 | Retention: how long are ScraperRun and AiUsage rows kept (e.g. 90 days raw, then monthly totals)? | 90 days raw; monthly totals kept |
| S8 | The full list of AI purposes; is `OTHER` acceptable? | the five above |
| S9 | Is AI spend ever shown to a firm (its own usage), or Super Admin only? | Super Admin only |
| S10 | Budgets or alerts (e.g. a firm over X dollars a month) — in scope now? | not now |
| S11 | Time zone for period boundaries ("this month"): IST, UTC? | IST, like the rest of the admin area |
| S12 | Do failed AI calls count in spend? | yes, when the provider billed them |

## 4. Candidate

```ts
// src/lib/schemas/candidate.ts

/** JobNavigator-aligned: persona grounds AI-generated answers to screening questions. */
export const PersonaSchema = z.object({
  summary: z.string(),
  toneNotes: z.string().nullable(),
  willRelocate: z.boolean(),
  noticePeriodDays: z.number().int().nullable(),
  preferredIndustries: z.array(z.string()),
  dealBreakers: z.array(z.string()),
});

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
  state: ClaimState,                     // answers are claims too
  evidenceId: z.string().nullable(),
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
  country: z.string().default('US'),
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

  assignedUserIds: z.array(z.string()),
  primaryUserId: z.string().nullable(),

  persona: PersonaSchema.nullable(),
  qaBank: z.array(QaBankEntrySchema),

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

---

## 5. The Record

```ts
// src/lib/schemas/record.ts

/** Substantiation. A claim cannot be VERIFIED without one of these. */
export const RecordEvidenceSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  entityType: z.enum(['experience', 'skill', 'project', 'certificate', 'summary']),
  entityId: z.string(),
  documentId: z.string().nullable(),
  excerpt: z.string().nullable(),          // verbatim supporting text
  pageNumber: z.number().int().nullable(),
  confirmedByUserId: z.string().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  source: FieldSource,
});

export const RecordBulletSchema = z.object({
  id: z.string(),
  text: z.string(),
  state: ClaimState,
  evidenceId: z.string().nullable(),
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
  source: FieldSource,
  state: ClaimState,
});

export const RecordSkillSchema = z.object({
  id: z.string(),
  name: z.string(),                        // as stated
  canonicalName: z.string(),               // after taxonomy collapse
  family: z.string().nullable(),
  yearsUsed: z.number().nullable(),
  lastUsedYear: z.number().int().nullable(),
  proficiency: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).nullable(),
  source: FieldSource,
  state: ClaimState,
});

export const RecordEducationSchema = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  source: FieldSource,
  state: ClaimState,
});

export const RecordCertificateSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string().nullable(),
  issueDate: z.string().datetime().nullable(),
  expiryDate: z.string().datetime().nullable(),
  credentialId: z.string().nullable(),
  credentialUrl: z.string().url().nullable(),
  source: FieldSource,
  state: ClaimState,
});

export const RecordSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  summaryState: ClaimState,
  experiences: z.array(RecordExperienceSchema),
  educations: z.array(RecordEducationSchema),
  skills: z.array(RecordSkillSchema),
  certificates: z.array(RecordCertificateSchema),
  evidence: z.array(RecordEvidenceSchema),
  lastVerifiedAt: z.string().datetime().nullable(),
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

export const ResumeClaimSchema = z.object({
  id: z.string(),
  resumeVersionId: z.string(),
  section: z.enum(['summary', 'experience', 'project']),
  entityId: z.string().nullable(),
  bulletIndex: z.number().int().nullable(),
  text: z.string(),
  state: ClaimState,
  evidenceId: z.string().nullable(),
  reason: z.string().nullable(),           // why unverified / why contradicted
  overriddenByUserId: z.string().nullable(),
  overrideReason: z.string().nullable(),
  overriddenAt: z.string().datetime().nullable(),
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

  claims: z.array(ResumeClaimSchema),
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

/** DERIVED — the export gate. Computed from claims. */
export const ExportGateSchema = z.object({
  canExport: z.boolean(),
  unverifiedCount: z.number().int(),
  contradictedCount: z.number().int(),
  blockingClaimIds: z.array(z.string()),
  message: z.string().nullable(),
});
```

---

## 9. Application, outreach, follow-up

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

- `CandidateDocument` — `kind` (`WORK_AUTH | IDENTITY | RESUME | CERTIFICATION | EDUCATION |
  EMPLOYMENT | OTHER`), `title`, `fileName`, `mimeType`, `sizeKb`, `uploadedAt`, `uploadedByUserId`,
  `expiresAt` (nullable), `shareUrl`.
- `RecordEvidence.documentId` points at a `CandidateDocument`; "evidence for N claims" is derived
  from the Record's evidence, never stored.
- Endpoints: `GET/POST /api/candidates/:id/documents` (POST takes metadata only in the mock),
  `DELETE /api/documents/:id`.

### 9.z Candidate submission facts

`UpdateCandidate` (`src/lib/schemas/candidate.ts`) — a partial of `workAuth`, `workAuthExpiry`,
`rateTarget`, `rateMin`, `availableFrom`, `noticePeriodDays`, `willingToRelocate`,
`employmentTypes`, sent to `PATCH /api/candidates/:id`.

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
  ]),
  summary: z.string(),
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  evidenceIds: z.array(z.string()),
  claimState: ClaimState.nullable(),
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
3. **Derived types are computed, not fetched.** `CandidateStats`, `RecordCompleteness` and
   `ExportGate` have schemas so they can be typed — but they're produced by pure functions in
   `src/lib/derive/`, which are unit-tested against fixtures.
4. **Denormalised fields are deliberate.** `Match.job`, `Application.companyNameAtApply`,
   `FollowUpTask.candidateName` — these exist so list views render without N+1 lookups, and so
   history survives upstream edits.
5. **`ClaimState` appears on Record fields, resume claims and Q&A answers.** That's intentional:
   anything asserted on a candidate's behalf is a claim, wherever it lives.
