import { z } from "zod";
import { CandidateInboxSchema, EmailCategory, EmailReviewPageSchema, InboxMessageSchema, type CandidateInbox, type EmailReviewPage, type InboxMessage, type ReviewEmailCommand } from "@/lib/schemas/inbox";
import { toBackendStatus } from "./applications";
import { fromBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

export const BackendInboxMessageSchema = z.object({
  id: z.string(), firm_id: z.string(), candidate_id: z.string(), application_id: z.string().nullable(),
  from_name: z.string(), from_email: z.string(), subject: z.string(), snippet: z.string(), body: z.string(),
  classification_state: z.enum(["NOT_QUEUED", "PENDING", "PROCESSING", "DONE", "ERROR", "EXCLUDED"]).default("NOT_QUEUED"),
  received_at: z.string(), is_read: z.boolean(), source_address: z.string().default(""),
  content_revision: z.number().int().optional(), classification_version: z.number().int().optional(),
  classification_category: z.string().nullable().optional(), classification_confidence: z.number().nullable().optional(),
  classification_error: z.string().nullable().optional(), classification_retry_exhausted: z.boolean().optional(),
});
export const BackendInboxSchema = z.object({
  firm_id: z.string(), candidate_id: z.string(),
  connection: z.object({
    firm_id: z.string(), candidate_id: z.string(), provider: z.literal("GOOGLE"), address: z.string(),
    connected_at: z.string(), last_synced_at: z.string().nullable(),
    status: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]), last_sync_error: z.string().nullable(),
    sync_state: z.enum(["IDLE", "QUEUED", "IMPORTING", "FAILED"]).default("IDLE"),
  }).nullable(), messages: z.array(BackendInboxMessageSchema),
  next_cursor: z.string().nullable().default(null), total_count: z.number().int().nonnegative().optional(),
  hidden_count: z.number().int().nonnegative().optional(),
});
export function toInboxMessage(dto: z.infer<typeof BackendInboxMessageSchema>): InboxMessage {
  return InboxMessageSchema.parse({
    id: fromBackendId(dto.id), firmId: fromBackendId(dto.firm_id), candidateId: fromBackendId(dto.candidate_id),
    applicationId: dto.application_id ? fromBackendId(dto.application_id) : null,
    fromName: dto.from_name, fromEmail: dto.from_email, subject: dto.subject, snippet: dto.snippet, body: dto.body,
    receivedAt: toIso(dto.received_at), isRead: dto.is_read, sourceAddress: dto.source_address,
    classificationState: dto.classification_state,
    signal: null, impliedStatus: null, scheduledFor: null,
    contentRevision: dto.content_revision, classificationVersion: dto.classification_version,
    classificationCategory: EmailCategory.safeParse(dto.classification_category).data ?? null,
    classificationConfidence: dto.classification_confidence ?? null,
    classificationError: dto.classification_error ?? null,
    classificationRetryExhausted: dto.classification_retry_exhausted ?? false,
  });
}
export function toCandidateInbox(dto: z.infer<typeof BackendInboxSchema>): CandidateInbox {
  return CandidateInboxSchema.parse({
    firmId: fromBackendId(dto.firm_id),
    connection: dto.connection ? {
      firmId: fromBackendId(dto.connection.firm_id), candidateId: fromBackendId(dto.connection.candidate_id),
      provider: dto.connection.provider, address: dto.connection.address, connectedAt: toIso(dto.connection.connected_at),
      lastSyncedAt: toIsoOrNull(dto.connection.last_synced_at), status: dto.connection.status,
      lastSyncError: dto.connection.last_sync_error, syncState: dto.connection.sync_state,
    } : null, messages: dto.messages.map(toInboxMessage), nextCursor: dto.next_cursor, totalCount: dto.total_count ?? dto.messages.length,
    hiddenCount: dto.hidden_count,
  });
}

export const BackendEmailReviewPageSchema = z.object({
  reviews: z.array(z.object({
    id: z.string(), message_id: z.string(), application_id: z.string().nullable(), revision: z.number().int(),
    application_revision: z.number().int().nullable(), reason: z.string(), created_at: z.string(),
    subject: z.string().default(""), from_name: z.string().default(""), received_at: z.string().nullable().default(null),
  })),
  next_cursor: z.string().nullable().default(null),
  total_count: z.number().int().nonnegative(),
});

export function toEmailReviewPage(dto: z.infer<typeof BackendEmailReviewPageSchema>): EmailReviewPage {
  return EmailReviewPageSchema.parse({
    reviews: dto.reviews.map((r) => ({
      id: r.id, messageId: fromBackendId(r.message_id), applicationId: r.application_id ? fromBackendId(r.application_id) : null,
      revision: r.revision, applicationRevision: r.application_revision, reason: r.reason,
      subject: r.subject, fromName: r.from_name, receivedAt: toIsoOrNull(r.received_at), createdAt: toIso(r.created_at),
    })),
    nextCursor: dto.next_cursor,
    totalCount: dto.total_count,
  });
}

/** The backend review command body. Dismiss carries no application fields (D-08). */
export function toBackendReviewCommand(command: ReviewEmailCommand, commandId: string, toBackendIdFn: (id: string) => string) {
  const dismiss = command.action === "DISMISS_NON_APPLICATION";
  return {
    review_id: command.reviewId,
    command_id: commandId,
    expected_review_revision: command.expectedReviewRevision,
    expected_content_revision: command.expectedContentRevision,
    application_id: dismiss || !command.applicationId ? null : toBackendIdFn(command.applicationId),
    expected_application_revision: dismiss ? null : command.expectedApplicationRevision,
    action: command.action,
    status: command.action === "SET_STATUS" && command.status ? toBackendStatus(command.status) : null,
    note: command.note,
  };
}
