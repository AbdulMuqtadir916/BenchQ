import { describe, expect, it } from "vitest";
import { WorkAuth } from "@/lib/schemas/enums";
import { needsSponsorship, needsTransfer, workAuthChange } from "./work-auth";

describe("workAuthChange: a work authorization edit on the candidate page", () => {
  it("sends the new status with the same sponsorship and transfer as the new-candidate flow", () => {
    expect(workAuthChange("H1B", "GC")).toEqual({ workAuth: "GC", needsSponsorship: false, needsTransfer: false });
    expect(workAuthChange("GC", "H1B")).toEqual({ workAuth: "H1B", needsSponsorship: true, needsTransfer: true });
    expect(workAuthChange("USC", "OPT")).toEqual({ workAuth: "OPT", needsSponsorship: true, needsTransfer: false });
  });

  it("follows the rule for every status", () => {
    for (const next of WorkAuth.options.filter((w) => w !== "USC")) {
      expect(workAuthChange("USC", next)).toEqual({ workAuth: next, needsSponsorship: needsSponsorship(next), needsTransfer: needsTransfer(next) });
    }
  });

  it("sends nothing when the status didn't change, so a rate-only edit leaves them alone", () => {
    expect(workAuthChange("H1B", "H1B")).toEqual({});
  });
});
