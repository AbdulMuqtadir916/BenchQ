import { createElement, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firms } from "@/mocks/team";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { allApplications } from "@/mocks/applications";
import { InboxMessageSchema } from "@/lib/schemas/inbox";
import { ApplicationBoard } from "./application-board";

/**
 * The board renders drag handles only for someone who can act: for a VIEWER (canAct false) every card
 * is a plain button that opens the application; nothing carries "draggable" semantics or "Space to move".
 */
const apps = allApplications.filter((app) => app.firmId === "firm_hts").slice(0, 30);
const firm = firms.find((item) => item.id === "firm_hts")!;
const render = (canAct: boolean, extra: Partial<ComponentProps<typeof ApplicationBoard>> = {}) =>
  renderToString(
    createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(FirmProvider, { firm } as ComponentProps<typeof FirmProvider>,
        createElement(ApplicationBoard, { apps, canAct, onMove: () => {}, candidateName: () => "x", ...extra }))),
  );

describe("application board: who can drag", () => {
  it.each([true, false])("links a linked review directly to its exact email (canAct=%s)", (canAct) => {
    const app = { ...apps[0]!, pendingReviews: [{ id: "review-1", messageId: "email-for-review", revision: 0, reason: "STATUS_REVIEW" }] };
    const html = render(canAct, { apps: [app] });
    expect(html).toContain("BDE review, 1");
    expect(html).toContain(`href="/${firm.slug}/candidates/${app.candidateId}?tab=inbox&amp;message=email-for-review"`);
    expect(html).toContain("Open email for review");
    expect(html).not.toContain('aria-roledescription="draggable"');
  });

  it("shows actionable unmatched mail in review even without any applications", () => {
    const message = InboxMessageSchema.parse({
      id: "unmatched-email", firmId: firm.id, candidateId: "candidate-1", applicationId: null,
      subject: "Synthetic assessment", fromName: "Recruiter", fromEmail: "recruiter@example.test",
      snippet: "Assessment", body: "", receivedAt: "2026-10-31T12:00:00.000Z", isRead: false,
      signal: "ASSESSMENT", impliedStatus: "ASSESSMENT", scheduledFor: null,
      classificationState: "DONE", classificationOutcome: "UNMATCHED", classificationConfidence: 0.9,
    });
    const html = render(true, { apps: [], unmatchedReviewMessages: [message] });
    expect(html).toContain("BDE review, 1");
    expect(html).toContain("Unmatched email");
    expect(html).toContain(`href="/${firm.slug}/candidates/candidate-1?tab=inbox&amp;message=unmatched-email"`);
    expect(html).not.toContain('aria-roledescription="draggable"');
    const unrelated = render(true, { apps: [], unmatchedReviewMessages: [{ ...message, signal: "OTHER" }] });
    expect(unrelated).toContain("BDE review, 0");
    expect(unrelated).not.toContain("Synthetic assessment");
  });

  it("places a pending review card only in review and retains its confirmed status", () => {
    const app = { ...apps[0]!, status: "INTERVIEW_SCHEDULED" as const };
    const html = render(true, { apps: [app], reviewApplicationIds: new Set([app.id]) });
    expect(html).toContain("BDE review, 1");
    expect(html).toContain("Interview scheduled, 0");
    expect(html).toContain("Interview scheduled");
    expect(html).not.toContain('aria-roledescription="draggable"');
    expect(app.status).toBe("INTERVIEW_SCHEDULED");
    expect(html.indexOf('aria-label="Applied,')).toBeLessThan(html.indexOf('aria-label="BDE review,'));
    expect(html.indexOf('aria-label="BDE review,')).toBeLessThan(html.indexOf('aria-label="Screening call,'));
  });

  it("renders nothing draggable when the viewer can't act (VIEWER)", () => {
    const html = render(false);
    expect(html).toContain("Application pipeline");
    expect(html).not.toContain('aria-roledescription="draggable"');
    expect(html).not.toContain("Space to move");
    expect(html).not.toContain("bq-board-card");
  });

  it("shows the ordered stages and hides unused Incomplete", () => {
    const html = render(true);
    for (const label of ["Saved", "Applied", "Screening call", "Interview schedule request", "Interview scheduled", "Offer", "Shortlisted", "Move on (rejected)", "Assessment", "Other"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('aria-label="Incomplete application,');
    const incomplete = render(true, { apps: [{ ...apps[0]!, status: "INCOMPLETE_APPLICATION" }] });
    expect(incomplete).toContain('aria-label="Incomplete application, 1"');
    expect(incomplete.indexOf('aria-label="Incomplete application,')).toBeLessThan(incomplete.indexOf('aria-label="Screening call,'));
  });

  it("renders the drag handles for someone who can act", () => {
    const html = render(true);
    expect(html).toContain('aria-roledescription="draggable"');
    expect(html).toContain("Space to move");
  });
});
