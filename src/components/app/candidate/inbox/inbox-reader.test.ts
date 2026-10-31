import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { allApplications } from "@/mocks/applications";
import type { Application } from "@/lib/schemas/application";
import { InboxMessageSchema, type InboxMessage } from "@/lib/schemas/inbox";
import { pendingSuggestion } from "@/components/app/inbox/signal-meta";
import type { CandidateActions } from "../candidate-actions";
import { InboxReader } from "./inbox-reader";

const application: Application = { ...allApplications[0]!, id: "test-app", status: "APPLIED", pendingReviews: [] };
const message = (extra: Partial<InboxMessage> = {}): InboxMessage => InboxMessageSchema.parse({
  id: "test-message", firmId: application.firmId, candidateId: application.candidateId,
  applicationId: application.id, fromName: "Recruiter", fromEmail: "recruiter@example.test",
  subject: "Synthetic classification test", snippet: "Synthetic test", body: "Synthetic test",
  receivedAt: "2026-10-31T12:00:00.000Z", isRead: true, signal: "OFFER", impliedStatus: "OFFER",
  scheduledFor: null, classificationState: "DONE", classificationConfidence: 0.95,
  classificationOutcome: "AUTO_APPLIED", ...extra,
});
const actions: CandidateActions = {
  openTab: vi.fn(), openApplication: vi.fn(), openMessage: vi.fn(), applySuggestion: vi.fn(),
  reviewInboxMessage: vi.fn(), retryInboxClassification: vi.fn(), findJobs: vi.fn(), reviewMasterResume: vi.fn(),
};
const render = (mail: InboxMessage, app: Application | undefined = mail.applicationId ? application : undefined, canAct = true) => renderToStaticMarkup(
  createElement(InboxReader, { message: mail, application: app, applications: [app ?? application],
    suggestion: undefined, canAct, actions }),
);

describe("Inbox review follows the persisted classification decision", () => {
  it.each(["AUTO_APPLIED", "NO_CHANGE"] as const)("does not suggest or ask confirmation for %s", (outcome) => {
    const mail = message({ classificationOutcome: outcome });
    // Even an older cached application must not re-create an already handled suggestion.
    expect(pendingSuggestion(mail, "APPLIED")).toBeNull();
    const html = render(mail);
    expect(html).not.toContain("Review application status");
    expect(html).not.toContain("Confirm status");
    expect(html).not.toContain("Move to Offer");
  });

  it.each([0.55, 0.95])("shows BDE review for a genuine pending decision at confidence %s", (confidence) => {
    const mail = message({ classificationOutcome: "REVIEW", classificationConfidence: confidence });
    const app: Application = { ...application, pendingReviews: [{ id: "review", messageId: mail.id,
      revision: 0, reason: confidence < 0.6 ? "LOW_CONFIDENCE" : "STATUS_REVIEW" }] };
    const html = render(mail, app);
    expect(html).toContain("Review application status");
    expect(html).toContain("Confirm status");
    expect(html).toContain("Needs BDE review");
    expect(html).not.toContain("Move to Offer");
    expect(html).toContain(confidence < 0.6 ? "55%" : "newer application activity");
  });

  it("routes unmatched job-related mail to review even with high confidence", () => {
    const html = render(message({ applicationId: null, classificationOutcome: "UNMATCHED" }), undefined);
    expect(html).toContain("Needs BDE review");
    expect(html).toContain("Select application");
    expect(html).toContain("Confirm status");
  });

  it("removes review controls after the BDE resolves the review", () => {
    const html = render(message({ classificationOutcome: "REVIEW" }), { ...application, status: "OFFER" });
    expect(html).not.toContain("Confirm status");
    expect(html).not.toContain("Review application status");
  });

  it.each(["PENDING", "PROCESSING", "ERROR"] as const)("does not turn %s into a suggestion", (state) => {
    const mail = message({ classificationState: state, classificationOutcome: null });
    expect(pendingSuggestion(mail, "APPLIED")).toBeNull();
    expect(render(mail)).not.toContain("Confirm status");
  });

  it("keeps unclassified and unrelated unmatched mail out of review", () => {
    for (const mail of [message({ applicationId: null, classificationOutcome: "UNMATCHED", signal: "OTHER" }),
      message({ applicationId: null, classificationOutcome: null, classificationState: "PENDING", signal: null })]) {
      expect(render(mail, undefined)).not.toContain("Confirm status");
    }
  });

  it("retains a linked Other email when the backend requires BDE review", () => {
    const mail = message({ classificationOutcome: "REVIEW", signal: "OTHER", impliedStatus: "OTHER",
      classificationConfidence: 0.4 });
    const app = { ...application, pendingReviews: [{ id: "review", messageId: mail.id, revision: 0, reason: "LOW_CONFIDENCE" }] };
    expect(render(mail, app)).toContain("Confirm status");
    expect(render(mail, app)).toContain("Needs BDE review");
  });

  it("does not impose a stage order on a backend review", () => {
    expect(pendingSuggestion(message({ classificationOutcome: "REVIEW", signal: "APPLIED", impliedStatus: "APPLIED" }), "OFFER"))
      .toBe("APPLIED");
  });

  it("does not expose confirmation controls to a viewer", () => {
    const mail = message({ classificationOutcome: "REVIEW", classificationConfidence: 0.55 });
    const app = { ...application, pendingReviews: [{ id: "review", messageId: mail.id, revision: 0, reason: "LOW_CONFIDENCE" }] };
    expect(render(mail, app, false)).not.toContain("Confirm status");
  });
});
