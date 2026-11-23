import { describe, expect, it } from "vitest";
import { copyAnnouncement, copyReference } from "./error-reference";

/** The reference's copy button (docs/team/uzair.md step 4b, decision 4): the clipboard's answer and what is said. */

describe("copyReference", () => {
  it("copied: the reference is what was written", async () => {
    const written: string[] = [];
    const state = await copyReference("req-42", { writeText: async (text: string) => { written.push(text); } });
    expect(state).toBe("copied");
    expect(written).toEqual(["req-42"]);
  });

  it("blocked: the browser refused the write", async () => {
    const state = await copyReference("req-42", { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } });
    expect(state).toBe("blocked");
  });

  it("blocked: no clipboard at all (an insecure page)", async () => {
    expect(await copyReference("req-42", undefined)).toBe("blocked");
  });
});

describe("copyAnnouncement", () => {
  it("announces Copied, the way out when blocked, and nothing at rest", () => {
    expect(copyAnnouncement("copied")).toBe("Copied");
    expect(copyAnnouncement("blocked")).toBe("Your browser blocked copying. Select the reference, then press Ctrl+C.");
    expect(copyAnnouncement("idle")).toBe("");
  });
});
