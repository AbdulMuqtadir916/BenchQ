import { describe, expect, it } from "vitest";
import { mentionsJob } from "./paste-posting-dialog";

describe("a pasted LinkedIn posting (decided 2026-11-17, Q107)", () => {
  it("must name the job's title or its company, in any case or order", () => {
    expect(mentionsJob("We are hiring a java DEVELOPER to build services.", "Java Developer", "Acme")).toBe(true);
    expect(mentionsJob("Acme Corp builds payment systems.", "Java Developer", "Acme Corp")).toBe(true);
    expect(mentionsJob("Sign in to see more jobs like this.", "Java Developer", "Acme Corp")).toBe(false);
    expect(mentionsJob("Developer wanted.", "Java Developer", null)).toBe(false);
  });
});
