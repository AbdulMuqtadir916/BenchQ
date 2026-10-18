import type { DevPrincipalOption, FirmSession } from "@/lib/schemas/session";

const mock = () => import("@/mocks/session").then((m) => m.sessionMock);

export const sessionApi = {
  /** Who is signed in. Platform sessions are served from Phase P. */
  current: async (): Promise<FirmSession> => (await mock()).current(),

  /** DEV ONLY: every fixture principal, for the dev principal switcher. */
  devPrincipals: async (): Promise<DevPrincipalOption[]> => (await mock()).devPrincipals(),

  /** DEV ONLY: sign in as a fixture firm user. */
  devSignInAs: async (userId: string): Promise<FirmSession> => (await mock()).devSignInAs(userId),
};
