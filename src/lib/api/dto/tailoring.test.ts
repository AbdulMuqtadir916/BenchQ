import { describe, expect, it } from "vitest";
import { TailoringRunDto, toStartBody, toTailoringRun } from "./tailoring";

const dto = (over: Record<string, unknown> = {}) => TailoringRunDto.parse({
  run_id: "run-1", status: "running", step: "review", resume_id: null, error_code: null,
  candidate_id: "cand-1", source_resume_id: "v-2", base_resume_id: null, job_posting_id: "post-1",
  job_title: "Java Developer", user_id: "u-1", started_at: "2026-11-12T10:00:00", finished_at: null, ...over,
});

describe("a tailoring run (docs/02 §8.3)", () => {
  it("maps the backend's run, its step while it runs", () => {
    const run = toTailoringRun(dto());
    expect(run).toMatchObject({ runId: "run-1", status: "running", step: "review", candidateId: "cand-1", sourceResumeId: "v-2",
      baseResumeId: null, jobId: "post-1", jobTitle: "Java Developer", resumeId: null, errorCode: null });
    expect(run.startedAt).toBe("2026-11-12T10:00:00.000Z");               // a zone-less time is UTC
  });

  it("shows no step once it ended, or for a step this screen doesn't know", () => {
    expect(toTailoringRun(dto({ status: "completed", resume_id: "r-9", base_resume_id: "b-2" })).step).toBeNull();
    expect(toTailoringRun(dto({ step: "something-newer" })).step).toBeNull();
    expect(toTailoringRun(dto({ status: "failed", error_code: "lost" })).errorCode).toBe("lost");
  });

  it("starts from the picked version, or the active base when none is picked", () => {
    expect(toStartBody({ candidateId: "c", jobId: "post-1", resumeId: "v-2" })).toEqual({ job_posting_id: "post-1", resume_id: "v-2" });
    expect(toStartBody({ candidateId: "c", jobId: "post-1" })).toEqual({ job_posting_id: "post-1" });
  });
});
