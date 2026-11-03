import { z } from "zod";
import { http } from "./http";

const Message = z.object({ message: z.string() });
export const NotificationItem = z.object({
  id: z.string(), type: z.string(), entityId: z.string(), requestStatus: z.string().nullable(), canReissue: z.boolean(),
  title: z.string(), detail: z.string(), readAt: z.string().nullable(), resolvedAt: z.string().nullable(), createdAt: z.string(),
});
const Inbox = z.object({ items: z.array(NotificationItem) });
const Decision = z.object({ status: z.enum(["APPROVED", "DENIED"]), resetLink: z.string().nullable() });
const ResetLink = z.object({ resetLink: z.string() });
const Ok = z.object({ ok: z.boolean() });

export type NotificationItem = z.infer<typeof NotificationItem>;

export const passwordRecoveryApi = {
  request: (email: string) => http.post("/api/auth/password-reset/request", Message, { body: { email } }),
  complete: (token: string, password: string) => http.post("/api/auth/password-reset/complete", Message, { body: { token, password } }),
};

export const notificationsApi = {
  list: () => http.get("/api/notifications", Inbox),
  markRead: (id: string) => http.patch(`/api/notifications/${encodeURIComponent(id)}/read`, Ok),
  decide: (id: string, approve: boolean) => http.post(`/api/notifications/${encodeURIComponent(id)}/password-reset-decision`, Decision, { body: { approve } }),
  reissue: (id: string) => http.post(`/api/notifications/${encodeURIComponent(id)}/password-reset-link`, ResetLink),
};
