import { z } from "zod";
import { CandidateInboxSchema, InboxMessageSchema, type CandidateInbox, type InboxMessage } from "@/lib/schemas/inbox";
import { fromBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

const BackendMessageSchema = z.object({
  id: z.string(), firm_id: z.string(), candidate_id: z.string(), application_id: z.string().nullable(),
  from_name: z.string(), from_email: z.string(), subject: z.string(), snippet: z.string(), body: z.string(),
  received_at: z.string(), is_read: z.boolean(), thread_id: z.string().nullable().optional(),
  classification_state: z.enum(["PENDING", "PROCESSING", "DONE", "ERROR"]).default("PENDING"),
  classification_error: z.string().nullable().default(null),
  classification: z.object({
    category: z.enum(["applied", "screening_call", "interview_schedule_request", "interview_scheduled", "offer", "shortlisted", "move_on", "incomplete_application", "assessment", "other"]),
    confidence: z.number().min(0).max(1), outcome: z.enum(["UNMATCHED", "REVIEW", "AUTO_APPLIED", "NO_CHANGE"]),
    probabilities: z.record(z.string(), z.number()),
  }).nullable().default(null),
});
const BackendConnectionSchema = z.object({
  firm_id: z.string(), candidate_id: z.string(), provider: z.literal("GOOGLE"), address: z.string(),
  connected_at: z.string(), last_synced_at: z.string().nullable(), status: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]),
  last_sync_error: z.string().nullable(),
});
export const BackendInboxSchema = z.object({
  firm_id: z.string(), candidate_id: z.string(), connection: BackendConnectionSchema.nullable(),
  messages: z.array(BackendMessageSchema),
});
export const BackendInboxMessageSchema = BackendMessageSchema;
export const BackendInboxReviewPageSchema = z.object({
  total: z.number().int().nonnegative(), messages: z.array(BackendMessageSchema),
});

export function toInboxMessage(dto: z.infer<typeof BackendMessageSchema>): InboxMessage {
  const category = dto.classification?.category.toUpperCase() as InboxMessage["signal"];
  const status = dto.classification?.category.toUpperCase() as InboxMessage["impliedStatus"];
  return InboxMessageSchema.parse({
    id: fromBackendId(dto.id), firmId: fromBackendId(dto.firm_id), candidateId: fromBackendId(dto.candidate_id),
    applicationId: dto.application_id ? fromBackendId(dto.application_id) : null, fromName: dto.from_name,
    fromEmail: dto.from_email, subject: dto.subject, snippet: dto.snippet, body: dto.body,
    receivedAt: toIso(dto.received_at), signal: category ?? null, isRead: dto.is_read,
    impliedStatus: status ?? null, scheduledFor: null,
    classificationState: dto.classification_state,
    classificationConfidence: dto.classification?.confidence ?? null,
    classificationOutcome: dto.classification?.outcome ?? null,
    classificationError: dto.classification_error,
  });
}

export function toCandidateInbox(dto: z.infer<typeof BackendInboxSchema>): CandidateInbox {
  return CandidateInboxSchema.parse({
    firmId: fromBackendId(dto.firm_id), candidateId: fromBackendId(dto.candidate_id),
    connection: dto.connection ? {
      firmId: fromBackendId(dto.connection.firm_id), candidateId: fromBackendId(dto.connection.candidate_id),
      provider: dto.connection.provider, address: dto.connection.address, connectedAt: toIso(dto.connection.connected_at),
      lastSyncedAt: toIsoOrNull(dto.connection.last_synced_at), status: dto.connection.status,
      lastSyncError: dto.connection.last_sync_error,
    } : null,
    messages: dto.messages.map(toInboxMessage),
  });
}
