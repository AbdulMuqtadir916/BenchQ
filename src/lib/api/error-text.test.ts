import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { SYSTEM_ERROR_TEXT, describeError, isSystemError, systemErrorCode, waitPhrase } from "./error-text";

/** What the user reads, by code (docs/02 §12; docs/team/uzair.md step 4b, decisions 3 and 4). */

const fromBody = (status: number, backendCode: string, message = "The backend's own words.", requestId: string | null = "req-1") =>
  new ApiError(message, `HTTP_${status}`, status, null, { backendCode, requestId });

describe("the system codes read the frontend's words, chosen by code", () => {
  it("UNAVAILABLE: one text everywhere", () => {
    expect(describeError(fromBody(503, "UNAVAILABLE"))).toEqual({
      title: "BenchQ is busy", message: "BenchQ is handling a lot right now. Try again in a few seconds.", reference: null, canRetry: true,
    });
  });

  const throttled = (retryAfterMs: number | null) =>
    new ApiError("Too many requests.", "RATE_LIMITED", 429, null, { backendCode: "RATE_LIMITED", retryAfterMs });

  it("RATE_LIMITED says the backend's wait", () => {
    expect(describeError(throttled(60_000))).toEqual({
      title: "Too many requests", message: "You've sent a lot of requests in a short time. Try again in 1 minute.", reference: null, canRetry: true,
    });
    expect(describeError(throttled(15 * 60_000)).message).toBe("You've sent a lot of requests in a short time. Try again in 15 minutes.");
    expect(describeError(throttled(5000)).message).toBe("You've sent a lot of requests in a short time. Try again in a minute.");
  });

  it("RATE_LIMITED without Retry-After: wait a few minutes", () => {
    expect(describeError(throttled(null)).message).toBe("You've sent a lot of requests in a short time. Wait a few minutes, then try again.");
  });

  it("NETWORK, made by http.ts when nothing answered", () => {
    const text = describeError(new ApiError("Can't reach the BenchQ backend. Check that it is running.", "NETWORK", 0));
    expect(text).toEqual({ title: "Can't reach BenchQ", message: "Check your internet connection, then try again.", reference: null, canRetry: true });
  });

  it("SCHEMA_MISMATCH: refresh, not retry", () => {
    const text = describeError(new ApiError("GET /api/x returned data the app doesn't understand.", "SCHEMA_MISMATCH", 200));
    expect(text.title).toBe("BenchQ needs a refresh");
    expect(text.message).toBe("This page is out of date with BenchQ. Refresh the page to continue.");
    expect(text.canRetry).toBe(false);
  });

  it("INTERNAL with a request id: the reference is the id", () => {
    const text = describeError(fromBody(500, "INTERNAL", "Something went wrong on BenchQ's side.", "req-42"));
    expect(text).toEqual({ title: "Something went wrong", message: SYSTEM_ERROR_TEXT.INTERNAL.message, reference: "req-42", canRetry: true });
    expect(text.message).toMatch(/reference below/);
  });

  it("INTERNAL without a request id (the Next proxy's own 500): no reference, and the words don't point at one", () => {
    const text = describeError(new ApiError("Request failed with status 500.", "INTERNAL", 500));
    expect(text.title).toBe("Something went wrong");
    expect(text.reference).toBeNull();
    expect(text.message).toBe("This one is on our side. Try again; if it keeps happening, tell support.");
  });

  it("a screen's own words never replace a system code's", () => {
    const text = describeError(fromBody(429, "RATE_LIMITED"), { screenText: () => "You have 5 tailorings running." });
    expect(text.message).toBe(SYSTEM_ERROR_TEXT.RATE_LIMITED.message);
  });
});

describe("waitPhrase: rounded up, so nobody tries again too early", () => {
  it.each([
    [0, "a minute"], [59_999, "a minute"], [60_000, "1 minute"], [60_001, "2 minutes"], [15 * 60_000, "15 minutes"],
    [59 * 60_000 + 1, "1 hour"], [60 * 60_000, "1 hour"], [60 * 60_000 + 1, "2 hours"], [3 * 60 * 60_000, "3 hours"],
  ])("%i ms → %s", (ms, phrase) => {
    expect(waitPhrase(ms)).toBe(phrase);
  });
});

describe("every other error keeps the backend's words", () => {
  it.each(["DAILY_LIMIT", "TAILORINGS_RUNNING", "NOT_CONFIGURED", "DUPLICATE_RESUME", "VALIDATION_FAILED", "NOT_FOUND", "SOMETHING_NEW"])("%s", (code) => {
    const text = describeError(fromBody(409, code, "Ten jobs added today. It resets at 6:30 PM IST."));
    expect(text).toEqual({ title: null, message: "Ten jobs added today. It resets at 6:30 PM IST.", reference: null, canRetry: true });
  });

  it("MAILBOX_BUSY (a 503 with its own code) is not the busy error", () => {
    const text = describeError(fromBody(503, "MAILBOX_BUSY", "This Google account is busy. Try again shortly."));
    expect(text.message).toBe("This Google account is busy. Try again shortly.");
    expect(text.title).toBeNull();
  });

  it("a 503 or 429 without the body's code is not a system error: only the code decides (rule 6)", () => {
    expect(isSystemError(new ApiError("scrape is busy", "UNAVAILABLE", 503))).toBe(false);
    expect(describeError(new ApiError("Too many attempts. Try again in a few minutes.", "RATE_LIMITED", 429)).message).toBe("Too many attempts. Try again in a few minutes.");
  });

  it("an INTERNAL request id is never shown on another code", () => {
    expect(describeError(fromBody(500, "NOT_CONFIGURED", "The résumé tailor isn't set up yet. Ask your admin.", "req-7")).reference).toBeNull();
  });

  it("a screen's own words, when it has them, then the backend's, then the fallback", () => {
    const conflict = new ApiError("stale", "CONFLICT", 409);
    expect(describeError(conflict, { screenText: () => "It changed. Reload." }).message).toBe("It changed. Reload.");
    expect(describeError(conflict, { screenText: () => null }).message).toBe("stale");
    expect(describeError("not an error", { fallback: "The save didn't go through. Try again." }).message).toBe("The save didn't go through. Try again.");
    expect(describeError(new Error("")).message).toBe("That didn't go through. Try again.");
  });

  it("a module with no live adapter can't be retried", () => {
    expect(describeError(new ApiError("Not available on the live backend yet.", "NOT_AVAILABLE", 501)).canRetry).toBe(false);
  });

  it("a plain Error is not a system error", () => {
    expect(systemErrorCode(new Error("boom"))).toBeNull();
  });
});
