import type { User } from "@/lib/schemas/session";
import type { Invite } from "@/lib/schemas/tenancy";
import { arrayOf } from "./client";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import { InviteDto, InviteWithTokenDto, UserDto, toInvite, toUser } from "./dto/session";
import { http } from "./http";

const mock = () => import("@/mocks/team").then((m) => m.teamMock);
const invitesMock = () => import("@/mocks/member-invites").then((m) => m.memberInvitesMock);

/** docs/07 Phase M: the OWNER invites a MANAGER, BDE or VIEWER (never an OWNER, A10). */
export interface InviteMemberInput {
  email: string;
  role: "MANAGER" | "BDE" | "VIEWER";
  /** Prefilled on /invite/[token] (Q31); null = not given. */
  inviteeName: string | null;
}

/** The invite and its link's token: shown once, when sent or resent (07 Q38). The link is /invite/[token]. */
export interface InviteWithLink {
  invite: Invite;
  token: string;
}

const firmPath = (firmId: string) => `/api/firms/${toBackendId(firmId)}`;
const withLink = (dto: { invite: Parameters<typeof toInvite>[0]; invite_token: string }): InviteWithLink => ({ invite: toInvite(dto.invite), token: dto.invite_token });

/** backend/api/routes_team.py, behind the session switch. */
const live = {
  list: async (firmId: string) => (await http.get(`${firmPath(firmId)}/members`, arrayOf(UserDto))).map(toUser),
  invites: async (firmId: string) => (await http.get(`${firmPath(firmId)}/invites`, arrayOf(InviteDto))).map(toInvite),
  invite: async (firmId: string, input: InviteMemberInput) =>
    withLink(await http.post(`${firmPath(firmId)}/invites`, InviteWithTokenDto, { body: { email: input.email, role: input.role, invitee_name: input.inviteeName } })),
  resendInvite: async (firmId: string, inviteId: string) =>
    withLink(await http.post(`${firmPath(firmId)}/invites/${toBackendId(inviteId)}/resend`, InviteWithTokenDto)),
  revokeInvite: async (firmId: string, inviteId: string) =>
    toInvite(await http.post(`${firmPath(firmId)}/invites/${toBackendId(inviteId)}/revoke`, InviteDto)),
};

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const teamApi = {
  /** On a live session a real firm's members come from the backend, not the fixtures. */
  list: async (firmId: string): Promise<User[]> => (isLive("session") ? live.list(firmId) : (await mock()).list(firmId)),

  /** The firm's invites, newest first, with the effective status (A9). OWNER and MANAGER (`team.view`). */
  invites: async (firmId: string): Promise<Invite[]> => (isLive("session") ? live.invites(firmId) : (await invitesMock()).list(firmId)),

  /** OWNER only (`member.invite`). Blocked at the seat limit (A4); one email is one account. */
  invite: async (firmId: string, input: InviteMemberInput): Promise<InviteWithLink> =>
    isLive("session") ? live.invite(firmId, input) : (await invitesMock()).invite(firmId, input),

  /** A new link and 7 more days; the old link stops. Also how "Copy link" works (07 Q38). */
  resendInvite: async (firmId: string, inviteId: string): Promise<InviteWithLink> =>
    isLive("session") ? live.resendInvite(firmId, inviteId) : (await invitesMock()).resend(firmId, inviteId),

  revokeInvite: async (firmId: string, inviteId: string): Promise<Invite> =>
    isLive("session") ? live.revokeInvite(firmId, inviteId) : (await invitesMock()).revoke(firmId, inviteId),
};
