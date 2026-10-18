import { ApiError } from "@/lib/api/client";
import { DevPrincipalOptionSchema, FirmSchema, FirmSessionSchema, type DevPrincipalOption, type Firm, type FirmSession } from "@/lib/schemas/session";
import { currentPrincipal, currentUser, firmById, isSignedIn, signInAs, signOut } from "./auth";
import { allUsers, firms } from "./team";
import { invites, platformUsers } from "./tenancy";
import { acceptInvite, markActive } from "./invites";
import { effectiveInviteStatus } from "@/lib/derive/tenancy";
import { mockResult, wait } from "./_shared";

function sessionNow(): FirmSession {
  const principal = currentPrincipal();
  return FirmSessionSchema.parse({ principal, user: currentUser(), firm: firmById(principal.firmId) });
}

const ROLE_ORDER = ["OWNER", "MANAGER", "BDE", "VIEWER"] as const;

/**
 * DEV ONLY: who accepts which pending invite when picked in the switcher: what the person would type
 * on /invite/[token] (Phase S). The GSC owner lets /welcome (an OWNER's first run) be tested.
 */
const DEV_INVITE_ACCEPTANCES: Record<string, { userId: string; name: string }> = {
  inv_gsc_owner: { userId: "user_gsc_owner", name: "Sunita Rao" },
};

function pendingAcceptance(inviteId: string) {
  const invite = invites.find((item) => item.id === inviteId);
  const person = DEV_INVITE_ACCEPTANCES[inviteId];
  return invite && person && effectiveInviteStatus(invite, new Date()) === "PENDING" ? { invite, person } : null;
}

/** DEV ONLY: every fixture principal, grouped by firm in fixture order, then the platform admins. */
function devPrincipals(): DevPrincipalOption[] {
  const firmUsers = firms.flatMap((firm) =>
    allUsers
      .filter((user) => user.firmId === firm.id)
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
      .map((user) => ({
        id: user.id,
        name: user.name,
        kind: "firm" as const,
        role: user.role,
        firmId: firm.id,
        firmName: firm.name,
        firmStatus: firm.status,
        available: user.isActive,
        note: user.isActive ? null : "Inactive user",
      }))
      .concat(
        Object.keys(DEV_INVITE_ACCEPTANCES).flatMap((inviteId) => {
          const pending = pendingAcceptance(inviteId);
          if (!pending || pending.invite.firmId !== firm.id || pending.invite.role === "PLATFORM_ADMIN") return [];
          return [{ id: inviteId, name: pending.person.name, kind: "firm" as const, role: pending.invite.role, firmId: firm.id, firmName: firm.name, firmStatus: firm.status, available: true, note: "Accepts the pending invite, then signs in (first run)" }];
        }),
      ),
  );
  const admins = platformUsers.map((admin) => ({
    id: admin.id,
    name: admin.name,
    kind: "platform" as const,
    role: admin.role,
    firmId: null,
    firmName: null,
    firmStatus: null,
    available: false,
    note: "Platform sessions arrive with the admin area (Phase P)",
  }));
  return [...firmUsers, ...admins].map((option) => DevPrincipalOptionSchema.parse(option));
}

/**
 * The firm a URL slug names, for the firm layout (docs/07 §2.5). Only the signed-in user's own firm
 * resolves: an unknown slug and another firm's slug are the same 404, so a URL never confirms that a
 * firm exists (principle 4).
 */
function firmBySlug(slug: string): Firm {
  const principal = currentPrincipal();
  const firm = firms.find((item) => item.slug === slug);
  if (!firm || firm.id !== principal.firmId) throw new ApiError("Not found.", "NOT_FOUND", 404);
  return FirmSchema.parse(firm);
}

export const sessionMock = {
  /** Who is signed in, or null when signed out. */
  current: (): Promise<FirmSession | null> => mockResult(isSignedIn() ? sessionNow() : null),

  firmBySlug: async (slug: string): Promise<Firm> => {
    await wait();
    return structuredClone(firmBySlug(slug));
  },

  /** The signed-in user finished (or skipped) /welcome: they are active from now on (docs/07 T7). */
  finishFirstRun: (): Promise<FirmSession> => {
    markActive(currentUser().id);
    return mockResult(sessionNow());
  },

  signOut: async (): Promise<null> => {
    signOut();
    return mockResult(null);
  },

  devPrincipals: (): Promise<DevPrincipalOption[]> => mockResult(devPrincipals()),

  /** DEV ONLY: the dev principal switcher's "sign in as". */
  devSignInAs: (userId: string): Promise<FirmSession> => {
    if (platformUsers.some((admin) => admin.id === userId)) {
      throw new ApiError("Platform sessions arrive with the admin area (Phase P).", "NOT_AVAILABLE", 400);
    }
    // An invite id from the list: accept it as the dev acceptance's person, then sign in as them.
    const pending = pendingAcceptance(userId);
    signInAs(pending ? acceptInvite(pending.invite.id, pending.person).id : userId);
    return mockResult(sessionNow());
  },
};
