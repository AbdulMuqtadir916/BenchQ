import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "./client";
import { http, parseRetryAfter } from "./http";

/**
 * Error bodies → `ApiError` (docs/02 §12; docs/team/uzair.md step 4b). The backend's text is kept as `message`; the
 * body's code, request id and `Retry-After` are stored for src/lib/api/error-text.ts and src/lib/query/retry.ts.
 */

const VALIDATION_DETAIL = "BenchQ couldn't take this as it was sent. Refresh the page and try again.";

function answer(status: number, body: unknown, contentType = "application/problem+json", headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": contentType, ...headers } }));
}

async function failure(): Promise<ApiError> {
  try {
    await http.get("/api/anything", z.unknown());
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

function problem(status: number, detail: string, code: string, extra: Record<string, unknown> = {}) {
  return { type: "about:blank", title: "Error", status, detail, code, request_id: "req-123", ...extra };
}

afterEach(() => vi.unstubAllGlobals());

describe("the problem body (new shape)", () => {
  it("a 409 duplicate résumé: the detail is the message, the top-level members are the details", async () => {
    answer(409, problem(409, "This résumé is already Base 2.", "DUPLICATE_RESUME", { base_resume_id: "b-1", hidden: false }));
    const error = await failure();
    expect(error.message).toBe("This résumé is already Base 2.");
    expect(error.code).toBe("CONFLICT");
    expect(error.backendCode).toBe("DUPLICATE_RESUME");
    expect(error.requestId).toBe("req-123");
    expect(error.details).toEqual({ baseResumeId: "b-1", hidden: false });
  });

  it("a 422 with errors: the backend's sentence; the fields kept, shown nowhere (Uzair, 2026-11-20)", async () => {
    answer(422, problem(422, VALIDATION_DETAIL, "VALIDATION_FAILED", {
      errors: [{ loc: ["body", "email"], msg: "value is not a valid email address", type: "value_error" }, { loc: ["query", "limit"], msg: "Input should be less than or equal to 400", type: "less_than_equal" }],
    }));
    const error = await failure();
    expect(error.message).toBe(VALIDATION_DETAIL);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toBeNull();
    expect(error.fieldErrors).toEqual([
      { loc: "body.email", msg: "value is not a valid email address" },
      { loc: "query.limit", msg: "Input should be less than or equal to 400" },
    ]);
  });

  it("the unexpected 500 (INTERNAL): the detail kept as the message, the request id stored", async () => {
    answer(500, problem(500, "Something went wrong on BenchQ's side.", "INTERNAL"));
    const error = await failure();
    expect(error.message).toBe("Something went wrong on BenchQ's side.");
    expect(error.code).toBe("HTTP_500");
    expect(error.backendCode).toBe("INTERNAL");
    expect(error.requestId).toBe("req-123");
    expect(error.details).toBeNull();
  });

  it("the busy 503: the detail kept, the code status-derived, the body's code and Retry-After stored", async () => {
    answer(503, problem(503, "The service is busy. Try again in a few seconds.", "UNAVAILABLE"), "application/problem+json", { "Retry-After": "5" });
    const error = await failure();
    expect(error.message).toBe("The service is busy. Try again in a few seconds.");
    expect(error.code).toBe("UNAVAILABLE");
    expect(error.backendCode).toBe("UNAVAILABLE");
    expect(error.retryAfterMs).toBe(5000);
  });

  it("no Retry-After header: null", async () => {
    answer(429, problem(429, "Too many requests.", "RATE_LIMITED"));
    expect((await failure()).retryAfterMs).toBeNull();
  });

  it.each([
    [500, "The résumé tailor isn't set up: the tailor_model setting is empty.", "NOT_CONFIGURED", "HTTP_500"],
    [500, "The résumé reader didn't answer. Try again in a minute.", "RESUME_READER_FAILED", "HTTP_500"],
    [504, "There was an issue while parsing your resume, please try again.", "RESUME_READER_TIMEOUT", "HTTP_504"],
    [429, "You have 5 tailorings running. Wait for one to finish, then try again.", "TAILORINGS_RUNNING", "RATE_LIMITED"],
    [503, "The search couldn't start; try again.", "SEARCH_NOT_STARTED", "UNAVAILABLE"],
    [404, "Not Found", "NOT_FOUND", "NOT_FOUND"],
  ])("a deliberate %i keeps its text as before (%s)", async (status, detail, backendCode, code) => {
    answer(status, problem(status, detail, backendCode));
    const error = await failure();
    expect(error.message).toBe(detail);
    expect(error.code).toBe(code);
    expect(error.backendCode).toBe(backendCode);
  });

  it("a body with no request id stores null", async () => {
    const body: Record<string, unknown> = problem(400, "Give a reason of at least 10 characters.", "BAD_REQUEST");
    delete body.request_id;
    answer(400, body);
    const error = await failure();
    expect(error.message).toBe("Give a reason of at least 10 characters.");
    expect(error.requestId).toBeNull();
    expect(error.retryAfterMs).toBeNull();
    expect(error.fieldErrors).toBeNull();
  });
});

describe("the old shape (JobNavigator leftovers) parses exactly as before", () => {
  it("a string detail is the message", async () => {
    answer(409, { detail: "scrape is already running" }, "application/json");
    const error = await failure();
    expect(error.message).toBe("scrape is already running");
    expect(error.code).toBe("CONFLICT");
    expect(error.backendCode).toBeNull();
    expect(error.requestId).toBeNull();
    expect(error.details).toBeNull();
  });

  it("a list detail is joined", async () => {
    answer(422, { detail: [{ loc: ["body", "name"], msg: "Field required" }, { loc: ["body"] }] }, "application/json");
    const error = await failure();
    expect(error.message).toBe("body.name: Field required; body: invalid");
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.fieldErrors).toEqual([{ loc: "body.name", msg: "Field required" }, { loc: "body", msg: "invalid" }]);
  });

  it("an object detail is the details, its message the message", async () => {
    answer(409, { detail: { message: "This résumé is Base 1 (hidden). Show it again?", base_resume_id: "b-2", hidden: true } }, "application/json");
    const error = await failure();
    expect(error.message).toBe("This résumé is Base 1 (hidden). Show it again?");
    expect(error.details).toEqual({ baseResumeId: "b-2", hidden: true });
    expect(error.backendCode).toBeNull();
  });

  it("an object detail without a message keeps the status text", async () => {
    answer(409, { detail: { base_resume_id: "b-3" } }, "application/json");
    const error = await failure();
    expect(error.message).toBe("Request failed with status 409.");
    expect(error.details).toEqual({ baseResumeId: "b-3" });
  });

  it("only known members pass, camelCased: no snake_case name leaves the DTO layer", async () => {
    answer(409, problem(409, "Clash.", "CONFLICT", { base_resume_id: "b-4", some_new_field: 1 }));
    const error = await failure();
    expect(error.details).toEqual({ baseResumeId: "b-4" });
    expect(Object.keys(error.details ?? {}).some((name) => name.includes("_"))).toBe(false);
  });

  it("an object detail with no known member: no details", async () => {
    answer(409, { detail: { message: "Clash.", other_thing: "x" } }, "application/json");
    expect((await failure()).details).toBeNull();
  });

  it("a JSON body with no detail keeps the status text", async () => {
    answer(418, { something: "else" }, "application/json");
    const error = await failure();
    expect(error.message).toBe("Request failed with status 418.");
    expect(error.code).toBe("HTTP_418");
    expect(error.details).toBeNull();
  });
});

describe("a body that isn't JSON", () => {
  it("a 5xx with nothing in it (the Next proxy's own 500) is the frontend's INTERNAL, with no reference", async () => {
    answer(500, "Internal Server Error", "text/plain");
    const error = await failure();
    expect(error.message).toBe("Request failed with status 500.");
    expect(error.code).toBe("INTERNAL");
    expect(error.backendCode).toBeNull();
    expect(error.requestId).toBeNull();
    expect(error.details).toBeNull();
  });

  it("a 503 with nothing in it is INTERNAL too, not the busy error", async () => {
    answer(503, "", "text/plain");
    const error = await failure();
    expect(error.code).toBe("INTERNAL");
    expect(error.backendCode).toBeNull();
  });

  it("a 4xx with nothing in it keeps its status code", async () => {
    answer(404, "Not Found", "text/plain");
    expect((await failure()).code).toBe("NOT_FOUND");
  });
});

describe("Retry-After (RFC 9110 §10.2.3)", () => {
  const now = Date.parse("2026-11-20T18:00:00Z");
  it("delay-seconds", () => {
    expect(parseRetryAfter("5", now)).toBe(5000);
    expect(parseRetryAfter(" 0 ", now)).toBe(0);
  });
  it("an HTTP date: the time until it; a past date is 0", () => {
    expect(parseRetryAfter("Fri, 20 Nov 2026 18:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("Fri, 20 Nov 2026 17:59:00 GMT", now)).toBe(0);
  });
  it("absent or unreadable: null", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter("-5", now)).toBeNull();
  });
  it("only the IMF-fixdate shape is read as a date: junk with a digit is null", () => {
    expect(parseRetryAfter("foo 1", now)).toBeNull();
    expect(parseRetryAfter("1 Nov", now)).toBeNull();
    expect(parseRetryAfter("2026-11-20T18:00:30Z", now)).toBeNull();
    expect(parseRetryAfter("Friday, 20-Nov-26 18:00:30 GMT", now)).toBeNull();
  });
  it("an all-digit string too long to count is the longest wait, never Infinity or NaN", () => {
    expect(parseRetryAfter("9".repeat(400), now)).toBe(24 * 60 * 60_000);
    expect(parseRetryAfter("99999999999", now)).toBe(24 * 60 * 60_000);
  });
});

describe("ApiError stays constructible the old way", () => {
  it("without the new fields", () => {
    const error = new ApiError("Not available on the live backend yet.", "NOT_AVAILABLE", 501);
    expect(error.details).toBeNull();
    expect(error.backendCode).toBeNull();
    expect(error.requestId).toBeNull();
  });
});
