/**
 * Which API modules are served by the real backend. Everything else is served by src/mocks. Set
 * NEXT_PUBLIC_LIVE_MODULES=companies,jobs in .env.local.
 * Temporary: once every module is live and src/mocks is gone, delete this file.
 *
 * The session, the team, the invites, the /admin firms, plans, users, invites and audit, and the ledger are
 * always the backend's (F6): there is no switch for them. The other modules stay on mocks under the real
 * signed-in principal (src/lib/api/live-session.ts) until their track lands.
 */
export type ApiModule =
  | "candidates"
  | "companies"
  | "jobs"
  | "records"
  | "resumes"
  | "applications"
  | "followups"
  | "documents"
  | "inbox"
  | "agents";

const liveModules = new Set(
  (process.env.NEXT_PUBLIC_LIVE_MODULES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);

export function isLive(module: ApiModule): boolean {
  return liveModules.has(module);
}
