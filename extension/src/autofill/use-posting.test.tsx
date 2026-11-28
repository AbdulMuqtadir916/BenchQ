// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCandidateJob, type BenchqJob } from "../api";
import { forgetPostings, usePosting, type Posting } from "./use-posting";

vi.mock("../api", async (actual) => ({ ...await actual<typeof import("../api")>(), getCandidateJob: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let seen: { posting: Posting; retry: () => void };

const report = (state: typeof seen) => { seen = state; };

function Harness({ postingId, onExpired }: { postingId: string | null; onExpired: () => void }) {
  const state = usePosting("firm-1", "user-1", "cand-1", postingId, onExpired);
  useEffect(() => report(state));
  return null;
}

const render = (postingId: string | null, onExpired: () => void = () => {}) => act(async () => {
  root ??= createRoot(document.createElement("div"));
  root.render(<Harness postingId={postingId} onExpired={onExpired} />);
});

const job: BenchqJob = { id: "post-1", title: "QA Engineer", company: "Acme", location: "Austin, TX", description: "<p>Test the API.</p>",
  url: null, employmentType: "FULL_TIME", workMode: "remote", postedAt: "2026-11-10" };

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  forgetPostings();
  vi.clearAllMocks();
});

describe("the job's posting, for its details page", () => {
  it("reads nothing until there's a posting to read, then reads it once and keeps it", async () => {
    vi.mocked(getCandidateJob).mockResolvedValue(job);
    await render(null);
    expect(seen.posting).toEqual({ status: "none" });
    expect(getCandidateJob).not.toHaveBeenCalled();
    await render("post-1");
    expect(seen.posting).toEqual({ status: "ready", posting: job });
    expect(getCandidateJob).toHaveBeenCalledWith("firm-1", "cand-1", "post-1");
    // Closed, then opened again: the posting it has, at once.
    await render(null);
    await render("post-1");
    expect(seen.posting).toEqual({ status: "ready", posting: job });
    expect(getCandidateJob).toHaveBeenCalledTimes(1);
  });

  it("says it's loading, then that it couldn't read it, and reads it again on Try again", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(getCandidateJob).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; })).mockResolvedValue(job);
    await render("post-1");
    expect(seen.posting).toEqual({ status: "loading" });
    await act(async () => { fail(new Error("Not found.")); });
    expect(seen.posting).toEqual({ status: "error" });
    await act(async () => { seen.retry(); });
    expect(seen.posting).toEqual({ status: "ready", posting: job });
    expect(getCandidateJob).toHaveBeenCalledTimes(2);
  });

  it("hands an ended session to the panel", async () => {
    vi.mocked(getCandidateJob).mockRejectedValue(new Error("SESSION_EXPIRED"));
    const onExpired = vi.fn();
    await render("post-1", onExpired);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(seen.posting).toEqual({ status: "error" });
  });

  it("ignores a response that arrives after the session cache was cleared", async () => {
    let finish!: (posting: BenchqJob) => void;
    vi.mocked(getCandidateJob).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render("post-1");
    forgetPostings();
    await act(async () => { finish(job); });
    expect(seen.posting).toEqual({ status: "loading" });
    await render(null);
    vi.mocked(getCandidateJob).mockResolvedValue({ ...job, title: "Updated posting" });
    await render("post-1");
    expect(getCandidateJob).toHaveBeenCalledTimes(2);
    expect(seen.posting).toMatchObject({ status: "ready", posting: { title: "Updated posting" } });
  });
});
