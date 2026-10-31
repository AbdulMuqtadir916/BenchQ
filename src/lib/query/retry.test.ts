import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { shouldRetryQuery } from "./retry";

describe("shouldRetryQuery", () => {
  it("never retries a 429, a 404 or a schema mismatch", () => {
    expect(shouldRetryQuery(0, new ApiError("Too many attempts.", "RATE_LIMITED", 429))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError("Not found", "NOT_FOUND", 404))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError("Bad shape", "SCHEMA_MISMATCH", 200))).toBe(false);
  });

  it("retries anything else up to twice", () => {
    const busy = new ApiError("Database is busy", "UNAVAILABLE", 503);
    expect(shouldRetryQuery(0, busy)).toBe(true);
    expect(shouldRetryQuery(1, busy)).toBe(true);
    expect(shouldRetryQuery(2, busy)).toBe(false);
    expect(shouldRetryQuery(0, new Error("offline"))).toBe(true);
  });
});
