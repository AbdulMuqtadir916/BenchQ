// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import FormProgress from "./FormProgress";
import type { ReviewRow, TabField } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (label: string, required: boolean, current: string): ReviewRow => ({
  key: label, status: current ? "same" : "ready", proposed: "Yes", field: { label, required, current, kind: "text" } as TabField,
});

let root: Root | null = null;
let host: HTMLElement;
function show(rows: ReviewRow[], isRestarting = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<FormProgress rows={rows} isRestarting={isRestarting} />); });
}
afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host.remove();
});

describe("the form's progress", () => {
  it("counts the fields that hold a value and the required ones still empty", () => {
    show([row("Email", true, "a@example.test"), row("Phone", true, ""), row("City", false, ""), row("Notes", false, "x")]);
    expect(host.textContent).toContain("2 of 4 fields filled");
    expect(host.textContent).toContain("1 required left");
    const bar = host.querySelector("[role='progressbar']")!;
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["2", "4"]);
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("50%");
  });

  const old = (label: string, required: boolean): ReviewRow => ({ ...row(label, required, "Old"), status: "ready", isOldFill: true });

  it("starts afresh while a switch of résumé refills the form: what BenchQ filled for the old one doesn't count", () => {
    show([old("Email", true), old("Phone", true), row("City", false, ""), row("Notes", false, "typed")], true);
    expect(host.textContent).toContain("1 of 4 fields filled");
    expect(host.textContent).toContain("2 required left");
  });

  it("counts every field that holds a value once the refill is over, an old one it couldn't take back too", () => {
    show([old("Email", true), old("Phone", true), row("City", false, ""), row("Notes", false, "typed")]);
    expect(host.textContent).toContain("3 of 4 fields filled");
    expect(host.textContent).toContain("Required fields done");
  });

  it("says so once every required field holds a value", () => {
    show([row("Email", true, "a@example.test"), row("City", false, "")]);
    expect(host.textContent).toContain("Required fields done");
  });
});
