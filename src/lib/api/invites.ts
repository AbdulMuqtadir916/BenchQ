import type { Session } from "@/lib/schemas/session";
import type { Invite } from "@/lib/schemas/tenancy";

const mock = () => import("@/mocks/invite-flow").then((m) => m.inviteFlowMock);

/**
 * What /invite/[token] may show before anyone signs in (docs/04 §2.1, 07 P4). `INVALID` (an unknown or
 * replaced token) shows nothing about any invite. The other states name the firm and the offered role,
 * which the link's holder was sent anyway.
 */
export type InviteLookup =
  | { status: "INVALID" }
  | ({ status: "VALID" | "EXPIRED" | "REVOKED" | "ACCEPTED" | "SUSPENDED"; firmName: string | null } & Pick<Invite, "email" | "inviteeName" | "role" | "expiresAt">);

export interface AcceptInviteInput {
  name: string;
  password: string;
}

/** The public side of an invite: no session needed. Accepting signs the new account in. */
export const invitesApi = {
  lookup: async (token: string): Promise<InviteLookup> => (await mock()).lookup(token),
  accept: async (token: string, input: AcceptInviteInput): Promise<Session> => (await mock()).accept(token, input),
};
