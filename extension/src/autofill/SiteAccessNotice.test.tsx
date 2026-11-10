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
  it("says which site, why, and what BenchQ does with it, before Chrome asks", async () => {
    const { container } = await show();
    const text = container.textContent ?? "";
    expect(text).toContain("Allow BenchQ on careers.employer.test?");
    expect(text).toContain("has to read the form");
    expect(text).toContain("isn't one of the job boards");
    expect(text).toContain("take the permission away any time");
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
