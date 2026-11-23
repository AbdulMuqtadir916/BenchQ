// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { finishOwnFile, forgetOwnFiles, removeOwnFile, settleSwap, startOwnFile, useOwnFile, type OwnFile } from "./own-files";
import type { ResumeFile } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (name: string): ResumeFile => ({ name, mimeType: "application/pdf", data: "", source: "picked", id: `own:${name}` });

/** What the store holds for a candidate, read the way the panel reads it. */
function heldFor(candidateId: string): OwnFile {
  let seen: OwnFile | null = null;
  const Probe = () => {
    seen = useOwnFile(candidateId);
    return null;
  };
  const root = createRoot(document.createElement("div"));
  act(() => { root.render(createElement(Probe)); });
  act(() => { root.unmount(); });
  return seen!;
}

afterEach(forgetOwnFiles);

describe("the BDE's own file, kept outside the panel", () => {
  it("never takes a read for a later pick's, even after the session's files were forgotten (#148's review)", () => {
    const first = startOwnFile("cand-1");
    forgetOwnFiles();
    const second = startOwnFile("cand-1");
    expect(second).not.toBe(first);
    expect(finishOwnFile("cand-1", first, file("old.pdf"))).toBe(false);
    expect(finishOwnFile("cand-1", second, file("new.pdf"))).toBe(true);
    expect(heldFor("cand-1").file?.name).toBe("new.pdf");
  });

  it("drops a read Remove came after", () => {
    const pick = startOwnFile("cand-1");
    removeOwnFile("cand-1");
    expect(finishOwnFile("cand-1", pick, file("late.pdf"))).toBe(false);
    expect(heldFor("cand-1").file).toBeNull();
  });

  it("keeps a swap for the read's file until a panel queues it, and only once", () => {
    const pick = startOwnFile("cand-1", true);
    expect(heldFor("cand-1").swap).toBe(pick);
    finishOwnFile("cand-1", pick, file("mine.pdf"));
    expect(heldFor("cand-1")).toMatchObject({ swap: pick, isReading: false });
    settleSwap("cand-1", pick);
    expect(heldFor("cand-1").swap).toBeNull();
  });

  it("swaps nothing when the file couldn't be read", () => {
    const pick = startOwnFile("cand-1", true);
    finishOwnFile("cand-1", pick, null);
    expect(heldFor("cand-1")).toMatchObject({ file: null, swap: null, isReading: false });
  });
});
