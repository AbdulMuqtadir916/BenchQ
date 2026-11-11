import { describe, expect, it } from "vitest";
import { LedgerListQuery } from "./ledger-list-query";

describe("Ledger list URL", () => {
  it("restores each table control", () => {
    expect(LedgerListQuery.parse({ actor: "USER", q: "sign in", sort: "-when", page: "2" }))
      .toEqual({ actor: "USER", q: "sign in", sort: "-when", page: 2 });
  });

  it("falls back independently for invalid values", () => {
    expect(LedgerListQuery.parse({ actor: "other", q: 5, sort: "summary", page: "-1" }))
      .toEqual({ actor: "ALL", q: "", sort: "", page: 1 });
    expect(LedgerListQuery.parse({ actor: "PLATFORM_ADMIN", page: "1.5" }))
      .toEqual({ actor: "PLATFORM_ADMIN", q: "", sort: "", page: 1 });
  });
});
