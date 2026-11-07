import { describe, expect, it } from "vitest";
import { ApplicationSchema } from "@/lib/schemas/application";
import { toApplication, toApplications, toBackendStatus, toFrontendStatus, type BackendApplication } from "./applications";

const row = (over: Partial<BackendApplication> = {}): BackendApplication => ({
  id: "11111111-1111-4111-8111-111111111111",
  job_id: "22222222-2222-4222-8222-222222222222",
  candidate_id: "33333333-3333-4333-8333-333333333333",
  submitted_by_user_id: null,
  status: "saved",
  status_revision: 3,
  pending_reviews: [],
  applied_at: null,
  notes: null,
  status_transitions: [],
  updated_at: "2026-11-05T10:00:00+00:00",
  discovered_at: null,
  company: "Acme",
  company_canonical: "Acme Inc",
  title: "Java Developer",
  ...over,
});

describe("applications DTO mapper", () => {
  it("maps a saved row to a valid Application carrying its server revision", () => {
    const application = toApplication(row(), "firm_1");
    expect(ApplicationSchema.safeParse(application).success).toBe(true);
    expect(application).toMatchObject({ status: "SAVED", statusRevision: 3, companyNameAtApply: "Acme Inc", jobTitleAtApply: "Java Developer" });
  });

  it("maps Saved → Applied with its applied time and history", () => {
    const application = toApplication(
      row({
        status: "applied",
        status_revision: 4,
        applied_at: "2026-11-05T11:00:00+00:00",
        status_transitions: [{ from: "saved", to: "applied", at: "2026-11-05T11:00:00+00:00", source: "ui", actor_user_id: null, note: null }],
      }),
      "firm_1",
    );
    expect(ApplicationSchema.safeParse(application).success).toBe(true);
    expect(application).toMatchObject({ status: "APPLIED", statusRevision: 4, appliedAt: "2026-11-05T11:00:00.000Z" });
    expect(application?.events[0]).toMatchObject({ fromStatus: "SAVED", toStatus: "APPLIED", isAutomated: false });
  });

  it("marks only email_classifier changes as automatic and keeps their email and revision", () => {
    const application = toApplication(row({ status: "screening_call", status_transitions: [
      { from: "applied", to: "screening_call", at: "2026-11-06T10:00:00+00:00", source: "email_classifier", actor_user_id: null,
        note: null, event_id: "ev-1", revision: 2, email_id: "msg-1" },
      { from: "screening_call", to: "applied", at: "2026-11-06T11:00:00+00:00", source: "email_undo", actor_user_id: null,
        note: null, event_id: "ev-2", revision: 3, email_id: "msg-1" },
    ] }), "firm_1");
    expect(application?.events.map((e) => [e.id, e.isAutomated, e.source, e.revision, e.emailId])).toEqual([
      ["ev-1", true, "email_classifier", 2, "msg-1"],
      ["ev-2", false, "email_undo", 3, "msg-1"],
    ]);
  });

  it("shows every candidate row: new statuses exactly, old ones as labelled legacy, unknown as UNKNOWN", () => {
    const rows = [
      row(),
      row({ id: "44444444-4444-4444-8444-444444444444", status: "screening_call" }),
      row({ id: "55555555-5555-4555-8555-555555555555", status: "rejected" }),
      row({ id: "66666666-6666-4666-8666-666666666666", status: "something_new" }),
      row({ id: "77777777-7777-4777-8777-777777777777", candidate_id: null }),
    ];
    expect(toApplications(rows, "firm_1").map((a) => a.status)).toEqual(["SAVED", "SCREENING_CALL", "REJECTED", "UNKNOWN"]);
  });

  it("carries the number of pending email reviews", () => {
    expect(toApplication(row({ pending_reviews: [{ id: "r1" }, { id: "r2" }] }), "firm_1")?.pendingReviewCount).toBe(2);
  });

  it("converts statuses in both directions without guessing", () => {
    expect(toFrontendStatus("interview_schedule_request")).toBe("INTERVIEW_SCHEDULE_REQUEST");
    expect(toFrontendStatus("interview")).toBe("INTERVIEW");
    expect(toFrontendStatus(null)).toBe("UNKNOWN");
    expect(toBackendStatus("MOVE_ON")).toBe("move_on");
    expect(toBackendStatus("INCOMPLETE_APPLICATION")).toBe("incomplete_application");
  });
});
