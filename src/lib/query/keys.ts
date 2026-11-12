/**
 * Every TanStack Query key in one place (docs/07 T5, principle 7).
 *
 * Firm data: the key STARTS with the firm id, so two firms can never share a cache entry and
 * `invalidateQueries({ queryKey: firmKey(firmId) })` clears one firm's data at once. Within a firm, a
 * resource's keys share a prefix (`[firmId, "applications"]`) so a mutation can invalidate every
 * list and detail of that resource together.
 *
 * Global reference data (companies, docs/07 Q13) and the session are not firm-scoped.
 */

type Params = Record<string, unknown> | undefined;

/** Everything cached for one firm. */
export const firmKey = (firmId: string) => [firmId] as const;

const resource = <R extends string>(name: R) => ({
  all: (firmId: string) => [firmId, name] as const,
  /** Prefix of every list of this resource (any params). */
  lists: (firmId: string) => [firmId, name, "list"] as const,
  list: (firmId: string, params?: Params) => [firmId, name, "list", params ?? {}] as const,
  detail: (firmId: string, id: string) => [firmId, name, "detail", id] as const,
});

export const queryKeys = {
  candidates: resource("candidates"),
  jobs: {
    ...resource("jobs"),
    /** A candidate's searches and today's usage ("Find jobs", docs/02 §6.z): under `jobs`, so a capture refreshes it. */
    searches: (firmId: string, candidateId: string) => [firmId, "jobs", "searches", candidateId] as const,
    /** The search this tab started for the candidate, until its outcome is read (never fetched: set on the start). */
    startedSearch: (firmId: string, candidateId: string) => [firmId, "jobs", "started", candidateId] as const,
    /** One of a candidate's own jobs (the job page opened for that candidate): under the job's detail key. */
    candidateDetail: (firmId: string, candidateId: string, id: string) => [firmId, "jobs", "detail", id, candidateId] as const,
  },
  applications: {
    ...resource("applications"),
    /** Server counts per status; under `all` so a move invalidates them with the lists. */
    counts: (firmId: string, candidateId?: string | null) => [firmId, "applications", "counts", candidateId ?? null] as const,
    /** Mutation key for saving / unsaving a feed job (the heart), so pending saves can be read back. */
    savedJobs: (firmId: string) => [firmId, "applications", "savedJobs"] as const,
    /** Mutation key of status moves (the pending-move overlay reads it). */
    moves: (firmId: string) => [firmId, "applications", "move"] as const,
  },
  /** The signed-in user's own tailorings (their panel, docs/02 §8.3). */
  tailorings: { mine: (firmId: string) => [firmId, "tailorings", "mine"] as const },
  resumes: {
    ...resource("resumes"),
    byCandidate: (firmId: string, candidateId: string) => [firmId, "resumes", "byCandidate", candidateId] as const,
    /** One version's autofill, as the Autofill screen reads it; `autofillAll` is every version's. */
    autofill: (firmId: string, versionId: string) => [firmId, "resumes", "autofill", versionId] as const,
    autofillAll: (firmId: string) => [firmId, "resumes", "autofill"] as const,
  },
  records: { byCandidate: (firmId: string, candidateId: string) => [firmId, "records", "byCandidate", candidateId] as const },
  documents: { byCandidate: (firmId: string, candidateId: string) => [firmId, "documents", "byCandidate", candidateId] as const },
  inbox: { confirmation: (firm: string, candidate: string, attempt: string | null) => [firm, "mailbox-confirmation", candidate, attempt] as const, body: (firm: string, candidate: string, message?: string | null) => message === undefined ? [firm, "inbox-body", candidate] as const : [firm, "inbox-body", candidate, message] as const, byCandidate: (firmId: string, candidateId: string) => [firmId, "inbox", "byCandidate", candidateId] as const, reviews: (firmId: string, candidateId: string) => [firmId, "inbox", "reviews", candidateId] as const },
  ledger: { all: (firmId: string) => [firmId, "ledger"] as const, list: (firmId: string, params?: Params) => [firmId, "ledger", "list", params ?? {}] as const, whole: (firmId: string, params?: Params) => [firmId, "ledger", "whole", params ?? {}] as const },
  team: {
    all: (firmId: string) => [firmId, "team"] as const,
    list: (firmId: string) => [firmId, "team", "list"] as const,
    invites: (firmId: string) => [firmId, "team", "invites"] as const,
  },
  /** The signed-in person's own marks (docs/02 §6.x); a principal change clears the cache. */
  jobMarks: { mine: (firmId: string) => [firmId, "jobMarks", "mine"] as const },
  /** The signed-in person's own notifications (07 Q54): a firm user's are under their firm. */
  notifications: { mine: (firmId: string) => [firmId, "notifications", "mine"] as const },

  // not firm-scoped
  /** The platform tier (docs/07 §2.3): every firm's rows, PLATFORM_ADMIN only. One prefix, so an admin write refreshes it all. */
  platform: {
    all: () => ["platform"] as const,
    firms: () => ["platform", "firms"] as const,
    firm: (firmId: string) => ["platform", "firms", firmId] as const,
    users: (firmId?: string) => ["platform", "users", firmId ?? "all"] as const,
    invites: (firmId?: string | null) => ["platform", "invites", firmId === undefined ? "all" : (firmId ?? "platform")] as const,
    plans: () => ["platform", "plans"] as const,
    audit: () => ["platform", "audit"] as const,
    team: () => ["platform", "team"] as const,
    candidateUsage: () => ["platform", "candidateUsage"] as const,
    /** The Super Admin's own notifications (07 Q54). */
    notifications: () => ["platform", "notifications"] as const,
  },
  /** /invite/[token]: public, before anyone signs in. */
  invite: (token: string) => ["invite", token] as const,
  /** The mock parser's sample résumé names (not firm data: the same fixtures for every firm). */
  companies: {
    all: () => ["companies"] as const,
    detail: (id: string) => ["companies", "detail", id] as const,
  },
  session: {
    /** Every session key: the session and the firm by slug (what a firm-settings change refreshes). */
    all: () => ["session"] as const,
    current: () => ["session", "current"] as const,
    /** The firm a URL slug names, as the signed-in principal sees it (docs/07 §2.5). Keyed by slug: the firm id is what it resolves. Cleared with the rest of the cache on every principal change. */
    firmBySlug: (slug: string) => ["session", "firmBySlug", slug] as const,
  },
} as const;

/** Placeholder firm id for a query that is disabled because no firm is in context yet. */
export const NO_FIRM = "__no_firm__";
