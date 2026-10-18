import { describe, expect, it, vi } from "vitest";
import { hasPageFailed, queryGroup } from "./query-group";

const q = (state: "pending" | "error" | "success") => ({
  isPending: state === "pending",
  isError: state === "error",
  error: state === "error" ? new Error(`failed`) : null,
  refetch: vi.fn(),
});

describe("queryGroup (docs/04 §13)", () => {
  it("is success only when every query loaded", () => {
    expect(queryGroup(q("success"), q("success")).status).toBe("success");
    expect(queryGroup(q("success"), q("pending")).status).toBe("pending");
  });

  it("lets an error win over loading, so a failed query is never shown as data while a sibling loads", () => {
    const group = queryGroup(q("pending"), q("error"), q("success"));
    expect(group.status).toBe("error");
    expect(group.error?.message).toBe("failed");
  });

  it("retries only the queries that failed", () => {
    const ok = q("success");
    const bad = q("error");
    queryGroup(ok, bad).retry();
    expect(bad.refetch).toHaveBeenCalledTimes(1);
    expect(ok.refetch).not.toHaveBeenCalled();
  });

  it("calls the page failed only when every query failed", () => {
    expect(hasPageFailed(q("error"), q("error"))).toBe(true);
    expect(hasPageFailed(q("error"), q("success"))).toBe(false);
    expect(hasPageFailed(q("error"), q("pending"))).toBe(false);
    expect(hasPageFailed()).toBe(false);
  });
});
