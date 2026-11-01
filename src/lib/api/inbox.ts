import { z } from "zod";
import type { CandidateInbox, InboxMessage } from "@/lib/schemas/inbox";
import { http } from "./http";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import { BackendInboxSchema, BackendInboxMessageSchema, toCandidateInbox, toInboxMessage } from "./dto/inbox";
const mock = () => import("@/mocks/inbox").then((m) => m.inboxMock);
const base = (firm: string, candidate: string) => `/api/firms/${toBackendId(firm)}/candidates/${toBackendId(candidate)}`;
const AuthorizationSchema = z.object({ authorization_url: z.string().url().refine((value) => {
  const url = new URL(value);
  return url.origin === "https://accounts.google.com" && url.pathname === "/o/oauth2/v2/auth";
}) });

export const inboxApi = {
  byCandidate: async (firmId: string, candidateId: string): Promise<CandidateInbox> => isLive("inbox")
    ? toCandidateInbox(await http.get(base(firmId, candidateId) + "/inbox", BackendInboxSchema))
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
};
