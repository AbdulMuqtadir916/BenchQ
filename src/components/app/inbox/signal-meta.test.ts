import { describe, expect, it } from "vitest";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { classificationFailureReason, emailActivityTitle, latestSignalByApplication, mailSignalMeta } from "./signal-meta";

const message = (over: Partial<InboxMessage>): InboxMessage => ({
  id: "m1", firmId: "f", candidateId: "c", applicationId: "a1", fromName: "R", fromEmail: "r@x.test", subject: "Interview next week",
  snippet: "", body: "", receivedAt: "2026-11-06T10:00:00.000Z", signal: null, isRead: false, impliedStatus: null, scheduledFor: null, ...over,
});

describe("email badges (DEBUG D-17)", () => {
  it("shows the classifier's category with its own label and icon", () => {
    const meta = mailSignalMeta(null, "DONE", "interview_scheduled");
    expect(meta.label).toBe("Interview scheduled");
    expect(meta.isBadge).toBe(true);
  });

  it("names every processing state (D-28)", () => {
    expect(mailSignalMeta(null, "PENDING").label).toBe("Classifying…");
    expect(mailSignalMeta(null, "ERROR", null, "CLASSIFIER_NOT_CONFIGURED").label).toBe("Waiting for classifier setup");
    expect(mailSignalMeta(null, "ERROR", null, "PROVIDER_AUTH_REJECTED").label).toBe("Waiting for classifier setup");
    expect(mailSignalMeta(null, "ERROR", null, "INVALID_RESPONSE").label).toBe("Classification failed");
    expect(mailSignalMeta(null, "NOT_QUEUED").label).toBe("Not yet queued");
    expect(mailSignalMeta(null, "DONE", "offer").label).toBe("Offer");
  });

  it("gives a readable failure reason, never a raw code", () => {
    expect(classificationFailureReason("CLASSIFIER_NOT_CONFIGURED")).toMatch(/not set up/);
    expect(classificationFailureReason("SOMETHING_NEW")).toBe("Classification failed.");
  });

  it("never titles an activity entry \"Email: Email\"", () => {
    expect(emailActivityTitle(message({ classificationState: "NOT_QUEUED" }))).toBe("Email: Interview next week");
    expect(emailActivityTitle(message({ classificationState: "DONE", classificationCategory: "offer" }))).toBe("Email: Offer");
  });

  it("uses classified job emails, not confirmations or Other, as an application's latest news", () => {
    const map = latestSignalByApplication([
      message({ id: "confirm", classificationCategory: "applied" }),
      message({ id: "other", classificationCategory: "other", receivedAt: "2026-11-06T12:00:00.000Z" }),
      message({ id: "news", classificationCategory: "assessment", receivedAt: "2026-11-06T11:00:00.000Z" }),
    ]);
    expect(map.get("a1")?.id).toBe("news");
  });
});
