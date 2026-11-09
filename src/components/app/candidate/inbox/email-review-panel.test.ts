import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firms } from "@/mocks/team";
import type { EmailReview, InboxMessage } from "@/lib/schemas/inbox";
import { EmailReviewPanel, STAGE_OPTIONS } from "./email-review-panel";

const firm = firms.find((item) => item.id === "firm_hts")!;
const message = (over: Partial<InboxMessage>): InboxMessage => ({
  id: "m1", firmId: "firm_hts", candidateId: "cand_10", applicationId: null, fromName: "R", fromEmail: "r@x.test",
  subject: "Weekly digest", snippet: "", body: "", receivedAt: "2026-11-06T10:00:00.000Z", signal: null, isRead: true,
  impliedStatus: null, scheduledFor: null, classificationState: "DONE", contentRevision: 0, ...over,
});
const review: EmailReview = { id: "r1", messageId: "m1", applicationId: null, revision: 0, applicationRevision: null,
  reason: "MANUAL_REVIEW", subject: "Weekly digest", fromName: "R", receivedAt: null, createdAt: "2026-11-06T10:00:00.000Z" };
const render = (over: Partial<InboxMessage>) => renderToString(
  createElement(QueryClientProvider, { client: new QueryClient() },
    createElement(FirmProvider, { firm } as ComponentProps<typeof FirmProvider>,
      createElement(EmailReviewPanel, { message: message(over), review, applications: [], canAct: true, onHide: () => {} }))),
).replaceAll("<!-- -->", "");

describe("email review panel: Irrelevant as a choice", () => {
  it("offers Irrelevant in the stage list, instead of a separate dismiss button", () => {
    expect(STAGE_OPTIONS.at(-1)).toEqual({ value: "IRRELEVANT", label: "Irrelevant (not about an application)" });
    const html = render({ classificationCategory: "shortlisted" });
    expect(html).not.toContain("Dismiss: not about an application");
    expect(html).toContain("Confirm stage");
  });

  it("starts on Irrelevant for an email the classifier marked Irrelevant, and needs no application", () => {
    const html = render({ classificationCategory: "other" });
    expect(html).toContain("Irrelevant (not about an application)"); // the selected stage, shown on the closed list
    expect(html).toContain("Confirm: Irrelevant");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Confirm: Irrelevant/);
  });
});
