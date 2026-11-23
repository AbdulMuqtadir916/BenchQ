import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { RETRY_AFTER_CAP_MS, retryDelay, shouldRetryQuery } from "./retry";

/** docs/02 §12.2 rule 7; docs/team/uzair.md step 4b, decision 5 (cap agreed 2026-11-20). */

const withRetryAfter = (status: number, retryAfterMs: number | null) =>
  new ApiError("Busy.", "UNAVAILABLE", status, null, { backendCode: "UNAVAILABLE", retryAfterMs });

describe("shouldRetryQuery", () => {
  it.each([400, 401, 403, 404, 409, 410, 413, 422, 429])("never retries a %i", (status) => {
    expect(shouldRetryQuery(0, new ApiError("No.", "X", status))).toBe(false);
  });

  it("never retries a schema mismatch or a module that isn't live", () => {
    expect(shouldRetryQuery(0, new ApiError("Bad shape", "SCHEMA_MISMATCH", 200))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError("Not live", "NOT_AVAILABLE", 501))).toBe(false);
  });

  it.each([500, 502, 503, 504])("retries a %i up to twice", (status) => {
    const error = new ApiError("Down.", "X", status);
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });

  it("retries a network error up to twice", () => {
    const offline = new ApiError("Can't reach the BenchQ backend.", "NETWORK", 0);
    expect(shouldRetryQuery(0, offline)).toBe(true);
    expect(shouldRetryQuery(2, offline)).toBe(false);
  });

  it("a 503 whose Retry-After asks for longer than the cap is not retried: the card shows at once", () => {
    expect(shouldRetryQuery(0, withRetryAfter(503, 120_000))).toBe(false);
  });

  it("a 503 whose Retry-After is within the cap is retried, the cap itself included", () => {
    expect(shouldRetryQuery(0, withRetryAfter(503, 5000))).toBe(true);
    expect(shouldRetryQuery(0, withRetryAfter(503, RETRY_AFTER_CAP_MS))).toBe(true);
  });

  it("an error that isn't an ApiError keeps the old rule", () => {
    expect(shouldRetryQuery(0, new Error("offline"))).toBe(true);
    expect(shouldRetryQuery(2, new Error("offline"))).toBe(false);
  });
});

describe("retryDelay", () => {
  it("waits what Retry-After asks", () => {
    expect(retryDelay(0, withRetryAfter(503, 5000))).toBe(5000);
    expect(retryDelay(1, withRetryAfter(503, 0))).toBe(0);
  });

  it("caps Retry-After at 10 s", () => {
    expect(RETRY_AFTER_CAP_MS).toBe(10_000);
    expect(retryDelay(0, withRetryAfter(503, 120_000))).toBe(10_000);
  });

  it("falls back to TanStack's default backoff without Retry-After", () => {
    expect(retryDelay(0, withRetryAfter(503, null))).toBe(1000);
    expect(retryDelay(1, new ApiError("Down.", "X", 500))).toBe(2000);
    expect(retryDelay(10, new Error("offline"))).toBe(30_000);
  });
});
