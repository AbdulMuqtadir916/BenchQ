import type { DevPrincipalOption, Firm, FirmSession, Session } from "@/lib/schemas/session";

const mock = () => import("@/mocks/session").then((m) => m.sessionMock);

export const sessionApi = {
  /** Who is signed in (a firm user or a platform admin), or null when signed out. */
  current: async (): Promise<Session | null> => (await mock()).current(),

  /**
   * The firm a URL slug names, for the firm layout (docs/07 §2.5). 404 for an unknown slug and for a
   * firm the signed-in user doesn't belong to alike; 401 when signed out.
   */
  firmBySlug: async (slug: string): Promise<Firm> => (await mock()).firmBySlug(slug),

  /** The signed-in user finished or skipped /welcome: from now on they land on the dashboard (docs/07 T7). */
  finishFirstRun: async (): Promise<FirmSession> => (await mock()).finishFirstRun(),

  signOut: async (): Promise<null> => (await mock()).signOut(),

  /** DEV ONLY: every fixture principal, for the dev principal switcher. */
  devPrincipals: async (): Promise<DevPrincipalOption[]> => (await mock()).devPrincipals(),

  /** DEV ONLY: sign in as a fixture firm user or platform admin, or accept a listed pending invite and sign in as its new user. */
  devSignInAs: async (userId: string): Promise<Session> => (await mock()).devSignInAs(userId),
};
