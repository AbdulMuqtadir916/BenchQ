import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { SYSTEM_ERROR_TEXT } from "@/lib/api/error-text";
import { http } from "@/lib/api/http";
import { ErrorNote } from "@/components/app/error-note";
import { INVALID_SIGN_IN, signInError } from "./sign-in-error";

/**
 * What /sign-in says when signing in fails (docs/07 L1; docs/team/uzair.md step 4b). Each case goes through the real
 * http.ts, from the response the backend sends (backend/auth/throttle.py, backend/statement_timeout.py), to the note
 * the page renders.
 */

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/problem+json", ...headers } }));
}

function problem(status: number, detail: string, code: string) {
  return { type: "about:blank", title: "Error", status, detail, code, request_id: "req-7" };
}

async function signInFailure(): Promise<Error> {
  try {
    await http.post("/api/auth/login", z.unknown(), { body: { email: "a@example.com", password: "x" } });
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected the sign-in to fail");
}

const note = async () => renderToStaticMarkup(<ErrorNote text={signInError(await signInFailure())} />);

afterEach(() => vi.unstubAllGlobals());

describe("the sign-in page's error", () => {
  it("the throttle: how long to wait, from Retry-After", async () => {
    answer(429, problem(429, "Too many attempts. Try again in a few minutes.", "RATE_LIMITED"), { "Retry-After": "900" });
    expect(signInError(await signInFailure()).message).toBe("Too many sign-in attempts. Try again in 15 minutes.");
    answer(429, problem(429, "Too many attempts. Try again in a few minutes.", "RATE_LIMITED"), { "Retry-After": "61" });
    expect(await note()).toContain("Too many sign-in attempts. Try again in 2 minutes.");
  });

  it("the throttle without Retry-After: wait a few minutes", async () => {
    answer(429, problem(429, "Too many attempts. Try again in a few minutes.", "RATE_LIMITED"));
    expect(signInError(await signInFailure()).message).toBe("Too many sign-in attempts. Wait a few minutes, then try again.");
  });

  it("busy (503 UNAVAILABLE): the shared words, not the backend's", async () => {
    answer(503, problem(503, "The service is busy. Try again in a few seconds.", "UNAVAILABLE"), { "Retry-After": "5" });
    const text = signInError(await signInFailure());
    expect(text.message).toBe(SYSTEM_ERROR_TEXT.UNAVAILABLE.message);
    expect(await note()).toContain(SYSTEM_ERROR_TEXT.UNAVAILABLE.message);
  });

  it("a network failure: the shared words", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    const text = signInError(await signInFailure());
    expect(text.message).toBe(SYSTEM_ERROR_TEXT.NETWORK.message);
    expect(text.message).not.toBe(INVALID_SIGN_IN);
  });

  it("a refused sign-in never says why", async () => {
    answer(401, problem(401, "Invalid credentials.", "UNAUTHENTICATED"));
    expect(signInError(await signInFailure()).message).toBe(INVALID_SIGN_IN);
    expect(signInError(new ApiError("No such user.", "VALIDATION_FAILED", 422)).message).toBe("Couldn't sign in right now. Try again.");
  });
});
