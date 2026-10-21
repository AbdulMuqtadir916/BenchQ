import { z, type ZodType } from "zod";

/** Errors shared by the local adapters and TanStack Query error UI. */

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
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
