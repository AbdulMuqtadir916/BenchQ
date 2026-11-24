import { describe, expect, it } from "vitest";
import type { Query } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { sameScopeOnly } from "./use-admin-activity";

type Q = Query<string[], Error, string[], readonly unknown[]>;
const previous = ["the last answer"];
const answered = (scope: unknown) => ({ queryKey: queryKeys.platform.activity("candidates", scope, {}) }) as unknown as Q;

// CodeRabbit on #145: the candidate picker kept the last view's candidates while the next view's loaded.
describe("the Super Admin's pickers keep the last answer only within the same firm and view", () => {
  it("keeps it within one firm, or within the whole platform", () => {
    expect(sameScopeOnly<string[]>({ firmId: "f1" })(previous, answered({ firmId: "f1" }))).toBe(previous);
    expect(sameScopeOnly<string[]>({})(previous, answered({}))).toBe(previous);
    expect(sameScopeOnly<string[]>({ firmId: "f1" })(previous, answered("f1"))).toBe(previous);   // the people key
  });

  it("drops it for another firm, or between the whole platform and failed sign-ins", () => {
    expect(sameScopeOnly<string[]>({ firmId: "f2" })(previous, answered({ firmId: "f1" }))).toBeUndefined();
    expect(sameScopeOnly<string[]>({ isFailed: true })(previous, answered({}))).toBeUndefined();
    expect(sameScopeOnly<string[]>({})(previous, answered({ isFailed: true }))).toBeUndefined();
    expect(sameScopeOnly<string[]>({})(undefined, undefined)).toBeUndefined();
  });
});
