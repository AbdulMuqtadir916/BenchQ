import { describe, expect, it } from "vitest";
import { jobPageSize } from "./job-pages";

describe("jobPageSize", () => {
  it("opens on 50 jobs and loads 10 more each time", () => {
    expect([0, 50, 60].map(jobPageSize)).toEqual([50, 10, 10]);
  });
});
