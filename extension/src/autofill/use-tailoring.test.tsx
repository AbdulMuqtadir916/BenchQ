// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRunningTailorings, getTailoring, startTailoring, type TailoringRun } from "../api";
import { LOOK_AGAIN_AT_MOST_MS, runFailure, startRefusal, TAILORING_POLL_MS, useTailoring } from "./use-tailoring";

vi.mock("../api", async (actual) => ({
  ...await actual<typeof import("../api")>(), getRunningTailorings: vi.fn(), getTailoring: vi.fn(), startTailoring: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const onSessionExpired = vi.fn();
const onTailored = vi.fn();
let root: Root | null = null;
let hook: ReturnType<typeof useTailoring>;

function Harness({ jobId }: { jobId: string | null }) {
  const state = useTailoring({ firmId: "firm-1", candidateId: "cand-1", jobId, onSessionExpired, onTailored });
  useEffect(() => { hook = state; });
  return null;
}

const run = (overrides: Partial<TailoringRun> = {}): TailoringRun => ({
  run_id: "run-1", status: "running", step: null, resume_id: null, error_code: null, job_posting_id: "posting-1", started_at: null, ...overrides,
});
const refused = (status: number, message = "") => Object.assign(new Error(message), { status });
/** Lets the answers the mocks give, and what React does with them, all land. */
const settle = () => act(async () => { for (let tick = 0; tick < 10; tick += 1) await Promise.resolve(); });

async function render(jobId: string | null = "posting-1") {
  root = createRoot(document.createElement("div"));
  await act(async () => { root!.render(<Harness jobId={jobId} />); });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getRunningTailorings).mockResolvedValue([]);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("tailoring the résumé for the connected job", () => {
  it("starts one for the job, follows its steps every 3 s, and hands over its résumé once it's done", async () => {
    vi.mocked(startTailoring).mockResolvedValue({ run_id: "run-1" });
    vi.mocked(getTailoring).mockResolvedValueOnce(run({ step: "draft" })).mockResolvedValueOnce(run({ status: "completed", resume_id: "res-new" }));
    await render();
    act(() => hook.start("base-v1"));
    await settle();
    expect(startTailoring).toHaveBeenCalledWith("firm-1", "cand-1", "posting-1", "base-v1");
    expect(hook.tailoring).toMatchObject({ status: "running", runId: "run-1", step: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(TAILORING_POLL_MS); });
    await settle();
    expect(hook.tailoring).toMatchObject({ status: "running", step: "draft" });
    expect(onTailored).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(TAILORING_POLL_MS); });
    await settle();
    expect(hook.tailoring).toEqual({ status: "completed", resumeId: "res-new" });
    expect(onTailored).toHaveBeenCalledWith("res-new");
    expect(getTailoring).toHaveBeenCalledTimes(2);
  });

  it("follows one already running for this job (started on the website), never another job's", async () => {
    vi.mocked(getRunningTailorings).mockResolvedValue([
      run({ run_id: "other", job_posting_id: "posting-2" }), run({ step: "review", started_at: "2026-11-13T10:00:00Z" }),
    ]);
    await render();
    expect(hook.tailoring).toMatchObject({ status: "running", runId: "run-1", step: "review", startedAt: Date.parse("2026-11-13T10:00:00Z") });
  });

  it("says why a start was refused, and why a run failed, in words the BDE can act on", async () => {
    vi.mocked(startTailoring).mockRejectedValue(refused(422, "This job has no description to tailor the résumé to."));
    await render();
    act(() => hook.start(null));
    await settle();
    expect(hook.tailoring).toEqual({ status: "failed", message: "This job has no description in BenchQ to tailor the resume to.", canRetry: false });
    const five = "You have 5 tailorings running. Wait for one to finish, then try again.";
    expect(startRefusal(refused(429, five))).toEqual({ message: five, canRetry: true });
    expect(startRefusal(refused(0, "BenchQ can't be reached."))).toEqual({ message: "BenchQ can't be reached.", canRetry: true });
    expect(startRefusal(refused(409, "This candidate has no active base résumé to tailor from.")).canRetry).toBe(false);
    expect(runFailure("gone")).toEqual({ message: "The resume or the job was removed in BenchQ.", canRetry: false });
    expect(runFailure("provider_failed")).toEqual({ message: "Tailoring didn't finish. Try again.", canRetry: true });
  });

  it("follows the run that's already tailoring the same résumé for this job when a start is refused for it, and only that one", async () => {
    vi.mocked(startTailoring).mockRejectedValue(refused(409, "This résumé is already being tailored for this job."));
    await render();
    // PR #140's review: another base's run for the same job is never taken for this résumé's.
    vi.mocked(getRunningTailorings).mockResolvedValue([run({ run_id: "other-base", source_resume_id: "base2-v1" }), run({ step: "verify", source_resume_id: "base-v1" })]);
    act(() => hook.start("base-v1"));
    await settle();
    await settle();
    expect(hook.tailoring).toMatchObject({ status: "running", runId: "run-1", step: "verify" });
  });

  it("keeps a 409 for another reason as said, following no run (PR #140 review)", async () => {
    vi.mocked(startTailoring).mockRejectedValue(refused(409, "This candidate has no active base résumé to tailor from."));
    await render();
    vi.mocked(getRunningTailorings).mockResolvedValue([run({ source_resume_id: "base-v1" })]);
    act(() => hook.start("base-v1"));
    await settle();
    await settle();
    expect(hook.tailoring).toEqual({ status: "failed", message: "This candidate has no active base résumé to tailor from.", canRetry: false });
    expect(getRunningTailorings).toHaveBeenCalledTimes(1);
  });

  it("never follows again a run that finished here, when a lookup answers late (PR #140 review)", async () => {
    let answer: (runs: TailoringRun[]) => void = () => {};
    vi.mocked(getRunningTailorings).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    vi.mocked(startTailoring).mockResolvedValue({ run_id: "run-1" });
    vi.mocked(getTailoring).mockResolvedValue(run({ status: "completed", resume_id: "res-new" }));
    await render();
    act(() => hook.start("base-v1"));
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(TAILORING_POLL_MS); });
    await settle();
    expect(hook.tailoring).toEqual({ status: "completed", resumeId: "res-new" });
    answer([run()]);
    await settle();
    expect(hook.tailoring).toEqual({ status: "completed", resumeId: "res-new" });
    expect(onTailored).toHaveBeenCalledTimes(1);
  });

  it("finds a run started on the website when the BDE comes back to the panel (PR #140 review)", async () => {
    await render();
    expect(hook.tailoring).toEqual({ status: "idle" });
    vi.mocked(getRunningTailorings).mockResolvedValue([run({ step: "draft" })]);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(hook.tailoring).toEqual({ status: "idle" });                 // too soon after the last look
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_AGAIN_AT_MOST_MS); });
    act(() => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(hook.tailoring).toMatchObject({ status: "running", runId: "run-1", step: "draft" });
  });

  it("hands an ended session over, and starts nothing without the job", async () => {
    vi.mocked(startTailoring).mockRejectedValue(new Error("SESSION_EXPIRED"));
    await render();
    act(() => hook.start(null));
    await settle();
    expect(onSessionExpired).toHaveBeenCalled();
    expect(hook.tailoring).toEqual({ status: "idle" });
    act(() => { root?.unmount(); });
    await render(null);
    act(() => hook.start(null));
    await settle();
    expect(startTailoring).toHaveBeenCalledTimes(1);
    expect(getRunningTailorings).toHaveBeenCalledTimes(1);
  });
});

describe("a refusal's filter (PR #140, second review)", () => {
  it("follows any run of the next job, though a refusal for the last one filtered by its résumé", async () => {
    vi.mocked(startTailoring).mockRejectedValue(refused(409, "This résumé is already being tailored for this job."));
    await render("posting-1");
    act(() => hook.start("base-v1"));
    await settle();
    await settle();
    vi.mocked(getRunningTailorings).mockResolvedValue([run({ run_id: "run-2", job_posting_id: "posting-2", source_resume_id: "base2-v1", step: "draft" })]);
    await act(async () => { root!.render(<Harness jobId="posting-2" />); });
    await settle();
    expect(hook.tailoring).toMatchObject({ status: "running", runId: "run-2", step: "draft" });
  });
});
