import type { ZodType } from "zod";
import { ApiError } from "./client";
import { fromErrorBody } from "./dto/problem";

/**
 * The only place the frontend talks to the network. Paths are relative
 * (`/api/...`); next.config.ts proxies them to BACKEND_URL so requests are
 * same-origin and the backend's HTTP-only `bq_session` cookie just works.
 */

type QueryValue = string | number | boolean | null | undefined;

/**
 * Where a client sends its requests. The default is the browser's: relative paths, the same origin, the
 * `bq_session` cookie attached by `credentials: "include"`. A server render (src/lib/server/) has no
 * origin and no cookie jar, so it passes the backend's own URL and the incoming request's cookie.
 */
export interface HttpTarget {
  baseUrl?: string;
  headers?: Record<string, string>;
}

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
}

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  502: "UPSTREAM_FAILED",
  503: "UNAVAILABLE",
};

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Longest wait `Retry-After` can ask of us, so a far-off date can't overflow a timer. Callers cap it lower. */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

/** The HTTP date a server sends (RFC 9110 §5.6.7, IMF-fixdate): "Wed, 21 Oct 2026 07:28:00 GMT". */
const IMF_FIXDATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * The `Retry-After` header (RFC 9110 §10.2.3) → ms to wait: delay-seconds ("5") or an IMF-fixdate. null when absent or
 * anything else (`Date.parse` would read "foo 1" or "-5" as a date); a date in the past is 0. A wait too long to count
 * (an all-digit string past `Number`'s range) is the longest wait.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const ms = Number(text) * 1000;
    return Number.isFinite(ms) ? Math.min(ms, MAX_RETRY_AFTER_MS) : MAX_RETRY_AFTER_MS;
  }
  const at = IMF_FIXDATE.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), MAX_RETRY_AFTER_MS);
}

/**
 * An error response → `ApiError`. The body is read by `fromErrorBody` (src/lib/api/dto/problem.ts): the problem
 * body (docs/02 §12) or the old `{"detail": …}` shape. `code` is the status-derived one; the body's own code, its
 * request id and the `Retry-After` wait are stored beside it, and the text the user reads is chosen from them
 * (src/lib/api/error-text.ts). A 5xx with nothing in it (not JSON, no code, no detail: the Next proxy's own 500 when
 * the backend is down) is the frontend's `INTERNAL`: an unexpected failure, with no reference to quote.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error body; keep the status message.
  }
  const body = fromErrorBody(payload);
  const isEmptyFailure = response.status >= 500 && body.backendCode === null && body.message === null;
  return new ApiError(
    body.message ?? `Request failed with status ${response.status}.`,
    isEmptyFailure ? "INTERNAL" : (STATUS_CODES[response.status] ?? `HTTP_${response.status}`),
    response.status,
    body.details,
    {
      backendCode: body.backendCode,
      requestId: body.requestId,
      retryAfterMs: parseRetryAfter(response.headers.get("Retry-After")),
      fieldErrors: body.fieldErrors,
    },
  );
}

async function request<T>(target: HttpTarget, method: string, path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  // A form (a file upload) sets its own multipart Content-Type, boundary included.
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  let response: Response;
  try {
    const headers = { ...(hasBody && !isForm ? { "Content-Type": "application/json" } : {}), ...target.headers };
    response = await fetch(`${target.baseUrl ?? ""}${buildUrl(path, options.query)}`, {
      method,
      credentials: "include",
      // A server read is never cached: it is somebody's session.
      cache: target.baseUrl ? "no-store" : undefined,
      headers: Object.keys(headers).length ? headers : undefined,
      body: isForm ? (options.body as FormData) : hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // Shown as the NETWORK text (src/lib/api/error-text.ts); this message is for logs and tests.
    throw new ApiError("Can't reach the BenchQ backend. Check that it is running.", "NETWORK", 0);
  }

  if (!response.ok) throw await toApiError(response);

  const payload: unknown = response.status === 204 ? undefined : await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    if (process.env.NODE_ENV === "development") {
      console.error(`[api] ${method} ${path} returned an unexpected shape`, parsed.error.issues);
    }
    throw new ApiError(`${method} ${path} returned data the app doesn't understand.`, "SCHEMA_MISMATCH", response.status);
  }
  return parsed.data;
}

export function createHttp(target: HttpTarget = {}) {
  return {
    get: <T>(path: string, schema: ZodType<T>, options?: Omit<RequestOptions, "body">) => request(target, "GET", path, schema, options),
    post: <T>(path: string, schema: ZodType<T>, options?: RequestOptions) => request(target, "POST", path, schema, options),
    /** multipart/form-data, for file uploads (the résumé parser). */
    postForm: <T>(path: string, schema: ZodType<T>, form: FormData, options?: Omit<RequestOptions, "body">) => request(target, "POST", path, schema, { ...options, body: form }),
    patch: <T>(path: string, schema: ZodType<T>, options?: RequestOptions) => request(target, "PATCH", path, schema, options),
    delete: <T>(path: string, schema: ZodType<T>, options?: Omit<RequestOptions, "body">) => request(target, "DELETE", path, schema, options),
  };
}

export const http = createHttp();
