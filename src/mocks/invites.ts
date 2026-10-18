import { ApiError } from "@/lib/api/client";
import { effectiveInviteStatus } from "@/lib/derive/tenancy";
import type { User } from "@/lib/schemas/session";
import { allLedger } from "./ledger";
import { allUsers, firms } from "./team";
import { invites } from "./tenancy";

/**
 * The mock backend's side of accepting an invite (docs/02 §3.1, Q18): the user is created (never
 * active yet, so an OWNER's landing is /welcome), the invite becomes ACCEPTED, an ONBOARDING firm
 * becomes ACTIVE when its OWNER accepts, and the firm's ledger gets INVITE_ACCEPTED. The
 * /invite/[token] page that drives it arrives with Phase S; until then the dev switcher does.
 */
export function acceptInvite(inviteId: string, person: { userId: string; name: string }, now = new Date()): User {
  const index = invites.findIndex((invite) => invite.id === inviteId);
  const invite = invites[index];
  if (!invite || effectiveInviteStatus(invite, now) !== "PENDING") throw new ApiError("This invite is no longer valid.", "INVITE_INVALID", 410);
  if (invite.firmId === null || invite.role === "PLATFORM_ADMIN") throw new ApiError("Platform invites arrive with Phase P.", "NOT_AVAILABLE", 400);
  const firmIndex = firms.findIndex((firm) => firm.id === invite.firmId);
  const firm = firms[firmIndex]!;

  const user: User = { id: person.userId, firmId: firm.id, name: person.name, email: invite.email, role: invite.role, avatarUrl: null, isActive: true, lastActiveAt: null };
  allUsers.push(user);
  invites[index] = { ...invite, status: "ACCEPTED" };
  const activates = invite.role === "OWNER" && firm.status === "ONBOARDING";
  if (activates) firms[firmIndex] = { ...firm, status: "ACTIVE" };
  allLedger.unshift({
    id: `ledger_${invite.id}_accepted`,
    firmId: firm.id,
    actorUserId: user.id,
    actorType: "USER",
    actorName: user.name,
    entityType: "invite",
    entityId: invite.id,
    entityLabel: invite.email,
    action: "INVITE_ACCEPTED",
    summary: `${user.name} accepted the ${invite.role} invite${activates ? "; firm is now active" : ""}`,
    modelId: null,
    promptVersion: null,
    evidenceIds: [],
    claimState: null,
    createdAt: now.toISOString(),
  });
  return user;
}

/** First run is over (docs/07 T7): the user is active from now on, so their landing is the dashboard. */
export function markActive(userId: string, now = new Date()): User {
  const index = allUsers.findIndex((user) => user.id === userId);
  if (index < 0) throw new ApiError("That user can't sign in here.", "UNKNOWN_USER", 400);
  allUsers[index] = { ...allUsers[index]!, lastActiveAt: now.toISOString() };
  return allUsers[index]!;
}
