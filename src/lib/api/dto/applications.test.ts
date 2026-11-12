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
  interviews: [],
  ...over,
});

const move = (from: string | null, to: string, at: string) => ({ from, to, at: `2026-11-${at}:00+00:00`, source: "ui", actor_user_id: null, note: null });

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

  it("reads the stage dates the backend doesn't store off the history, oldest move first", () => {
    const application = toApplication(row({
      status: "offer",
      applied_at: "2026-11-01T09:00:00+00:00",
      // Sent out of order on purpose: the oldest move decides.
      status_transitions: [move("interview_scheduled", "offer", "06T10:00"), move("saved", "applied", "01T09:00"),
        move("applied", "screening_call", "02T10:00"), move("shortlisted", "interview_scheduled", "04T10:00")],
    }), "firm_1");
    expect(ApplicationSchema.safeParse(application).success).toBe(true);
    expect(application).toMatchObject({
      firstResponseAt: "2026-11-02T10:00:00.000Z", interviewAt: "2026-11-04T10:00:00.000Z", offerAt: "2026-11-06T10:00:00.000Z",
    });
  });

  it("counts Move On as hearing back, but not a correction back to Saved", () => {
    const corrected = toApplication(row({ status: "saved", status_transitions: [move("saved", "applied", "01T09:00"), move("applied", "saved", "01T09:05")] }), "firm_1");
    expect(corrected?.firstResponseAt).toBeNull();
    const rejected = toApplication(row({ status: "move_on", status_transitions: [move("saved", "applied", "01T09:00"), move("applied", "move_on", "03T12:00")] }), "firm_1");
    expect(rejected?.firstResponseAt).toBe("2026-11-03T12:00:00.000Z");
  });

  it("leaves an undone automatic move, and the Undo that took it back, out of the stage dates", () => {
    const automatic = { ...move("applied", "screening_call", "03T10:00"), source: "email_classifier", event_id: "auto-1" };
    const undo = { ...move("screening_call", "applied", "03T11:00"), source: "email_undo", event_id: "undo-1", undo_event_id: "auto-1" };
    const undone = toApplication(row({ status: "applied", status_transitions: [move("saved", "applied", "01T09:00"), automatic, undo] }), "firm_1");
    expect(undone?.firstResponseAt).toBeNull();
    const kept = toApplication(row({ status: "screening_call", status_transitions: [move("saved", "applied", "01T09:00"), automatic] }), "firm_1");
    expect(kept?.firstResponseAt).toBe("2026-11-03T10:00:00.000Z");
  });

  it("dates the interview by the earliest booking that wasn't cancelled, before the history", () => {
    const application = toApplication(row({
      status: "interview_scheduled",
      status_transitions: [move("applied", "interview_scheduled", "04T10:00")],
      interviews: [
        { when_at: "2026-11-05T15:00:00+00:00", status: "cancelled" },
        { when_at: "2026-11-09T15:00:00+00:00", status: "scheduled" },
        { when_at: null, status: "scheduled" },
      ],
    }), "firm_1");
    expect(application?.interviewAt).toBe("2026-11-09T15:00:00.000Z");
  });

  it("counts a legacy placement as the offer date (D6), and leaves every date empty with no history", () => {
    expect(toApplication(row({ status: "placed", status_transitions: [move("interview", "placed", "07T10:00")] }), "firm_1")?.offerAt)
      .toBe("2026-11-07T10:00:00.000Z");
    expect(toApplication(row({ status: "offer" }), "firm_1")).toMatchObject({ firstResponseAt: null, interviewAt: null, offerAt: null });
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

  it("carries the résumé version that was sent, and none when none was recorded", () => {
    const sent = toApplication(row({ status: "applied", resume_id: "44444444-4444-4444-8444-444444444444" }), "firm_1");
    expect(ApplicationSchema.safeParse(sent).success).toBe(true);
    expect(sent?.resumeVersionId).toBe("44444444-4444-4444-8444-444444444444");
    expect(toApplication(row({ status: "applied", resume_id: null }), "firm_1")?.resumeVersionId).toBeNull();
    expect(toApplication(row({ status: "applied" }), "firm_1")?.resumeVersionId).toBeNull();   // an older backend without the field
  });

  it("converts statuses in both directions without guessing", () => {
    expect(toFrontendStatus("interview_schedule_request")).toBe("INTERVIEW_SCHEDULE_REQUEST");
    expect(toFrontendStatus("interview")).toBe("INTERVIEW");
    expect(toFrontendStatus(null)).toBe("UNKNOWN");
    expect(toBackendStatus("MOVE_ON")).toBe("move_on");
    expect(toBackendStatus("INCOMPLETE_APPLICATION")).toBe("incomplete_application");
  });
});
