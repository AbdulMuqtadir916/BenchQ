import type { Firm, FirmSession, Session } from "@/lib/schemas/session";

const mock = () => import("@/mocks/session").then((m) => m.sessionMock);

/**
 * The session layer (docs/07 Phase L, Q25–Q27). Who is signed in lives behind this adapter only: the
 * mock keeps it in `localStorage` (shared across tabs, like the cookie Phase D brings); screens and
 * stores never read storage themselves.
 */
export const sessionApi = {
  /** Who is signed in (a firm user or a platform admin), or null when signed out. */
  current: async (): Promise<Session | null> => (await mock()).current(),

  /**
   * Sign in with email + password. Every failure is the same 401 "Email or password is incorrect.",
   * so a caller can't tell an unknown email from a wrong password or a deactivated account.
   */
  signIn: async (email: string, password: string): Promise<Session> => (await mock()).signIn(email, password),

  signOut: async (): Promise<null> => (await mock()).signOut(),

  /** Start a read-only support view of a firm (07 §4, PLATFORM_ADMIN only). Ends any open one first. */
  startSupportView: async (firmId: string, reason: string): Promise<Session> => (await mock()).startSupportView(firmId, reason),

  /** End the open support view; `firmId` is the firm it was of, for the way back. */
  exitSupportView: async (): Promise<{ session: Session; firmId: string | null }> => (await mock()).exitSupportView(),

  /**
   * Call `onChange` when the session changes in another tab (signed in, out, or as someone else); then
   * ask `current()`. Returns the unsubscribe.
   */
  watch: (onChange: () => void): (() => void) => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void mock().then((m) => {
      if (!cancelled) stop = m.watch(onChange);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  },

  /**
   * The firm a URL slug names, for the firm layout (docs/07 §2.5). For a firm user: 404 for an unknown
   * slug and for a firm they don't belong to alike. For a platform admin: any existing firm, 404 for an
   * unknown slug. 401 when signed out.
   */
  firmBySlug: async (slug: string): Promise<Firm> => (await mock()).firmBySlug(slug),

  /** The signed-in user finished or skipped /welcome: from now on they land on the dashboard (docs/07 T7). */
  finishFirstRun: async (): Promise<FirmSession> => (await mock()).finishFirstRun(),
};
