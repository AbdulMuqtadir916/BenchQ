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
  jobs: resource("jobs"),
  applications: resource("applications"),
  followups: resource("followups"),
  resumes: {
    ...resource("resumes"),
    byCandidate: (firmId: string, candidateId: string) => [firmId, "resumes", "byCandidate", candidateId] as const,
  },
  records: { byCandidate: (firmId: string, candidateId: string) => [firmId, "records", "byCandidate", candidateId] as const },
  documents: { byCandidate: (firmId: string, candidateId: string) => [firmId, "documents", "byCandidate", candidateId] as const },
  inbox: { byCandidate: (firmId: string, candidateId: string) => [firmId, "inbox", "byCandidate", candidateId] as const },
  ledger: { list: (firmId: string, params?: Params) => [firmId, "ledger", "list", params ?? {}] as const },
  team: { list: (firmId: string) => [firmId, "team", "list"] as const },

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
  },
  /** /invite/[token]: public, before anyone signs in. */
  invite: (token: string) => ["invite", token] as const,
  companies: {
    all: () => ["companies"] as const,
    detail: (id: string) => ["companies", "detail", id] as const,
  },
  session: {
    current: () => ["session", "current"] as const,
    /** The firm a URL slug names, as the signed-in principal sees it (docs/07 §2.5). Keyed by slug: the firm id is what it resolves. Cleared with the rest of the cache on every principal change. */
    firmBySlug: (slug: string) => ["session", "firmBySlug", slug] as const,
  },
} as const;

/** Placeholder firm id for a query that is disabled because no firm is in context yet. */
export const NO_FIRM = "__no_firm__";
