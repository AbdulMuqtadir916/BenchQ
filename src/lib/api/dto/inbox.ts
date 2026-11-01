import { z } from "zod";
import { CandidateInboxSchema, InboxMessageSchema, type CandidateInbox, type InboxMessage } from "@/lib/schemas/inbox";
import { fromBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

export const BackendInboxMessageSchema = z.object({
  id: z.string(), firm_id: z.string(), candidate_id: z.string(), application_id: z.string().nullable(),
  from_name: z.string(), from_email: z.string(), subject: z.string(), snippet: z.string(), body: z.string(),
  received_at: z.string(), is_read: z.boolean(), source_address: z.string().default(""),
});
export const BackendInboxSchema = z.object({
  firm_id: z.string(), candidate_id: z.string(),
  connection: z.object({
    firm_id: z.string(), candidate_id: z.string(), provider: z.literal("GOOGLE"), address: z.string(),
    connected_at: z.string(), last_synced_at: z.string().nullable(),
    status: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]), last_sync_error: z.string().nullable(),
  }).nullable(), messages: z.array(BackendInboxMessageSchema),
});
export function toInboxMessage(dto: z.infer<typeof BackendInboxMessageSchema>): InboxMessage {
  return InboxMessageSchema.parse({
    id: fromBackendId(dto.id), firmId: fromBackendId(dto.firm_id), candidateId: fromBackendId(dto.candidate_id),
    applicationId: dto.application_id ? fromBackendId(dto.application_id) : null,
    fromName: dto.from_name, fromEmail: dto.from_email, subject: dto.subject, snippet: dto.snippet, body: dto.body,
    receivedAt: toIso(dto.received_at), isRead: dto.is_read, sourceAddress: dto.source_address,
    signal: null, impliedStatus: null, scheduledFor: null,
  });
}
export function toCandidateInbox(dto: z.infer<typeof BackendInboxSchema>): CandidateInbox {
  return CandidateInboxSchema.parse({
    firmId: fromBackendId(dto.firm_id),
    connection: dto.connection ? {
      firmId: fromBackendId(dto.connection.firm_id), candidateId: fromBackendId(dto.connection.candidate_id),
      provider: dto.connection.provider, address: dto.connection.address, connectedAt: toIso(dto.connection.connected_at),
      lastSyncedAt: toIsoOrNull(dto.connection.last_synced_at), status: dto.connection.status,
      lastSyncError: dto.connection.last_sync_error,
    } : null, messages: dto.messages.map(toInboxMessage),
  });
}
