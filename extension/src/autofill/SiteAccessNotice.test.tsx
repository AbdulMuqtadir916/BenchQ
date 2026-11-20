// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SiteAccessNotice } from "./SiteAccessNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const access = { origins: ["https://careers.employer.test/*"], host: "careers.employer.test" };

async function show(props: Partial<Parameters<typeof SiteAccessNotice>[0]> = {}) {
  const container = document.createElement("div");
  const onAllow = vi.fn();
  await act(async () => { createRoot(container).render(<SiteAccessNotice access={access} isDenied={false} isAsking={false} onAllow={onAllow} {...props} />); });
  return { container, onAllow };
}

describe("the notice asking to read a site", () => {
  it("says which site, why, and what BenchQ does with it, before Chrome asks, in a compact card", async () => {
    const { container } = await show();
    const text = container.textContent ?? "";
    expect(text).toContain("Allow BenchQ on this site?");
    expect(container.querySelector("[data-slot=site-access-host]")?.textContent).toBe("careers.employer.test");
    expect(text).toContain("needs to read the form on careers.employer.test to fill it");
    expect(text).toContain("isn't on BenchQ's list yet");
    // What BenchQ will and won't do is there, folded away until asked for.
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("What BenchQ can see");
    expect(details.textContent).toContain("Reads only this tab's form");
    expect(details.textContent).toContain("Asks once for this site");
    expect(details.textContent).toContain("Yours to take back");
    expect(container.querySelector("[data-slot=site-access-allow]")?.textContent).toBe("Allow on careers.employer.test");
  });

  it("is a labelled region a screen reader can find", async () => {
    const { container } = await show();
    const region = container.querySelector("[data-slot=site-access]")!;
    expect(region.getAttribute("aria-labelledby")).toBe("site-access-title");
    expect(container.querySelector("#site-access-title")?.textContent).toContain("Allow BenchQ");
  });

  it("asks Chrome when the button is clicked", async () => {
    const { container, onAllow } = await show();
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-slot=site-access-allow]")!.click(); });
    expect(onAllow).toHaveBeenCalledTimes(1);
  });

  it("explains a no, and offers to ask again", async () => {
    const { container } = await show({ isDenied: true });
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Not allowed");
    expect(container.querySelector("[data-slot=site-access-allow]")?.textContent).toBe("Ask again");
  });
});
