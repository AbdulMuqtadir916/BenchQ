import { describe, expect, it } from "vitest";
import sample from "./__samples__/inbox.json";
import { BackendInboxSchema, toCandidateInbox } from "./inbox";

describe("Inbox backend DTO", () => {
  it("maps a backend response without inventing a classification", () => {
    const inbox = toCandidateInbox(BackendInboxSchema.parse(sample));
    expect(inbox.connection).toMatchObject({ address: "candidate@example.test", status: "CONNECTED" });
    expect(inbox.connection?.lastSyncedAt).toBe("2026-10-31T10:05:00.000Z");
    expect(inbox.messages[0]).toMatchObject({
      id: "email-1", applicationId: null, signal: null, impliedStatus: null, scheduledFor: null,
      body: "We received your application.", isRead: false,
    });
  });

  it("maps an explicit Decider category and confidence from backend data", () => {
    const source = { ...sample, messages: [{ ...sample.messages[0],
      classification_state: "DONE",
      classification: { category: "assessment", confidence: 0.45, outcome: "REVIEW",
        probabilities: { applied: 0.05, assessment: 0.45 } },
    }] };
    const inbox = toCandidateInbox(BackendInboxSchema.parse(source));
    expect(inbox.messages[0]).toMatchObject({
      signal: "ASSESSMENT", impliedStatus: "ASSESSMENT", classificationState: "DONE",
      classificationConfidence: 0.45, classificationOutcome: "REVIEW",
    });
  });
});
