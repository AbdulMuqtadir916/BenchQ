import type { Session } from "@/lib/schemas/session";
import { InviteBaseSchema, type Invite } from "@/lib/schemas/tenancy";
import { InviteLookupDto, SessionDto, toSession } from "./dto/session";
import { toIso } from "./dto/shared";
import { http } from "./http";
import { rememberLiveSession } from "./live-session";

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

const LookupFields = InviteBaseSchema.pick({ email: true, inviteeName: true, role: true, expiresAt: true });
const tokenPath = (token: string) => `/api/invites/${encodeURIComponent(token)}`;

/** The public side of an invite: no session needed. Accepting signs the new account in (backend/api/routes_invites.py). */
export const invitesApi = {
  lookup: async (token: string): Promise<InviteLookup> => {
    const dto = await http.get(tokenPath(token), InviteLookupDto);
    if (dto.status === "INVALID") return { status: "INVALID" };
    const fields = LookupFields.parse({ email: dto.email, inviteeName: dto.invitee_name, role: dto.role, expiresAt: toIso(dto.expires_at) });
    return { status: dto.status, firmName: dto.firm_name, ...fields };
  },
  accept: async (token: string, input: AcceptInviteInput): Promise<Session> => {
    const session = toSession(await http.post(`${tokenPath(token)}/accept`, SessionDto, { body: input }));
    rememberLiveSession(session);
    return session;
  },
};
