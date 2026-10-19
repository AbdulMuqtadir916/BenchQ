import { ApiError } from "@/lib/api/client";
import type { AcceptInviteInput, InviteLookup } from "@/lib/api/invites";
import type { Session } from "@/lib/schemas/session";
import { MIN_PASSWORD_LENGTH, setPassword, startSession } from "./auth";
import { injectedFailure } from "./membership";
import { acceptInvite, acceptPlatformInvite, inviteBlock } from "./invites";
import { inviteIdForToken } from "./invite-tokens";
import { sessionNow } from "./session";
import { firms } from "./team-data";
import { invites } from "./tenancy";
import { mockResult } from "./_shared";

/**
 * /invite/[token] against the mock backend (07 P4, Q26, Q28). Public: no session needed to look an
 * invite up; accepting creates the account, sets its password and signs it in (any other account in
 * this browser is signed out, the session being shared by tabs, Q27).
 */

let sequence = 0;
const newId = (prefix: string, now: Date) => `${prefix}_${now.getTime().toString(36)}${(sequence++).toString(36)}`;

function inviteFor(token: string) {
  const inviteId = inviteIdForToken(token);
  return inviteId ? (invites.find((invite) => invite.id === inviteId) ?? null) : null;
}

export const inviteFlowMock = {
  lookup: async (token: string, now = new Date()): Promise<InviteLookup> => {
    injectedFailure("invites.lookup");
    const invite = inviteFor(token);
    if (!invite) return mockResult({ status: "INVALID" });
    const firmName = invite.firmId ? (firms.find((firm) => firm.id === invite.firmId)?.name ?? null) : null;
    const block = inviteBlock(invite, now);
    return mockResult({ status: block ?? "VALID", firmName, email: invite.email, inviteeName: invite.inviteeName, role: invite.role, expiresAt: invite.expiresAt });
  },

  accept: async (token: string, input: AcceptInviteInput, now = new Date()): Promise<Session> => {
    injectedFailure("invites.accept");
    const invite = inviteFor(token);
    if (!invite) throw new ApiError("This invite link isn't valid.", "INVITE_INVALID", 410);
    const name = input.name.trim();
    if (!name) throw new ApiError("Enter your name.", "INVALID", 400);
    if (input.password.length < MIN_PASSWORD_LENGTH) throw new ApiError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`, "INVALID", 400);
    const account =
      invite.firmId === null
        ? acceptPlatformInvite(invite.id, { userId: newId("padm", now), name }, now)
        : acceptInvite(invite.id, { userId: newId("user", now), name }, now);
    setPassword(account.id, input.password);
    startSession(account.id);
    return mockResult(sessionNow());
  },
};
