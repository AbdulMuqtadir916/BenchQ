/**
 * Which API modules are served by the real backend. Everything else is served
 * by src/mocks. Set NEXT_PUBLIC_LIVE_MODULES=companies,jobs in .env.local.
 * Temporary: once every module is live and src/mocks is gone, delete this file.
 *
 * `session` is the onboarding flow (07 Q38): sign-in and the session, /invite/[token], the team list and the
 * /admin firms, plans, users, invites, team and audit. The other modules stay on mocks under the real
 * signed-in principal; a seeded demo account keeps its mock data (src/lib/api/dto/demo-ids.ts).
 *
 * Every other live module needs `session` too, since its endpoints answer only a signed-in cookie:
 * `NEXT_PUBLIC_LIVE_MODULES=session,ledger` (docs/integration/01-ledger.md).
 */
export type ApiModule =
  | "session"
  | "team"
  | "candidates"
  | "companies"
  | "jobs"
  | "records"
  | "resumes"
  | "applications"
  | "followups"
  | "documents"
  | "inbox"
  | "ledger"
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
