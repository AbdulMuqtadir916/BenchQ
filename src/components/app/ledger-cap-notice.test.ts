import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LedgerCapNotice } from "./ledger-cap-notice";

/**
 * BUG-022: the Ledger screen loads the whole ledger up to a cap. Only when entries remain beyond the cap does it say so, because
 * an audit trail that silently hides its older entries is worse than one that admits it.
 */
describe("LedgerCapNotice", () => {
  it("says how many entries are shown and that older ones are not loaded, when the cap was reached", () => {
    const markup = renderToStaticMarkup(createElement(LedgerCapNotice, { hasMore: true, shown: 2000 }));
    expect(markup).toContain("Showing the latest 2,000 entries");
    expect(markup).toContain("Older entries are not loaded");
    expect(markup).toContain('role="status"');
  });

  it("is absent when the whole ledger was loaded", () => {
    expect(renderToStaticMarkup(createElement(LedgerCapNotice, { hasMore: false, shown: 119 }))).toBe("");
  });
});
