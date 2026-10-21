import { ApiError } from "@/lib/api/client";
import type { InviteMemberInput, InviteWithLink } from "@/lib/api/team";
import { ENTITY, seatBlockReason, usageOf } from "@/lib/derive/platform";
import { effectiveInviteStatus } from "@/lib/derive/tenancy";
import type { Invite } from "@/lib/schemas/tenancy";
import { firmById, currentUser } from "./auth";
import { allCandidates } from "./candidates";
import { changed } from "./db";
import { issueInviteToken } from "./invite-tokens";
import { logFirmAction } from "./ledger";
import { firmScoped, requireAction } from "./membership";
import { DAY_MS, INVITE_DAYS, checkEmail, checkEmailFree } from "./platform";
import { allUsers } from "./team-data";
import { invites } from "./tenancy";
import { mockResult, newId, notFound } from "./_shared";

/**
 * The firm side of invites (docs/07 Phase M, M1; 07 Q38), the same rules as backend/api/routes_team.py: the
 * OWNER invites a MANAGER, BDE or VIEWER (never an OWNER, A10), resends and revokes; the firm's own OWNER
 * invite is the Super Admin's. Blocked at the seat limit (A4). The link's token is returned when the invite
 * is sent or resent and never again (only its hash would be stored), so "Copy link" is a resend.
 */

export const MEMBER_ROLES = ["MANAGER", "BDE", "VIEWER"] as const;

const conflict = (message: string, code = "CONFLICT") => new ApiError(message, code, 409);

function checkSeat(firmId: string, now: Date): void {
  const usage = usageOf(firmById(firmId), { users: allUsers, invites, candidates: allCandidates }, now);
  if (!usage.canAddSeat) throw conflict(seatBlockReason(usage), "SEAT_LIMIT");
}

function memberInvite(firmId: string, inviteId: string): Invite {
  const invite = invites.find((item) => item.id === inviteId && item.firmId === firmId) ?? notFound("Invite", inviteId);
  if (invite.role === "OWNER") throw new ApiError("Only BenchQ can resend or revoke the owner's invite.", "FORBIDDEN", 403);
  return invite;
}

const withStatus = (invite: Invite, now: Date): Invite => ({ ...invite, status: effectiveInviteStatus(invite, now) });

export const memberInvitesMock = firmScoped("memberInvites", {
  /** The firm's invites, newest first, with the effective status (A9). OWNER and MANAGER (`team.view`). */
  list: (firmId: string, now = new Date()): Promise<Invite[]> => {
    requireAction("team.view");
    return mockResult(invites.filter((invite) => invite.firmId === firmId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((invite) => withStatus(invite, now)));
  },

  invite: (firmId: string, input: InviteMemberInput, now = new Date()): Promise<InviteWithLink> => {
    if (!(MEMBER_ROLES as readonly string[]).includes(input.role)) throw new ApiError("Choose Manager, BDE or Viewer.", "INVALID", 400);
    const email = checkEmail(input.email);
    checkEmailFree(email, now);
    checkSeat(firmId, now);
    const name = input.inviteeName?.trim() || null;
    const invite: Invite = {
      id: newId("inv", now), firmId, email, inviteeName: name, role: input.role, invitedByUserId: currentUser().id,
      status: "PENDING", expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS).toISOString(), createdAt: now.toISOString(),
    };
    invites.unshift(invite);
    changed("invites");
    logFirmAction({ firmId, entityType: ENTITY.invite, entityId: invite.id, entityLabel: email, action: "INVITE_SENT", summary: `Invited ${name ? `${name} (${email})` : email} as ${input.role}` }, now);
    return mockResult({ invite, token: issueInviteToken(invite.id) });
  },

  /** A new link and 7 more days (A9); the old link stops. Also "Copy link". An expired one needs a free seat. */
  resend: (firmId: string, inviteId: string, now = new Date()): Promise<InviteWithLink> => {
    const invite = memberInvite(firmId, inviteId);
    const status = effectiveInviteStatus(invite, now);
    if (status !== "PENDING" && status !== "EXPIRED") throw conflict("Only a pending or expired invite can be resent.");
    if (status === "EXPIRED") {
      checkEmailFree(invite.email, now);
      checkSeat(firmId, now);
    }
    Object.assign(invite, { status: "PENDING", expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS).toISOString() });
    changed("invites");
    logFirmAction({ firmId, entityType: ENTITY.invite, entityId: invite.id, entityLabel: invite.email, action: "INVITE_SENT", summary: `Invite resent to ${invite.email}` }, now);
    return mockResult({ invite: { ...invite }, token: issueInviteToken(invite.id) });
  },

  revoke: (firmId: string, inviteId: string, now = new Date()): Promise<Invite> => {
    const invite = memberInvite(firmId, inviteId);
    if (effectiveInviteStatus(invite, now) !== "PENDING") throw conflict("Only a pending invite can be revoked.");
    invite.status = "REVOKED";
    changed("invites");
    logFirmAction({ firmId, entityType: ENTITY.invite, entityId: invite.id, entityLabel: invite.email, action: "INVITE_REVOKED", summary: `Revoked the invite to ${invite.email}` }, now);
    return mockResult({ ...invite });
  },
}, { invite: "member.invite", resend: "member.invite", revoke: "member.invite" });
