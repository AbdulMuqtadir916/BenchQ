import { afterEach, describe, expect, it, vi } from "vitest";
import { applicationsApi } from "./applications";
import { http } from "./http";
import { BackendApplicationSchema, toApplication } from "./dto/applications";
import { TRACKER_STATUSES } from "@/components/app/applications/status-meta";

vi.mock("./http", () => ({ http: { get: vi.fn(), patch: vi.fn() } }));
afterEach(() => vi.resetAllMocks());
const sample = () => BackendApplicationSchema.parse({
  id: "app", job_id: "job", candidate_id: "candidate", submitted_by_user_id: null,
  status: "saved", status_revision: 3, applied_at: null, cv_version_used: null, notes: "Keep my notes",
  next_action: null, next_action_date: null, last_email_received: null, last_email_snippet: null,
  status_transitions: [], updated_at: "2026-10-31T00:00:00Z", company: "Company", company_canonical: null,
  title: "Engineer", url: null, best_cv: null, short_id: null, location: null, salary_min: null,
  salary_max: null, source: null, has_cached_page: false, discovered_at: "2026-10-30T00:00:00Z",
  tailored_resume_id: null, tailored_resume_name: null, has_cover_letter: false,
  pending_reviews: [{ id: "review", message_id: "email", revision: 0, reason: "LOW_CONFIDENCE" }],
});

describe("live Applications adapter", () => {
  it("paginates backend records and preserves review membership and revision", async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ total: 2, applications: [sample()] })
      .mockResolvedValueOnce({ total: 2, applications: [{ ...sample(), id: "second" }] });
    const result = await applicationsApi.list("firm");
    expect(result.map((app) => app.id)).toEqual(["app", "second"]);
    expect(result[0]?.statusRevision).toBe(3);
    expect(result[0]?.pendingReviews[0]?.messageId).toBe("email");
    expect(http.get).toHaveBeenLastCalledWith("/api/applications", expect.anything(), {
      query: { tracked_only: true, candidate_id: undefined, limit: 200, offset: 1 },
    });
  });
  it("sends revision, command ID and transition note without replacing application notes", async () => {
    vi.mocked(http.patch).mockResolvedValue(sample());
    await applicationsApi.updateStatus("firm", "app", { status: "ASSESSMENT", note: "Confirmed" }, 3, "command");
    expect(http.patch).toHaveBeenCalledWith("/api/applications/app/candidate-status", expect.anything(), {
      body: { status: "assessment", note: "Confirmed", expected_revision: 3, command_id: "command" },
    });
  });
  it("propagates backend failure without falling back to fixture applications", async () => {
    vi.mocked(http.get).mockRejectedValue(new Error("Backend unavailable"));
    await expect(applicationsApi.list("firm")).rejects.toThrow("Backend unavailable");
  });
  it.each(TRACKER_STATUSES)("maps %s without collapsing categories", (status) => {
    expect(toApplication({ ...sample(), status: status.toLowerCase() }, "firm", "candidate").status).toBe(status);
  });
  it("keeps human review decisions human and preserves their note", () => {
    const app = toApplication({ ...sample(), status_transitions: [{ from: "applied", to: "assessment",
      at: "2026-10-31T00:00:00Z", source: "bde_review", actor_user_id: "actor", note: "Confirmed" }] }, "firm", "candidate");
    expect(app.events[0]).toMatchObject({ isAutomated: false, actorUserId: "actor", note: "Confirmed" });
  });
});
