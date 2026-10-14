# 02 — Data Contracts

**Project:** BenchQ · frontend only
**Version:** 1.0 · September 2026

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

### 3.1 PROPOSED — tenancy contracts (pending sign-off)

> **Status: draft for product-owner review. Nothing here exists in code.** No schema, fixture,
> session type or query key has been changed; `docs/07` Phase T cannot start until these are signed
> off (07 §7). Source: 07 §3 (principal), §4 (support view), §7 (list of contracts), Q7–Q13. The
> shapes follow this file's conventions (Zod, ISO datetimes as `z.string().datetime()`).
> **"Open"** marks a field or rule 07 does not settle; see *Open questions* below.

#### Principal and SupportView — who is signed in (07 §3)

```ts
// src/lib/schemas/session.ts (replaces the user + role pair in the client session store)
export const SupportViewSchema = z.object({
  id: z.string(),                         // support-view id; also the `entityId` on its ledger entries
  firmId: z.string(),                     // the one firm being viewed (one view at a time, 07 §4)
  reason: z.string().min(10),              // required free text, shown to the firm (07 §4: min. 10 chars)
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),        // startedAt + 60 minutes (07 §4); extension: Open
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
    role: z.literal('PLATFORM_ADMIN'),     // code name (Q7); UI label "Super Admin"
    support: SupportViewSchema.nullable(), // null = not inside a firm; at most one view at a time
  }),
]);
```

#### Firm — additions to the existing `FirmSchema` (07 §7)

```ts
// existing fields unchanged: id, name, slug, logoUrl, primaryTimezone, clientTimezone,
// truthGuardMode, applicationExpiryDays
status: z.enum(['ONBOARDING', 'ACTIVE', 'SUSPENDED']), // ONBOARDING: created, owner not yet joined; SUSPENDED: firm users see a blocked screen (07 §2.5)
planId: z.string(),                       // → Plan.id. Nullable while ONBOARDING?  Open
seatLimit: z.number().int(),              // max active users. Overrides Plan.seatLimit or copies it?  Open
candidateLimit: z.number().int(),         // max active candidates (status ≠ INACTIVE today). Same question  Open
createdAt: z.string().datetime(),
// `slug` rules (Q12): set and changed only by Super Admin; reserved words rejected (07 §2.4)
```

`SessionSchema.seatsUsed` and `activeCandidates` stop being stored: they become derived counts
(active users, active candidates), and the two limits move onto `Firm` (07 T2).

#### Plan — platform catalogue, no billing (07 §7)

```ts
export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),                        // e.g. "Starter"
  seatLimit: z.number().int(),             // default seats when a firm is put on this plan
  candidateLimit: z.number().int(),        // default active-candidate cap
  features: z.array(z.string()),           // display labels only; a feature-flag list?  Open
  isActive: z.boolean(),                   // false = hidden from new firms, kept for existing ones
});                                        // no price fields: no billing in the frontend (CLAUDE.md)
```

#### Invite — how every user joins (Q11, 07 §7)

```ts
export const InviteSchema = z.object({
  id: z.string(),
  firmId: z.string().nullable(),           // null = invite to the BenchQ platform team
  email: z.string().email(),               // who is invited; the token is sent here
  role: z.union([FirmRole, z.literal('PLATFORM_ADMIN')]), // role offered. INFERRED: 07 §7 lists only `role`; PLATFORM_ADMIN is added so platform-team invites (firmId null) can exist (Q11 below)
  invitedByUserId: z.string(),             // a firm user or a PlatformUser id
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
  expiresAt: z.string().datetime(),        // lifetime: Open
  createdAt: z.string().datetime(),
});                                        // the `[token]` in /invite/[token] is not a field here: it is
                                           // an opaque secret the backend owns (never in a fixture)
```

#### PlatformUser — BenchQ staff (07 §7)

```ts
export const PlatformUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.literal('PLATFORM_ADMIN'),       // the only platform role for now
  isActive: z.boolean(),
  lastActiveAt: z.string().datetime().nullable(),
});                                        // no firmId: platform users belong to no firm (Q9)
```

#### `firmId` on records (07 §7, Q13)

| Record | Change | Note |
|---|---|---|
| Candidate, User | none | already have `firmId` |
| Job, Application, Resume, Record (candidate record), Document, Inbox (`CandidateInbox`, `InboxMessage`, `MailboxConnection`), Followup (`FollowUpTask`) | add `firmId: z.string()` | required; every fixture gets one in Phase T (T3) |
| LedgerEntry | add `firmId: z.string().nullable()` | `null` = a platform-level event with no firm; which events are null: Open |
| Company (and `CompanyVerification`) | none | global reference data (Q13) |
| Agent / tailoring runs | none proposed | derived from the firm-scoped records they act on; confirm  Open |

#### Ledger actions and actors (07 §4, §7)

```ts
// LedgerEntrySchema.action — existing values kept, these added:
'ADMIN_ACCESS_END',    // a support view ended (exit, expiry or sign-out)
'FIRM_CREATED', 'FIRM_SUSPENDED', 'FIRM_REACTIVATED',
'PLAN_CHANGED',        // a firm's plan or its limits changed
'INVITE_SENT', 'INVITE_ACCEPTED', 'INVITE_REVOKED',
// `actorType` already has 'PLATFORM_ADMIN'; `ADMIN_ACCESS` already exists (support view started)
```

#### Open questions for the product owner

**Seats and limits**
1. **What counts as a seat?** Every active user, VIEWERs included? Do pending invites reserve a seat?
   Does the OWNER count? (The current mock counts every `isActive` user, VIEWER or not.)
2. **What counts as an "active candidate" for `candidateLimit`?** Today: any status except `INACTIVE`.
   Should `PAUSED` and `PLACED` count?
3. **Does `Firm.seatLimit` / `candidateLimit` override the `Plan`'s numbers or copy them** at the time the
   plan is assigned? 07 puts the fields on both. This decides whether editing a plan changes existing firms.
4. **What happens when a firm is over its limit** (plan downgrade, or an invite beyond `seatLimit`)? Block the
   action, warn, or allow and flag?

**Firm lifecycle and profile**
5. **Trial.** Do we need a trial state (`TRIAL`, `trialEndsAt`) in addition to `ONBOARDING`, `ACTIVE`,
   `SUSPENDED`? Who or what moves a firm from `ONBOARDING` to `ACTIVE`: the owner accepting the invite, or
   Super Admin?
6. **Extra firm fields.** Do you want any of these on `Firm`, and which are required at creation: contact
   phone, billing email, GST number, country, registered address, company size, a "primary contact" name?
   (None are in 07 §7 today.)
7. **Slug rules.** Allowed characters and length (e.g. lowercase letters, digits and hyphens, 3 to 40)?
   May Super Admin change a slug after launch, given every firm URL contains it?
8. **Can a suspended firm's users still sign in** to see the blocked screen, or are they signed out?

**Invites**
9. **Invite lifetime** (7 days? 14?), and what "resend" does (new token, new `expiresAt`, same `Invite` row)?
10. **Roles you may invite to:** can an OWNER invite another OWNER, or is there exactly one per firm?
    Can a firm invite a VIEWER only up to some number?
11. **Platform team invites** (`firmId = null`): who may invite staff, and is `PLATFORM_ADMIN` the only role?

**Support view and audit**
12. **Support view length:** fixed 60 minutes (07 §4), or extendable? Is the required `reason` visible to the
    firm as written, and does the firm see the admin's name and email?
13. **Which ledger entries have `firmId = null`?** E.g. `FIRM_CREATED` has no firm yet; should
    `FIRM_SUSPENDED` and `PLAN_CHANGED` appear in the affected firm's own ledger, or only in `/admin/audit`?
14. **Is there a plan-change history record?** 07 §2.3 shows "change history" on a firm's plan page, but §7
    defines no entity for it. Derive it from ledger entries, or add a `PlanChange` contract?

**Smaller points**
15. **`Plan.features`:** free-text labels for display, or a fixed set of feature flags the UI checks?
16. **Is `planId` required while a firm is `ONBOARDING`?**
17. **Agent and tailoring runs** (`agents` mock): are they firm-scoped, or purely derived from firm-scoped records?

---

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
