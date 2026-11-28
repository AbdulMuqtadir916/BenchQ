// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readJobPage } from "./tab-bridge";
import type { PageJob } from "./types";
import { isThisJob, usePageJob } from "./use-page-job";

vi.mock("./tab-bridge", () => ({ readJobPage: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let seen: PageJob | null = null;

const report = (state: PageJob | null) => { seen = state; };

function Harness({ isOpen }: { isOpen: boolean }) {
  const state = usePageJob(7, isOpen);
  useEffect(() => report(state));
  return null;
}

const render = (isOpen: boolean) => act(async () => {
  root ??= createRoot(document.createElement("div"));
  root.render(<Harness isOpen={isOpen} />);
});

const page: PageJob = { title: "Analytics Engineer", company: "Reddit", location: "Remote", url: "https://boards.greenhouse.io/reddit/jobs/1",
  isJobPage: true, description: "<p>Reddit is a community of communities.</p>" };

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  vi.clearAllMocks();
});

describe("the job's page as the tab shows it, for its details page", () => {
  it("is read each time the details page opens, and is nothing while it's closed", async () => {
    vi.mocked(readJobPage).mockResolvedValue(page);
    await render(false);
    expect(seen).toBeNull();
    expect(readJobPage).not.toHaveBeenCalled();
    await render(true);
    expect(seen).toEqual(page);
    expect(readJobPage).toHaveBeenCalledWith(7);
    await render(false);
    expect(seen).toBeNull();
    await render(true);
    expect(readJobPage).toHaveBeenCalledTimes(2);
  });

  it("is nothing on a page that shows no job, or one it couldn't read", async () => {
    vi.mocked(readJobPage).mockResolvedValueOnce({ ...page, isJobPage: false });
    await render(true);
    expect(seen).toBeNull();
    await render(false);
    vi.mocked(readJobPage).mockRejectedValueOnce(new Error("No tab."));
    await render(true);
    expect(seen).toBeNull();
  });

  it("knows the connected job on its page, its form, or as the same listing elsewhere", () => {
    const job = { title: "Analytics Engineer", company: "Reddit", url: "https://boards.greenhouse.io/reddit/jobs/1" };
    expect(isThisJob(page, job, null)).toBe(true);
    expect(isThisJob({ ...page, url: `${job.url}/apply` }, job, null)).toBe(true);
    expect(isThisJob({ ...page, url: "https://www.redditinc.com/careers/1" }, job, null)).toBe(true);
    expect(isThisJob({ ...page, url: "https://boards.greenhouse.io/reddit/jobs/2", title: "Data Scientist" }, job, null)).toBe(false);
  });
});
