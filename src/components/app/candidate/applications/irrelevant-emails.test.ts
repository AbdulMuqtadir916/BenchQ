import { describe, expect, it } from "vitest";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { CATEGORY_META } from "@/components/app/inbox/signal-meta";
import { irrelevantEmails } from "./irrelevant-emails";

const message = (over: Partial<InboxMessage>): InboxMessage => ({
  id: "m1", firmId: "f", candidateId: "c", applicationId: null, fromName: "R", fromEmail: "r@x.test", subject: "Weekly digest",
  snippet: "", body: "", receivedAt: "2026-11-06T10:00:00.000Z", signal: null, isRead: false, impliedStatus: null, scheduledFor: null, ...over,
});

describe("the Irrelevant tab", () => {
  it("lists only classified Other emails, newest first", () => {
    const list = irrelevantEmails([
      message({ id: "old", classificationState: "DONE", classificationCategory: "other", receivedAt: "2026-11-05T10:00:00.000Z" }),
      message({ id: "job", classificationState: "DONE", classificationCategory: "shortlisted" }),
      message({ id: "pending", classificationState: "PENDING", classificationCategory: null }),
      message({ id: "new", classificationState: "DONE", classificationCategory: "other", receivedAt: "2026-11-07T10:00:00.000Z" }),
    ]);
    expect(list.map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("labels Other as Irrelevant, with an icon", () => {
    expect(CATEGORY_META.other.label).toBe("Irrelevant");
    expect(CATEGORY_META.other.Icon).toBeDefined();
  });
});
