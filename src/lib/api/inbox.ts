import { z } from "zod";
import type { CandidateInbox, EmailReviewPage, InboxMessage, ReviewEmailCommand } from "@/lib/schemas/inbox";
import { newCommandId } from "@/lib/utils";
import { http } from "./http";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import { BackendEmailReviewPageSchema, BackendInboxSchema, BackendInboxMessageSchema, toBackendReviewCommand, toCandidateInbox, toEmailReviewPage, toInboxMessage } from "./dto/inbox";
const mock = () => import("@/mocks/inbox").then((m) => m.inboxMock);
const base = (firm: string, candidate: string) => `/api/firms/${toBackendId(firm)}/candidates/${toBackendId(candidate)}`;
const AuthorizationSchema = z.object({ authorization_url: z.string().url().refine((value) => {
  const url = new URL(value);
  return url.origin === "https://accounts.google.com" && url.pathname === "/o/oauth2/v2/auth";
}) });

export const inboxApi = {
  confirmation: async (firm: string, candidate: string, attempt: string) => http.get(base(firm, candidate) + `/mailbox/confirm/${encodeURIComponent(attempt)}`, z.object({address: z.string()})),
  confirm: async (firm: string, candidate: string, attempt: string) => toCandidateInbox(await http.post(base(firm, candidate) + `/mailbox/confirm/${encodeURIComponent(attempt)}`, BackendInboxSchema)),
  cancelConfirmation: async (firm: string, candidate: string, attempt: string) => http.delete(base(firm, candidate) + `/mailbox/confirm/${encodeURIComponent(attempt)}`, z.object({cleanup_pending: z.boolean()})),
  deleteContent: async (firm: string, candidate: string, message?: string, disconnect = false) => toCandidateInbox(await http.delete(base(firm, candidate) + "/inbox-content", BackendInboxSchema, {query: {message_id: message, disconnect}})),
  byCandidate: async (firmId: string, candidateId: string, messageId?: string, cursor?: string | null): Promise<CandidateInbox> => isLive("inbox")
    ? toCandidateInbox(await http.get(base(firmId, candidateId) + "/inbox", BackendInboxSchema, {query: {message_id: messageId, cursor}}))
    : (await mock()).byCandidate(firmId, candidateId),
  connect: async (firmId: string, candidateId: string, returnTo = "/"): Promise<string | CandidateInbox> => isLive("inbox")
    ? (await http.post(base(firmId, candidateId) + "/mailbox/oauth", AuthorizationSchema, { body: { return_to: returnTo } })).authorization_url
    : (await mock()).connect(firmId, candidateId),
  sync: async (firmId: string, candidateId: string): Promise<CandidateInbox> => isLive("inbox")
    ? toCandidateInbox((await http.post(base(firmId, candidateId) + "/mailbox/sync", z.object({ imported: z.number().int(), inbox: BackendInboxSchema }))).inbox)
    : (await mock()).byCandidate(firmId, candidateId),
  disconnect: async (firmId: string, candidateId: string): Promise<CandidateInbox> => isLive("inbox")
    ? toCandidateInbox(await http.delete(base(firmId, candidateId) + "/mailbox", BackendInboxSchema))
    : (await mock()).disconnect(firmId, candidateId),
  markRead: async (firmId: string, candidateId: string, messageId: string): Promise<InboxMessage> => isLive("inbox")
    ? toInboxMessage(await http.patch(base(firmId, candidateId) + `/inbox-messages/${toBackendId(messageId)}/read`, BackendInboxMessageSchema))
    : (await mock()).markRead(firmId, messageId, candidateId),
  /** Pending BDE reviews, newest first. The mock inbox has no classifier, so it has no reviews. */
  reviews: async (firmId: string, candidateId: string, cursor?: string | null): Promise<EmailReviewPage> => isLive("inbox")
    ? toEmailReviewPage(await http.get(base(firmId, candidateId) + "/email-reviews", BackendEmailReviewPageSchema, { query: { limit: 50, after: cursor ?? undefined } }))
    : { reviews: [], nextCursor: null, totalCount: 0 },
  /** Retry a failed classification (roles with email.retry). The server checks the email has not changed. */
  retryClassification: async (firmId: string, candidateId: string, messageId: string, expected: { contentRevision: number; resultVersion: number }, commandId = newCommandId()): Promise<void> => {
    if (!isLive("inbox")) throw new Error("Retry needs the live inbox.");
    await http.post(base(firmId, candidateId) + `/inbox-messages/${toBackendId(messageId)}/classification/retry`, z.object({ state: z.string() }), {
      body: { command_id: commandId, expected_content_revision: expected.contentRevision, expected_result_version: expected.resultVersion },
    });
  },
  /** Open a review for an email marked Irrelevant (category Other), so the usual review panel works on it. Idempotent. */
  openReview: async (firmId: string, candidateId: string, messageId: string): Promise<string> => {
    if (!isLive("inbox")) throw new Error("Email review needs the live inbox.");
    return (await http.post(base(firmId, candidateId) + `/inbox-messages/${toBackendId(messageId)}/review/open`, z.object({ review_id: z.string() }))).review_id;
  },
  /** One human decision on a review; returns the refreshed inbox. Retrying with the same command id is idempotent. */
  review: async (firmId: string, candidateId: string, messageId: string, command: ReviewEmailCommand, commandId = newCommandId()): Promise<CandidateInbox> => {
    if (!isLive("inbox")) throw new Error("Email review needs the live inbox.");
    return toCandidateInbox(await http.patch(base(firmId, candidateId) + `/inbox-messages/${toBackendId(messageId)}/review`, BackendInboxSchema,
      { body: toBackendReviewCommand(command, commandId, toBackendId) }));
  },
};
