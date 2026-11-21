import { z, type ZodType } from "zod";

/** Errors shared by the local adapters and TanStack Query error UI. */

export class ApiError extends Error {
  code: string;
  status: number;
  /** What the backend named beside its message (e.g. a 409's duplicate résumé): the problem body's extension
   * members, or an old-shape object `detail`. */
  details: Record<string, unknown> | null;
  /** The body's own `code` (docs/02 §12.1), e.g. `DAILY_LIMIT`; null for an old-shape or non-JSON body. What the
   * user reads is chosen from it (src/lib/api/error-text.ts); `code` above stays the status-derived or frontend one. */
  backendCode: string | null;
  /** The body's `request_id` (same as the `X-Request-ID` header); null when the body had none. */
  requestId: string | null;
  /** A validation 422's fields and their messages (no submitted values); shown nowhere, kept for debugging. */
  fieldErrors: ReadonlyArray<{ loc: string; msg: string }> | null;
  /** How long the backend asked to wait before trying again (the `Retry-After` header), in ms; null when it didn't. */
  retryAfterMs: number | null;
  constructor(
    message: string,
    code: string,
    status: number,
    details: Record<string, unknown> | null = null,
    meta: {
      backendCode?: string | null;
      requestId?: string | null;
      retryAfterMs?: number | null;
      fieldErrors?: ReadonlyArray<{ loc: string; msg: string }> | null;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.backendCode = meta.backendCode ?? null;
    this.requestId = meta.requestId ?? null;
    this.retryAfterMs = meta.retryAfterMs ?? null;
    this.fieldErrors = meta.fieldErrors ?? null;
  }
}

/** The record doesn't exist (or the user may not know it exists): show not-found, not an error card. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Something the mocks do that the backend doesn't have yet (07 Q38: the live backend is onboarding only so far). */
export function notLiveYet(): never {
  throw new ApiError("Not available on the live backend yet.", "NOT_AVAILABLE", 501);
}

/** Helper used by the local JSON store and adapter schemas. */
export const arrayOf = <T,>(schema: ZodType<T>) => z.array(schema);
