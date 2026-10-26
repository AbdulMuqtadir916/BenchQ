import { z } from "zod";
import type { Firm, FirmSession, Session } from "@/lib/schemas/session";
import { ApiError } from "./client";
import { toBackendId } from "./dto/demo-ids";
import { FirmDto, SessionDto, SupportExitDto, toFirm, toSession, toSupportExit } from "./dto/session";
import { http } from "./http";
import { rememberLiveSession, watchLiveSession } from "./live-session";

/**
 * The backend's session (07-auth F3): GET /api/auth/me and friends. Every answer is remembered for the modules
 * still on mocks, which read the signed-in principal from it (src/lib/api/live-session.ts).
 */
const live = {
  current: async (): Promise<Session | null> => {
    try {
      const session = toSession(await http.get("/api/auth/me", SessionDto));
      rememberLiveSession(session, { broadcast: false });
      return session;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        rememberLiveSession(null, { broadcast: false });
        return null;
      }
      throw error;
    }
  },
  signIn: async (email: string, password: string): Promise<Session> => {
    const session = toSession(await http.post("/api/auth/sign-in", SessionDto, { body: { email, password } }));
    rememberLiveSession(session);
    return session;
  },
  signOut: async (): Promise<null> => {
    await http.post("/api/auth/sign-out", z.unknown());
    rememberLiveSession(null);
    return null;
  },
  firmBySlug: async (slug: string): Promise<Firm> => toFirm(await http.get(`/api/firms/by-slug/${encodeURIComponent(slug)}`, FirmDto)),
  finishFirstRun: async (): Promise<FirmSession> => {
    const session = toSession(await http.post("/api/auth/first-run-done", SessionDto));
    rememberLiveSession(session, { broadcast: false });
    if (!("user" in session)) throw new ApiError("Only a firm user has a first run.", "FORBIDDEN", 403);
    return session;
  },
  // A view changes the principal for every tab on this cookie, so other tabs are told, as on sign-in.
  startSupportView: async (firmId: string, reason: string): Promise<Session> => {
    const session = toSession(await http.post("/api/support-views", SessionDto, { body: { firm_id: toBackendId(firmId), reason } }));
    rememberLiveSession(session);
    return session;
  },
  exitSupportView: async (): Promise<{ session: Session; firmId: string | null }> => {
    const exited = toSupportExit(await http.delete("/api/support-views/current", SupportExitDto));
    rememberLiveSession(exited.session);
    return exited;
  },
};

/**
 * The session layer (docs/07 Phase L, Q25–Q27; F6). Who is signed in is the backend's cookie session; screens
 * and stores reach it only through this adapter. A change in one tab reaches the others over a BroadcastChannel.
 */
export const sessionApi = {
  /** Who is signed in (a firm user or a platform admin), or null when signed out. */
  current: live.current,

  /**
   * Sign in with email + password. Every failure is the same 401 "Email or password is incorrect.",
   * so a caller can't tell an unknown email from a wrong password or a deactivated account.
   */
  signIn: live.signIn,

  signOut: live.signOut,

  /** Start a read-only support view of a firm (07 §4, PLATFORM_ADMIN only). Ends any open one first. */
  startSupportView: live.startSupportView,

  /** End the open support view; `firmId` is the firm it was of, for the way back. */
  exitSupportView: live.exitSupportView,

  /**
   * Call `onChange` when the session changes in another tab (signed in, out, or as someone else); then
   * ask `current()`. Returns the unsubscribe.
   */
  watch: (onChange: () => void): (() => void) => watchLiveSession(onChange),

  /**
   * The firm a URL slug names, for the firm layout (docs/07 §2.5). For a firm user: 404 for an unknown
   * slug and for a firm they don't belong to alike. For a platform admin: any existing firm, 404 for an
   * unknown slug. 401 when signed out.
   */
  firmBySlug: live.firmBySlug,

  /** The signed-in user finished or skipped /welcome: from now on they land on the dashboard (docs/07 T7). */
  finishFirstRun: live.finishFirstRun,
};
