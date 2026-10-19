import { ApiError } from "@/lib/api/client";
import { effectiveInviteStatus } from "@/lib/derive/tenancy";
import type { User } from "@/lib/schemas/session";
import type { Invite, PlatformUser } from "@/lib/schemas/tenancy";
import { allLedger } from "./ledger";
import { allUsers, firms } from "./team";
import { invites, platformUsers } from "./tenancy";
import { changed } from "./db";

/**
 * The mock backend's side of accepting an invite (docs/02 §3.1, Q18, 07 P4): the account is created
 * (a firm user never active yet, so an OWNER's landing is /welcome; or a platform admin for a staff
 * invite), the invite becomes ACCEPTED, an ONBOARDING firm becomes ACTIVE when its OWNER accepts, and
 * the ledger gets INVITE_ACCEPTED (the firm's, or the platform's for staff). An invite to a SUSPENDED
 * firm is refused and stays PENDING (Q28). /invite/[token] drives it through src/mocks/invite-flow.ts.
 */

/** Why an invite can't be accepted right now, or null when it can (the order the page checks them in). */
export type InviteBlock = "ACCEPTED" | "REVOKED" | "EXPIRED" | "SUSPENDED";

export function inviteBlock(invite: Invite, now: Date): InviteBlock | null {
  const status = effectiveInviteStatus(invite, now);
  if (status === "ACCEPTED" || status === "REVOKED" || status === "EXPIRED") return status;
  const firm = invite.firmId ? firms.find((item) => item.id === invite.firmId) : null;
  if (firm?.status === "SUSPENDED") return "SUSPENDED";
  return null;
}

const BLOCK_MESSAGE: Record<InviteBlock, string> = {
  ACCEPTED: "This invite has already been accepted.",
  REVOKED: "This invite was revoked.",
  EXPIRED: "This invite has expired.",
  SUSPENDED: "Workspace suspended. This invite can't be accepted right now.",
};

function acceptable(inviteId: string, now: Date): { index: number; invite: Invite } {
  const index = invites.findIndex((invite) => invite.id === inviteId);
  const invite = invites[index];
  if (!invite) throw new ApiError("This invite is no longer valid.", "INVITE_INVALID", 410);
  const block = inviteBlock(invite, now);
  if (block === "SUSPENDED") throw new ApiError(BLOCK_MESSAGE.SUSPENDED, "FIRM_SUSPENDED", 403);
  if (block) throw new ApiError(`This invite is no longer valid. ${BLOCK_MESSAGE[block]}`, "INVITE_INVALID", 410);
  const email = invite.email.toLowerCase();
  if (allUsers.some((user) => user.email.toLowerCase() === email) || platformUsers.some((user) => user.email.toLowerCase() === email)) {
    throw new ApiError("An account with this email already exists. Sign in instead.", "EMAIL_TAKEN", 409);
  }
  return { index, invite };
}

function logAccepted(invite: Invite, actor: { id: string; name: string }, summary: string, now: Date): void {
  allLedger.unshift({
    id: `ledger_${invite.id}_accepted`,
    firmId: invite.firmId,
    actorUserId: actor.id,
    actorType: invite.firmId ? "USER" : "PLATFORM_ADMIN",
    actorName: actor.name,
    entityType: "invite",
    entityId: invite.id,
    entityLabel: invite.email,
    action: "INVITE_ACCEPTED",
    summary,
    modelId: null,
    promptVersion: null,
    evidenceIds: [],
    claimState: null,
    createdAt: now.toISOString(),
  });
}

/** A firm invite: the user is created in the invite's firm with the invite's role. */
export function acceptInvite(inviteId: string, person: { userId: string; name: string }, now = new Date()): User {
  const { index, invite } = acceptable(inviteId, now);
  if (invite.firmId === null || invite.role === "PLATFORM_ADMIN") throw new ApiError("This is a platform-team invite.", "WRONG_INVITE", 400);
  const firmIndex = firms.findIndex((firm) => firm.id === invite.firmId);
  const firm = firms[firmIndex]!;

  const user: User = { id: person.userId, firmId: firm.id, name: person.name, email: invite.email, role: invite.role, avatarUrl: null, isActive: true, lastActiveAt: null };
  allUsers.push(user);
  invites[index] = { ...invite, status: "ACCEPTED" };
  const activates = invite.role === "OWNER" && firm.status === "ONBOARDING";
  if (activates) firms[firmIndex] = { ...firm, status: "ACTIVE" };
  logAccepted(invite, user, `${user.name} accepted the ${invite.role} invite${activates ? "; firm is now active" : ""}`, now);
  changed("users", "invites", "firms", "ledger");
  return user;
}

/** A platform-team invite (A11): the person joins BenchQ staff as a Super Admin. */
export function acceptPlatformInvite(inviteId: string, person: { userId: string; name: string }, now = new Date()): PlatformUser {
  const { index, invite } = acceptable(inviteId, now);
  if (invite.firmId !== null || invite.role !== "PLATFORM_ADMIN") throw new ApiError("This is a firm invite.", "WRONG_INVITE", 400);
  const admin: PlatformUser = { id: person.userId, name: person.name, email: invite.email, role: "PLATFORM_ADMIN", isActive: true, lastActiveAt: now.toISOString() };
  platformUsers.push(admin);
  invites[index] = { ...invite, status: "ACCEPTED" };
  logAccepted(invite, admin, `${admin.name} joined the platform team`, now);
  changed("platformUsers", "invites", "ledger");
  return admin;
}

/** First run is over (docs/07 T7): the user is active from now on, so their landing is the dashboard. */
export function markActive(userId: string, now = new Date()): User {
  const index = allUsers.findIndex((user) => user.id === userId);
  if (index < 0) throw new ApiError("That user can't sign in here.", "UNKNOWN_USER", 400);
  allUsers[index] = { ...allUsers[index]!, lastActiveAt: now.toISOString() };
  changed("users");
  return allUsers[index]!;
}
