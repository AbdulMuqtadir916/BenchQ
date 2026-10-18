import type { DevPrincipalOption, Firm, FirmSession } from "@/lib/schemas/session";

const mock = () => import("@/mocks/session").then((m) => m.sessionMock);

export const sessionApi = {
  /** Who is signed in, or null when signed out. Platform sessions are served from Phase P. */
  current: async (): Promise<FirmSession | null> => (await mock()).current(),

  /**
   * The firm a URL slug names, for the firm layout (docs/07 §2.5). 404 for an unknown slug and for a
   * firm the signed-in user doesn't belong to alike; 401 when signed out.
   */
  firmBySlug: async (slug: string): Promise<Firm> => (await mock()).firmBySlug(slug),

  signOut: async (): Promise<null> => (await mock()).signOut(),

  /** DEV ONLY: every fixture principal, for the dev principal switcher. */
  devPrincipals: async (): Promise<DevPrincipalOption[]> => (await mock()).devPrincipals(),

  /** DEV ONLY: sign in as a fixture firm user. */
  devSignInAs: async (userId: string): Promise<FirmSession> => (await mock()).devSignInAs(userId),
};
