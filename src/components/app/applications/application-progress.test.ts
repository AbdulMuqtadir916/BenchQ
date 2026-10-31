import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { allApplications } from "@/mocks/applications";
import type { Application, ApplicationEvent } from "@/lib/schemas/application";
import { InboxMessageSchema } from "@/lib/schemas/inbox";
import { ApplicationProgress } from "./application-progress";
import { TRACKER_STATUSES, visibleApplicationStatuses } from "./status-meta";

const app = { ...allApplications[0]!, status: "SHORTLISTED", events: [] } as Application;
const event = (toStatus: ApplicationEvent["toStatus"], fromStatus: ApplicationEvent["fromStatus"] = "APPLIED", day = 1): ApplicationEvent => ({
  id: `event-${day}`, applicationId: app.id, fromStatus, toStatus, note: null,
  actorUserId: null, isAutomated: true, createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`,
});
const render = (input: Application = app) => renderToStaticMarkup(createElement(ApplicationProgress, { application: input }));

describe("application progress", () => {
  it("uses the requested order", () => {
    expect(TRACKER_STATUSES).toEqual(["SAVED", "APPLIED", "INCOMPLETE_APPLICATION", "SCREENING_CALL", "SHORTLISTED", "INTERVIEW_SCHEDULE_REQUEST", "INTERVIEW_SCHEDULED", "ASSESSMENT", "OFFER", "MOVE_ON", "OTHER"]);
  });
  it("fills through Shortlisted without inventing dates", () => {
    const html = render();
    expect(html).toContain('data-status="SAVED" data-state="completed"');
    expect(html).toContain('data-status="SCREENING_CALL" data-state="completed"');
    expect(html).toContain('data-status="SHORTLISTED" data-state="current"');
    expect(html).toContain('data-status="OFFER" data-state="future"');
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain('<time');
    expect(html).not.toContain('Incomplete application');
  });
  it("shows Incomplete only with application-specific accepted evidence or retained history", () => {
    const message = InboxMessageSchema.parse({ id: 'mail', firmId: app.firmId, candidateId: app.candidateId, applicationId: app.id,
      fromName: 'Recruiter', fromEmail: 'r@example.test', subject: 'Complete application', body: '', snippet: '',
      isRead: true, receivedAt: '2026-10-31T12:00:00.000Z', scheduledFor: null, impliedStatus: 'INCOMPLETE_APPLICATION', signal: 'INCOMPLETE_APPLICATION',
      classificationState: 'DONE', classificationConfidence: 0.9, classificationOutcome: 'AUTO_APPLIED' });
    expect(visibleApplicationStatuses(app, [message])).toContain('INCOMPLETE_APPLICATION');
    expect(visibleApplicationStatuses(app, [{ ...message, applicationId: 'another-app' }])).not.toContain('INCOMPLETE_APPLICATION');
    expect(visibleApplicationStatuses(app, [{ ...message, classificationConfidence: 0.4, classificationOutcome: 'REVIEW' }])).not.toContain('INCOMPLETE_APPLICATION');
    expect(render({ ...app, events: [event('INCOMPLETE_APPLICATION')] })).toContain('Incomplete application');
    expect(render({ ...app, status: 'INCOMPLETE_APPLICATION' })).toContain('Incomplete application');
  });
  it.each(['MOVE_ON', 'OTHER'] as const)('does not invent interviews or offers for %s', (status) => {
    const html = render({ ...app, status, events: [event(status)] });
    expect(html).toContain('data-status="APPLIED" data-state="completed"');
    expect(html).toContain('data-status="OFFER" data-state="future"');
    expect(html).toContain(`data-status="${status}" data-state="current"`);
    expect(html.match(/<time/g)).toHaveLength(1);
  });
  it("uses the latest preceding main stage after a reversal, retaining old dates", () => {
    const html = render({ ...app, status: 'MOVE_ON', events: [event('OFFER'), event('APPLIED', 'OFFER', 2), event('MOVE_ON', 'APPLIED', 3)] });
    expect(html).toContain('data-status="SCREENING_CALL" data-state="future"');
    expect(html).toContain('data-status="OFFER" data-state="future"');
    expect(html).toContain('2026-10-01T12:00:00.000Z');
  });
  it("keeps a legacy current status visible", () => {
    expect(render({ ...app, status: 'INTERVIEW' })).toContain('data-status="INTERVIEW" data-state="current"');
  });
});
