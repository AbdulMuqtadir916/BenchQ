import { ApiError } from "./client";

/**
 * What the user reads for an error (docs/02-DATA-CONTRACTS.md §12; docs/team/uzair.md step 4b, decisions 3 and 4).
 *
 * Chosen by code, never by status: the body's own code (`ApiError.backendCode`), else the frontend's codes
 * (`NETWORK`, `SCHEMA_MISMATCH`, and `INTERNAL` for a 5xx that came with no body and no code, e.g. the Next proxy's own
 * 500 when the backend is down). The system errors read the same on every screen; every other error keeps the
 * backend's text (`error.message`), or the screen's own words where a screen has them (`screenText`).
 */

export type SystemErrorCode = "UNAVAILABLE" | "RATE_LIMITED" | "NETWORK" | "INTERNAL" | "SCHEMA_MISMATCH";

export interface ErrorText {
  /** A heading for the system errors; null when the message stands alone (the backend's or the screen's text). */
  title: string | null;
  message: string;
  /** The request id to quote to support: only on an unexpected error (INTERNAL) that has one. */
  reference: string | null;
  /** Whether trying the same thing again can help: false for a page that is out of date (refresh instead) and for a
   * module that isn't live yet. */
  canRetry: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "a minute", "15 minutes", "1 hour", "2 hours": a `Retry-After` wait rounded up to whole minutes (or hours, from an
 * hour), so the user never tries again too early. */
export function waitPhrase(ms: number): string {
  if (ms < MINUTE_MS) return "a minute";
  if (ms < HOUR_MS) {
    const minutes = Math.ceil(ms / MINUTE_MS);
    if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  const hours = Math.ceil(ms / HOUR_MS);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/**
 * The frontend's own words for the system errors. DRAFTS pending Abdul's sign-off (docs/02 §12.4, question 4): one
 * map, so a wording change is one edit here. Rules for writing them: docs/02 §12.3. Variants decided by Uzair,
 * 2026-11-20.
 */
export const SYSTEM_ERROR_TEXT = {
  UNAVAILABLE: {
    title: "BenchQ is busy",
    /** One text on page cards and after a button press (Uzair, 2026-11-20): a card shows only once the query's own
     * retries are spent, so nothing tries again for the user in either place. */
    message: "BenchQ is handling a lot right now. Try again in a few seconds.",
    canRetry: true,
  },
  RATE_LIMITED: {
    title: "Too many requests",
    /** With the backend's `Retry-After`, as `waitPhrase` says it. */
    messageWithWait: (wait: string) => `You've sent a lot of requests in a short time. Try again in ${wait}.`,
    message: "You've sent a lot of requests in a short time. Wait a few minutes, then try again.",
    canRetry: true,
  },
  NETWORK: {
    title: "Can't reach BenchQ",
    message: "Check your internet connection, then try again.",
    canRetry: true,
  },
  INTERNAL: {
    title: "Something went wrong",
    message: "This one is on our side. Try again; if it keeps happening, send support the reference below.",
    /** The same error with no request id to quote (the Next proxy's own 500): no reference line below it. */
    messageWithoutReference: "This one is on our side. Try again; if it keeps happening, tell support.",
    canRetry: true,
  },
  SCHEMA_MISMATCH: {
    title: "BenchQ needs a refresh",
    message: "This page is out of date with BenchQ. Refresh the page to continue.",
    canRetry: false,
  },
} as const;

const SYSTEM_CODES = new Set<string>(Object.keys(SYSTEM_ERROR_TEXT));
const isSystemCode = (code: string | null): code is SystemErrorCode => code !== null && SYSTEM_CODES.has(code);

/** The codes only the frontend makes (src/lib/api/http.ts). A status-derived `code` (a 503 → `UNAVAILABLE`) is not one:
 * a 503 or 429 without the body's code is not the busy or throttle error (docs/02 §12.2, rule 6). */
const FRONTEND_SYSTEM_CODES = new Set<string>(["NETWORK", "SCHEMA_MISMATCH", "INTERNAL"]);

/** Text for an error that isn't an `Error` at all, or one with no message. */
const DEFAULT_FALLBACK = "That didn't go through. Try again.";

/** The system code an error carries, or null: the error then shows the backend's or the screen's text. */
export function systemErrorCode(error: unknown): SystemErrorCode | null {
  if (!(error instanceof ApiError)) return null;
  // The body's code decides; a body without one falls back to the frontend's own code (NETWORK, SCHEMA_MISMATCH, and
  // http.ts's INTERNAL for a 5xx with nothing in it).
  const code = error.backendCode ?? (FRONTEND_SYSTEM_CODES.has(error.code) ? error.code : null);
  return isSystemCode(code) ? code : null;
}

export const isSystemError = (error: unknown): boolean => systemErrorCode(error) !== null;

/** Trying again can't help a module with no live adapter yet. A backend 4xx keeps its Retry: its own words may ask for
 * it ("The applications kept changing while they loaded. Try again."). Queries still never retry one by themselves. */
const retryHelps = (error: unknown): boolean => !(error instanceof ApiError && error.code === "NOT_AVAILABLE");

export interface DescribeOptions {
  /** The text when the error has no message of its own (not an `Error`, or an empty message). */
  fallback?: string;
  /** A screen's own words for its non-system errors (e.g. a 409 that means "someone changed it first"); null keeps
   * the backend's text. Never consulted for a system code: those read the same everywhere. */
  screenText?: (error: unknown) => string | null;
}

function systemMessage(code: SystemErrorCode, error: unknown): string {
  const retryAfterMs = error instanceof ApiError ? error.retryAfterMs : null;
  switch (code) {
    case "RATE_LIMITED":
      return retryAfterMs === null ? SYSTEM_ERROR_TEXT.RATE_LIMITED.message : SYSTEM_ERROR_TEXT.RATE_LIMITED.messageWithWait(waitPhrase(retryAfterMs));
    case "INTERNAL":
      return error instanceof ApiError && error.requestId ? SYSTEM_ERROR_TEXT.INTERNAL.message : SYSTEM_ERROR_TEXT.INTERNAL.messageWithoutReference;
    default:
      return SYSTEM_ERROR_TEXT[code].message;
  }
}

/** The one function that picks what an error says (docs/team/uzair.md step 4b, "Agreed 2026-11-20"). */
export function describeError(error: unknown, options: DescribeOptions = {}): ErrorText {
  const code = systemErrorCode(error);
  if (code) {
    const text = SYSTEM_ERROR_TEXT[code];
    const reference = code === "INTERNAL" && error instanceof ApiError ? error.requestId : null;
    return { title: text.title, message: systemMessage(code, error), reference, canRetry: text.canRetry };
  }
  const own = options.screenText?.(error) ?? null;
  const said = error instanceof Error && error.message ? error.message : null;
  return { title: null, message: own ?? said ?? options.fallback ?? DEFAULT_FALLBACK, reference: null, canRetry: retryHelps(error) };
}

/** Just the words, for a place that has room for one sentence and no reference (a composed sentence, a label). */
export const errorSentence = (error: unknown, options?: DescribeOptions): string => describeError(error, options).message;

/** A screen's own words as an ErrorText, for a case it decides before (or instead of) `describeError`. */
export const screenErrorText = (message: string): ErrorText => ({ title: null, message, reference: null, canRetry: true });
