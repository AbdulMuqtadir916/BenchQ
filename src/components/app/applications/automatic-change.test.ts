import { describe, expect, it } from "vitest";
import type { Application, ApplicationEvent } from "@/lib/schemas/application";
import { latestAutomaticChange } from "./automatic-change";

const event = (over: Partial<ApplicationEvent>): ApplicationEvent => ({
  id: "e1", applicationId: "a1", fromStatus: "APPLIED", toStatus: "SCREENING_CALL", note: null, actorUserId: null,
  isAutomated: true, createdAt: "2026-11-06T10:00:00.000Z", source: "email_classifier", revision: 2, emailId: "m1", ...over,
});
const app = (events: ApplicationEvent[], statusRevision: number) => ({ events, statusRevision }) as unknown as Application;

describe("latestAutomaticChange (when Undo is offered)", () => {
  it("offers the latest automatic change while nothing has happened since", () => {
    expect(latestAutomaticChange(app([event({})], 2))?.id).toBe("e1");
  });

  it("offers nothing once a later revision exists, or when the latest change was a person's", () => {
    expect(latestAutomaticChange(app([event({})], 3))).toBeNull();
    const manual = event({ id: "e2", source: "ui", isAutomated: false, revision: 3, createdAt: "2026-11-06T11:00:00.000Z" });
    expect(latestAutomaticChange(app([event({}), manual], 3))).toBeNull();
  });
});
