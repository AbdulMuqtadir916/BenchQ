import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import applications from "@/mocks/data/applications.json";
import { ApplicationSchema, type Application, type ApplicationEvent } from "@/lib/schemas/application";
import { StatusTimeline } from "./status-timeline";

const base: Application = ApplicationSchema.parse(applications[0]);
const event = (over: Partial<ApplicationEvent>): ApplicationEvent => ({
  id: "ev_1", applicationId: base.id, fromStatus: "APPLIED", toStatus: "SCREENING_CALL", note: null, actorUserId: null,
  isAutomated: true, createdAt: "2026-11-10T10:00:00.000Z", source: "email_classifier", revision: 2, emailId: "msg_1", ...over,
});
const html = (events: ApplicationEvent[], emailHref?: (id: string) => string) =>
  renderToStaticMarkup(<StatusTimeline application={{ ...base, events }} actorName={() => "Sneha Rao"} emailHref={emailHref} />);

// Abdul's review on #127: a change that came from an email links to that email.
describe("the status timeline's email links", () => {
  it("links an email-based change to its email", () => {
    const out = html([event({})], (id) => `/firm/candidates/c1?tab=inbox&message=${id}`);
    expect(out).toContain("Open the email");
    expect(out).toContain("message=msg_1");
  });

  it("shows no link for a change made by hand, which has no email", () => {
    expect(html([event({ source: "ui", isAutomated: false, emailId: null })], () => "/x")).not.toContain("Open the email");
  });

  it("shows no link where no email can be opened (no candidate to open it on)", () => {
    expect(html([event({})])).not.toContain("Open the email");
  });
});
