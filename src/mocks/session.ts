import { ApiError } from "@/lib/api/client";
import { DevPrincipalOptionSchema, FirmSchema, FirmSessionSchema, type DevPrincipalOption, type Firm, type FirmSession } from "@/lib/schemas/session";
import { currentPrincipal, currentUser, firmById, isSignedIn, signInAs, signOut } from "./auth";
import { allUsers, firms } from "./team";
import { platformUsers } from "./tenancy";
import { mockResult, wait } from "./_shared";

function sessionNow(): FirmSession {
  const principal = currentPrincipal();
  return FirmSessionSchema.parse({ principal, user: currentUser(), firm: firmById(principal.firmId) });
}

const ROLE_ORDER = ["OWNER", "MANAGER", "BDE", "VIEWER"] as const;

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
      })),
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
    signInAs(userId);
    return mockResult(sessionNow());
  },
};
