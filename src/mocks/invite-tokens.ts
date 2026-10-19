import { z } from "zod";
import { table, changed } from "./db";
import { invites } from "./tenancy";

/**
 * The invite tokens (docs/02 §3.1: the `[token]` of /invite/[token] is an opaque secret the backend
 * owns — never a field of `Invite`, never in a fixture). The mock auth layer keeps the map here, persisted
 * like the rest of the demo data (src/mocks/db.ts). One live token per invite: a resend issues a new one
 * and the old link stops working (A9). Mock only: real tokens come with Phase D.
 */
const InviteTokenSchema = z.object({ token: z.string(), inviteId: z.string() });
type InviteToken = z.infer<typeof InviteTokenSchema>;

/** A fixture invite's token: derived from its id (FNV-1a), so a reload or a new tab finds the same link. */
function seedToken(inviteId: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const char of `benchq-invite:${inviteId}`) {
    a = Math.imul(a ^ char.charCodeAt(0), 0x01000193) >>> 0;
    b = Math.imul(b ^ char.charCodeAt(0), 0x811c9dc5) >>> 0;
  }
  return `iv_${a.toString(36)}${b.toString(36)}`;
}

function newToken(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return `iv_${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("")}`;
}

const tokens: InviteToken[] = table("inviteTokens", InviteTokenSchema, () => invites.map((invite) => ({ token: seedToken(invite.id), inviteId: invite.id })));

/** The invite a token opens, or null for an unknown (or replaced) token. */
export function inviteIdForToken(token: string): string | null {
  return tokens.find((item) => item.token === token)?.inviteId ?? null;
}

/** The invite's live token. */
export function tokenForInvite(inviteId: string): string | null {
  return tokens.find((item) => item.inviteId === inviteId)?.token ?? null;
}

/** A new token for the invite (sent or resent): any earlier one stops working. */
export function issueInviteToken(inviteId: string): string {
  for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i]!.inviteId === inviteId) tokens.splice(i, 1);
  const token = newToken();
  tokens.push({ token, inviteId });
  changed("inviteTokens");
  return token;
}
