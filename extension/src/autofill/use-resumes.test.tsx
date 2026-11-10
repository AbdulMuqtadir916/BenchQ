// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResumeListing, type ResumeListing } from "../api";
import { useResumes } from "./use-resumes";

vi.mock("../api", async (actual) => ({ ...await actual<typeof import("../api")>(), getResumeListing: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listing: ResumeListing = {
  bases: [
    { id: "visible", number: 1, is_active: true, archived_at: null, versions: [
      { id: "visible-v1", version: 1, name: "Base", title: "Engineer", category: "BASE", job_id: null },
    ] },
    { id: "hidden", number: 2, is_active: false, archived_at: "2026-11-01T00:00:00Z", versions: [
      { id: "hidden-v1", version: 1, name: "Base", title: "Engineer", category: "BASE", job_id: null },
    ] },
    { id: "visible-2", number: 3, is_active: false, archived_at: null, versions: [
      { id: "visible-2-v1", version: 1, name: "Base", title: "Platform Engineer", category: "BASE", job_id: null },
    ] },
  ],
  tailored: [],
};

const onSessionExpired = vi.fn();
const onAccessLost = vi.fn();

type Options = Parameters<typeof useResumes>[0];
let root: Root | null = null;
let hook: ReturnType<typeof useResumes>;

function Harness(options: Options) {
  const state = useResumes({ ...options, onSessionExpired, onAccessLost });
  useEffect(() => { hook = state; });
  return null;
}

async function render(options: Options) {
  root = createRoot(document.createElement("div"));
  await act(async () => { root!.render(<Harness {...options} />); });
}

async function rerender(options: Options) {
  await act(async () => { root!.render(<Harness {...options} />); });
}

const options: Options = {
  firmId: "firm-1", candidateId: "candidate-1", applicationId: "application-1", applicationStatus: "loading",
  jobId: null, namedId: null, onSessionExpired, onAccessLost,
};

beforeEach(() => {
  vi.mocked(getResumeListing).mockResolvedValue(listing);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  vi.clearAllMocks();
});

describe("the résumé selection waits for its linked application", () => {
  it("doesn't choose a base while application details are loading, then starts on the named hidden version", async () => {
    await render(options);
    expect(hook.resumes.status).toBe("loading");
    expect(getResumeListing).not.toHaveBeenCalled();

    await rerender({ ...options, applicationStatus: "ready", jobId: "job-1", namedId: "hidden-v1" });
    expect(getResumeListing).toHaveBeenCalledWith("firm-1", "candidate-1");
    expect(hook.resumes).toMatchObject({ status: "ready", picked: { id: "hidden-v1" } });
  });

  it("doesn't fall back to a resume when the linked application can't be found", async () => {
    await render({ ...options, applicationStatus: "unavailable" });
    expect(hook.resumes).toEqual({ status: "unavailable" });
    expect(getResumeListing).not.toHaveBeenCalled();
  });

  it("doesn't silently substitute another resume when the application's named version is missing", async () => {
    await render({ ...options, applicationStatus: "ready", namedId: "deleted-v1" });
    expect(hook.resumes).toEqual({ status: "missing" });
  });

  it("drops a manual choice when the connected application changes", async () => {
    await render({ ...options, applicationStatus: "ready", jobId: "job-1", namedId: null });
    expect(hook.resumes).toMatchObject({ status: "ready", picked: { id: "visible-v1" } });
    act(() => { hook.pick("visible-2-v1"); });
    expect(hook.resumes).toMatchObject({ status: "ready", picked: { id: "visible-2-v1" } });

    await rerender({ ...options, applicationId: "application-2", applicationStatus: "ready", jobId: "job-2", namedId: "hidden-v1" });
    expect(hook.resumes).toMatchObject({ status: "ready", picked: { id: "hidden-v1" } });
  });
});
